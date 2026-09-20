import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProjectMapping, parseProjectMapping, mappedProjectItem } from './request-project-mapping.ts';
import { editProjectItems } from './service-project-items.ts';
import { assertProjectItemsWritable } from './service-project-readonly.ts';
const field = id => ({ id, name: id, type: 'text', options: [] });
const service = { id: 'svc', name: '测试服务', deliveryMethods: ['远程'], status: '已启用' };
const config = { serviceId: service.id, revision: 1, versionFieldDefaultRemoved: true, fields: [], fieldNames: {}, fieldOptions: {}, materials: [], basicFields: { description: { enabled: true, required: false }, businessObjects: { enabled: false, required: false } } };
const directory = { services: [service], requestFields: [field('source'), field('installSks')], itemConfigs: [config] };
const item = { id: 'item', serviceId: service.id, serviceName: service.name, description: '原说明', method: '远程', methods: ['远程'], businessObjectIds: [], materials: [],
  config: { ...config, fields: ['source', 'installSks'] }, values: { source: '原值', installSks: '是' } };
const legacy = { ...defaultProjectMapping(), fields: { ...defaultProjectMapping().fields, description: 'serviceName', values: 'values' }, readonly: { name: true, description: true, materials: true, values: true }, itemFields: [{ source: field('source'), target: field('other'), readonly: true }] };

test('固定同字段复制包括 SKS 和隐藏字段，旧跨字段配置不能更换来源', () => {
  const result = mappedProjectItem(item, directory);
  assert.deepEqual(result.values, item.values);
  assert.equal(result.description, item.description);
  assert.deepEqual(result.config.fields, []);
  assert.equal(result.values.other, undefined);
  result.values.source = '独立修改';
  assert.equal(item.values.source, '原值');
  assert.deepEqual(mappedProjectItem(item).values, item.values);
});

test('附件、在线文档及材料要求固定复制，项目中的编辑不改变来源数据', async () => {
  const source = structuredClone(item);
  source.config.materials = [{ id: 'doc', name: '材料', required: true }];
  source.materials = [{ requirementId: 'doc', files: [{ id: 'file', name: '原附件', blob: new Blob(['原内容']) }, { id: 'online', kind: 'online', url: 'https://example.com/doc', content: '原文档' }] }];
  const result = mappedProjectItem(source, directory);
  assert.deepEqual(result.config.materials, source.config.materials);
  assert.equal(await result.materials[0].files[0].blob.text(), '原内容');
  result.materials[0].files[0].name = '新附件名';
  result.materials[0].files[1].content = '新文档';
  result.config.materials[0].required = false;
  assert.equal(source.materials[0].files[0].name, '原附件');
  assert.equal(source.materials[0].files[1].content, '原文档');
  assert.equal(source.config.materials[0].required, true);
});

test('固定映射的隐藏字段在后续保存说明时仍保留', () => {
  const mapping = defaultProjectMapping();
  const mapped = mappedProjectItem(item, directory);
  const project = { id: 'p', createdById: 'pm', customerId: 'c', revision: 1, status: '待启动', items: [mapped], requestConversion: { mapping, workOrders: [{ sourceItemId: item.id }] } };
  const saved = editProjectItems(project, { type: 'save', item: { ...mapped, description: '新说明' } }, { id: 'pm', name: '经理', role: 'SmartX 项目经理' }, { services: [service], businessObjects: [], requests: [] });
  assert.deepEqual(saved.items[0].values, item.values);
  assert.deepEqual(saved.items[0].config.fields, []);
});
