import test from 'node:test';
import assert from 'node:assert/strict';
import { clearHiddenItemFields, clearHiddenRequestFields, newItem, newRequest, snapshotItemBusinessObjects } from './service-requests.ts';

const service = { id: 's', name: '服务', deliveryMethods: ['现场', '远程'], category: '运维', priceUnit: '人天' };
function item() {
  const config = {
    serviceId: 's', revision: 2,
    fields: ['edition', 'installSfs', 'installSks', 'legacy-address', 'optional'],
    fieldRequiredWhen: { installSfs: 'standard-or-enterprise', installSks: 'enterprise', 'legacy-address': 'onsite' },
    fieldRequired: { optional: false }, fieldNames: {}, fieldOptions: {}, materials: [],
    basicFields: { description: { enabled: true, required: false }, businessObjects: { enabled: true, required: false } },
  };
  return { ...newItem(service, config), method: '现场', description: '保留说明', businessObjectIds: ['object'], values: {
    edition: '企业版', installSfs: '是', installSks: '否', 'legacy-address': '已填写的地址', optional: '保留选填值',
  } };
}

test('编辑期间切换回来保留选择；保存副本清除全部隐藏条件字段，包括历史或自定义地址', () => {
  const editing = item();
  editing.values.edition = '基础版';
  editing.method = '远程';
  const saved = clearHiddenItemFields(editing);
  assert.deepEqual(saved.values, { edition: '基础版', optional: '保留选填值' });
  assert.equal(editing.values.installSfs, '是');
  assert.equal(editing.values.installSks, '否');
  assert.equal(editing.values['legacy-address'], '已填写的地址');
  editing.values.edition = '企业版';
  editing.method = '现场';
  assert.deepEqual(clearHiddenItemFields(editing).values, editing.values);
  assert.deepEqual(clearHiddenItemFields(saved), saved);
});

test('标准版保留 SFS、清除 SKS；现场多选保留地址；已保存后切回企业版不恢复隐藏旧值', () => {
  const editing = item();
  editing.values.edition = '标准版';
  editing.method = '["远程","现场"]';
  const saved = clearHiddenItemFields(editing);
  assert.equal(saved.values.installSfs, '是');
  assert.equal(Object.hasOwn(saved.values, 'installSks'), false);
  assert.equal(saved.values['legacy-address'], '已填写的地址');
  saved.values.edition = '企业版';
  assert.equal(saved.values.installSks, undefined);
});

test('未启用的基础字段及不在表单中的旧值清除，配置、可见字段和附件保留', async () => {
  const editing = item();
  editing.config.basicFields.description.enabled = false;
  editing.config.basicFields.businessObjects.enabled = false;
  editing.businessObjectSnapshot = { savedAt: 'before', objects: [{ object: { id: 'object' } }] };
  editing.values.removedField = '已移除字段的旧值';
  editing.materials = [{ requirementId: 'material', files: [{ id: 'file', blob: new Blob(['附件内容']) }] }];
  const original = structuredClone(editing);
  const saved = snapshotItemBusinessObjects(editing, [], undefined, [], 'request', 'customer');
  assert.equal(saved.description, '');
  assert.deepEqual(saved.businessObjectIds, []);
  assert.equal(Object.hasOwn(saved, 'businessObjectSnapshot'), false);
  assert.equal(Object.hasOwn(saved.values, 'removedField'), false);
  assert.equal(saved.values.installSfs, '是');
  assert.deepEqual(saved.config, original.config);
  assert.equal(await saved.materials[0].files[0].blob.text(), '附件内容');
  assert.deepEqual(editing, original);
});

test('整单按各服务项当前条件清理，不改写原编辑对象、会议和其他记录', () => {
  const a = item();
  const b = item();
  b.values.edition = '基础版';
  const record = { ...newRequest('申请', 'customer', '申请人'), items: [a, b], operations: { activities: [{ detail: '已有记录' }] } };
  const saved = clearHiddenRequestFields(record);
  assert.equal(saved.items[0].values.installSfs, '是');
  assert.equal(saved.items[1].values.installSfs, undefined);
  assert.equal(record.items[1].values.installSfs, '是');
  assert.deepEqual(saved.operations, record.operations);
});
