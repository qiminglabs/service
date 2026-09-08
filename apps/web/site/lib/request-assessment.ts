import { portalSwitchIdentities } from './portal-context.ts';
import { operationIdentities } from './internal-users.ts';
import type {
  ServiceRequest,
  InternalUser,
  StoredFile,
} from './service-requests';
import {
  appendActivity,
  operationsOf,
  isInternal,
} from './request-operations.ts';
import type { OperationActor, RequestAsset } from './request-operations.ts';

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
export type AssetAllocation = { assetId: string; name: string; days: number };
export type AssessmentPlan = {
  releasedAt?: string;
  id: string;
  roundId: string;
  effort: number;
  allocations: AssetAllocation[];
  salesId: string;
  salesName: string;
  at: string;
  author: string;
};
export type GapApproval = {
  id: string;
  planId: string;
  days: number;
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
  needsReview?: boolean; // Legacy field, no longer controls assessment.
  effort?: { days: number; at: string; author: string; note?: string };
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
    externalNote?: string;
    allocations?: AssessmentPlan['allocations'];
  };
};
export type AssessmentAction =
  | { type: 'return-draft'; reason: string }
  | { type: 'effort'; days: number; note?: string }
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
  | { type: 'gap-submit'; reason: string; approverId: string }
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
  return plan?.releasedAt ? undefined : plan;
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
      ['SmartX 员工', 'SmartX 系统管理员'].includes(user.role) &&
      user.id !== selectedId &&
      user.id !== managerId,
  );
}

// User-requested repair for this named local request only. Never changes a decision.
export function repairCustomerRequestApprover(
  records: ServiceRequest[],
  users: InternalUser[],
  now = new Date().toISOString(),
): ServiceRequest | null {
  const matches = records.filter((record) => record.title === '客户发起请求');
  if (matches.length !== 1 || matches[0].status !== '待评估') return null;
  const original = matches[0];
  const plan = currentPlan(original);
  if (!plan) return null;
  const options = gapApproverOptions(
    users,
    plan.salesId,
    assessmentOf(original).managerId,
  );
  if (options.length !== 1) return null;
  const ops = structuredClone(operationsOf(original));
  const pending =
    ops.assessment?.approvals.filter(
      (approval) =>
        approval.planId === plan.id &&
        approval.state === '待审批' &&
        !options.some((user) => user.id === approval.approverId),
    ) ?? [];
  if (!pending.length) return null;
  const changes = pending.map((approval) => {
    const before = approval.approver;
    approval.approverId = options[0].id;
    approval.approver = options[0].name;
    return `${before} → ${options[0].name}`;
  });
  return appendActivity(
    { ...original, updatedAt: now, operations: ops },
    {
      id: 'system:requested-approver-repair',
      name: '系统',
      role: 'SmartX 系统管理员',
    },
    '审批',
    '修正额度特批审批人',
    `按用户要求匹配可切换身份：${changes.join('；')}`,
    now,
  );
}

export const isProjectManager = (actor: OperationActor) =>
  actor.role === 'SmartX 项目经理';
export const isSalesUser = (user: InternalUser | undefined) =>
  !!user && user.status === '启用' && /销售/.test(user.department ?? '');
export const planAssetDays = (plan?: AssessmentPlan) =>
  plan?.allocations.reduce((sum, a) => sum + a.days, 0) ?? 0;
export const planGap = (plan?: AssessmentPlan) =>
  Math.max(0, (plan?.effort ?? 0) - planAssetDays(plan));
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
        (currentPlan(r)
          ?.allocations.filter((a) => a.assetId === asset.id)
          .reduce((n, a) => n + a.days, 0) ?? 0),
      0,
    );
  return Math.max(0, asset.balanceDays - locked);
}
export function assessmentLockIssue(
  record: ServiceRequest,
  records: ServiceRequest[],
  assets: RequestAsset[],
): string | null {
  if (record.status === '已取消') return null;
  const plan = currentPlan(record);
  if (!plan) return null;
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
      return `${asset.name} 可锁定余额不足，请刷新后重新评估资产方案。`;
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
): ServiceRequest {
  if (!actor.id || !isInternal(actor.role))
    throw new Error('仅内部人员可处理评估工作。');
  if (record.status !== '待评估')
    throw new Error('仅待评估阶段可处理评估工作。');
  const assessment = structuredClone(assessmentOf(record));
  const manager = () => {
    if (
      !isProjectManager(actor) ||
      (assessment.managerId && assessment.managerId !== actor.id)
    )
      throw new Error('评估及客户确认由负责本请求的项目经理执行。');
  };
  const text = (s: string, label: string) => {
    if (!s.trim()) throw new Error(`请填写${label}。`);
  };
  const positive = (n: number) => {
    if (!Number.isFinite(n) || n <= 0 || n > 100000)
      throw new Error('人天必须为有效正数。');
  };
  let title = '',
    detail = '',
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
      '额度特批审批中，暂不能修改核定人天或服务依据，请等待审批完成。',
    );
  if (action.type === 'review') {
    manager();
    text(action.opinion, '评估意见');
    if (assessment.rounds.some((r) => r.outcome === '评估通过'))
      throw new Error('材料评估已通过，不支持新增评估。');
    if (!['评估通过', '需补充'].includes(action.outcome))
      throw new Error('请选择有效评估结论。');
    const id = crypto.randomUUID();
    assessment.managerId = actor.id;
    assessment.manager = actor.name;
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
    title = `材料评估 · ${action.outcome}`;
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
      '退回草稿',
      action.reason.trim(),
      now,
    );
  } else if (action.type === 'effort') {
    manager();
    if (!assessment.rounds.some((r) => r.outcome === '评估通过'))
      throw new Error('请先完成材料评估。');
    positive(action.days);
    assessment.effort = {
      days: action.days,
      at: now,
      author: actor.name,
      note: action.note?.trim() ?? '',
    };
    if (plan && plan.effort !== action.days) {
      assessment.plans.at(-1)!.releasedAt = now;
      assessment.approvals.forEach((a) => {
        if (a.state === '待审批' || a.state === '已通过') a.state = '已失效';
      });
    }
    title = '核定人天';
    detail = `${action.days} 人天${assessment.effort.note ? ` · ${assessment.effort.note}` : ''}`;
  } else if (action.type === 'plan') {
    manager();
    const round = assessment.rounds.find((r) => r.outcome === '评估通过');
    if (!round) throw new Error('请先完成材料评估。');
    const effort = assessedEffort(record);
    if (effort === undefined) throw new Error('请先核定人天，再关联服务依据。');
    positive(effort);
    const sales = users.find((u) => u.id === action.salesId && isSalesUser(u));
    if (!sales) throw new Error('请选择负责本请求的销售。');
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
      return { ...a, name: asset.name };
    });
    if (allocations.reduce((sum, a) => sum + a.days, 0) > effort + 1e-8)
      throw new Error('锁定人天不能超过评估总人天。');
    assessment.plans.push({
      id: crypto.randomUUID(),
      roundId: round.id,
      effort: effort,
      allocations,
      salesId: sales.id,
      salesName: sales.name,
      at: now,
      author: actor.name,
    });
    assessment.approvals.forEach((a) => {
      if (a.state === '待审批' || a.state === '已通过') a.state = '已失效';
    });
    title = plan ? '调整服务依据' : '关联服务依据';
    detail = `总人天 ${effort} · 锁定 ${planAssetDays(assessment.plans.at(-1))} 人天`;
  } else if (action.type === 'gap-submit') {
    const sales = users.find((u) => u.id === actor.id && isSalesUser(u));
    if (
      !plan ||
      actor.id !== plan.salesId ||
      !sales ||
      actor.role !== 'SmartX 员工'
    )
      throw new Error('仅方案指定的销售可发起额度特批。');
    const gap = planGap(plan);
    positive(gap);
    text(action.reason, '特批原因');
    if (
      assessment.approvals.some(
        (a) => a.planId === plan.id && ['待审批', '已通过'].includes(a.state),
      )
    )
      throw new Error('该方案已发起特批，请勿重复提交。');
    const approver = gapApproverOptions(
      users,
      actor.id,
      assessment.managerId,
    ).find((user) => user.id === action.approverId);
    if (
      !approver ||
      approver.id === actor.id ||
      approver.id === assessment.managerId
    )
      throw new Error(
        '请选择右上角可切换身份中的上级审批人，不能由销售本人或评估项目经理审批。',
      );
    assessment.approvals.push({
      id: crypto.randomUUID(),
      planId: plan.id,
      days: gap,
      reason: action.reason.trim(),
      authorId: actor.id,
      author: actor.name,
      approverId: approver.id,
      approver: approver.name,
      at: now,
      state: '待审批',
    });
    category = '审批';
    title = '销售发起额度特批';
    detail = `缺口 ${gap} 人天 · ${action.reason}`;
  } else if (action.type === 'gap-decide') {
    const approval = assessment.approvals.find((a) => a.id === action.id);
    if (
      !approval ||
      approval.state !== '待审批' ||
      approval.planId !== plan?.id
    )
      throw new Error('审批已处理或资产方案已变更。');
    if (
      !['SmartX 员工', 'SmartX 系统管理员'].includes(actor.role) ||
      actor.id !== approval.approverId ||
      actor.id === approval.authorId ||
      actor.id === assessment.managerId
    )
      throw new Error('仅指定上级可审批，不能自行审批。');
    text(action.note, '审批意见');
    approval.state = action.approve ? '已通过' : '已拒绝';
    approval.note = action.note.trim();
    approval.decidedAt = now;
    approval.decidedBy = actor.name;
    category = '审批';
    title = `额度特批${action.approve ? '通过' : '拒绝'}`;
    detail = action.note;
  } else if (action.type === 'confirm') {
    manager();
    if (!plan || assessedEffort(record) === undefined || !assessment.rounds.some(round => round.outcome === '评估通过')) throw new Error('请先完成材料评估、核定人天和关联服务依据。');
    const gap = planGap(plan);
    const approval = assessment.approvals.find(
      (a) => a.planId === plan.id && a.state === '已通过' && a.days >= gap,
    );
    if (gap > 1e-8 && !approval)
      throw new Error('资产不足，请由销售发起特批并经上级审批通过。');
    const round = assessment.rounds.find((r) => r.id === plan.roundId)!;
    assessment.confirmation = {
      at: now,
      by: actor.name,
      planId: plan.id,
      scope: round.scope,
      effort: plan.effort,
      assetDays: planAssetDays(plan),
      extraDays: gap,
      externalNote: action.externalNote?.trim() ?? '',
      allocations: structuredClone(plan.allocations),
    };
    status = '待确认';
    title = '发起客户确认';
    detail = `${round.scope} · 总人天 ${plan.effort} · 客户资产 ${planAssetDays(plan)} · 特批 ${gap}`;
  } else {
    throw new Error('不支持的评估操作。');
  }
  const next = {
    ...record,
    status,
    operations: { ...operationsOf(record), assessment },
  };
  if (action.type === 'plan' || action.type === 'confirm') {
    const issue = assessmentLockIssue(next, records, assets);
    if (issue) throw new Error(issue);
  }
  return appendActivity(next, actor, category, title, detail, now);
}
