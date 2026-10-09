import { activityMessage, activityList, activityLabel, type ActivityText } from './activity-events.ts';
import { isDemoAdministrator } from './demo-permissions.ts';
import { requestApprovalRemaining, requestApprovalRemainingDays } from './request-approval-quota.ts';
import type { HardwareAssessmentRequirement } from './hardware-assessment-trigger';
import { activeRequestAssetAllocations } from './project-reservation-release.ts';
import { requestTypeOf } from './request-types.ts';
import { convertAssessmentToDelivery } from './request-type-workflow.ts';
import { canPerformAssessmentRole, type AssessmentRouting } from './assessment-routing.ts';
import { effortEntitlementAllocations, entitlementLockIssue, type EntitlementAllocation } from './request-entitlement-reservations.ts';
import { isDayQuantity, sumDays } from './day-quantity.ts';
import { calculateEffortPricing, type EffortPricingLine, type EffortPricingInput, type EntitlementPricingContext } from './request-pricing.ts';
import { assetDayMethod, requestDayRequirements, allocationMethodIssue, planDayGaps, type DayMethod, type DayRequirement } from './request-asset-coverage.ts';
import { portalSwitchIdentities } from './portal-context.ts';
import { operationIdentities } from './internal-users.ts';
import { isRequestApplicant, requestAudience } from './request-collaboration.ts';
import { hardwareItems, isHardwareProductManager, hardwareReviewers, hardwareReviewSource, hardwarePassIssue, type HardwareAssessment } from './request-hardware-assessment.ts';
import type {
  ServiceRequest,
  CatalogService,
  CustomerRef,
  InternalUser,
  ObjectRef,
  StoredFile,
} from './service-requests';
import {
  appendActivity,
  operationsOf,
  isInternal,
} from './request-operations.ts';
import type { OperationActor, RequestAsset } from './request-operations.ts';
import { createApprovalExecution, decideApprovalExecution, type ApprovalExecution } from './approval-execution.ts';
import type { ApprovalRules } from './approval-rules';

export function canManageAssessmentBasis(record: ServiceRequest, actor?: OperationActor, customers: CustomerRef[] = [], users: InternalUser[] = []): boolean {
  if (!actor?.id || !isInternal(actor.role)) return false;
  if (isDemoAdministrator(actor, users)) return true;
  if (requestAudience(record) === 'internal') return isRequestApplicant(record, actor);
  return customerOwner(record, customers, users)?.id === actor.id;
}

function assessmentBasisPermissionMessage(record: ServiceRequest): string {
  return requestAudience(record) === 'internal'
    ? '服务依据关联及发起客户确认由本申请的内部申请人执行。'
    : '服务依据关联及发起客户确认由当前客户所有人执行。';
}

export function assessmentBasisSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, actor?: OperationActor, customers: CustomerRef[] = [], users: InternalUser[] = []): string | null {
  const plan = currentPlan(next);
  const confirmation = assessmentOf(next).confirmation;
  // Releasing a plan after re-estimation, return or cancellation is not a new association.
  const changingBasis = !!plan && JSON.stringify(plan) !== JSON.stringify(previous && currentPlan(previous));
  const confirming = !!confirmation && JSON.stringify(confirmation) !== JSON.stringify(previous && assessmentOf(previous).confirmation);
  if (!(changingBasis || confirming)) return null;
  const source = previous ?? next;
  if (!canManageAssessmentBasis(source, actor, customers, users)) return assessmentBasisPermissionMessage(source);
  const previousPlan = previous && currentPlan(previous);
  if (plan && previousPlan?.id === plan.id) {
    if (plan.freezeOnConfirmation !== previousPlan.freezeOnConfirmation || (previousPlan.frozenAt && plan.frozenAt !== previousPlan.frozenAt))
      return '不可直接更改已有服务依据的冻结状态。';
    if (plan.frozenAt && !previousPlan.frozenAt && (!confirming || confirmation?.planId !== plan.id))
      return '仅发起客户确认时可冻结关联资产。';
  }
  return null;
}

export type Followup = {
  id: string;
  roundId: string;
  kind: '补充材料' | '联系客户';
  content: string;
  assigneeId: string;
  assignee: string;
  reply?: string;
  files: StoredFile[];
  repliedAt?: string;
};
export type AssessmentRound = {
  id: string;
  authorId: string;
  author: string;
  at: string;
  outcome: '需补充' | '评估通过';
  scope: string;
  opinion: string;
  risks: string;
};
export type AssetAllocation = { assetId: string; name: string; days: number; method?: DayMethod };
export type AssessmentPlan = {
  entitlementAllocations?: EntitlementAllocation[];
  releasedAt?: string;
  freezeOnConfirmation?: true;
  frozenAt?: string;
  id: string;
  roundId: string;
  effort: number;
  allocations: AssetAllocation[];
  requirements?: DayRequirement[];
  salesId: string;
  salesName: string;
  at: string;
  author: string;
};
export type GapApproval = {
  manualAmount?: true;
  workflow?: ApprovalExecution;
  id: string;
  planId: string;
  days: number;
  gaps?: DayRequirement[];
  reason: string;
  authorId: string;
  author: string;
  approverId: string;
  approver: string;
  at: string;
  state: '待审批' | '已通过' | '已拒绝' | '已失效';
  note?: string;
  decidedAt?: string;
  decidedBy?: string;
};
export type Assessment = {
  routing?: AssessmentRouting;
  hardwareRequirement?: HardwareAssessmentRequirement;
  hardware?: HardwareAssessment;
  needsReview?: boolean; // Legacy field, no longer controls assessment.
  effort?: { days: number; estimatedDays?: number; lines?: EffortPricingLine[]; at: string; author: string; note?: string };
  managerId: string;
  manager: string;
  rounds: AssessmentRound[];
  tasks: Followup[];
  plans: AssessmentPlan[];
  approvals: GapApproval[];
  confirmation?: {
    at: string;
    by: string;
    planId: string;
    scope: string;
    effort: number;
    assetDays: number;
    extraDays: number;
    extraDaysByMethod?: DayRequirement[];
    externalNote?: string;
    allocations?: AssessmentPlan['allocations'];
    entitlementAllocations?: EntitlementAllocation[];
  };
};
export type AssessmentAction =
  | { type: 'convert-to-delivery' }
  | { type: 'hardware-review'; outcome: AssessmentRound['outcome']; opinion: string }
  | { type: 'return-draft'; reason: string }
  | { type: 'effort'; items: EffortPricingInput[]; note?: string }
  | {
      type: 'review';
      scope?: string;
      opinion: string;
      risks?: string;
      outcome: AssessmentRound['outcome'];
    }
  | {
      type: 'plan';
      allocations: { assetId: string; days: number }[];
      salesId: string;
    }
  | { type: 'gap-submit'; reason: string; approverId?: string; method?: DayMethod; days?: number }
  | { type: 'gap-decide'; id: string; approve: boolean; note: string }
  | { type: 'confirm'; externalNote?: string };
export const emptyAssessment = (): Assessment => ({
  managerId: '',
  manager: '',
  rounds: [],
  tasks: [],
  plans: [],
  approvals: [],
});
export const assessmentOf = (record: ServiceRequest) =>
  record.operations?.assessment ?? emptyAssessment();
export const currentPlan = (record: ServiceRequest) => {
  const plan = assessmentOf(record).plans.at(-1);
  if (!plan || plan.releasedAt) return undefined;
  const requirements = plan.requirements ?? requestDayRequirements(record);
  return requirements.length && !plan.requirements ? { ...plan, requirements } : plan;
};
export const assessedEffort = (record: ServiceRequest) =>
  assessmentOf(record).effort?.days ?? currentPlan(record)?.effort;
export function gapApproverOptions(
  users: InternalUser[],
  selectedId: string,
  managerId: string,
) {
  return portalSwitchIdentities(
    operationIdentities(users),
    selectedId,
    {},
  ).filter(
    (user) =>
      ['SmartX 销售经理', 'SmartX 系统管理员'].includes(user.role) &&
      user.id !== selectedId &&
      user.id !== managerId,
  );
}

export const isProjectManager = (actor: OperationActor) =>
  actor.role === 'SmartX 项目经理';
export const isSalesUser = (user: InternalUser | undefined) =>
  !!user && user.status === '启用' && /销售/.test(user.department ?? '');
export function canSubmitGapApproval(record: ServiceRequest, actor: OperationActor | undefined, users: InternalUser[]): boolean {
  const plan = currentPlan(record);
  if (!plan || !actor?.id || !isInternal(actor.role)) return false;
  const user = users.find(user => user.id === actor.id && user.status === '启用');
  if (!user) return false;
  if (isDemoAdministrator(actor, users)) return true;
  const applicant = requestAudience(record) === 'internal' && isRequestApplicant(record, actor);
  const responsibleSales = actor.id === plan.salesId && actor.role === 'SmartX 销售经理' && isSalesUser(user);
  return applicant || responsibleSales;
}
export function customerOwner(record: ServiceRequest, customers: CustomerRef[], users: InternalUser[]) {
  const ownerId = customers.find(customer => customer.id === record.customerId)?.ownerUserId;
  return users.find(user => user.id === ownerId && user.status === '启用');
}
export function planSalesOwnerIssue(record: ServiceRequest, customers: CustomerRef[], users: InternalUser[]): string | null {
  const plan = currentPlan(record);
  if (!plan) return null;
  const owner = customerOwner(record, customers, users);
  if (!owner) return '当前客户未配置有效的客户所有人，请先完善客户资料。';
  return plan.salesId !== owner.id || plan.salesName !== owner.name
    ? '负责销售必须为当前客户所有人，请重新打开服务依据关联后保存。' : null;
}
export const planAssetDays = (plan?: AssessmentPlan) =>
  sumDays(plan?.allocations.map(a => a.days) ?? []);
export const planGap = (plan?: AssessmentPlan) =>
  plan?.requirements ? sumDays(planDayGaps(plan).map(row => row.days))
    : Math.max(0, sumDays([plan?.effort ?? 0, -planAssetDays(plan)]));
export function assetAvailable(
  asset: RequestAsset,
  records: ServiceRequest[],
  exceptId: string,
): number | null {
  if (
    asset.balanceDays === undefined ||
    !Number.isFinite(asset.balanceDays) ||
    asset.balanceDays < 0
  )
    return null;
  const locked = records
    .filter((r) => r.id !== exceptId && r.status !== '已取消')
    .reduce(
      (sum, r) =>
        sum +
        (activeRequestAssetAllocations(r)
          .filter((a) => a.assetId === asset.id)
          .reduce((n, a) => n + a.days, 0) ?? 0),
      0,
    );
  // Never round an old fractional remainder up into spendable credit.
  const projectLocked = (asset.projectReservations ?? []).reduce((sum, row) => sum + row.days, 0);
  return Math.floor((Math.max(0, asset.balanceDays - locked - projectLocked - (asset.projectConsumptions ?? []).reduce((sum, row) => sum + row.days, 0)) + 1e-8) * 10) / 10;
}
export function assessmentLockIssue(
  record: ServiceRequest,
  records: ServiceRequest[],
  assets: RequestAsset[],
  objects: ObjectRef[] = [],
): string | null {
  if (record.status === '已取消') return null;
  const plan = currentPlan(record);
  if (!plan) return null;
  if (assessmentOf(record).confirmation?.planId === plan.id) {
    if (plan.freezeOnConfirmation && !plan.frozenAt) return '发起客户确认时须冻结关联资产。';
    if (requestApprovalRemainingDays(record) > 1e-8)
      return '服务依据额度不足，审批通过后才能发起客户确认。';
  }
  const entitlementIssue = entitlementLockIssue(record, records, objects);
  if (entitlementIssue) return entitlementIssue;
  if (plan.effort !== assessedEffort(record)) return '服务依据与计价总人天不一致，请重新关联。';
  const methodIssue = allocationMethodIssue(record, plan.allocations, assets);
  if (methodIssue) return methodIssue;
  if (plan.requirements && JSON.stringify(plan.requirements) !== JSON.stringify(requestDayRequirements(record)))
    return '远程、现场计价人天已变化，请重新进行服务依据关联。';
  for (const allocation of plan.allocations) {
    const asset = assets.find(
      (a) =>
        a.id === allocation.assetId &&
        a.customerId === record.customerId &&
        ['启用', '使用中'].includes(a.status),
    );
    if (!asset) return `${allocation.name} 已失效，请重新选择资产。`;
    const available = assetAvailable(asset, records, record.id);
    if (available === null)
      return `${asset.name} 尚未维护余额，请先在主数据中填写余额人天。`;
    if (allocation.days > available + 1e-8)
      return `${asset.name} 可冻结余额不足，请刷新后重新评估资产方案。`;
  }
  return null;
}
export function applyAssessmentAction(
  record: ServiceRequest,
  action: AssessmentAction,
  actor: OperationActor,
  assets: RequestAsset[],
  users: InternalUser[],
  records: ServiceRequest[],
  now = new Date().toISOString(),
  services: CatalogService[] = [],
  customers: CustomerRef[] = [],
  pricingContext?: EntitlementPricingContext,
  approvalRules?: ApprovalRules,
): ServiceRequest {
  if (action.type === 'convert-to-delivery') return convertAssessmentToDelivery(record, actor, users, now);
  if (!actor.id || !isInternal(actor.role))
    throw new Error('仅内部人员可处理评估工作。');
  if (record.status !== '待评估')
    throw new Error('仅待评估阶段可处理评估工作。');
  if (requestTypeOf(record) === '技术评估' && ['plan', 'gap-submit', 'gap-decide', 'confirm'].includes(action.type))
    throw new Error('技术评估须先完成评估并转为服务交付，再进入后续交付流程。');
  const assessment = structuredClone(assessmentOf(record));
  const manager = () => {
    if (
      !canPerformAssessmentRole(record, actor, 'manager', users)
    )
      throw new Error('材料评估及人天核定由负责本请求的项目经理执行。');
  };
  const text = (s: string, label: string) => {
    if (!s.trim()) throw new Error(`请填写${label}。`);
  };
  const positive = (n: number) => {
    if (!isDayQuantity(n) || n <= 0 || n > 100000)
      throw new Error('人天必须为有效正数，最多一位小数。');
  };
  let title: ActivityText = '',
    detail: ActivityText = '',
    category: '评估' | '审批' = '评估';
  let status: ServiceRequest['status'] = record.status;
  const plan = currentPlan(record);
  if (
    (action.type === 'effort' || action.type === 'plan') &&
    assessment.approvals.some(
      (a) => a.planId === plan?.id && a.state === '待审批',
    )
  )
    throw new Error(
      '额度特批审批中，暂不能修改人天核定或服务依据，请等待审批完成。',
    );
  if (action.type === 'hardware-review') {
    if (!hardwareItems(record).length) throw new Error('当前请求未命中本轮硬件评估触发条件。');
    if (assessment.rounds.some(round => round.outcome === '评估通过')) throw new Error('材料评估已通过，双方评估结论已锁定。');
    if (!isDemoAdministrator(actor, users) && (!canPerformAssessmentRole(record, actor, 'hardware', users) || !isHardwareProductManager(actor) || !hardwareReviewers(users).some(user => user.id === actor.id))) throw new Error('仅已启用的硬件产品经理可提交硬件产品经理评估。');
    text(action.opinion, '评估意见');
    if (!['需补充', '评估通过'].includes(action.outcome)) throw new Error('请选择有效评估结论。');
    const hardware = assessment.hardware = { reviewerId: actor.id, reviewer: actor.name, assignmentId: assessment.hardware?.assignmentId ?? crypto.randomUUID(), rounds: assessment.hardware?.rounds ?? [] };
    hardware.rounds.push({ id: crypto.randomUUID(), assignmentId: hardware.assignmentId, authorId: actor.id, author: actor.name, at: now,
      outcome: action.outcome, opinion: action.opinion.trim(),
      itemIds: hardwareItems(record).map(item => item.id), source: hardwareReviewSource(record) });
    title = activityMessage("硬件产品经理评估 · {0}", [action.outcome]);
    detail = action.opinion.trim();
  } else if (action.type === 'review') {
    manager();
    text(action.opinion, '评估意见');
    if (assessment.rounds.some((r) => r.outcome === '评估通过'))
      throw new Error('材料评估已通过，不支持新增评估。');
    if (!['评估通过', '需补充'].includes(action.outcome))
      throw new Error('请选择有效评估结论。');
    if (action.outcome === '评估通过') {
      const issue = hardwarePassIssue(record, users);
      if (issue) throw new Error(issue);
    }
    const id = crypto.randomUUID();
    if (!isDemoAdministrator(actor)) { assessment.managerId = actor.id; assessment.manager = actor.name; }
    assessment.rounds.push({
      id,
      authorId: actor.id,
      author: actor.name,
      at: now,
      outcome: action.outcome,
      scope: action.scope?.trim() ?? '',
      opinion: action.opinion.trim(),
      risks: action.risks?.trim() ?? '',
    });
    title = activityMessage("材料评估 · {0}", [activityLabel(action.outcome)]);
    detail = action.opinion;
  } else if (action.type === 'return-draft') {
    manager();
    text(action.reason, '退回原因');
    assessment.plans.forEach((p) => {
      if (!p.releasedAt) p.releasedAt = now;
    });
    assessment.approvals.forEach((a) => {
      if (a.state === '待审批' || a.state === '已通过') a.state = '已失效';
    });
    const ops = operationsOf(record);
    return appendActivity(
      {
        ...record,
        status: '草稿',
        submittedAt: undefined,
        operations: {
          ...ops,
          assessmentHistory: [...(ops.assessmentHistory ?? []), assessment],
          assessment: {
            ...emptyAssessment(),
            managerId: assessment.managerId,
            manager: assessment.manager,
          },
          draftReturns: [
            ...(ops.draftReturns ?? []),
            { at: now, actorId: actor.id, reason: action.reason.trim() },
          ],
        },
      },
      actor,
      '提交',
      activityMessage("退回草稿"),
      action.reason.trim(),
      now,
    );
  } else if (action.type === 'effort') {
    manager();
    if (!assessment.rounds.some((r) => r.outcome === '评估通过'))
      throw new Error('请先完成材料评估。');
    const pricing = calculateEffortPricing(record, action.items, services, pricingContext ? { ...pricingContext, records } : undefined);
    assessment.effort = {
      ...pricing,
      at: now,
      author: actor.name,
      note: action.note?.trim() ?? '',
    };
    const updatedRequirements = requestDayRequirements({ ...record, operations: { ...operationsOf(record), assessment } });
    if (plan && (JSON.stringify(effortEntitlementAllocations(assessmentOf(record).effort?.lines)) !== JSON.stringify(effortEntitlementAllocations(pricing.lines)) || plan.effort !== pricing.days || JSON.stringify(updatedRequirements) !== JSON.stringify(requestDayRequirements(record)))) {
      assessment.plans.at(-1)!.releasedAt = now;
      assessment.approvals.forEach((a) => {
        if (a.state === '待审批' || a.state === '已通过') a.state = '已失效';
      });
    }
    title = activityMessage("人天核定");
    if (requestTypeOf(record) === '技术评估') { status = '评估完成'; title = activityMessage("人天核定 · 评估完成"); }
    detail = activityMessage("预估 {0} 人天 · 计价 {1} 人天 · {2}{3}", [pricing.estimatedDays, pricing.days, activityList(pricing.lines.map(line => activityMessage("{0}：{1} × {2} = {3}", [activityLabel(line.serviceName), (line.kind === 'entitlement' ? activityMessage("差额权益 {0}", [line.deficitEntitlements]) : line.estimatedDays), line.priceCoefficient, line.billableDays])), "；"), (assessment.effort.note ? activityMessage(" · {0}", [assessment.effort.note]) : '')]);
  } else if (action.type === 'plan') {
    if (!canManageAssessmentBasis(record, actor, customers, users)) throw new Error(assessmentBasisPermissionMessage(record));
    const round = assessment.rounds.find((r) => r.outcome === '评估通过');
    if (!round) throw new Error('请先完成材料评估。');
    const effort = assessedEffort(record);
    if (effort === undefined) throw new Error('请先完成人天核定，再进行服务依据关联。');
    if (!isDayQuantity(effort) || effort > 100000) throw new Error('计价总人天须最多一位小数，请重新核定。');
    const sales = customerOwner(record, customers, users);
    if (!sales) throw new Error('当前客户未配置有效的客户所有人，请先完善客户资料。');
    if (action.salesId && action.salesId !== sales.id) throw new Error('负责销售必须为当前客户所有人，请重新打开服务依据关联后保存。');
    const seen = new Set<string>();
    const allocations = action.allocations.map((a) => {
      positive(a.days);
      if (seen.has(a.assetId)) throw new Error('不能重复选择同一资产。');
      seen.add(a.assetId);
      const asset = assets.find(
        (v) =>
          v.id === a.assetId &&
          v.customerId === record.customerId &&
          ['启用', '使用中'].includes(v.status),
      );
      if (!asset) throw new Error('请选择当前客户有效的资产。');
      return { ...a, name: asset.name, method: assetDayMethod(asset) };
    });
    if (allocations.reduce((sum, a) => sum + a.days, 0) > effort + 1e-8)
      throw new Error('冻结人天不能超过计价总人天。');
    const methodIssue = allocationMethodIssue(record, allocations, assets);
    if (methodIssue) throw new Error(methodIssue);
    if (plan) assessment.plans.at(-1)!.releasedAt = now;
    assessment.plans.push({
      entitlementAllocations: effortEntitlementAllocations(assessment.effort?.lines),
      freezeOnConfirmation: true,
      id: crypto.randomUUID(),
      roundId: round.id,
      effort: effort,
      allocations,
      requirements: requestDayRequirements(record),
      salesId: sales.id,
      salesName: sales.name,
      at: now,
      author: actor.name,
    });
    assessment.approvals.forEach((a) => {
      if (a.state === '待审批' || a.state === '已通过') a.state = '已失效';
    });
    title = (plan ? activityMessage("调整服务依据") : activityMessage("服务依据关联"));
    detail = activityMessage("计价总人天 {0} · 关联 {1} 人天", [effort, planAssetDays(assessment.plans.at(-1))]);
  } else if (action.type === 'gap-submit') {
    if (!plan || !canSubmitGapApproval(record, actor, users))
      throw new Error('仅本请求的内部申请人或方案指定的销售可发起额度特批。');
    const methodIssue = allocationMethodIssue(record, plan.allocations, assets);
    if (methodIssue) throw new Error(methodIssue);
    const remaining = requestApprovalRemainingDays(record);
    const manual = action.days !== undefined || action.method !== undefined;
    if (remaining <= 1e-8) throw new Error('额度已足够，无需重复提交审批。');
    if (manual && !['远程', '现场'].includes(action.method ?? '')) throw new Error('请选择远程或现场服务方式。');
    const days = manual ? action.days! : remaining;
    positive(days);
    const gaps = manual ? [{ method: action.method!, days }] : requestApprovalRemaining(record);
    text(action.reason, '申请理由');
    if (
      assessment.approvals.some(
        (a) => a.planId === plan.id && a.state === '待审批',
      )
    )
      throw new Error('该方案已发起特批，请勿重复提交。');
    const workflow = approvalRules ? createApprovalExecution(record, approvalRules, users, customers, now) : undefined;
    const first = workflow?.steps[0];
    const approver = first ? users.find(user => user.id === first.approverId && user.status === '启用') : gapApproverOptions(
      users,
      actor.id,
      assessment.managerId,
    ).find((user) => user.id === action.approverId);
    if (
      !approver ||
      (!workflow && (approver.id === actor.id || approver.id === assessment.managerId))
    )
      throw new Error(
        '请选择右上角可切换身份中的上级审批人，不能由发起人本人或评估项目经理审批。',
      );
    assessment.approvals.push({
      ...(workflow ? { workflow } : {}),
      id: crypto.randomUUID(),
      planId: plan.id,
      ...(manual ? { manualAmount: true as const } : {}),
      days,
      gaps,
      reason: action.reason.trim(),
      authorId: actor.id,
      author: actor.name,
      approverId: approver.id,
      approver: approver.name,
      at: now,
      state: '待审批',
    });
    category = '审批';
    title = (workflow ? activityMessage("发起特殊审批") : activityMessage("发起额度特批"));
    detail = activityMessage("申请额度 {0} · {1}{2}", [gaps.length ? activityList(gaps.map(row => activityMessage('{0} {1} 人天', [activityLabel(row.method), row.days]))) : activityMessage('{0} 人天', [days]), action.reason, (workflow ? activityMessage(" · {0} · {1}", [activityLabel(workflow.ruleName), activityList(workflow.steps.map(step => step.approver), ' → ')]) : '')]);
  } else if (action.type === 'gap-decide') {
    const approval = assessment.approvals.find((a) => a.id === action.id);
    if (
      !approval ||
      approval.state !== '待审批' ||
      approval.planId !== plan?.id
    )
      throw new Error('审批已处理或资产方案已变更。');
    if (!approval.workflow && !isDemoAdministrator(actor, users) && (
      !['SmartX 销售经理', 'SmartX 系统管理员'].includes(actor.role) ||
      actor.id !== approval.approverId ||
      actor.id === approval.authorId ||
      actor.id === assessment.managerId
    ))
      throw new Error('仅指定上级可审批，不能自行审批。');
    text(action.note, '审批意见');
    if (approval.workflow) {
      decideApprovalExecution(approval, actor, users, action.approve, action.note, now, value => { detail = value; });
      category = '审批';
      title = (action.approve ? ((approval.workflow.steps.every(step => step.state === '已通过') ? activityMessage("特殊审批全部通过") : activityMessage("特殊审批环节通过"))) : activityMessage("特殊审批驳回，退回申请人"));
    } else {
      approval.state = action.approve ? '已通过' : '已拒绝';
      approval.note = action.note.trim();
      approval.decidedAt = now;
      approval.decidedBy = actor.name;
      category = '审批';
      title = activityMessage("额度特批{0}", [(action.approve ? activityMessage("通过") : activityMessage("拒绝"))]);
      detail = action.note;
    }
  } else if (action.type === 'confirm') {
    if (!canManageAssessmentBasis(record, actor, customers, users)) throw new Error(assessmentBasisPermissionMessage(record));
    if (!plan || assessedEffort(record) === undefined || !assessment.rounds.some(round => round.outcome === '评估通过')) throw new Error('请先完成材料评估、人天核定和服务依据关联。');
    const gap = planGap(plan);
    if (requestApprovalRemainingDays(record) > 1e-8)
      throw new Error('资产不足，请由内部申请人或负责销售发起特批并经上级审批通过。');
    if (plan.freezeOnConfirmation) assessment.plans.at(-1)!.frozenAt ??= now;
    const round = assessment.rounds.find((r) => r.id === plan.roundId)!;
    assessment.confirmation = {
      at: now,
      by: actor.name,
      planId: plan.id,
      scope: round.scope,
      effort: plan.effort,
      assetDays: planAssetDays(plan),
      extraDays: gap,
      extraDaysByMethod: planDayGaps(plan),
      externalNote: action.externalNote?.trim() ?? '',
      allocations: structuredClone(plan.allocations),
      entitlementAllocations: structuredClone(plan.entitlementAllocations ?? effortEntitlementAllocations(assessment.effort?.lines)),
    };
    status = '待确认';
    title = activityMessage("发起客户确认");
    detail = activityMessage("{0} · 计价总人天 {1} · 客户资产 {2} · 特批 {3}", [round.scope, plan.effort, planAssetDays(plan), gap]);
  } else {
    throw new Error('不支持的评估操作。');
  }
  const next = {
    ...record,
    status,
    ...(action.type === 'hardware-review' && assessment.hardware && !record.internalParticipants?.some(person => person.userId === assessment.hardware!.reviewerId)
      ? { internalParticipants: [...(record.internalParticipants ?? []), { userId: assessment.hardware.reviewerId, name: assessment.hardware.reviewer }] } : {}),
    operations: { ...operationsOf(record), assessment },
  };
  if (action.type === 'plan' || action.type === 'confirm') {
    const issue = assessmentLockIssue(next, records, assets, pricingContext?.businessObjects);
    if (issue) throw new Error(issue);
  }
  return appendActivity(next, actor, category, title, detail, now);
}
