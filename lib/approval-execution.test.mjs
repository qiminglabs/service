import test from 'node:test';
import assert from 'node:assert/strict';
import { localInternalUsers, fixedIdentityRoles } from './internal-users.ts';
import { demoReportingUsers, demoWorkflowRuleReferences } from './demo-workflow-rules.ts';
import { approvalRulesId } from './approval-rules.ts';
import { emptyAssessment, applyAssessmentAction } from './request-assessment.ts';
import { specialApprovalSaveIssue } from './approval-execution.ts';

const users = demoReportingUsers(localInternalUsers);
const customers = [{ id: 'C-1', name: '测试客户', status: '启用', team: '商业', ownerUserId: 'USR-001' }];
const rules = demoWorkflowRuleReferences({ users, customers, services: [] }).find(r => r.id === approvalRulesId).payload;
const actor = id => ({ id, name: users.find(u => u.id === id).name, role: fixedIdentityRoles[id] });
const now = '2026-09-15T10:00:00.000Z';
const request = () => ({ id: 'REQ-1', title: '现场审批', createdById: 'USR-001', createdByAudience: 'internal', createdBy: '王琪', customerId: 'C-1', status: '待评估',
  items: [{ id: 'item1', serviceId: 'service', method: '现场' }], operations: { activities: [], meetings: [], worklogs: [], bases: [], evaluations: [], assessment: { ...emptyAssessment(), managerId: 'USR-003', manager: '赵言',
  rounds: [{ id: 'round', outcome: '评估通过', scope: '现场服务' }], effort: { days: 3 }, plans: [{ id: 'plan', effort: 3, allocations: [], requirements: [{ method: '现场', days: 3 }], roundId: 'round', salesId: 'USR-001', salesName: '王琪', at: now }] } } });
const act = (r, action, id, config = rules) => applyAssessmentAction(r, action, actor(id), [], users, [], now, [], customers, undefined, config);
const start = () => act(request(), { type: 'gap-submit', reason: '额度不足' }, 'USR-001');
const decide = (r, id, approve = true) => act(r, { type: 'gap-decide', id: r.operations.assessment.approvals.at(-1).id, approve, note: approve ? '同意' : '请申请人补充' }, id);

test('按规则逐级执行，截止人后继续下一环节，全部通过前不能发起确认', () => {
  let r = start();
  const route = r.operations.assessment.approvals[0].workflow;
  assert.deepEqual(route.steps.map(s => s.approverId), ['USR-003', 'USR-006', 'USR-008']);
  assert.equal(route.steps[1].cutoff, true);
  assert.throws(() => decide(r, 'USR-008'), /当前环节/);
  const before = structuredClone(r);
  r = decide(r, 'USR-003');
  assert.equal(specialApprovalSaveIssue(r, before, actor('USR-003'), users, customers, rules), null);
  assert.equal(r.operations.assessment.approvals[0].state, '待审批');
  assert.throws(() => decide(r, 'USR-003'), /当前环节/);
  assert.throws(() => act(r, { type: 'confirm' }, 'USR-001'), /资产不足/);
  r = decide(r, 'USR-006');
  assert.equal(r.operations.assessment.approvals[0].approverId, 'USR-008');
  r = decide(r, 'USR-008');
  assert.equal(r.operations.assessment.approvals[0].state, '已通过');
  assert.ok(r.operations.assessment.approvals[0].workflow.steps.every(s => s.note === '同意' && s.decidedAt));
  assert.equal(r.operations.activities.filter(a => a.category === '审批').length, 4);
});

test('驳回终止后续环节，保留前级记录，允许申请人重新发起', () => {
  const r = decide(decide(start(), 'USR-003'), 'USR-006', false);
  assert.equal(r.operations.assessment.approvals[0].state, '已拒绝');
  assert.deepEqual(r.operations.assessment.approvals[0].workflow.steps.map(s => s.state), ['已通过', '已拒绝', '已终止']);
  assert.throws(() => decide(r, 'USR-008'), /审批已处理/);
  const resubmitted = act(r, { type: 'gap-submit', reason: '补充后重提' }, 'USR-001');
  assert.equal(resubmitted.operations.assessment.approvals.length, 2);
  assert.equal(resubmitted.operations.assessment.approvals[1].approverId, 'USR-003');
});

test('规则修改不改写进行中的快照，保存阻止跳级、历史覆盖和陈旧审批', () => {
  const pending = start();
  const changedRules = { ...rules, rules: [] };
  const after = act(pending, { type: 'gap-decide', id: pending.operations.assessment.approvals[0].id, approve: true, note: '同意' }, 'USR-003', changedRules);
  assert.equal(after.operations.assessment.approvals[0].approverId, 'USR-006');
  const forged = structuredClone(after); forged.operations.assessment.approvals[0].state = '已通过';
  assert.match(specialApprovalSaveIssue(forged, pending, actor('USR-003'), users, customers, rules), /审批状态/);
  assert.ok(specialApprovalSaveIssue(pending, after, actor('USR-003'), users, customers, rules));
  assert.ok(specialApprovalSaveIssue(start(), request(), actor('USR-001'), users, customers, changedRules));
});

test('未命中使用默认审批人，无可用默认人时禁止生成空审批', () => {
  const pending = act(request(), { type: 'gap-submit', reason: '额度不足' }, 'USR-001', { version: 1, rules: [], defaultUserId: 'USR-006' });
  assert.equal(pending.operations.assessment.approvals[0].workflow.steps[0].fallback, true);
  assert.throws(() => act(request(), { type: 'gap-submit', reason: '额度不足' }, 'USR-001', { version: 1, rules: [] }), /未找到审批人/);
});
