import { activityMessage, activityLabel, renderActivityText, type ActivityText } from './activity-events.ts';
import { isDemoAdministrator } from './demo-permissions.ts';
import { requestApprovalRemainingDays } from './request-approval-quota.ts';
import { isDayQuantity, sumDays } from './day-quantity.ts';
import { resolveApprovalPreview } from './approval-preview.ts';
import type { RoutingDictionary } from './assessment-routing-schema';
import type { ApprovalRules } from './approval-rules';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { GapApproval } from './request-assessment';
import type { OperationActor } from './request-operations';
import { fixedIdentityRoles } from './internal-users.ts';

export type ApprovalExecutionStep = {
  id: string; nodeId: string; nodeName: string; level: number;
  approverId: string; approver: string; cutoff: boolean; fallback?: boolean; fallbackReason?: string;
  state: '未开始' | '待审批' | '已通过' | '已拒绝' | '已终止';
  note?: string; decidedAt?: string; decidedBy?: string;
};
export type ApprovalExecution = {
  ruleId?: string; ruleName: string; ruleRevision?: number; flowRevision?: number;
  capturedAt: string; steps: ApprovalExecutionStep[];
};

// Resolve once at submission; subsequent decisions use this immutable route snapshot.
export function createApprovalExecution(record: ServiceRequest, rules: ApprovalRules, users: InternalUser[], customers: RoutingDictionary['customers'], now: string): ApprovalExecution {
  const preview = resolveApprovalPreview(record, rules.rules, users, customers, rules.defaultUserId);
  if (preview.requirement !== 'required') throw new Error('当前请求不需要特殊审批或尚未完成服务依据关联。');
  const issue = preview.issue || preview.steps.find(step => step.issue)?.issue;
  if (issue) throw new Error(issue);
  const steps: ApprovalExecutionStep[] = preview.steps.flatMap(node => node.approvers.map((person, index) => ({
    id: `${node.id}:${index + 1}`, nodeId: node.id, nodeName: node.name, level: index + 1,
    approverId: person.id, approver: person.name, cutoff: person.cutoff, fallback: person.fallback,
    fallbackReason: person.fallback ? node.fallbackReason : undefined, state: '未开始' as const,
  })));
  if (preview.defaultApprover) steps.push({ id: 'default:1', nodeId: 'default', nodeName: '默认审批人审批', level: 1, approverId: preview.defaultApprover.id, approver: preview.defaultApprover.name, cutoff: false, fallback: true, fallbackReason: '未命中特殊审批规则', state: '未开始' });
  if (!steps.length) throw new Error('未找到审批人，请先配置有效的特殊审批流程或默认审批人。');
  steps[0].state = '待审批';
  return { ruleId: preview.rule?.id, ruleName: preview.rule?.name ?? '默认审批人审批', ruleRevision: preview.rule?.revision, flowRevision: preview.rule?.flow.revision, capturedAt: now, steps };
}

export function decideApprovalExecution(approval: GapApproval, actor: OperationActor, users: InternalUser[], approve: boolean, note: string, now: string, capture?: (value: ActivityText) => void): string {
  const steps = approval.workflow!.steps;
  const current = steps.find(step => step.state === '待审批');
  if (!current || (!isDemoAdministrator(actor, users) && (current.approverId !== actor.id || approval.approverId !== actor.id))
    || !users.some(user => user.id === actor.id && user.status === '启用') || fixedIdentityRoles[actor.id] !== actor.role)
    throw new Error('仅当前环节指定且已启用的审批人可以处理。');
  if (actor.id === approval.authorId && !isDemoAdministrator(actor, users)) throw new Error('不能审批自己发起的申请，请调整审批人配置后重新发起。');
  current.state = approve ? '已通过' : '已拒绝';
  current.note = note.trim(); current.decidedAt = now; current.decidedBy = actor.name;
  if (!approve) {
    steps.filter(step => step.state === '未开始').forEach(step => { step.state = '已终止'; });
    approval.state = '已拒绝';
  } else {
    const next = steps.find(step => step.state === '未开始');
    if (next) { next.state = '待审批'; approval.approverId = next.approverId; approval.approver = next.approver; }
    else approval.state = '已通过';
  }
  if (approval.state !== '待审批') { approval.note = note.trim(); approval.decidedAt = now; approval.decidedBy = actor.name; }
  const detail = activityMessage('{0} · {1}{2}{3}', [activityLabel(current.nodeName), current.approver,
    approve ? activityMessage('审批通过') : activityMessage('驳回，退回申请人'),
    approval.state === '待审批' ? activityMessage('；下一审批人：{0}', [approval.approver]) : '',
  ]);
  capture?.(detail);
  return renderActivityText(detail, 'zh-CN');
}

export function specialApprovalSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, actor: OperationActor | undefined, users: InternalUser[], customers: RoutingDictionary['customers'], rules: ApprovalRules): string | null {
  if (!previous) return null;
  const before = previous.operations?.assessment?.approvals ?? [];
  const after = next.operations?.assessment?.approvals ?? [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  if (same(before, after)) return null;
  // The existing return-to-draft guard verifies the archived assessment.
  if (next.status === '草稿' && previous.status === '待评估') return null;
  if (!actor) return '审批变更缺少操作人，请刷新重试。';
  if (after.length < before.length) return '不能删除已有审批历史。';
  try {
    for (const old of before) {
      const changed = after.find(approval => approval.id === old.id);
      if (!changed) return '不能删除已有审批历史。';
      if (!old.workflow || same(old, changed)) continue;
      if (changed.state === '已失效' && (next.status === '已取消' || next.operations?.assessment?.plans.at(-1)?.id !== previous.operations?.assessment?.plans.at(-1)?.id || next.operations?.assessment?.plans.at(-1)?.releasedAt)) {
        if (!same({ ...old, state: '已失效' }, changed)) return '不能修改已记录的审批过程。';
        continue;
      }
      if (old.state !== '待审批') return '不能修改已完成的审批历史。';
      const current = old.workflow.steps.find(step => step.state === '待审批');
      const decision = changed.workflow?.steps.find(step => step.id === current?.id);
      if (!decision || !['已通过', '已拒绝'].includes(decision.state) || !decision.note?.trim() || !decision.decidedAt) return '请按顺序处理当前审批环节。';
      const expected = structuredClone(old);
      decideApprovalExecution(expected, actor, users, decision.state === '已通过', decision.note, decision.decidedAt);
      if (!same(expected, changed)) return '审批状态已变化或包含非当前环节的修改，请刷新重试。';
    }
    const added = after.filter(approval => !before.some(old => old.id === approval.id));
    if (added.length > 1) return '每次仅可发起一个审批流程。';
    for (const approval of added) {
      const plan = previous.operations?.assessment?.plans.at(-1);
      if (previous.status !== '待评估' || !plan || plan.releasedAt || approval.planId !== plan.id || approval.authorId !== actor.id
        || (!isDemoAdministrator(actor, users) && previous.createdById !== actor.id && plan.salesId !== actor.id) || before.some(old => old.planId === plan.id && old.state === '待审批') || requestApprovalRemainingDays(previous) <= 1e-8) return '当前请求不能发起新的特殊审批。';
      if (!isDayQuantity(approval.days) || approval.days <= 0 || approval.days > 100000 || !approval.reason.trim()) return '申请人天须为大于 0 的有效数值，最多一位小数，并填写申请理由。';
      if (approval.manualAmount && (approval.gaps?.length !== 1 || !['远程', '现场'].includes(approval.gaps[0].method) || approval.gaps[0].days !== approval.days)) return '申请人天与服务方式明细不一致。';
      if (approval.gaps?.length && (approval.gaps.some(row => !isDayQuantity(row.days) || row.days <= 0 || !['远程', '现场'].includes(row.method)) || sumDays(approval.gaps.map(row => row.days)) !== approval.days)) return '申请额度明细无效。';
      const expected = createApprovalExecution(previous, rules, users, customers, approval.at);
      if (!same(expected, approval.workflow) || approval.state !== '待审批' || approval.approverId !== expected.steps[0].approverId || approval.approver !== expected.steps[0].approver) return '审批规则已变更，请重新打开并发起审批。';
    }
    return null;
  } catch (error) { return error instanceof Error ? error.message : '审批状态校验失败。'; }
}
