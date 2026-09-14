import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig } from './service-requests.ts';
import { calculateEffortPricing, effortTotalsByMethod, effortPricingSaveIssue, entitlementPricingContext } from './request-pricing.ts';
import { applyAssessmentAction, currentPlan, planGap } from './request-assessment.ts';
import { requestDayRequirements } from './request-asset-coverage.ts';
const services = [
  { id: 'days', name: '部署', category: '实施', priceUnit: '服务人天', defaultQuantity: 1, priceCoefficient: 1.5, deliveryMethods: ['远程'], status: '已启用' },
  { id: 'inspection', name: '基础巡检', category: '运维', priceUnit: '巡检权益', deliveryMethods: ['远程'], status: '已启用' },
  { id: 'upgrade', name: '升级保障', category: '运维', priceUnit: '升级权益', deliveryMethods: ['现场'], status: '已启用' },
];
const objects = [
  { id: 'a', name: '集群A', customerId: 'c', product: 'SMTX OS 系统', status: '启用', nodeCount: 8, inspectionEntitlement: 8, upgradeEntitlement: 3 },
  { id: 'b', name: '集群B', customerId: 'c', product: 'SMTX OS 系统', status: '启用', nodeCount: 4, inspectionEntitlement: 2, upgradeEntitlement: 4 },
];
const context = { businessObjects: objects, conversions: { inspection: { days: 0.3, version: 2 }, upgrade: { days: 0.5, version: 3 } } };
function request(catalog = services) {
  return { ...newRequest('核定', 'c', '经理', '', 'pm', 'SmartX 项目经理'), externalCollaborators: [{ contactId: 'c', name: '客户', phone: '', email: '' }], status: '待评估', items: catalog.map(service => ({ ...newItem(service, defaultConfig(service)), id: service.id, businessObjectIds: service.id === 'days' ? [] : ['a', 'b'] })) };
}
const inputs = record => record.items.map(item => ({ itemId: item.id, estimatedDays: item.id === 'days' ? 2 : 0 }));

test('两类计价合并，预估只汇总人天类；巡检与升级逐集群独立计算差额', () => {
  const record = request();
  const pricing = calculateEffortPricing(record, inputs(record), services, context);
  assert.equal(pricing.estimatedDays, 2);
  assert.equal(pricing.days, 6.1); // 人天3 + 巡检2×0.3 + 升级5×0.5
  assert.deepEqual(pricing.lines.map(line => line.billableDays), [3, 0.6, 2.5]);
  assert.equal(pricing.lines[1].deficitEntitlements, 2);
  assert.equal(pricing.lines[2].deficitEntitlements, 5);
  assert.equal(pricing.lines[1].conversionVersion, 2);
  assert.equal(pricing.lines[1].estimatedDays, 0);
  assert.deepEqual(effortTotalsByMethod(record, pricing.lines), [
    { method: '远程', estimatedDays: 2, days: 3.6 }, { method: '现场', estimatedDays: 0, days: 2.5 },
  ]);
  const saved = { ...record, operations: { assessment: { effort: pricing, plans: [] } } };
  assert.equal(effortPricingSaveIssue(saved, undefined, services, context), null);
  const changed = { ...context, conversions: { ...context.conversions, inspection: { days: 0.4, version: 3 } } };
  assert.match(effortPricingSaveIssue(saved, undefined, services, changed), /不一致/);
  const changedObjects = { ...context, businessObjects: objects.map(object => ({ ...object, inspectionEntitlement: 0 })) };
  assert.match(effortPricingSaveIssue(saved, undefined, services, changedObjects), /不一致/);
  assert.equal(effortPricingSaveIssue(saved, saved, services, changed), null);
  const forged = structuredClone(saved);
  forged.operations.assessment.effort.lines[1].deficitEntitlements = 0;
  assert.match(effortPricingSaveIssue(forged, saved, services, context), /不一致/);
});

test('权益全部覆盖时允许核定0计价人天，并可关联0人天依据和发起客户确认', () => {
  const pm = { id: 'pm', name: '经理', role: 'SmartX 项目经理' };
  const sales = { id: 'sales', name: '销售', status: '启用', department: '销售部' };
  let record = request([services[1]]);
  record.items[0].businessObjectIds = ['a'];
  const act = action => { record = applyAssessmentAction(record, action, pm, [], [sales], [], '2026-09-09T10:00:00Z', services, [{ id: 'c', ownerUserId: sales.id }], context); };
  act({ type: 'review', outcome: '评估通过', opinion: '齐全' });
  act({ type: 'effort', items: inputs(record) });
  assert.equal(record.operations.assessment.effort.days, 0);
  assert.equal(record.operations.assessment.effort.estimatedDays, 0);
  assert.equal(record.operations.assessment.effort.lines[0].deficitEntitlements, 0);
  assert.deepEqual(requestDayRequirements(record), [{ method: '远程', days: 0 }]);
  act({ type: 'plan', salesId: sales.id, allocations: [] });
  assert.equal(planGap(currentPlan(record)), 0);
  act({ type: 'confirm' });
  assert.equal(record.status, '待确认');
  assert.equal(record.operations.assessment.confirmation.assetDays, 0);
});

test('权益类不需要预估人天和目录人天系数；不可引用其他客户或无效集群', () => {
  const record = request([services[1]]);
  const calculate = (ctx = context) => calculateEffortPricing(record, inputs(record), services, ctx);
  assert.equal(calculate().days, 0.6);
  const precision = { ...context, conversions: { inspection: { days: 0.1234, version: 2 } } };
  assert.throws(() => calculate(precision), /换算系数/);
  for (const patch of [{ customerId: 'other' }, { status: '停用' }, { product: '其他产品' }, { inspectionEntitlement: undefined }]) {
    assert.throws(() => calculate({ ...context, businessObjects: objects.map(object => ({ ...object, ...patch })) }));
  }
  assert.throws(() => calculate({ ...context, conversions: {} }), /换算系数/);
  record.items[0].businessObjectIds = [];
  assert.throws(() => calculate(), /请选择业务对象/);
});

test('权益系数读取当前独立配置，未维护时与后台使用相同默认值', () => {
  const defaults = entitlementPricingContext([{ id: 'workspace', payload: { businessObjects: objects } }]);
  assert.equal(defaults.conversions.inspection.days, 0.3);
  assert.equal(defaults.conversions.upgrade.days, 0.3);
  const current = entitlementPricingContext([{ id: 'entitlement-conversion-inspection', payload: [{ version: 1, days: 0.3 }, { version: 2, days: 0.6 }] }]);
  assert.deepEqual(current.conversions.inspection, { version: 2, days: 0.6 });
});
