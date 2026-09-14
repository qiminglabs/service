import { readLocal } from './service-requests.ts';
import { requestMaterialIssues } from './request-materials.ts';
import type { ServiceRequest } from './service-requests';
import { applicantRemovalIssue, customerCollaboratorsIssue, isRequestApplicant, requestAudience } from './request-collaboration.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import { assessedEffort } from './request-assessment.ts';
import { requestCompletenessIssues } from './request-validation-builtins.ts';
import { factCatalog, parseCompiledRule, parseRuleDefinition, normalizeStoredSubmissionRule, ruleEvents, submissionRulesId } from './submission-rule-schema.ts';
import type { RuleDefinition, RuleEvent, RuleFact, SubmissionRule, RuleCondition } from './submission-rule-schema';
export type ValidationContext = Parameters<typeof requestCompletenessIssues>[1];
export type ValidationFailure = { ruleId: string; requirement: string; message: string };
export class SubmissionValidationError extends Error {
  failures: ValidationFailure[];
  events: RuleEvent[];
  constructor(failures: ValidationFailure[], events: RuleEvent[]) {
    super(failures.map(f => f.message).join('\n'));
    this.name = 'SubmissionValidationError'; this.failures = failures; this.events = events;
  }
}
export { builtinSubmissionRules } from './submission-rule-builtins.ts';
import { builtinSubmissionRules } from './submission-rule-builtins.ts';
export function submissionEvent(record: ServiceRequest): RuleEvent {
  return record.operations?.draftReturns?.length ? 'resubmit' : 'submit';
}
// The queue is driven by saved transitions, never a client-supplied event name.
export function validationEventsForTransition(next: ServiceRequest, previous?: ServiceRequest): RuleEvent[] {
  const events: RuleEvent[] = [];
  const a = next.operations?.assessment, b = previous?.operations?.assessment;
  if (next.status === '待评估' && (!previous || previous.status === '草稿')) events.push(submissionEvent(previous ?? next));
  if (a?.rounds.some(round => round.outcome === '评估通过' && !b?.rounds.some(old => old.id === round.id))) events.push('assessment-pass');
  if (a?.effort && JSON.stringify(a.effort) !== JSON.stringify(b?.effort)) events.push('effort-confirm');
  if (a?.plans.length && JSON.stringify(a.plans.at(-1)) !== JSON.stringify(b?.plans.at(-1)) && !a.plans.at(-1)?.releasedAt) events.push('plan-confirm');
  if (next.status === '待确认' && previous?.status !== '待确认' && a?.confirmation) events.push('request-confirmation');
  if (previous?.status === '待确认' && next.status === '待受理') events.push('customer-accept');
  return events;
}
export function ruleFacts(record: ServiceRequest, refs: ValidationContext, now = new Date()): Record<RuleFact, string | number | boolean | null> {
  const participantIds = new Set(record.internalParticipants?.map(p => p.userId));
  const people = (refs.users ?? []).filter(u => participantIds.has(u.id) && u.status === '启用');
  const roleCount = (role: string) => new Set(people.filter(u => fixedIdentityRoles[u.id] === role).map(u => u.id)).size;
  const externalIds = new Set(record.externalCollaborators?.map(p => p.contactId));
  const date = record.expectedServiceDate;
  const validDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return {
    title: record.title, description: record.description,
    expectedServiceDate: date ?? '', expectedLeadDays: validDate ? (Date.parse(date) - today) / 86400000 : null,
    customerName: refs.customers.find(c => c.id === record.customerId)?.name ?? '', itemCount: record.items.length,
    internalCount: new Set(people.map(p => p.id)).size,
    customerCount: new Set(refs.contacts.filter(c => externalIds.has(c.id) && c.customerId === record.customerId && c.status === '启用').map(c => c.id)).size,
    presalesCount: roleCount('SmartX 售前工程师'), engineerCount: roleCount('SmartX 服务工程师'), managerCount: roleCount('SmartX 项目经理'), salesCount: roleCount('SmartX 销售经理'),
    isApplicant: isRequestApplicant(record, refs.currentActor), applicantPresent: !applicantRemovalIssue(record),
    customerCollaboratorsValid: !customerCollaboratorsIssue(record, refs.contacts),
    allItemsDescribed: record.items.length > 0 && record.items.every(item => !!item.description.trim()),
    hasOnsiteItem: record.items.some(item => item.method === '现场'), hasRemoteItem: record.items.some(item => item.method === '远程'),
    hasBusinessObjects: record.items.length > 0 && record.items.every(item => item.businessObjectIds.length > 0),
    requiredMaterialsComplete: requestMaterialIssues(record, refs.audience ?? requestAudience(record)).length === 0,
    completeness: requestCompletenessIssues(record, refs).length === 0,
    managerAssigned: (refs.users ?? []).some(u => u.id === record.operations?.assessment?.managerId && u.status === '启用' && fixedIdentityRoles[u.id] === 'SmartX 项目经理'),
    assessedDays: assessedEffort(record) ?? null,
  };
}
export function evaluateCondition(condition: RuleCondition, facts: ReturnType<typeof ruleFacts>): boolean {
  const actual = facts[condition.fact];
  if (actual === null || actual === undefined) return false;
  const type = factCatalog[condition.fact].type;
  const expected = type === 'number' ? Number(condition.value) : type === 'boolean' ? condition.value === 'true' : condition.value;
  switch (condition.operator) {
    case 'eq': return actual === expected;
    case 'ne': return actual !== expected;
    case 'gt': return typeof actual === 'number' && actual > Number(expected);
    case 'gte': return typeof actual === 'number' && actual >= Number(expected);
    case 'lt': return typeof actual === 'number' && actual < Number(expected);
    case 'lte': return typeof actual === 'number' && actual <= Number(expected);
    case 'contains': return typeof actual === 'string' && actual.includes(condition.value);
    case 'not-empty': return typeof actual === 'string' && !!actual.trim();
  }
}
export function runValidationQueue(record: ServiceRequest, refs: ValidationContext, events: RuleEvent[], stored: unknown = []): ValidationFailure[] {
  if (!events.length) return [];
  const failures: ValidationFailure[] = [];
  const audience = requestAudience(record);
  // Material completeness follows the submitting applicant even when a later
  // checkpoint is performed by a manager; catalog scope still follows origin.
  const context = { ...refs, audience, materialActorId: audience === 'customer' ? record.createdById : refs.currentActor?.id };
  const applies = (rule: RuleDefinition) => (rule.scope === 'all' || rule.scope === audience) && rule.events.some(event => events.includes(event));
  const facts = ruleFacts(record, context);
  for (const rule of builtinSubmissionRules.filter(applies)) {
    let messages: string[] = [];
    switch (rule.id) {
      case 'builtin-applicant': messages = [isRequestApplicant(record, refs.currentActor) ? null : '仅创建人可以提交服务请求。', applicantRemovalIssue(record)].filter((s): s is string => !!s); break;
      case 'builtin-presales': if (facts.presalesCount === 0) messages = ['内部申请提交前，请至少添加一位已启用的 SmartX 售前工程师为内部协作人。']; break;
      case 'builtin-customer': { const issue = customerCollaboratorsIssue(record, refs.contacts); if (issue) messages = [issue]; break; }
      case 'builtin-completeness': messages = requestCompletenessIssues(record, context); break;
    }
    failures.push(...messages.map(message => ({ ruleId: rule.id, requirement: rule.requirement, message: message === rule.promptText ? message : `${rule.promptText}${rule.id === 'builtin-completeness' ? '' : ' '}${message}` })));
  }
  if (!Array.isArray(stored) || stored.length > 200) return [...failures, { ruleId: 'queue', requirement: '规则配置有效', message: '校验规则配置损坏，请联系管理员修复后重试。' }];
  for (const saved of stored as SubmissionRule[]) {
    let rule = saved;
    try {
      rule = normalizeStoredSubmissionRule(saved);
      if (!rule || typeof rule !== 'object') throw new Error();
      if (!rule.active) { if (!['pending', 'error'].includes(rule.status)) throw new Error(); continue; }
      if (typeof rule.active.enabled !== 'boolean') throw new Error();
      const definition = parseRuleDefinition(normalizeStoredSubmissionRule(rule).active);
      if (!rule.active.enabled || !applies(definition)) continue;
      const compiled = parseCompiledRule(rule.active.compiled);
      for (const check of compiled.checks) {
        const results = check.conditions.map(condition => evaluateCondition(condition, facts));
        if (!(check.mode === 'all' ? results.every(Boolean) : results.some(Boolean))) {
          failures.push({ ruleId: rule.id, requirement: definition.requirement, message: definition.promptText });
          break; // One administrator-written prompt per failed rule.
        }
      }
    } catch {
      failures.push({ ruleId: rule?.id ?? 'queue', requirement: '规则配置有效', message: '一条校验规则无法执行，请联系管理员修复后重试。' });
    }
  }
  return failures;
}
export async function checkSubmissionQueue(record: ServiceRequest, currentActor: ValidationContext['currentActor'], events: RuleEvent[]) {
  const references = await readLocal<{ id: string; payload?: any }>('references');
  const workspace = references.find(r => r.id === 'workspace')?.payload;
  if (!workspace) throw new Error('无法读取校验所需资料，请刷新后重试。');
  return runValidationQueue(record, { customers: workspace.customers ?? [], contacts: workspace.contacts ?? [], users: workspace.users ?? [], services: workspace.services ?? [], businessObjects: workspace.businessObjects ?? [], currentActor }, events, references.find(r => r.id === submissionRulesId)?.payload);
}
export function validationHeading(events: RuleEvent[]) {
  return events.some(e => e === 'submit' || e === 'resubmit') ? '尚未提交，请补充以下内容' : `${events.map(event => ruleEvents[event]).join('、')}未通过校验，请补充以下内容`;
}
