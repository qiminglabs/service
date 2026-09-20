import test from 'node:test';
import assert from 'node:assert/strict';
import { isDayQuantity, parseDayQuantity, roundDays, formatDays, workspaceDayQuantityIssue } from './day-quantity.ts';
import { calculateBillableDays, calculateEffortPricing, effortPricingSaveIssue } from './request-pricing.ts';
import { applyAssessmentAction, assessmentLockIssue, assetAvailable, currentPlan } from './request-assessment.ts';
import { appendConversionVersion } from './entitlement-conversions.ts';

test('人天输入支持整数和一位小数，拒绝多位、负数、无效值及科学计数法输入', () => {
  for (const [raw, value] of [['0', 0], ['1', 1], ['0.1', 0.1], [' 2.5 ', 2.5]])
    assert.equal(parseDayQuantity(raw), value);
  for (const raw of ['', ' ', '-0.1', '0.01', '2.25', '1.00', '1e1', 'NaN', 'Infinity'])
    assert.equal(parseDayQuantity(raw), null, raw);
  for (const value of [NaN, Infinity, -1, 0.01, 1.25]) assert.equal(isDayQuantity(value), false);
  assert.equal(isDayQuantity(0.1 + 0.2), true);
});

test('服务目录创建和编辑允许最小人天为零，仍拒绝负数和无效精度', () => {
  const zero = { services: [{ id: 's', priceUnit: '服务人天', defaultQuantity: 0 }] };
  assert.equal(workspaceDayQuantityIssue(zero), null);
  assert.equal(workspaceDayQuantityIssue(zero, { services: [{ id: 's', defaultQuantity: 1 }] }), null);
  for (const value of [-0.1, NaN, Infinity, 0.01]) {
    assert.match(workspaceDayQuantityIssue({ services: [{ id: 's', defaultQuantity: value }] }), /最小人天/);
  }
});

test('半数舍入使用一位小数，保留计价系数两位精度，逐项舍入后合计', () => {
  assert.equal(roundDays(1.15), 1.2);
  assert.equal(calculateBillableDays(0.1, 1.5), 0.2);
  assert.equal(calculateBillableDays(0.7, 1.6), 1.1);
  assert.equal(calculateBillableDays(1, 1.25), 1.3);
  assert.equal(calculateBillableDays(0.1, 0.1), 0);
  const services = [{ id: 's', priceCoefficient: 1.5, defaultQuantity: 0.1 }];
  const record = { items: [{ id: 'a', serviceId: 's' }, { id: 'b', serviceId: 's' }] };
  const priced = calculateEffortPricing(record, record.items.map(item => ({ itemId: item.id, estimatedDays: 0.1 })), services);
  assert.deepEqual(priced.lines.map(line => line.billableDays), [0.2, 0.2]);
  assert.equal(priced.days, 0.4);
});

test('资产和目录保存拒绝多位人天，历史余额和目录未改变时保持原值', () => {
  const old = { assets: [{ id: 'a', balanceDays: 2.75 }], services: [{ id: 's', defaultQuantity: 0.25 }] };
  const snapshot = structuredClone(old);
  assert.equal(workspaceDayQuantityIssue(old, old), null);
  assert.match(workspaceDayQuantityIssue({ assets: [{ id: 'a', balanceDays: 2.76 }] }, old), /余额人天/);
  assert.match(workspaceDayQuantityIssue({ services: [{ id: 's', defaultQuantity: 0.26 }] }, old), /最小人天/);
  assert.equal(workspaceDayQuantityIssue({ assets: [{ id: 'a', balanceDays: 2.7 }], services: [{ id: 's', defaultQuantity: 0.3 }] }, old), null);
  assert.deepEqual(old, snapshot);
  assert.equal(assetAvailable({ id: 'a', balanceDays: 2.75 }, [], ''), 2.7);
  assert.equal(assetAvailable({ id: 'a', balanceDays: 0.09 }, [], ''), 0);
  assert.equal(formatDays(2.75), '2.75'); // Historical balance remains exact, not 2.8.
  assert.throws(() => appendConversionVersion([], 0.25, '管理员', ''), /一位小数/);
});

test('核定、锁定、缺口及客户确认使用同一计价数，存储校验拒绝多位锁定', () => {
  const actor = { id: 'pm', name: '经理', role: 'SmartX 项目经理' };
  const sales = { id: 'sales', name: '销售', status: '启用', department: '销售部' };
  const assets = [{ id: 'a', name: '远程人天', customerId: 'c', status: '启用', balanceDays: 1.5 }];
  const services = [{ id: 's', priceUnit: '服务人天', priceCoefficient: 1.5, defaultQuantity: 0.1 }];
  const before = { id: 'r', createdById: actor.id, createdByAudience: 'internal', customerId: 'c', externalCollaborators: [{ contactId: 'c', name: '客户', phone: '', email: '' }], status: '待评估', items: [{ id: 'i', serviceId: 's', serviceName: '部署', method: '远程' }],
    operations: { activities: [], assessment: { managerId: 'pm', rounds: [{ id: 'round', outcome: '评估通过' }], plans: [], approvals: [] } } };
  const act = (record, action) => applyAssessmentAction(record, action, actor, assets, [sales], [], '2026-09-10T10:00:00Z', services, [{ id: 'c', ownerUserId: 'sales' }]);
  const assessed = act(before, { type: 'effort', items: [{ itemId: 'i', estimatedDays: 0.1 }] });
  assert.equal(assessed.operations.assessment.effort.days, 0.2);
  assert.equal(effortPricingSaveIssue(assessed, before, services), null);
  assert.throws(() => act(assessed, { type: 'plan', allocations: [{ assetId: 'a', days: 0.15 }] }), /一位小数/);
  const planned = act(assessed, { type: 'plan', allocations: [{ assetId: 'a', days: 0.2 }] });
  assert.equal(assetAvailable(assets[0], [planned], 'other'), 1.5);
  const forged = structuredClone(planned);
  currentPlan(forged).allocations[0].days = 0.15;
  assert.match(assessmentLockIssue(forged, [], assets), /一位小数/);
  const confirmed = act(planned, { type: 'confirm' });
  assert.equal(assetAvailable(assets[0], [confirmed], 'other'), 1.3);
  assert.equal(confirmed.operations.assessment.confirmation.assetDays, 0.2);
  assert.equal(confirmed.operations.assessment.confirmation.effort, 0.2);
});
