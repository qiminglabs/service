import { fixedIdentityRoles } from './internal-users.ts';
import { assessmentRoutingId, parseRoutePredicate, parseRoutingConfig, routingUsers, type RouteCondition, type RoutingDictionary, type RoutingRule } from './assessment-routing-schema.ts';
import { approvalRulesId, testedApprovalConditions, type ApprovalRule, type ApprovalRules } from './approval-rules.ts';
import { approvalConfigIssue, type ApprovalNode } from './approval-flows.ts';
import { buildDemoSubmissionRule } from './demo-submission-rules.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import type { InternalUser } from './service-requests';

type Workspace = RoutingDictionary & { users: InternalUser[] };

// Only used by the explicit demo reset. Reuse existing people and fixed identities.
export function demoReportingUsers(users: InternalUser[]): InternalUser[] {
  const manager = routingUsers(users, 'manager')[0];
  const admin = users.find(user => user.status === '启用' && fixedIdentityRoles[user.id] === 'SmartX 系统管理员');
  return users.map(user => ({ ...user, reportsToUserId: user.status !== '启用' || user.id === admin?.id
    ? undefined : user.id === manager?.id ? admin?.id : manager?.id }));
}

export function demoWorkflowRuleReferences(workspace: Workspace, now = new Date().toISOString()) {
  const manager = routingUsers(workspace.users, 'manager')[0];
  const hardware = routingUsers(workspace.users, 'hardware')[0];
  const admin = workspace.users.find(user => user.status === '启用' && fixedIdentityRoles[user.id] === 'SmartX 系统管理员');
  if (!manager || !hardware || !admin) throw new Error('初始化规则样例需要启用的项目经理、硬件产品经理和系统管理员。');
  const metadata = { updatedAt: now, updatedBy: admin.name };
  const hardwareService = workspace.services.find(service => service.name === '硬件兼容性测试');
  const upgrade = workspace.services.find(service => service.name === '集群升级（服务权益）') ?? workspace.services.find(service => /升级/.test(service.name));
  const condition = (field: RouteCondition['field'], value: string): RouteCondition => ({ field, operator: 'eq', value });
  const predicate = (conditions: RouteCondition[] = [], items: RouteCondition[] = []) => parseRoutePredicate({ version: 1, groups: [{ conditions, items: items.length ? [{ mode: 'some', conditions: items }] : [] }] }, workspace);
  const finance = predicate([condition('customerTeam', '金融')]);
  const onsite = predicate([], [condition('method', '现场')]);
  const customer = predicate([condition('source', 'customer')]);
  const route = (id: string, priority: number, requirement: string, compiled: RoutingRule['compiled'], userId: string): RoutingRule => ({ id, priority, requirement, compiled, userId, enabled: true, ...metadata });
  const routing = parseRoutingConfig({ version: 1, revision: 1, ...metadata,
    manager: { defaultUserId: manager.id, rules: [
      route('demo-manager-finance', 10, '客户负责团队为金融的申请', finance, manager.id),
      route('demo-manager-onsite', 20, '包含现场服务的申请', onsite, manager.id),
      ...(upgrade ? [route('demo-manager-upgrade', 30, `包含服务项「${upgrade.name}」的申请`, predicate([], [condition('serviceId', upgrade.id)]), manager.id)] : []),
      route('demo-manager-customer', 40, '由客户发起的申请', customer, manager.id),
    ] },
    hardware: { defaultUserId: hardware.id, trigger: { enabled: !!hardwareService, serviceIds: hardwareService ? [hardwareService.id] : [] }, rules: [
      route('demo-hardware-finance', 10, '客户负责团队为金融的申请', finance, hardware.id),
    ] },
  });
  const node = (id: string, name: string, source: ApprovalNode['source'], options: Partial<ApprovalNode> = {}): ApprovalNode => ({ id, name, source, userIds: [], depth: 2, stopUserIds: [], reject: 'return', ...options });
  const approval = (id: string, priority: number, name: string, requirement: string, compiled: RoutingRule['compiled'], nodes: ApprovalNode[]): ApprovalRule => {
    const flow = { version: 1 as const, revision: 1, name, nodes, ...metadata };
    const issue = approvalConfigIssue(flow, workspace.users);
    if (issue) throw new Error(issue);
    return { id, revision: 1, name, priority, conditions: testedApprovalConditions({ requirement, testedRequirement: requirement, compiled }, workspace), flow, ...metadata };
  };
  const approvals: ApprovalRules = { version: 1, defaultRevision: 1, defaultUserId: admin.id, rules: [
    approval('demo-approval-finance', 10, '金融客户特殊审批', '客户负责团队为金融的申请', finance, [
      node('finance-manager', '申请人汇报人审批', 'manager'),
      node('finance-final', '最终审批', 'people', { userIds: [admin.id] }),
    ]),
    approval('demo-approval-onsite', 20, '现场服务逐级审批', '内部申请且包含现场服务', predicate([condition('source', 'internal')], [condition('method', '现场')]), [
      node('onsite-chain', '沿汇报关系逐级审批', 'org', { stopUserIds: [admin.id] }),
      node('onsite-final', '服务安排复核', 'people', { userIds: [hardware.id] }),
    ]),
  ] };
  const submission = [{ ...buildDemoSubmissionRule(), ...metadata }];
  return [{ id: assessmentRoutingId, payload: routing }, { id: approvalRulesId, payload: approvals }, { id: submissionRulesId, payload: submission }];
}
