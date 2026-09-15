import test from 'node:test';
import assert from 'node:assert/strict';
import { objectEntitlementAvailability, defaultConfig, newItem, newRequest, requestIssues } from './service-requests.ts';
const cluster = { id: 'cluster', customerId: 'customer', name: '生产集群', status: '启用', product: 'SMTX OS 系统', nodeCount: 8, inspectionEntitlement: 8, upgradeEntitlement: 3 };

test('按目录权益类型展示当前可用数/节点数，仅低于节点数提示不足', () => {
  assert.deepEqual(objectEntitlementAvailability(cluster, '巡检权益'), { name: '巡检权益', available: 8, required: 8, insufficient: false });
  assert.deepEqual(objectEntitlementAvailability(cluster, '升级权益'), { name: '升级权益', available: 3, required: 8, insufficient: true });
  assert.equal(objectEntitlementAvailability({ ...cluster, inspectionEntitlement: 0 }, '巡检权益').insufficient, true);
  assert.equal(objectEntitlementAvailability({ ...cluster, upgradeEntitlement: 8 }, '升级权益').insufficient, false);
  assert.equal(objectEntitlementAvailability(cluster, '服务人天'), null);
  assert.equal(objectEntitlementAvailability(cluster), null);
  assert.equal(objectEntitlementAvailability({ ...cluster, inspectionEntitlement: undefined }, '巡检权益').available, undefined);
});

for (const priceUnit of ['巡检权益', '升级权益']) {
  test(`${priceUnit}为零也不阻止内部或客户发起申请`, () => {
    const service = { id: 'catalog', name: priceUnit, category: '运维支持或培训', priceUnit, deliveryMethods: ['远程'], status: '已启用' };
    const config = { ...defaultConfig(service), materials: [], fields: [], basicFields: { description: { enabled: true, required: false } } };
    const item = { ...newItem(service, config), businessObjectIds: [cluster.id] };
    const record = { ...newRequest('权益服务', 'customer', '申请人', '', 'contact', '客户'), expectedServiceDateUncertain: true, businessImpact: '生产环境', items: [item] };
    const refs = { customers: [{ id: 'customer', status: '启用' }], contacts: [{ id: 'contact', customerId: 'customer', status: '启用' }], services: [service], businessObjects: [{ ...cluster, inspectionEntitlement: 0, upgradeEntitlement: 0 }] };
    assert.equal(objectEntitlementAvailability(refs.businessObjects[0], priceUnit).insufficient, true);
    for (const audience of ['internal', 'customer']) assert.deepEqual(requestIssues(record, { ...refs, audience }), []);
  });
}
