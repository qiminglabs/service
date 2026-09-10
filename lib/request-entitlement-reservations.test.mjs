import test from 'node:test';
import assert from 'node:assert/strict';
import { newItem, newRequest, defaultConfig, objectEntitlementAvailability } from './service-requests.ts';
import { applyAssessmentAction, currentPlan, assessmentLockIssue } from './request-assessment.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { entitlementAvailable, activeEntitlementAllocations, entitlementLockIssue } from './request-entitlement-reservations.ts';
import { calculateEffortPricing } from './request-pricing.ts';
const service = { id: 'inspection', name: '巡检', category: '运维', priceUnit: '巡检权益', deliveryMethods: ['远程'], status: '已启用' };
const upgrade = { ...service, id: 'upgrade', name: '升级', priceUnit: '升级权益' };
const object = { id: 'cluster', name: '集群', customerId: 'c', product: 'SMTX OS 系统', status: '启用', nodeCount: 8, inspectionEntitlement: 8, upgradeEntitlement: 8 };
const pm = { id: 'pm', name: '经理', role: 'SmartX 项目经理' };
const sales = { id: 'sales', name: '销售', status: '启用', department: '销售部' };
const customer = { id: 'contact', name: '客户', role: '客户' };
const context = { businessObjects: [object], conversions: { inspection: { days: 0.3, version: 1 }, upgrade: { days: 0.5, version: 1 } } };
const now = '2026-09-09T13:00:00Z';
const act = (record, action, records = [], ctx = context) => applyAssessmentAction(record, action, pm, [], [sales], records, now, [service, upgrade], [{ id: 'c', ownerUserId: sales.id }], ctx);
const effort = record => ({ type: 'effort', items: record.items.map(item => ({ itemId: item.id, estimatedDays: 0 })) });
const plan = { type: 'plan', salesId: sales.id, allocations: [] };
function ready(id = 'A', catalog = [service], records = []) {
  let record = { ...newRequest('权益申请', 'c', '销售', 'contact', 'sales', 'SmartX 销售经理'), id, externalCollaborators: [{ contactId: 'contact', name: '客户', phone: '', email: '' }], status: '待评估', items: catalog.map((entry, index) => ({ ...newItem(entry, defaultConfig(entry)), id: `${id}-${index}`, businessObjectIds: [object.id] })) };
  record = act(record, { type: 'review', outcome: '评估通过', opinion: '通过' }, records);
  return act(record, effort(record), records);
}

test('关联依据时冻结，同类其他请求不能重复占用，计价和业务对象列表扣除已冻结权益', () => {
  const unlinked = ready();
  assert.equal(entitlementAvailable(object, 'inspection', [unlinked]), 8);
  const a = act(unlinked, plan);
  assert.equal(activeEntitlementAllocations(a)[0].quantity, 8);
  assert.equal(entitlementAvailable(object, 'inspection', [a]), 0);
  assert.equal(entitlementAvailable(object, 'inspection', [a], a.id), 8);
  assert.equal(entitlementAvailable(object, 'upgrade', [a]), 8);
  assert.deepEqual(objectEntitlementAvailability(object, '巡检权益', [a]), { name: '巡检权益', available: 0, required: 8, insufficient: true });
  const b = ready('B', [service], [a]);
  assert.equal(b.operations.assessment.effort.days, 2.4);
  assert.equal(b.operations.assessment.effort.lines[0].deficitEntitlements, 8);
  // 两个请求同时完成核定，后保存者必须重新核定，不能超额冻结。
  const stale = ready('stale');
  assert.throws(() => act(stale, plan, [a]), /已被占用/);
  const raced = act(stale, plan);
  assert.match(assessmentLockIssue(raced, [a], [], [object]), /已被占用/);
});

test('重新关联不会重复冻结；计价不变但权益用量变化也释放旧方案', () => {
  const a = act(ready(), plan);
  const replaced = act(a, plan, [a]);
  assert.equal(replaced.operations.assessment.plans[0].releasedAt, now);
  assert.equal(entitlementAvailable(object, 'inspection', [replaced]), 0);
  assert.equal(activeEntitlementAllocations(replaced).length, 1);
  const updatedObject = { ...object, nodeCount: 4, inspectionEntitlement: 4, upgradeEntitlement: 4 };
  const repriced = act(a, effort(a), [a], { ...context, businessObjects: [updatedObject] });
  assert.equal(repriced.operations.assessment.effort.days, 0);
  assert.equal(currentPlan(repriced), undefined);
  assert.equal(activeEntitlementAllocations(repriced).length, 0);
  assert.equal(entitlementAvailable(updatedObject, 'inspection', [repriced]), 4);
});

test('退回草稿和取消释放，客户拒绝和通过均保留冻结', () => {
  const a = act(ready(), plan);
  const returned = act(a, { type: 'return-draft', reason: '补充' }, [a]);
  assert.equal(entitlementAvailable(object, 'inspection', [returned]), 8);
  assert.equal(returned.operations.assessmentHistory.at(-1).plans.at(-1).releasedAt, now);
  assert.equal(entitlementAvailable(object, 'inspection', [{ ...a, status: '已取消' }]), 8);
  const pending = act(a, { type: 'confirm' }, [a]);
  assert.equal(pending.operations.assessment.confirmation.entitlementAllocations[0].quantity, 8);
  for (const accepted of [true, false]) {
    const decided = applyCustomerDecision(pending, customer, 'c', accepted, '补充说明');
    assert.equal(entitlementAvailable(object, 'inspection', [decided]), 0);
    assert.equal(currentPlan(decided).id, currentPlan(a).id);
  }
});

test('同一请求重复使用同集群同类权益时只分配一次，巡检和升级互不占用', () => {
  const record = ready('repeat', [service, service, upgrade]);
  const lines = record.operations.assessment.effort.lines;
  assert.deepEqual(lines.map(line => line.deficitEntitlements), [0, 8, 0]);
  assert.deepEqual(lines.map(line => line.billableDays), [0, 2.4, 0]);
  const linked = act(record, plan);
  assert.equal(activeEntitlementAllocations(linked).length, 2);
  assert.equal(entitlementAvailable(object, 'inspection', [linked]), 0);
  assert.equal(entitlementAvailable(object, 'upgrade', [linked]), 0);
  const forged = structuredClone(linked);
  forged.operations.assessment.plans.at(-1).entitlementAllocations = [];
  assert.match(entitlementLockIssue(forged, [], [object]), /不一致/);
  // 已有核定权益的旧方案兼容冻结；已释放的旧方案不计入。
  const legacy = structuredClone(linked);
  delete legacy.operations.assessment.plans.at(-1).entitlementAllocations;
  assert.equal(entitlementAvailable(object, 'inspection', [legacy]), 0);
  legacy.operations.assessment.plans.at(-1).releasedAt = now;
  assert.equal(entitlementAvailable(object, 'inspection', [legacy]), 8);
});
