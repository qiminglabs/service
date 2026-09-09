import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, resolveRequestConfig, applyCatalogConfigRules, newItem, itemBasicIssues, matchesObjectProduct } from './service-requests.ts';

for (const priceUnit of ['巡检权益', '升级权益']) {
  test(`${priceUnit}：两套配置及新申请强制业务对象必填，仅限 SMTX OS 系统`, () => {
    const service = { id: 'entitlement', name: '权益', category: '运维支持或培训', priceUnit, deliveryMethods: ['远程'], status: '已启用' };
    const legacy = { ...defaultConfig(service), basicFields: { description: { enabled: true, required: false }, businessObjects: { enabled: false, required: false, products: ['其他产品'] } } };
    for (const configs of [[], [legacy]]) {
      const config = resolveRequestConfig(service, configs);
      assert.deepEqual(config.basicFields.businessObjects, { enabled: true, required: true, products: ['SMTX OS 系统'] });
      assert.equal(matchesObjectProduct({ product: '其他产品' }, config), false);
      assert.equal(matchesObjectProduct({ product: 'SMTX OS 系统' }, config), true);
    }
    const item = newItem(service, legacy);
    assert.ok(itemBasicIssues(item).includes('业务对象'));
    assert.equal(item.priceCoefficient, undefined);
    assert.equal(legacy.basicFields.businessObjects.required, false);
    assert.deepEqual(applyCatalogConfigRules(service, legacy).basicFields.businessObjects.products, ['SMTX OS 系统']);
  });
}
test('服务人天保留原业务对象配置', () => {
  const service = { id: 'days', name: '服务', category: '产品实施交付', priceUnit: '服务人天', deliveryMethods: ['远程'], status: '已启用' };
  const config = defaultConfig(service);
  assert.equal(applyCatalogConfigRules(service, config), config);
  assert.equal(config.basicFields.businessObjects.enabled, false);
});
