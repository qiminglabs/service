import { isDemoAdministrator } from './demo-permissions.ts';
import { withAssessmentCollaborators } from './request-collaboration.ts';
import {
  hardwareItems,
  hardwareRequirement,
  matchesHardwareTrigger,
  captureHardwareRequirement,
  parseHardwareAssessmentTrigger,
} from './hardware-assessment-trigger.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import {
  matchesRoute,
  parseRoutingConfig,
  routingUsers,
  roleIdentity,
  type RoutingRole,
  type RoutingConfig,
  type RoutingDictionary,
} from './assessment-routing-schema.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';

export type AssessmentAllocation = {
  id: string;
  userId: string;
  userName: string;
  at: string;
  configRevision: number;
  ruleId?: string;
  matchedBy: 'rule' | 'default';
  reason: string;
};
export type AssessmentRouting = {
  manager?: AssessmentAllocation;
  hardware?: AssessmentAllocation;
  history?: {
    role: RoutingRole;
    allocation: AssessmentAllocation;
    replacedAt: string;
    by: string;
    reason: string;
  }[];
};
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const needsHardware = (record: ServiceRequest) =>
  hardwareItems(record).length > 0;
export const materialAssessmentPassed = (record: ServiceRequest) =>
  !!record.operations?.assessment?.rounds.some(
    (round) => round.outcome === '评估通过',
  );
export function canPerformAssessmentRole(
  record: ServiceRequest,
  actor: OperationActor | undefined,
  role: RoutingRole,
  users?: InternalUser[],
): boolean {
  if (isDemoAdministrator(actor, users)) return true;
  if (!actor?.id || actor.role !== roleIdentity[role]) return false;
  const assessment = record.operations?.assessment;
  if (!assessment?.routing)
    return role === 'hardware'
      ? fixedIdentityRoles[actor.id] === actor.role &&
          (!users || routingUsers(users, role).some((u) => u.id === actor.id))
      : !assessment?.managerId || assessment.managerId === actor.id;
  const allocation = assessment.routing[role];
  return (
    !!allocation?.userId &&
    allocation.userId === actor.id &&
    fixedIdentityRoles[actor.id] === actor.role &&
    (!users || routingUsers(users, role).some((u) => u.id === actor.id))
  );
}
export function resolveAssessmentRoute(
  record: ServiceRequest,
  role: RoutingRole,
  config: RoutingConfig,
  users: InternalUser[],
  now = new Date().toISOString(),
  customers: RoutingDictionary['customers'] = [],
): AssessmentAllocation | undefined {
  if (
    role === 'hardware' &&
    !matchesHardwareTrigger(
      record,
      parseHardwareAssessmentTrigger(config.hardware.trigger),
    )
  )
    return undefined;
  const policy = config[role],
    rule = policy.rules
      .filter((r) => r.enabled)
      .sort((a, b) => a.priority - b.priority)
      .find((r) => matchesRoute(record, r.compiled, customers));
  const userId = rule?.userId ?? policy.defaultUserId,
    user = routingUsers(users, role).find((user) => user.id === userId);
  return {
    id: crypto.randomUUID(),
    userId: user?.id ?? '',
    userName: user?.name ?? '',
    at: now,
    configRevision: config.revision,
    matchedBy: rule ? 'rule' : 'default',
    ...(rule ? { ruleId: rule.id } : {}),
    reason: user
      ? rule
        ? `命中优先级 ${rule.priority}：${rule.requirement}`
        : '使用默认负责人'
      : userId
        ? '配置的负责人已停用或角色不符，请管理员重新分配。'
        : '尚未配置默认负责人，且未命中分配规则。',
  };
}
export function routingSaveIssue(
  next: ServiceRequest,
  previous: ServiceRequest | undefined,
  actor: OperationActor | undefined,
  users: InternalUser[],
): string | null {
  const before = previous?.operations?.assessment,
    after = next.operations?.assessment;
  const returning = previous?.status === '待评估' && next.status === '草稿';
  if (returning) {
    if (
      after?.routing ||
      after?.hardwareRequirement ||
      !same(
        next.operations?.assessmentHistory?.at(-1)?.hardwareRequirement,
        before?.hardwareRequirement,
      ) ||
      !same(
        next.operations?.assessmentHistory?.at(-1)?.routing,
        before?.routing,
      )
    )
      return '退回草稿须归档并清空本轮分配记录。';
    if (
      before?.routing &&
      !canPerformAssessmentRole(previous!, actor, 'manager', users)
    )
      return '仅负责本请求的项目经理可退回草稿。';
    return null;
  }
  if (!same(before?.hardwareRequirement, after?.hardwareRequirement))
    return '硬件评估触发条件由后台流程管理，请刷新后重试。';
  if (!same(before?.routing, after?.routing))
    return '评估负责人由后台分配流程管理，请刷新后重试。';
  if (!before?.routing) return null;
  if (
    before.managerId !== after?.managerId ||
    (before.manager !== after?.manager &&
      (!canPerformAssessmentRole(previous!, actor, 'manager', users) ||
        after?.manager !== actor?.name))
  )
    return '不能直接修改评估项目经理。';
  if (
    (!same(before.rounds, after?.rounds) ||
      !same(before.effort, after?.effort) ||
      !same(previous?.items, next.items)) &&
    !canPerformAssessmentRole(previous!, actor, 'manager', users)
  )
    return '材料评估、服务项修改及人天核定由分配的项目经理执行。';
  if (
    !same(before.hardware, after?.hardware) &&
    !canPerformAssessmentRole(previous!, actor, 'hardware', users)
  )
    return '仅分配的硬件产品经理可填写硬件评估。';
  return null;
}
function installAllocation(
  record: ServiceRequest,
  role: RoutingRole,
  allocation: AssessmentAllocation | undefined,
  now: string,
  by: string,
  reason: string,
): void {
  const assessment = record.operations!.assessment!;
  const routing = (assessment.routing ??= {});
  const old = routing[role];
  if (old)
    (routing.history ??= []).push({
      role,
      allocation: old,
      replacedAt: now,
      by,
      reason,
    });
  routing[role] = allocation;
  if (role === 'manager') {
    assessment.managerId = allocation?.userId ?? '';
    assessment.manager = allocation?.userName ?? '';
  }
  if (role === 'hardware' && assessment.hardware?.rounds.length)
    assessment.hardware.rounds.at(-1)!.invalidatedAt = now;
}
// Called only after the original input has passed identity and immutability checks.
export function routeAssessmentOnSave(
  next: ServiceRequest,
  previous: ServiceRequest | undefined,
  storedConfig: unknown,
  users: InternalUser[],
  now = new Date().toISOString(),
  customers: RoutingDictionary['customers'] = [],
): ServiceRequest {
  if (next.status !== '待评估' || materialAssessmentPassed(previous ?? next))
    return next;
  const submitting = previous?.status === '草稿' || !previous;
  const addedHardware =
    !!previous && !needsHardware(previous) && needsHardware(next);
  const removedHardware =
    !!previous && needsHardware(previous) && !needsHardware(next);
  if (!submitting && !addedHardware && !removedHardware) return next;
  const record = structuredClone(next);
  record.operations ??= {
    meetings: [],
    worklogs: [],
    bases: [],
    evaluations: [],
    activities: [],
  };
  record.operations.assessment ??= {
    managerId: '',
    manager: '',
    rounds: [],
    tasks: [],
    plans: [],
    approvals: [],
  };
  const assessment = record.operations.assessment;
  const latestConfig = parseRoutingConfig(storedConfig);
  const requirement = submitting
    ? captureHardwareRequirement(
        parseHardwareAssessmentTrigger(latestConfig.hardware.trigger),
        latestConfig.revision,
      )
    : hardwareRequirement(previous ?? next);
  assessment.hardwareRequirement = structuredClone(requirement);
  const config = {
    ...latestConfig,
    hardware: {
      ...latestConfig.hardware,
      trigger: {
        enabled: requirement.serviceIds.length > 0,
        serviceIds: requirement.serviceIds,
      },
    },
  };
  if (submitting) {
    assessment.routing = {};
    installAllocation(
      record,
      'manager',
      resolveAssessmentRoute(record, 'manager', config, users, now, customers),
      now,
      '系统',
      '提交申请',
    );
    installAllocation(
      record,
      'hardware',
      resolveAssessmentRoute(record, 'hardware', config, users, now, customers),
      now,
      '系统',
      '提交申请',
    );
  } else if (addedHardware) {
    installAllocation(
      record,
      'hardware',
      resolveAssessmentRoute(record, 'hardware', config, users, now, customers),
      now,
      '系统',
      '申请项命中硬件评估触发条件',
    );
  } else if (removedHardware && assessment.routing)
    installAllocation(
      record,
      'hardware',
      undefined,
      now,
      '系统',
      '申请项不再命中硬件评估触发条件',
    );
  return withAssessmentCollaborators(record, users);
}
