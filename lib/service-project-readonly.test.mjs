import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProjectMapping, parseProjectMapping, mappedServiceProject } from './request-project-mapping.ts';
import { createServiceProjects } from './request-projects.ts';
import { editServiceProject } from './service-projects.ts';
import { editProjectItems } from './service-project-items.ts';
import { projectFieldReadonly, projectItemReadonly, projectCustomerReadonly } from './service-project-readonly.ts';
import { defaultConfig, newItem } from './service-requests.ts';

const actor = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const service = { id: 's1', name: '实施服务', category: '其他', status: '已启用', deliveryMethods: ['远程', '现场'], priceUnit: '人天' };
const customers = [{ id: 'c1', name: '客户甲', status: '启用' }, { id: 'c2', name: '客户乙', status: '启用' }];
const context = { services: [service], businessObjects: [{ id: 'o1', name: '集群', customerId: 'c1', status: '启用', product: 'SMTX OS 系统', nodeCount: 3 }], requests: [] };
function fixture(readonly = {}) {
  const config = { ...defaultConfig(service), fields: ['nodes'], fieldRequired: { nodes: true }, basicFields: { description: { enabled: true, required: false }, businessObjects: { enabled: true, required: false } },
    materials: [{ id: 'doc', name: '项目材料', instructions: '', required: false, deduplicate: true, onlineTemplateUrl: 'https://example.com/template' }] };
  const item = { ...newItem(service, config), description: '服务范围', values: { nodes: '3' }, businessObjectIds: ['o1'], businessObjectSnapshot: { savedAt: '2026-09-16', objects: [] },
    materials: [{ requirementId: 'doc', files: [{ id: 'file', name: '资料.txt', size: 3, blob: new Blob(['abc']), uploadedAt: '2026-09-16T00:00:00Z' }] }] };
  const request = { id: 'request', title: '来源请求', description: '项目说明', customerId: 'c1', status: '待受理', expectedServiceDate: '2026-09-20', items: [item], operations: { activities: [], assessment: { managerId: actor.id } } };
  const field = { id: 'nodes', name: '节点数', type: 'integer', options: [] };
  const mapping = { ...defaultProjectMapping(), readonly };
  const next = createServiceProjects(request, actor, [{ id: 'SP1', name: '项目甲', note: '', itemIds: [item.id] }], 'conversion', '2026-09-16T00:00:00Z', mapping);
  const project = mappedServiceProject(request, next.operations.projectCreation.projects[0], next.operations.projectCreation, mapping, [], { services: [service], requestFields: [field], itemConfigs: [config] });
  // Historical snapshots keep the locks saved before fixed item/material mapping.
  project.requestConversion.mapping = structuredClone(mapping);
  delete project.requestConversion.mapping.itemMappingMode;
  return project;
}
function edit(project, patch) { return editServiceProject(project, { ...project, ...patch }, actor, customers); }

test('每个基本字段独立只读，未锁定字段仍可保存，后续流程状态仍可推进', () => {
  for (const [target, value] of Object.entries({ name: '新名称', expectedServiceDate: '2026-09-21', customerId: 'c2', note: '新说明', serviceProviderId: '' })) {
    const project = fixture({ [target]: true });
    assert.throws(() => edit(project, { [target]: value }), /只读/);
    assert.equal(edit(project, { status: '进行中' }).status, '进行中');
    const unlocked = target === 'name' ? 'note' : 'name';
    assert.equal(edit(project, { [unlocked]: '可以修改' })[unlocked], '可以修改');
  }
});
test('逐项锁定服务项字段，保存层拒绝篡改值、定义及移除，允许修改未锁定说明', () => {
  for (const [target, patch] of Object.entries({ serviceId: { serviceName: '篡改目录' }, method: { method: '现场' }, description: { description: '篡改说明' }, businessObjectIds: { businessObjectIds: [] }, materials: { materials: [] } })) {
    const project = fixture({ [target]: true });
    const item = project.items[0];
    assert.throws(() => editProjectItems(project, { type: 'save', item: { ...item, ...patch } }, actor, context), /只读/);
    assert.throws(() => editProjectItems(project, { type: 'remove', id: item.id }, actor, context), /只读/);
    assert.throws(() => editProjectItems(project, { type: 'save', item: { ...item, config: { ...item.config, fields: [] } } }, actor, context), /只读/);
    if (target !== 'description') assert.equal(editProjectItems(project, { type: 'save', item: { ...item, description: '可修改的说明' } }, actor, context).items[0].description, '可修改的说明');
  }
});
test('请求转换项目客户始终固定，禁止更换客户间接清空材料或业务对象', () => {
  for (const target of ['materials', 'businessObjectIds']) {
    const project = fixture({ [target]: true });
    assert.equal(projectCustomerReadonly(project), true);
    assert.throws(() => edit(project, { customerId: 'c2' }), /只读/);
  }
  assert.throws(() => edit(fixture({ name: true }), { customerId: 'c2' }), /只读/);
  const direct = { ...fixture(), sourceServiceRequestId: undefined, requestConversion: undefined };
  assert.equal(edit(direct, { customerId: 'c2' }).customerId, 'c2');
});
test('共用材料任一来源项只读时阻止通过新项修改，新建独立服务项可编辑', () => {
  const project = fixture({ materials: true, values: true });
  const source = project.items[0];
  const copied = editProjectItems(project, { type: 'copy', id: source.id }, actor, context);
  const copy = copied.items[1];
  assert.equal(projectItemReadonly(copied, copy.id, 'values'), false);
  assert.throws(() => editProjectItems(copied, { type: 'materials', id: copy.id, material: { requirementId: 'doc', files: [] } }, actor, context), /只读/);
  assert.equal(editProjectItems(copied, { type: 'save', item: { ...copy, values: { nodes: '5' } } }, actor, context).items[1].values.nodes, '5');
});
test('保存其他字段保留只读业务对象快照及真实材料字节', async () => {
  const project = fixture({ businessObjectIds: true, materials: true });
  const item = structuredClone(project.items[0]);
  item.materials[0].files[0].blob = new Blob(['xyz']);
  item.description = '更新其他字段';
  const saved = editProjectItems(project, { type: 'save', item }, actor, context);
  assert.equal(await saved.items[0].materials[0].files[0].blob.text(), 'abc');
  assert.deepEqual(saved.items[0].businessObjectSnapshot, project.items[0].businessObjectSnapshot);
});
test('历史映射不默认加锁，只读必须为布尔配置，未映射字段不锁定', () => {
  const legacy = defaultProjectMapping();
  assert.deepEqual(parseProjectMapping(legacy).readonly, { customerId: true });
  assert.equal(projectFieldReadonly(fixture(), 'name'), false);
  for (const readonly of [null, [], 'true', { name: 'true' }, { unsupported: true }]) assert.throws(() => parseProjectMapping({ ...legacy, readonly }), /只读配置无效/);
  const project = fixture({ note: true }); project.requestConversion.mapping.fields.note = '';
  assert.equal(projectFieldReadonly(project, 'note'), false);
});
test('项目保存创建时的只读快照，不随后续后台配置变化', () => {
  const readonly = { name: true };
  const project = fixture(readonly); readonly.name = false;
  assert.equal(projectFieldReadonly(project, 'name'), true);
  assert.throws(() => edit(project, { name: '不可改变' }), /只读/);
});

test('客户只读由系统强制，旧配置和未保存配置均不能关闭', () => {
  assert.equal(defaultProjectMapping().readonly.customerId, true);
  assert.equal(parseProjectMapping({ ...defaultProjectMapping(), readonly: { customerId: false } }).readonly.customerId, true);
  const project = fixture({ customerId: false });
  assert.equal(projectCustomerReadonly(project), true);
  assert.throws(() => edit(project, { customerId: 'c2' }), /只读/);
  delete project.requestConversion;
  assert.equal(projectCustomerReadonly(project), true);
});
