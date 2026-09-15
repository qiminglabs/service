import { approvalConfigIssue, reportingChain } from './approval-flows.ts';
import { resolveApprovalRule, type ApprovalRule } from './approval-rules.ts';
import { currentPlan, planGap } from './request-assessment.ts';
import { requestAudience } from './request-collaboration.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { RoutingDictionary } from './assessment-routing-schema';

export type ApprovalPreviewStep = {
  id: string;
  name: string;
  approvers: { id: string; name: string; cutoff: boolean; fallback?: boolean }[];
  issue?: string;
  fallbackReason?: string;
};
export type ApprovalPreview = {
  requirement: 'required' | 'not-required' | 'pending';
  rule?: ApprovalRule;
  defaultApprover?: { id: string; name: string };
  steps: ApprovalPreviewStep[];
  issue?: string;
};

export function approvalPreviewRequirement(request: ServiceRequest): ApprovalPreview['requirement'] {
  const plan = currentPlan(request);
  if (!plan) return 'pending';
  return planGap(plan) > 1e-8 ? 'required' : 'not-required';
}

/** Read-only projection of saved rules. Never changes request assignments or approval state. */
export function resolveApprovalPreview(request: ServiceRequest, rules: ApprovalRule[], users: InternalUser[], customers: RoutingDictionary['customers'], defaultUserId = ''): ApprovalPreview {
  const requirement = approvalPreviewRequirement(request);
  if (requirement !== 'required') return { requirement, steps: [] };
  return { ...resolveRequiredApprovalPreview(request, rules, users, customers, defaultUserId), requirement: 'required' };
}

function resolveRequiredApprovalPreview(request: ServiceRequest, rules: ApprovalRule[], users: InternalUser[], customers: RoutingDictionary['customers'], defaultUserId: string): Omit<ApprovalPreview, 'requirement'> {
  const rule = resolveApprovalRule(rules, request, customers);
  if (!rule) {
    if (!defaultUserId) return { steps: [] };
    const person = users.find(user => user.id === defaultUserId && user.status === '启用');
    return person ? { steps: [], defaultApprover: { id: person.id, name: person.name } } : { steps: [], issue: '默认审批人不存在或已停用，待分配。' };
  }
  if (!rule.flow.nodes.length) return { rule, steps: [], issue: '命中的规则尚未配置审批流程。' };
  const issue = approvalConfigIssue(rule.flow, users, { allowUnavailableApprovers: true }) ?? undefined;
  if (issue) return { rule, steps: [], issue };
  const fallback = users.find(user => user.id === defaultUserId && user.status === '启用');
  const steps = rule.flow.nodes.map(node => {
    let resolved: { users: InternalUser[]; issue?: string };
    if (node.source === 'people') {
      const person = node.userIds.length === 1 ? users.find(user => user.id === node.userIds[0] && user.status === '启用') : undefined;
      resolved = person ? { users: [person] } : { users: [], issue: '指定审批人未配置、不存在或已停用。' };
    } else if (node.source !== 'manager' && node.source !== 'org') {
      resolved = { users: [], issue: '审批人来源无效，请重新配置。' };
    } else if (requestAudience(request) !== 'internal') {
      resolved = { users: [], issue: '该请求由客户发起，无法读取内部汇报关系。' };
    } else if (!request.createdById) {
      resolved = { users: [], issue: '该请求未记录申请人编号，无法确定汇报关系。' };
    } else {
      resolved = reportingChain(users, request.createdById, node.source === 'manager' ? 1 : node.depth, node.source === 'org' ? node.stopUserIds : []);
    }
    const approvers: ApprovalPreviewStep['approvers'] = resolved.users.map(user => ({ id: user.id, name: user.name, cutoff: node.source === 'org' && (node.stopUserIds ?? []).includes(user.id) }));
    if (resolved.issue && fallback) {
      // End only this incomplete stage; keep already resolved levels and later stages.
      if (approvers.at(-1)?.id === fallback.id) approvers[approvers.length - 1].fallback = true;
      else approvers.push({ id: fallback.id, name: fallback.name, cutoff: false, fallback: true });
      return { id: node.id, name: node.name, approvers, fallbackReason: resolved.issue };
    }
    return {
      id: node.id, name: node.name, approvers,
      issue: resolved.issue ? `${resolved.issue} ${defaultUserId ? '默认审批人不存在或已停用' : '未设置默认审批人'}，待分配。` : undefined,
    };
  });
  return { rule, steps, issue };
}
