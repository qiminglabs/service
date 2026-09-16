import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareMaterialDeduplication, materialTemplateKeys, requestMaterialGroups, requestMaterialGroup, synchronizeRequestMaterials, saveRequestMaterialGroup, requestMaterialIssues, materialDialogItem } from './request-materials.ts';
import { newItem, newRequest, defaultConfig, requestMaterialFiles, requestMaterialsCustomerVisible, attributeRequestMaterials, customerMaterialSaveIssue, materialFiles, copyRequestItem } from './service-requests.ts';
import { requestCompletenessIssues } from './request-validation-builtins.ts';
import { materialRequiredFor, materialRequiredTypes } from './material-requirements.ts';

const service = { id: 's', name: '部署', priceUnit: '服务人天', status: '已启用', deliveryMethods: ['远程'] };
const employee = { id: 'pm', name: '经理', role: 'SmartX 项目经理' };
const customer = { id: 'c1', name: '客户甲', role: '客户' };
const req = (id, extra = {}) => ({ id, name: '移交材料', required: true, instructions: '', deduplicate: true, onlineTemplateUrl: 'https://docs.example.com/doc/1', ...extra });
const item = (id, requirements) => ({ ...newItem(service, { ...defaultConfig(service), fields: [], materials: requirements }), id, description: '部署' });
const record = (...items) => ({ ...newRequest('实施', 'company', '经理'), expectedServiceDateUncertain: true, businessImpact: '生产环境', items });
const file = (id, audience = 'internal', actor = 'pm') => ({ id, name: `${id}.txt`, size: 3, uploadedAt: '2026-09-14T00:00:00Z', blob: new Blob(['abc']), uploaderAudience: audience, uploadedById: actor });

test('材料按申请类型必传，兼容历史单开关，显式取消不会回退为必传', () => {
  for (const presales of [true, false]) for (const delivery of [true, false]) {
    const requirement = req('typed', { requiredByType: { '技术评估': presales, '服务交付': delivery } });
    const r = record(item('a', [requirement]));
    assert.equal(requestMaterialIssues({ ...r, requestType: '技术评估' }).length, Number(presales));
    assert.equal(requestMaterialIssues({ ...r, requestType: '服务交付' }).length, Number(delivery));
    assert.equal(requestMaterialIssues({ ...r, requestType: undefined }).length, Number(delivery));
  }
  for (const required of [true, false]) assert.deepEqual(materialRequiredTypes(req('old', { required })), { '技术评估': required, '服务交付': required });
  assert.equal(materialRequiredFor(req('old'), ''), false);
});

test('共用材料分别按两种类型合并必传要求，类型切换不修改快照或文件', () => {
  const r = record(item('a', [req('m1', { requiredByType: { '技术评估': true, '服务交付': false } })]), item('b', [req('m2', { requiredByType: { '技术评估': false, '服务交付': true } })]));
  const before = structuredClone(r);
  for (const requestType of ['技术评估', '服务交付']) {
    const typed = { ...r, requestType };
    assert.deepEqual(requestMaterialGroups(typed)[0].requirement.requiredByType, { '技术评估': true, '服务交付': true });
    assert.equal(requestMaterialIssues(typed).length, 1);
    const supplied = saveRequestMaterialGroup(typed, 'b', 'm2', { requirementId: 'm2', files: [file('shared')] }, employee);
    assert.deepEqual(requestMaterialIssues(supplied), []);
  }
  assert.deepEqual(r, before);
});

test('去重须主动启用；同名材料不会合并，相同链接在同一请求内合并，必填取并集', () => {
  const r = record(item('a', [req('m1', { required: false })]), item('b', [req('m2')]), item('c', [req('m3', { deduplicate: false })]), item('d', [req('m4', { onlineTemplateUrl: 'https://docs.example.com/doc/2' })]));
  const groups = requestMaterialGroups(r);
  assert.equal(groups.length, 3);
  assert.equal(groups[0].members.length, 2);
  assert.equal(groups[0].requirement.required, true);
  assert.equal(requestMaterialIssues(r).length, 3);
  assert.equal(requestMaterialGroups(record(item('x', [req('m1')])))[0].shared, false);
  assert.equal(requestMaterialGroups(record(item('a', [req('m1', { onlineTemplateUrl: 'https://docs.example.com/doc/1?v=2' })]), item('b', [req('m2')]))).length, 2);
});

test('相同文件内容生成同一模板标识，忽略文件名差异；同名不同内容保持独立', async () => {
  const prepare = async (name, text) => (await prepareMaterialDeduplication({ ...defaultConfig(service), materials: [req('m', { onlineTemplateUrl: undefined, template: { ...file(name), name, blob: new Blob([text]) } })] })).materials[0];
  const a = await prepare('a.txt', 'same'), b = await prepare('renamed.txt', 'same'), c = await prepare('a.txt', 'different');
  assert.equal(a.templateDigest, b.templateDigest);
  assert.notEqual(a.templateDigest, c.templateDigest);
  assert.equal(requestMaterialGroups(record(item('a', [a]), item('b', [b]), item('c', [c]))).length, 2);
  await assert.rejects(prepareMaterialDeduplication({ ...defaultConfig(service), materials: [req('m', { onlineTemplateUrl: undefined })] }), /文件模板或填写在线文档/);
  assert.deepEqual(materialTemplateKeys(req('m', { onlineTemplateUrl: undefined })), []);
});

test('文件或在线链接任一相同均可去重，多来源连接可合并，配置快照不变', () => {
  const r = record(item('a', [req('m1', { templateDigest: 'same', onlineTemplateUrl: undefined })]), item('b', [req('m2', { templateDigest: 'same' })]), item('c', [req('m3', { onlineTemplateUrl: 'https://docs.example.com/doc/1#heading' })]));
  const before = structuredClone(r);
  assert.equal(requestMaterialGroups(r).length, 1);
  assert.deepEqual(r, before);
});

test('同一行填写一次满足全部关联材料；复制、新增服务项继承共用文档，移除原项不丢失', () => {
  let r = record(item('a', [req('m1')]), item('b', [req('m2')]));
  r = saveRequestMaterialGroup(r, 'a', 'm1', { requirementId: 'm1', files: [file('doc')] }, employee);
  assert.deepEqual(requestMaterialIssues(r), []);
  assert.equal(r.items[1].materials[0].files[0].id, 'doc');
  assert.equal(requestMaterialGroups(r)[0].material.files.length, 1);
  r.items.push(copyRequestItem(r.items[0]));
  r = synchronizeRequestMaterials(r);
  assert.equal(r.items[2].materials[0].files[0].id, 'doc');
  r.items = r.items.slice(1);
  assert.equal(requestMaterialGroups(r)[0].material.files.length, 1);
  r = saveRequestMaterialGroup(r, 'b', 'm2', { requirementId: 'm2', files: [] }, employee);
  assert.equal(requestMaterialIssues(r).length, 1);
  assert.equal(requestMaterialGroups(r)[0].material.files.length, 0);
});

test('客户发起的材料完整可见；保存仍不能移除内部及其他客户文件', () => {
  const a = item('a', [req('m1')]), b = item('b', [req('m2')]);
  a.materials = [{ requirementId: 'm1', files: [file('internal'), file('mine', 'customer', 'c1')] }];
  b.materials = [{ requirementId: 'm2', files: [file('other', 'customer', 'c2')] }];
  const r = { ...record(a, b), createdByAudience: 'customer', createdById: 'c1' };
  const group = requestMaterialGroup(r, 'b', 'm2');
  assert.equal(requestMaterialsCustomerVisible(r), true);
  assert.deepEqual(requestMaterialFiles(r, group.material, 'customer').map(f => f.id), ['internal', 'mine', 'other']);
  const edited = saveRequestMaterialGroup(r, 'a', 'm1', { requirementId: 'm1', files: [file('new', 'customer', 'c1')] }, customer);
  assert.equal(customerMaterialSaveIssue(edited, r, customer), null);
  assert.deepEqual(requestMaterialGroups(edited)[0].material.files.map(f => f.id), ['internal', 'other', 'new']);
  const attributed = attributeRequestMaterials(edited, r, customer);
  assert.equal(attributed.items[0].materials[0].files.find(f => f.id === 'other').uploadedById, 'c2');
  assert.equal(attributed.items[1].materials[0].files.find(f => f.id === 'internal').uploaderAudience, 'internal');
  assert.equal(materialDialogItem(group).materials[0].files.length, 3);
});

test('文件来源不因关联变化；客户发起的申请齐套计入全部材料', () => {
  const r = { ...record(item('a', [req('m1')])), createdByAudience: 'customer', createdById: 'c1' };
  r.items[0].materials = [{ requirementId: 'm1', files: [file('customer-doc', 'customer', 'c1')] }];
  const next = synchronizeRequestMaterials({ ...r, items: [...r.items, item('b', [req('m2')])] });
  const attributed = attributeRequestMaterials(next, r, employee);
  assert.equal(attributed.items[1].materials[0].files[0].uploaderAudience, 'customer');
  assert.equal(requestMaterialIssues(attributed, 'customer').length, 0);
  const replaced = saveRequestMaterialGroup(attributed, 'a', 'm1', { requirementId: 'm1', files: [file('internal-doc')] }, employee);
  assert.equal(requestMaterialIssues(replaced, 'customer').length, 0);
  assert.equal(requestMaterialFiles(replaced, replaced.items[0].materials[0], 'customer')[0].id, 'internal-doc');
  assert.equal(materialFiles(replaced.items[1].materials[0]).length, 1);
});

test('提交齐套按合并材料校验，缺失只提示一次，不改变独立材料校验', () => {
  let r = record(item('a', [req('m1')]), item('b', [req('m2')]));
  const refs = { customers: [{ id: 'company', status: '启用' }], contacts: [], services: [service], businessObjects: [], audience: 'internal', currentActor: employee };
  assert.equal(requestCompletenessIssues(r, refs).filter(issue => issue.includes('上传')).length, 1);
  r = saveRequestMaterialGroup(r, 'a', 'm1', { requirementId: 'm1', files: [file('doc')] }, employee);
  assert.deepEqual(requestCompletenessIssues(r, refs), []);
  r.items.push(item('c', [req('m3', { deduplicate: false })]));
  assert.equal(requestCompletenessIssues(r, refs).filter(issue => issue.includes('上传')).length, 1);
});


test('内部发起的材料整体对客户隐藏，包含客户自己的文件；客户不能保存此区域', () => {
  const r = record(item('a', [req('m1')]));
  r.createdByAudience = 'internal';
  r.items[0].materials = [{ requirementId: 'm1', files: [file('own', 'customer', 'c1'), file('internal')] }];
  assert.equal(requestMaterialsCustomerVisible(r), false);
  assert.deepEqual(requestMaterialFiles(r, r.items[0].materials[0], 'customer'), []);
  assert.equal(requestMaterialFiles(r, r.items[0].materials[0], 'internal').length, 2);
  assert.throws(() => saveRequestMaterialGroup(r, 'a', 'm1', r.items[0].materials[0], customer), /仅内部/);
  r.items[0].materials = [];
  assert.deepEqual(requestMaterialIssues(r, 'customer'), []);
  assert.equal(requestMaterialIssues(r, 'internal').length, 1);
});
