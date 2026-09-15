import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogFormInitializationId, planCatalogFormInitialization } from './catalog-form-initialization.ts';
import { defaultConfig, normalizeCatalogRequestConfig } from './service-requests.ts';

const source = { id: 'SC-IMP-009', name: '备份与容灾-备份组件新装', category: '产品实施交付', version: 2, deliveryMethods: ['远程', '现场'], priceUnit: '服务人天', status: '已启用' };
const other = { ...source, id: 'SC-OPS-001', category: '运维支持或培训', version: 5, status: '已停用', deliveryMethods: ['远程'] };
const template = {
  ...defaultConfig(source), revision: 4, fields: ['edition', 'nodes', 'installSfs'],
  fieldOrder: ['nodes', 'method', 'edition', 'installSfs', 'description'],
  fieldWidths: { nodes: 'full', description: 'half' },
  fieldRequired: { nodes: false, edition: true }, fieldRequiredWhen: { installSfs: 'standard-or-enterprise' },
  fieldOptions: { edition: ['标准版', '企业版'], installSfs: ['是', '否'] },
  materials: [{ id: 'test-material', name: '移交材料', required: true, instructions: '按模板填写', template: { id: 'file-1', name: '模板.txt', blob: new Blob(['模板内容']) } }],
};
function fixture() {
  return { configs: [structuredClone(template)], references: [{ id: 'workspace', payload: { services: [source, other], customers: [{ id: 'c1' }] } }] };
}
const payload = (plan, id) => plan.references.find(record => record.id === id)?.payload;
const comparable = config => { const { serviceId, revision, ...rest } = normalizeCatalogRequestConfig(config); return rest; };

test('所有目录（含停用）两套表单复制字段、布局、条件、选项和材料文件，保留服务属性', async () => {
  const f = fixture();
  const before = structuredClone(f);
  const plan = planCatalogFormInitialization(f.references, f.configs, '2026-09-14T00:00:00Z');
  assert.equal(plan.configs.length, 2);
  for (const service of [source, other]) {
    const internal = plan.configs.find(config => config.serviceId === service.id);
    const customer = payload(plan, `customer-request-config:${service.id}`);
    assert.deepEqual(comparable(internal), comparable(template));
    assert.deepEqual(comparable(customer), comparable(template));
    assert.equal(await customer.materials[0].template.blob.text(), '模板内容');
  }
  const workspace = payload(plan, 'workspace');
  assert.deepEqual(workspace.customers, before.references[0].payload.customers);
  assert.equal(workspace.services[1].status, '已停用');
  assert.deepEqual(workspace.services[1].deliveryMethods, ['远程']);
  assert.equal(workspace.services[1].version, 6);
  assert.deepEqual(f, before);
  assert.equal(payload(plan, catalogFormInitializationId).formCount, 4);
});

test('使用指定 v2 历史快照，不使用后续版本，原配置留在历史中', () => {
  const f = fixture();
  f.references[0].payload.services[0] = { ...source, version: 3 };
  f.configs[0] = { ...template, revision: 5, fields: ['nodes'] };
  f.references.push({ id: `catalog-history:${source.id}`, payload: [{ service: source, internal: template, customer: defaultConfig(source), savedAt: 'old', reason: 'v2' }] });
  const plan = planCatalogFormInitialization(f.references, f.configs, 'now');
  assert.deepEqual(plan.configs[0].fields, template.fields);
  const history = payload(plan, `catalog-history:${source.id}`);
  assert.deepEqual(history.find(entry => entry.service.version === 3).internal.fields, ['nodes']);
  assert.equal(history.at(-1).service.version, 4);
});

test('找不到真实 v2 配置时不使用默认配置覆盖', () => {
  const f = fixture();
  assert.equal(planCatalogFormInitialization(f.references, [], 'now'), null);
  f.references[0].payload.services[0] = { ...source, version: 3 };
  assert.equal(planCatalogFormInitialization(f.references, f.configs, 'now'), null);
});

test('仅初始化一次，后续独立修改及新增目录不会被重复覆盖', () => {
  const f = fixture();
  const plan = planCatalogFormInitialization(f.references, f.configs, 'now');
  plan.configs[0].fields = [];
  assert.equal(planCatalogFormInitialization(plan.references, plan.configs, 'later'), null);
  assert.deepEqual(plan.configs[0].fields, []);
});

test('两套配置独立拷贝且保留权益类服务的强制业务对象约束', () => {
  const f = fixture();
  f.references[0].payload.services.push({ ...other, id: 'entitlement', priceUnit: '巡检权益' });
  const plan = planCatalogFormInitialization(f.references, f.configs, 'now');
  const internal = plan.configs[1];
  internal.fieldOptions.edition.push('测试');
  assert.deepEqual(payload(plan, `customer-request-config:${other.id}`).fieldOptions.edition, template.fieldOptions.edition);
  assert.deepEqual(plan.configs[2].basicFields.businessObjects, { enabled: true, required: true, products: ['SMTX OS 系统'] });
});
