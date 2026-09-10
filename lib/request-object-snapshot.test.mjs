import test from 'node:test';
import assert from 'node:assert/strict';
import { newItem, defaultConfig, snapshotItemBusinessObjects, savedItemBusinessObjects, itemSummaryFields, itemDisplayFields, normalizeStoredRequest, newRequest } from './service-requests.ts';
import { calculateEntitlementPricing } from './request-pricing.ts';

const service = { id: 'inspection', name: '巡检', category: '运维', priceUnit: '巡检权益', deliveryMethods: ['远程'], status: '已启用' };
const cluster = () => ({ id: 'cluster', name: '原集群', customerId: 'c', product: 'SMTX OS 系统', status: '启用', nodeCount: 8, inspectionEntitlement: 8, upgradeEntitlement: 4, sn: 'original-sn' });
const item = () => ({ ...newItem(service, defaultConfig(service)), businessObjectIds: ['cluster'] });
const capture = (value, objects, records = []) => snapshotItemBusinessObjects(value, objects, service.priceUnit, records, 'request', 'c');

test('申请项保存后固定对象名称、节点和权益；重新保存才更新，不修改原申请项', () => {
  const object = cluster();
  const original = item();
  const saved = capture(original, [object]);
  assert.equal(original.businessObjectSnapshot, undefined);
  Object.assign(object, { name: '新集群', nodeCount: 12, inspectionEntitlement: 3, sn: 'new-sn' });
  const view = savedItemBusinessObjects(saved)[0];
  assert.equal(view.object.name, '原集群');
  assert.equal(view.object.sn, 'original-sn');
  assert.deepEqual(view.entitlement, { name: '巡检权益', available: 8, required: 8, insufficient: false });
  for (const fields of [itemSummaryFields(saved, {}, [object]), itemDisplayFields(saved, {}, [object])]) {
    assert.equal(fields.find(field => field.key === 'businessObjects').value, '原集群');
  }
  const edited = capture(saved, [object]);
  assert.equal(savedItemBusinessObjects(edited)[0].object.nodeCount, 12);
  assert.equal(savedItemBusinessObjects(edited)[0].entitlement.available, 3);
  assert.equal(savedItemBusinessObjects(saved)[0].object.nodeCount, 8);
});

test('快照记录可用权益，扣除其他申请冻结，排除本申请冻结；后续释放不回写', () => {
  const lock = id => ({ id, customerId: 'c', status: '待评估', operations: { assessment: { plans: [{ entitlementAllocations: [{ itemId: 'i', objectId: 'cluster', kind: 'inspection', quantity: 3 }] }] } } });
  const saved = capture(item(), [cluster()], [lock('other'), lock('request')]);
  assert.equal(savedItemBusinessObjects(saved)[0].entitlement.available, 5);
  assert.equal(savedItemBusinessObjects(capture(saved, [cluster()]))[0].entitlement.available, 8);
  assert.equal(savedItemBusinessObjects(saved)[0].entitlement.available, 5);
});

test('保存材料、提交和重新读取保留原快照；旧记录不自动补写当前数据', () => {
  const saved = capture(item(), [cluster()]);
  const record = { ...newRequest('申请', 'c', '申请人'), status: '待评估', items: [{ ...saved, materials: [] }] };
  const reopened = normalizeStoredRequest(JSON.parse(JSON.stringify(record)));
  assert.deepEqual(reopened.items[0].businessObjectSnapshot, saved.businessObjectSnapshot);
  assert.equal(savedItemBusinessObjects(item())[0].recorded, false);
  assert.equal(savedItemBusinessObjects(item())[0].entitlement, null);
  assert.equal(normalizeStoredRequest({ ...record, items: [item()] }).items[0].businessObjectSnapshot, undefined);
});

test('核定仍使用当前权益而不是申请展示快照，并验证编辑对象仍可用', () => {
  const object = cluster();
  const saved = capture(item(), [object]);
  object.inspectionEntitlement = 2;
  const record = { ...newRequest('申请', 'c', '申请人'), id: 'request', items: [saved] };
  const line = calculateEntitlementPricing(record, saved, [service], { businessObjects: [object], conversions: { inspection: { days: 0.5, version: 1 } } });
  assert.equal(line.deficitEntitlements, 6);
  assert.equal(savedItemBusinessObjects(saved)[0].entitlement.available, 8);
  assert.throws(() => capture(saved, [{ ...object, customerId: 'other' }]), /取消关联/);
  assert.throws(() => capture(saved, [{ ...object, status: '停用' }]), /取消关联/);
  assert.throws(() => capture(saved, []), /取消关联/);
  assert.deepEqual(savedItemBusinessObjects(capture({ ...saved, businessObjectIds: [] }, [])), []);
});
