import { activityFields, activityMessage } from './activity-events.ts';
import { isDemoAdministrator } from './demo-permissions.ts';
import type { ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';

export type CustomerDecision = {
  at: string;
  actorId: string;
  actor: string;
  accepted: boolean;
  reason: string;
  planId: string;
};

export function applyCustomerDecision(
  record: ServiceRequest,
  actor: OperationActor,
  customerId: string | undefined,
  accepted: boolean,
  reason = '',
  at = new Date().toISOString(),
): ServiceRequest {
  if (!isDemoAdministrator(actor) && (!actor.id || actor.role !== '客户' || customerId !== record.customerId))
    throw new Error('仅所属客户可以确认或拒绝服务请求。');
  if (!isDemoAdministrator(actor) && !record.externalCollaborators?.some(person => person.contactId === actor.id)) throw new Error('仅客户协作人可以确认或拒绝服务请求。');
  const confirmation = record.operations?.assessment?.confirmation;
  if (record.status !== '待确认' || !confirmation)
    throw new Error('请求已变更，请刷新后重试；仅待确认请求可以处理。');
  if (!accepted && !reason.trim()) throw new Error('请填写拒绝原因。');
  const next = structuredClone(record);
  const ops = next.operations!;
  ops.customerDecisions = [...(ops.customerDecisions ?? []), {
    at, actorId: actor.id, actor: isDemoAdministrator(actor) ? `${actor.name}（管理员代确认）` : actor.name, accepted,
    reason: accepted ? '' : reason.trim(), planId: confirmation.planId,
  }];
  next.status = accepted ? '待受理' : '待评估';
  next.updatedAt = at;
  if (!accepted) {
    delete ops.assessment!.confirmation;
  }
  ops.activities.push({
    id: `customer-decision:${confirmation.planId}:${at}`,
    at, actor: actor.name, actorId: actor.id, category: '服务依据',
    ...activityFields('request', accepted ? activityMessage('客户确认通过') : activityMessage('客户拒绝确认'), accepted ? activityMessage('请求进入待受理。') : activityMessage('{0} · 请求退回客户确认步骤，服务依据、资产冻结及审批结果保留。', [reason.trim()])),
  });
  return next;
}

export function customerDecisionIssue(
  next: ServiceRequest,
  previous: ServiceRequest,
  actor?: OperationActor,
  customerId?: string,
): string | null {
  const changed = JSON.stringify(next.operations?.customerDecisions) !== JSON.stringify(previous.operations?.customerDecisions);
  // Manager cancellation is validated separately against the latest saved request.
  if (!changed && next.status === '已取消') return null;
  if (!changed && !(previous.status === '待确认' && next.status !== previous.status)) return null;
  const decision = next.operations?.customerDecisions?.at(-1);
  if (!actor || !decision || !changed) return '请由客户通过确认或拒绝操作处理请求。';
  try {
    const expected = applyCustomerDecision(previous, actor, customerId, decision.accepted, decision.reason, decision.at);
    // The persistence layer refreshes updatedAt; every business field must match.
    if (JSON.stringify({ ...expected, updatedAt: next.updatedAt }) !== JSON.stringify(next))
      return '请求或确认方案已变更，请刷新后重试。';
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : '客户确认保存失败。';
  }
}
