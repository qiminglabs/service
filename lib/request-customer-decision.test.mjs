import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCustomerDecision, customerDecisionIssue } from './request-customer-decision.ts';
import { currentPlan, assetAvailable } from './request-assessment.ts';
const actor = { id: 'C1', name: '客户甲', role: '客户' };
const at = '2026-09-08T10:00:00Z';
function request() {
  return { id: 'R1', customerId: 'ORG1', title: '服务请求', externalCollaborators: [{ contactId: actor.id }], status: '待确认', operations: {
    activities: [], meetings: [], worklogs: [], bases: [], evaluations: [],
    assessment: { rounds: [{ id: 'review', outcome: '评估通过' }], tasks: [], effort: { days: 3 },
      plans: [{ id: 'P1', effort: 3, allocations: [{ assetId: 'A1', name: '远程人天', days: 2 }] }],
      approvals: [{ planId: 'P1', state: '已通过', days: 1 }], confirmation: { planId: 'P1' } },
  } };
}
test('客户确认进入待受理，保留锁定并记录客户决定，不修改原请求', () => {
  const before = request();
  const next = applyCustomerDecision(before, actor, 'ORG1', true, '', at);
  assert.equal(next.status, '待受理');
  assert.equal(currentPlan(next).id, 'P1');
  assert.equal(next.operations.customerDecisions[0].actorId, actor.id);
  assert.equal(before.status, '待确认');
  assert.equal(customerDecisionIssue(next, before, actor, 'ORG1'), null);
  assert.throws(() => applyCustomerDecision(next, actor, 'ORG1', true), /仅待确认/);
});
test('拒绝需原因，退回第四步并保留服务依据、资产锁定及审批结果', () => {
  const before = request();
  assert.throws(() => applyCustomerDecision(before, actor, 'ORG1', false, '  '), /拒绝原因/);
  const next = applyCustomerDecision(before, actor, 'ORG1', false, ' 日期需调整 ', at);
  assert.equal(next.status, '待评估');
  assert.deepEqual(currentPlan(next), currentPlan(before));
  assert.equal(next.operations.assessment.confirmation, undefined);
  assert.deepEqual(next.operations.assessment.approvals, before.operations.assessment.approvals);
  assert.deepEqual(next.operations.assessment.rounds, before.operations.assessment.rounds);
  assert.deepEqual(next.operations.assessment.effort, before.operations.assessment.effort);
  assert.equal(next.operations.customerDecisions[0].reason, '日期需调整');
  assert.equal(assetAvailable({ id: 'A1', balanceDays: 5 }, [next]), 3);
  assert.equal(customerDecisionIssue(next, before, actor, 'ORG1'), null);
});
test('拒绝跨客户或内部身份操作，保存层拒绝篡改和过期决定', () => {
  const before = request();
  assert.throws(() => applyCustomerDecision(before, actor, 'ORG2', true), /所属客户/);
  assert.throws(() => applyCustomerDecision(before, { ...actor, role: 'SmartX 项目经理' }, 'ORG1', true), /所属客户/);
  const next = applyCustomerDecision(before, actor, 'ORG1', true, '', at);
  assert.ok(customerDecisionIssue({ ...next, title: '偷偷修改' }, before, actor, 'ORG1'));
  assert.ok(customerDecisionIssue(next, next, actor, 'ORG1') === null);
  const newer = request(); newer.operations.assessment.confirmation.planId = 'P2';
  assert.ok(customerDecisionIssue(next, newer, actor, 'ORG1'));
  assert.ok(customerDecisionIssue({ ...before, status: '待受理' }, before, actor, 'ORG1'));
  assert.ok(customerDecisionIssue(next, before, undefined, 'ORG1'));
});
