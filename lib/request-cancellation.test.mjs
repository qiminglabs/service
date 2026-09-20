import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelRequest, cancelRequest, requestCancellationSaveIssue } from './request-cancellation.ts';
import { newRequest } from './service-requests.ts';
import { emptyAssessment, currentPlan, assetAvailable } from './request-assessment.ts';
import { activeEntitlementAllocations } from './request-entitlement-reservations.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { requestReturnNotice } from './request-operations.ts';
import { localInternalUsers as users } from './internal-users.ts';

const pm = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理' };
const now = '2026-09-16T12:00:00Z';
function request(status = '待评估') {
  return { ...newRequest('服务申请', 'c1', sales.name, sales.id, sales.role), status,
    operations: { assessment: { ...emptyAssessment(), managerId: pm.id, manager: pm.name,
      plans: [{ id: 'plan', roundId: 'round', effort: 2, allocations: [{ assetId: 'asset', days: 2 }] }],
      approvals: [{ id: 'waiting', state: '待审批' }, { id: 'approved', state: '已通过' }, { id: 'rejected', state: '已拒绝' }],
      confirmation: { planId: 'plan', at: now },
    }, activities: [] }, externalCollaborators: [{ contactId: 'customer', name: '客户' }] };
}

test('仅负责且启用的项目经理可取消三个处理中状态，结束状态与草稿不提供入口', () => {
  for (const status of ['待评估', '待确认', '待受理']) assert.equal(canCancelRequest(request(status), pm, users), true);
  for (const status of ['草稿', '评估完成', '已转服务项目', '已取消']) {
    assert.equal(canCancelRequest(request(status), pm, users), false);
    assert.throws(() => cancelRequest(request(status), pm, users, '取消'), /负责项目经理/);
  }
  for (const actor of [undefined, sales, { ...pm, id: 'other' }, { ...pm, role: '客户' }]) assert.equal(canCancelRequest(request(), actor, users), false);
  const unassigned = request(); unassigned.operations.assessment.managerId = '';
  assert.equal(canCancelRequest(unassigned, pm, users), false);
  assert.equal(canCancelRequest(request(), pm, users.map(user => user.id === pm.id ? { ...user, status: '停用' } : user)), false);
  assert.throws(() => cancelRequest(request(), pm, users, '  '), /原因/);
});

test('取消保留原请求与历史、释放额度、终止审批，客户不能继续确认', () => {
  const record = request('待确认'), original = structuredClone(record);
  const cancelled = cancelRequest(record, pm, users, '  客户撤销需求  ', now);
  assert.equal(cancelled.status, '已取消');
  assert.equal(cancelled.cancelledFromStatus, '待确认');
  assert.equal(currentPlan(cancelled), undefined);
  assert.deepEqual(activeEntitlementAllocations(cancelled), []);
  assert.equal(assetAvailable({ id: 'asset', balanceDays: 5 }, [cancelled]), 5);
  assert.equal(cancelled.operations.assessment.plans[0].releasedAt, now);
  assert.deepEqual(cancelled.operations.assessment.approvals.map(item => item.state), ['已失效', '已失效', '已拒绝']);
  assert.deepEqual(cancelled.operations.assessment.confirmation, record.operations.assessment.confirmation);
  assert.equal(cancelled.operations.activities.at(-1).actorId, pm.id);
  assert.deepEqual(requestReturnNotice(cancelled), { title: '取消原因', reason: '客户撤销需求' });
  assert.throws(() => applyCustomerDecision(cancelled, { id: 'customer', name: '客户', role: '客户' }, 'c1', true), /仅待确认/);
  assert.deepEqual(record, original);
});

test('保存取消必须匹配最新记录，拒绝直接改状态、篡改内容、停用账号和恢复已取消请求', () => {
  const before = request();
  const next = cancelRequest(before, pm, users, '取消需求', now);
  assert.equal(requestCancellationSaveIssue(next, before, pm, users), null);
  assert.ok(requestCancellationSaveIssue({ ...before, status: '已取消' }, before, pm, users));
  assert.ok(requestCancellationSaveIssue({ ...next, title: '篡改标题' }, before, pm, users));
  assert.ok(requestCancellationSaveIssue(next, { ...before, status: '待确认' }, pm, users));
  assert.ok(requestCancellationSaveIssue(next, before, sales, users));
  assert.ok(requestCancellationSaveIssue(next, before, pm, users.map(user => user.id === pm.id ? { ...user, status: '停用' } : user)));
  assert.ok(requestCancellationSaveIssue({ ...next, status: '待评估' }, next, pm, users));
  assert.ok(requestCancellationSaveIssue(next, undefined, pm, users));
});
