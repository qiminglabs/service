import { openDatabase, readLocal } from './service-requests.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import type { OperationActor } from './request-operations';
import type { InternalUser } from './service-requests';
import { parseSubmissionRuleDefinition,normalizeStoredSubmissionRule,submissionRulesId } from './submission-rule-schema.ts';
import type { RuleDefinition, SubmissionRule } from './submission-rule-schema';
import { ruleCompilationKey, RuleConflictError, testSubmissionRule } from './submission-rule-conflicts.ts';
import type { RuleTestResult } from './submission-rule-conflicts';
import { builtinSubmissionRules } from './submission-rule-builtins.ts';
export async function readSubmissionRules(): Promise<SubmissionRule[]> {
  const refs = await readLocal<{ id: string; payload?: unknown }>('references');
  const rules = refs.find(r => r.id === submissionRulesId)?.payload ?? [];
  if (!Array.isArray(rules)) throw new Error('校验规则配置损坏，请联系管理员。');
  return rules.map(normalizeStoredSubmissionRule);
}
export function canManageSubmissionRules(actor: OperationActor) {
  return !!actor.id && actor.role === 'SmartX 系统管理员' && fixedIdentityRoles[actor.id] === 'SmartX 系统管理员';
}
async function mutateRules(actor: OperationActor, change: (rules: SubmissionRule[]) => SubmissionRule[]): Promise<SubmissionRule[]> {
  if (!canManageSubmissionRules(actor)) throw new Error('仅系统管理员可维护校验规则。');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'), store = tx.objectStore('references'), get = store.getAll();
      let result: SubmissionRule[];
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('规则保存未完成。'));
      tx.onerror = () => reject(tx.error);
      get.onsuccess = () => {
        try {
          const users: InternalUser[] = get.result.find(r => r.id === 'workspace')?.payload?.users ?? [];
          if (!users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('当前管理员已停用或不存在，请重新选择身份。');
          const rules = get.result.find(r => r.id === submissionRulesId)?.payload ?? [];
          if (!Array.isArray(rules)) throw new Error('规则配置损坏，无法保存。');
          result = change(rules.map(normalizeStoredSubmissionRule));
          if (result.length > 200) throw new Error('最多支持 200 条自定义校验规则。');
          store.put({ id: submissionRulesId, payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
function archiveSubmissionRule(rule: SubmissionRule, actor: OperationActor, activeOnly = false): NonNullable<SubmissionRule['history']> {
  const { history = [], ...snapshot } = structuredClone(rule);
  const archivedAt = new Date().toISOString();
  return [...history, {
    ...snapshot,
    ...(activeOnly && rule.active ? { ...parseSubmissionRuleDefinition(rule.active), status: 'ready' as const, error: undefined } : {}),
    version: rule.version ?? Math.max(1, rule.revision), enabled: false,
    ...(rule.active ? { active: { ...structuredClone(rule.active), enabled: false } } : {}),
    disabledAt: archivedAt, disabledBy: actor.name, archivedAt, archivedBy: actor.name,
  }];
}
// Persist only the tested compilation. Recheck the latest rules inside the same
// transaction so a new conflicting rule cannot slip in between test and save.
export async function saveTestedSubmissionRule(actor: OperationActor, definition: RuleDefinition, tested: RuleTestResult, existing?: Pick<SubmissionRule, 'id' | 'revision'>) {
  const parsed = parseSubmissionRuleDefinition(definition);
  if (!tested || tested.key !== ruleCompilationKey(parsed)) throw new Error('检验要求、适用申请或固定检查时机已变化，请重新转译并测试。');
  if (tested.conflicts.length) throw new RuleConflictError(tested.conflicts);
  return mutateRules(actor, rules => {
    const previous = existing ? rules.find(r => r.id === existing.id) : undefined;
    if (existing && (!previous || previous.revision !== existing.revision)) throw new Error('规则已被其他页面修改，请刷新后重试。');
    if (previous?.enabled === false) throw new Error('停用规则只读，不可编辑或再次启用。');
    const current = testSubmissionRule(parsed, tested.compiled, tested.summary, rules, existing?.id);
    if (current.conflicts.length) throw new RuleConflictError(current.conflicts);
    const next: SubmissionRule = {
      ...parsed, id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1,
      enabled: true, version: previous ? (previous.version ?? Math.max(1, previous.revision)) + 1 : 1,
      history: previous ? archiveSubmissionRule(previous, actor) : [],
      status: 'ready', updatedAt: new Date().toISOString(), updatedBy: actor.name,
      active: { ...parsed, compiled: current.compiled, summary: current.summary, enabled: true },
    };
    return previous ? rules.map(r => r.id === previous.id ? next : r) : [...rules, next];
  });
}

export async function disableSubmissionRule(actor: OperationActor, rule: Pick<SubmissionRule, 'id' | 'revision'>) {
  return mutateRules(actor, rules => {
    if (builtinSubmissionRules.some(builtin => builtin.id === rule.id)) throw new Error('系统预置规则不支持停用。');
    const current = rules.find(item => item.id === rule.id);
    if (!current || current.revision !== rule.revision) throw new Error('规则已被其他页面修改，请刷新后重试。');
    if (current.enabled === false) throw new Error('规则已停用。');
    const at = new Date().toISOString();
    return rules.map(item => item.id !== current.id ? item : {
      ...current, enabled: false, version: current.version ?? Math.max(1, current.revision), revision: current.revision + 1,
      disabledAt: at, disabledBy: actor.name, updatedAt: at, updatedBy: actor.name,
      ...(current.active ? { active: { ...current.active, enabled: false } } : {}),
    });
  });
}
