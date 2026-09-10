import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig } from './service-requests.ts';
import { applyAssessmentAction, currentPlan, planGap, assessmentLockIssue, assetAvailable, planSalesOwnerIssue } from './request-assessment.ts';
import { assetDayMethod, requestDayRequirements, planDayGaps, coverageByMethod } from './request-asset-coverage.ts';
const pm = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理', status: '启用', department: '销售部' };
const boss = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员', status: '启用', department: '服务部' };
const services = [{ id: 'remote', name: '远程培训', deliveryMethods: ['远程'], priceCoefficient: 1.5, defaultQuantity: 1 },
  { id: 'onsite', name: '现场部署', deliveryMethods: ['现场'], priceCoefficient: 1, defaultQuantity: 1 }];
const assets = [{ id: 'r', name: '远程人天', customerId: 'c', status: '启用', balanceDays: 10 },
  { id: 's', name: '现场人天', customerId: 'c', status: '启用', balanceDays: 10 },
  { id: 'r2', name: '远程人天加购', customerId: 'c', status: '启用', balanceDays: 10 }];
const at = '2026-09-09T12:00:00Z';
const act = (record, action, actor = pm) => applyAssessmentAction(record, action, actor, assets, [sales, boss], [], at, services, [{ id: record.customerId, ownerUserId: sales.id }]);
function ready(onlyRemote = false) {
  let record = { ...newRequest('分类锁定', 'c', '销售'), externalCollaborators: [{ contactId: 'c', name: '客户', phone: '', email: '' }], status: '待评估',
    items: (onlyRemote ? [services[0]] : services).map(service => ({ ...newItem(service, defaultConfig(service)), id: service.id })) };
  record = act(record, { type: 'review', outcome: '评估通过', opinion: '通过' });
  return act(record, { type: 'effort', items: record.items.map(item => ({ itemId: item.id, estimatedDays: 2 })) });
}
const link = (record, allocations) => act(record, { type: 'plan', salesId: sales.id, allocations });
test('按计价远程与现场分别限定资产，不允许跨类别抵扣或同类多资产合计超额', () => {
  const record = ready();
  assert.deepEqual(requestDayRequirements(record), [{ method: '远程', days: 3 }, { method: '现场', days: 2 }]);
  assert.throws(() => link(record, [{ assetId: 's', days: 3 }]), /现场计价总人天 2/);
  assert.throws(() => link(record, [{ assetId: 'r', days: 4 }, { assetId: 's', days: 1 }]), /远程计价总人天 3/);
  assert.throws(() => link(record, [{ assetId: 'r', days: 2 }, { assetId: 'r2', days: 2 }]), /远程计价总人天 3/);
  assert.throws(() => link(ready(true), [{ assetId: 's', days: 1 }]), /没有现场计价人天/);
  const linked = link(record, [{ assetId: 'r', days: 1 }, { assetId: 'r2', days: 2 }, { assetId: 's', days: 2 }]);
  assert.equal(planGap(currentPlan(linked)), 0);
  assert.equal(assessmentLockIssue(linked, [linked], assets), null);
});
test('分类型缺口传给销售特批及客户确认，某类余额富余不能补另一类', () => {
  let record = link(ready(), [{ assetId: 'r', days: 1 }, { assetId: 's', days: 1 }]);
  const gaps = [{ method: '远程', days: 2 }, { method: '现场', days: 1 }];
  assert.deepEqual(planDayGaps(currentPlan(record)), gaps);
  assert.equal(planGap(currentPlan(record)), 3);
  assert.throws(() => act(record, { type: 'confirm' }), /特批/);
  record = act(record, { type: 'gap-submit', reason: '服务额度不足', approverId: boss.id }, sales);
  const approval = record.operations.assessment.approvals.at(-1);
  assert.deepEqual(approval.gaps, gaps);
  record = act(record, { type: 'gap-decide', id: approval.id, approve: true, note: '通过' }, boss);
  record = act(record, { type: 'confirm' });
  assert.deepEqual(record.operations.assessment.confirmation.extraDaysByMethod, gaps);
  assert.deepEqual(record.operations.assessment.confirmation.allocations.map(row => row.method), ['远程', '现场']);
  assert.equal(assetAvailable(assets[0], [record], 'another'), 9);
});
test('没有资产时仍保留两种缺口，旧不匹配方案在保存与确认时被拦截', () => {
  const record = link(ready(), []);
  assert.deepEqual(planDayGaps(currentPlan(record)), [{ method: '远程', days: 3 }, { method: '现场', days: 2 }]);
  const invalid = structuredClone(record);
  invalid.operations.assessment.plans.at(-1).allocations = [{ assetId: 'r', name: '远程人天', days: 5 }];
  assert.match(assessmentLockIssue(invalid, [], assets), /远程计价总人天/);
  // Even an excessive remote allocation cannot erase the onsite gap.
  assert.equal(planGap(currentPlan(invalid)), 2);
  assert.throws(() => act(invalid, { type: 'gap-submit', reason: '申请', approverId: boss.id }, sales), /远程计价总人天/);
});
test('总额不变但远程现场配比变化时，必须重新关联依据并重新审批', () => {
  let record = link(ready(), [{ assetId: 'r', days: 3 }, { assetId: 's', days: 1 }]);
  record.operations.assessment.approvals.push({ planId: currentPlan(record).id, state: '已通过', days: 1 });
  record = act(record, { type: 'effort', items: [{ itemId: 'remote', estimatedDays: 1 }, { itemId: 'onsite', estimatedDays: 3.5 }] });
  assert.equal(record.operations.assessment.effort.days, 5);
  assert.equal(currentPlan(record), undefined);
  assert.equal(record.operations.assessment.approvals.at(-1).state, '已失效');
});
test('未知资产类别不猜测，保存时验证实时资产类别与核定分类，精确处理小数', () => {
  assert.equal(assetDayMethod({ name: '通用人天' }), undefined);
  assert.equal(assetDayMethod({ name: '远程及现场人天' }), undefined);
  const record = link(ready(), [{ assetId: 'r', days: 1 }]);
  assert.match(assessmentLockIssue(record, [], [{ ...assets[0], name: '现场人天' }, assets[1]]), /类别已变更/);
  record.operations.assessment.plans.at(-1).requirements[0].days = 4;
  assert.match(assessmentLockIssue(record, [], assets), /计价人天已变化/);
  assert.deepEqual(coverageByMethod([{ method: '远程', days: 0.3 }], [{ assetId: 'r', name: '远程人天', days: 0.1 }]),
    [{ method: '远程', days: 0.3, lockedDays: 0.1, gap: 0.2 }]);
});


test('负责销售固定为当前客户所有人，禁止选择其他销售，未配置或停用时禁止关联', () => {
  const record = ready(true);
  const other = { ...sales, id: 'other', name: '其他销售' };
  const directory = [sales, other, boss];
  const customers = [{ id: 'c', ownerUserId: sales.id }];
  const savePlan = (salesId, refs = customers, users = directory) => applyAssessmentAction(record,
    { type: 'plan', salesId, allocations: [] }, pm, assets, users, [], at, services, refs);
  const linked = savePlan(sales.id);
  assert.equal(currentPlan(linked).salesId, sales.id);
  assert.equal(currentPlan(linked).salesName, sales.name);
  assert.throws(() => savePlan(other.id), /必须为当前客户所有人/);
  assert.throws(() => savePlan(sales.id, []), /未配置有效的客户所有人/);
  assert.throws(() => savePlan(sales.id, customers, [{ ...sales, status: '停用' }]), /未配置有效的客户所有人/);
  assert.equal(planSalesOwnerIssue(linked, customers, directory), null);
  assert.match(planSalesOwnerIssue(linked, [{ id: 'c', ownerUserId: other.id }], directory), /必须为当前客户所有人/);
  const forged = structuredClone(linked);
  forged.operations.assessment.plans.at(-1).salesId = other.id;
  assert.match(planSalesOwnerIssue(forged, customers, directory), /必须为当前客户所有人/);
});
