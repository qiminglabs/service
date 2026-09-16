import { emptyApprovalConfig, normalizeApprovalConfig, type ApprovalConfig } from './approval-flows.ts';
import { matchesRoute, parseRoutePredicate, routesOverlap, type RoutePredicate, type RoutingDictionary } from './assessment-routing-schema.ts';

import type { ServiceRequest } from './service-requests';

export const approvalRulesId = 'request-special-approval-rules';
export type ApprovalRuleConditions = {
  requirement: string;
  compiled?: RoutePredicate;
  testedRequirement?: string;
};
export type ApprovalRule = {
  enabled?: boolean;
  version?: number;
  history?: Array<Omit<ApprovalRule, 'history'> & { archivedAt: string; archivedBy: string }>;
  id: string;
  revision: number;
  name: string;
  priority: number;
  conditions: ApprovalRuleConditions;
  flow: ApprovalConfig;
  updatedAt?: string;
  updatedBy?: string;
};
export type ApprovalRules = { version: 1; rules: ApprovalRule[]; defaultUserId?: string; defaultRevision?: number };
export function nextApprovalPriority(rules: Pick<ApprovalRule, 'priority'>[]): number {
  const used = new Set(rules.map(rule => rule.priority));
  const next = Math.max(0, ...used) + 10;
  if (next <= 9999) return next;
  for (let priority = 1; priority <= 9999; priority++) if (!used.has(priority)) return priority;
  return 0;
}
export function sortApprovalRules(rules: ApprovalRule[]): ApprovalRule[] {
  return [...rules].sort((a, b) => a.priority - b.priority);
}
export function resolveApprovalRule(rules: ApprovalRule[], request: ServiceRequest, customers: RoutingDictionary['customers']): ApprovalRule | undefined {
  return sortApprovalRules(rules).find(rule => rule.enabled !== false && rule.conditions.compiled && rule.conditions.testedRequirement === rule.conditions.requirement.trim() && matchesRoute(request, rule.conditions.compiled, customers));
}
export function newApprovalRule(rules: ApprovalRule[] = []): ApprovalRule {
  return { id: crypto.randomUUID(), revision: 0, version: 1, enabled: true, name: '', priority: nextApprovalPriority(rules), conditions: { requirement: '' }, flow: emptyApprovalConfig() };
}
export function readApprovalRulesPayload(stored: unknown, legacy?: ApprovalConfig): ApprovalRules {
  if (stored !== undefined) {
    const value = stored as ApprovalRules;
    if (!value || value.version !== 1 || !Array.isArray(value.rules) || value.rules.some(rule => !rule?.id || !rule.conditions || !rule.flow || !Array.isArray(rule.flow.nodes)) || new Set(value.rules.map(rule => rule.id)).size !== value.rules.length) throw new Error('特殊审批规则无法读取，请恢复有效配置后重试。');
    if ((value.defaultUserId !== undefined && typeof value.defaultUserId !== 'string') || (value.defaultRevision !== undefined && (!Number.isInteger(value.defaultRevision) || value.defaultRevision < 0))) throw new Error('默认审批人配置无效。');
    const assigned = value.rules.filter(rule => rule.priority !== undefined).map(rule => ({ priority: rule.priority }));
    const rules = value.rules.map(rule => {
      const priority = rule.priority ?? nextApprovalPriority(assigned);
      if (rule.priority === undefined) assigned.push({ priority });
      return { ...structuredClone(rule), priority, flow: normalizeApprovalConfig(rule.flow), conditions: normalizeConditions(rule.conditions) };
    });
    return { ...structuredClone(value), rules: sortApprovalRules(rules) };
  }
  if (!legacy) return { version: 1, rules: [] };
  if (legacy.version !== 1 || !Number.isInteger(legacy.revision) || !Array.isArray(legacy.nodes)) throw new Error('原审批流程无法读取，请恢复有效配置后重试。');
  return { version: 1, rules: [{ ...newApprovalRule(), id: 'legacy-approval-rule', name: legacy.name, conditions: { requirement: '全部申请' }, flow: normalizeApprovalConfig(legacy), updatedAt: legacy.updatedAt, updatedBy: legacy.updatedBy }] };
}
export function approvalRuleIssue(rule: ApprovalRule): string | null {
  if (!rule.id || !Number.isInteger(rule.revision) || rule.revision < 0) return '规则版本无效。';
  if (!Number.isInteger(rule.priority) || rule.priority < 1 || rule.priority > 9999) return '优先级须为 1–9999 的整数，数字越小越优先。';
  if (!rule.name.trim() || rule.name.length > 80) return '请填写规则名称，最多 80 字。';
  if (!rule.conditions.requirement?.trim() || rule.conditions.requirement.length > 4000) return '请输入匹配条件，最多 4000 字。';
  return null;
}
export function approvalRuleConditionLabel(conditions: ApprovalRuleConditions): string {
  return conditions.requirement || '待填写匹配条件';
}
// Preserve existing conditions as editable prose when upgrading the local format.
function normalizeConditions(conditions: ApprovalRuleConditions): ApprovalRuleConditions {
  if (typeof conditions.requirement === 'string') return structuredClone(conditions);
  const old = conditions as unknown as { scope?: string; minAmount?: number | null; maxAmount?: number | null; risk?: string };
  const labels = [old.scope === 'internal' ? '内部申请' : old.scope === 'customer' ? '客户申请' : '全部申请'];
  if (old.minAmount != null) labels.push(`申请金额不少于 ${old.minAmount} 元`);
  if (old.maxAmount != null) labels.push(`申请金额不超过 ${old.maxAmount} 元`);
  if (old.risk && old.risk !== 'all') labels.push(old.risk === 'high' ? '高风险' : '普通风险');
  return { requirement: labels.join('，且') };
}
export function testedApprovalConditions(conditions: ApprovalRuleConditions, dictionary: RoutingDictionary): ApprovalRuleConditions {
  if (!conditions.compiled || conditions.testedRequirement !== conditions.requirement.trim()) throw new Error('请先转译并测试当前匹配条件，再保存规则。');
  const compiled = parseRoutePredicate(conditions.compiled, dictionary);
  if (!routesOverlap(compiled, compiled, 'manager')) throw new Error('匹配条件互相矛盾，请修改后重新测试。');
  return { requirement: conditions.requirement.trim(), testedRequirement: conditions.requirement.trim(), compiled };
}
