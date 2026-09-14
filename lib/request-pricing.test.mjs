import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig } from './service-requests.ts';
import { calculateEffortPricing, effortPricingSaveIssue, effortTotalsByMethod } from './request-pricing.ts';
import { applyAssessmentAction, assessedEffort, currentPlan, planGap, assetAvailable } from './request-assessment.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { createServiceProjects, serviceProjectCreationEnabled } from './request-projects.ts';
const services = [
  { id: 's1', name: '部署', priceCoefficient: 1.5, defaultQuantity: 0.1, deliveryMethods: ['远程'] },
  { id: 's2', name: '巡检', priceCoefficient: 0.8, defaultQuantity: 0.1, deliveryMethods: ['现场'] },
];
const pm = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const customer = { id: 'contact', name: '客户', role: '客户' };
const sales = { id: 'sales', name: '销售', role: 'SmartX 销售经理', status: '启用', department: '销售部' };
const boss = { id: 'boss', name: '上级', role: 'SmartX 系统管理员', status: '启用', department: '管理部' };
const at = '2026-09-09T10:00:00Z';
const assets = [{ id: 'asset', customerId: 'c', name: '远程人天', status: '启用', balanceDays: 20 }, { id: 'onsite', customerId: 'c', name: '现场人天', status: '启用', balanceDays: 20 }];
function request() {
  return { ...newRequest('计价测试', 'c', pm.name, '', pm.id, pm.role), externalCollaborators: [{ contactId: customer.id, name: '客户', phone: '', email: '' }], status: '待评估',
    items: services.map((service, index) => ({ ...newItem(service, defaultConfig(service)), id: `i${index}` })) };
}
const inputs = [{ itemId: 'i0', estimatedDays: 2 }, { itemId: 'i1', estimatedDays: 3 }];
const act = (r, action, actor = pm, catalog = services) => applyAssessmentAction(r, action, actor, assets, [sales, boss], [], at, catalog, [{ id: r.customerId, ownerUserId: sales.id }]);
const ready = () => act(request(), { type: 'review', outcome: '评估通过', opinion: '齐全' });

test('核定预估人天逐项满足目录最小值，等于最小值允许保存，不能用计价人天代替预估', () => {
  const r = ready();
  const currentCatalog = [{ ...services[0], defaultQuantity: 2 }, { ...services[1], defaultQuantity: 3 }];
  const saved = act(r, { type: 'effort', items: inputs }, pm, currentCatalog);
  assert.equal(effortPricingSaveIssue(saved, r, currentCatalog), null);
  assert.throws(() => act(r, { type: 'effort', items: [{ ...inputs[0], estimatedDays: 1.9 }, inputs[1]] }, pm, currentCatalog), /部署.*最小人天数量 2/);
  assert.throws(() => act(r, { type: 'effort', items: [inputs[0], { ...inputs[1], estimatedDays: 2.9 }] }, pm, currentCatalog), /巡检.*最小人天数量 3/);
  // Coefficient 1.5 would produce 2.9 billable days, but the estimate must still reach 2.
  assert.throws(() => calculateEffortPricing(r, [{ ...inputs[0], estimatedDays: 1.9 }, inputs[1]], currentCatalog), /最小人天数量/);
});

test('实时目录最小值提高阻止提交，降低后可保存，请求与核定均不保存最小值快照', () => {
  const r = ready();
  assert.equal(Object.hasOwn(r.items[0], 'defaultQuantity'), false);
  const saved = act(r, { type: 'effort', items: inputs });
  for (const line of saved.operations.assessment.effort.lines) {
    assert.equal(Object.hasOwn(line, 'defaultQuantity'), false);
    assert.equal(Object.hasOwn(line, 'minimumDays'), false);
  }
  const raised = [{ ...services[0], defaultQuantity: 3 }, services[1]];
  assert.match(effortPricingSaveIssue(saved, r, raised), /最小人天数量 3/);
  r.items[0].defaultQuantity = 0.01; // An old or tampered snapshot must not supply the minimum.
  assert.throws(() => act(r, { type: 'effort', items: inputs }, pm, raised), /最小人天数量 3/);
  const lowered = [{ ...services[0], defaultQuantity: 1 }, services[1]];
  assert.equal(effortPricingSaveIssue(saved, r, lowered), null);
  assert.equal(act(r, { type: 'effort', items: inputs }, pm, lowered).operations.assessment.effort.days, 5.4);
  assert.equal(effortPricingSaveIssue(saved, saved, raised), null); // Unrelated future actions do not rewrite old assessments.
});

test('目录不存在或最小值未维护时阻止核定，不回退到请求中的历史值', () => {
  const r = ready();
  r.items[0].defaultQuantity = 0.01;
  for (const minimum of [undefined, 0, -1, NaN, Infinity]) {
    assert.throws(() => calculateEffortPricing(r, inputs, [{ ...services[0], defaultQuantity: minimum }, services[1]]), /无法获取.*最小人天数量/);
  }
  assert.throws(() => calculateEffortPricing(r, inputs, [services[1]]), /无法获取.*最小人天数量/);
});

test('远程和现场分别汇总，只返回实际存在的服务方式，且不重复累计混合方式', () => {
  const r = request();
  const pricing = calculateEffortPricing(r, inputs, services);
  assert.deepEqual(effortTotalsByMethod(r, pricing.lines), [
    { method: '远程', estimatedDays: 2, days: 3 },
    { method: '现场', estimatedDays: 3, days: 2.4 },
  ]);
  r.items[1].method = '["远程"]';
  assert.deepEqual(effortTotalsByMethod(r, pricing.lines), [{ method: '远程', estimatedDays: 5, days: 5.4 }]);
  r.items.forEach(item => { item.method = '现场'; });
  assert.deepEqual(effortTotalsByMethod(r, pricing.lines), [{ method: '现场', estimatedDays: 5, days: 5.4 }]);
  r.items[0].method = '["远程","现场"]';
  const mixed = effortTotalsByMethod(r, pricing.lines);
  assert.equal(mixed.reduce((sum, total) => sum + total.estimatedDays, 0), 5);
  assert.equal(mixed.find(total => total.method === '未区分').days, 3);
});

test('逐项乘目录系数，重复目录按申请项单独计价，逐项四舍五入到一位小数后汇总', () => {
  const r = request();
  r.items.push({ ...r.items[0], id: 'i2' });
  const result = calculateEffortPricing(r, [...inputs, { itemId: 'i2', estimatedDays: 0.1 }], services);
  assert.equal(result.estimatedDays, 5.1);
  assert.deepEqual(result.lines.map(line => line.billableDays), [3, 2.4, 0.2]);
  assert.equal(result.days, 5.6);
  const small = calculateEffortPricing({ ...r, items: [r.items[0]] }, [{ itemId: 'i0', estimatedDays: 0.1 }], [{ ...services[0], priceCoefficient: 0.01 }]);
  assert.equal(small.days, 0);
});
test('拒绝漏项、重复、其他请求项、无效预估、缺失系数或篡改系数', () => {
  const r = request();
  for (const invalid of [[], [inputs[0], inputs[0]], [inputs[0], { itemId: 'other', estimatedDays: 3 }]])
    assert.throws(() => calculateEffortPricing(r, invalid, services));
  for (const value of [0, -1, NaN, Infinity, 100001, 0.001])
    assert.throws(() => calculateEffortPricing(r, [{ ...inputs[0], estimatedDays: value }, inputs[1]], services));
  assert.throws(() => calculateEffortPricing(r, inputs, [{ ...services[0], priceCoefficient: undefined }, services[1]]), /未配置/);
  assert.throws(() => calculateEffortPricing(r, [{ ...inputs[0], priceCoefficient: 1 }, inputs[1]], services), /已变更/);
  assert.throws(() => act(ready(), { type: 'effort', days: 5 }), /每个/);
});
test('资产锁定、缺口、客户确认和生成工单均使用计价人天，并保存核定快照', () => {
  const before = ready();
  let r = act(before, { type: 'effort', items: inputs, note: '估算依据' });
  assert.equal(assessedEffort(r), 5.4);
  assert.equal(effortPricingSaveIssue(r, before, services), null);
  r = act(r, { type: 'plan', allocations: [{ assetId: 'asset', days: 3 }, { assetId: 'onsite', days: 2 }], salesId: sales.id });
  assert.equal(planGap(currentPlan(r)), 0.4);
  assert.equal(assetAvailable(assets[0], [r], 'other'), 17);
  r = act(r, { type: 'plan', allocations: [{ assetId: 'asset', days: 3 }, { assetId: 'onsite', days: 2.4 }], salesId: sales.id });
  assert.throws(() => act(r, { type: 'plan', allocations: [{ assetId: 'asset', days: 5.5 }], salesId: sales.id }), /计价总人天/);
  r = act(r, { type: 'confirm' });
  assert.equal(r.operations.assessment.confirmation.assetDays, 5.4);
  assert.equal(r.operations.assessment.confirmation.effort, 5.4);
  const approved = applyCustomerDecision(r, customer, 'c', true, '', at);
  if (serviceProjectCreationEnabled) {
  const converted = createServiceProjects(approved, pm, [{ id: 'project', name: '项目', note: '', itemIds: ['i0', 'i1'] }], 'conversion', at);
  assert.deepEqual(converted.operations.projectCreation.projects[0].workOrders.map(order => order.pricing.billableDays), [3, 2.4]);
  assert.notEqual(converted.operations.projectCreation.projects[0].workOrders[0].pricing, r.operations.assessment.effort.lines[0]);
  } else {
    assert.throws(() => createServiceProjects(approved, pm, [{ id: 'project', name: '项目', note: '', itemIds: ['i0', 'i1'] }], 'conversion', at), /待开发/);
  }
  const laterCatalog = [{ ...services[0], priceCoefficient: 9 }, services[1]];
  assert.equal(effortPricingSaveIssue(approved, r, laterCatalog), null);
  assert.equal(assessedEffort(approved), 5.4);
});
test('保存校验拒绝篡改总额与明细，旧总额记录保持原值，重新核定必须填明细', () => {
  const before = ready();
  const saved = act(before, { type: 'effort', items: inputs });
  const tampered = structuredClone(saved);
  tampered.operations.assessment.effort.days = 5;
  assert.match(effortPricingSaveIssue(tampered, before, services), /不一致/);
  tampered.operations.assessment.effort.days = 5.4;
  tampered.operations.assessment.effort.lines[0].priceCoefficient = 1;
  assert.match(effortPricingSaveIssue(tampered, before, services), /已变更/);
  assert.match(effortPricingSaveIssue(saved, before, [{ ...services[0], priceCoefficient: 2 }, services[1]]), /已变更/);
  const legacy = structuredClone(before);
  legacy.operations.assessment.effort = { days: 7, at, author: '项目经理' };
  assert.equal(assessedEffort(legacy), 7);
  assert.equal(effortPricingSaveIssue(legacy, legacy, services), null);
  assert.equal(assessedEffort(act(legacy, { type: 'effort', items: inputs })), 5.4);
});
test('计价总额变化后释放预留，备注修改保留方案，审批中禁止重新核定', () => {
  let r = act(ready(), { type: 'effort', items: inputs });
  r = act(r, { type: 'plan', allocations: [{ assetId: 'asset', days: 3 }, { assetId: 'onsite', days: 2 }], salesId: sales.id });
  const noteOnly = act(r, { type: 'effort', items: inputs, note: '补充备注' });
  assert.deepEqual(currentPlan(noteOnly), currentPlan(r));
  const changed = act(r, { type: 'effort', items: [{ ...inputs[0], estimatedDays: 3 }, inputs[1]] });
  assert.equal(currentPlan(changed), undefined);
  assert.equal(effortPricingSaveIssue(changed, r, services), null);
  r.operations.assessment.approvals.push({ planId: currentPlan(r).id, state: '待审批' });
  assert.throws(() => act(r, { type: 'effort', items: inputs }), /审批中/);
});
