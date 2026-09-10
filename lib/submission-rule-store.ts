import { openDatabase, readLocal } from './service-requests.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import type { OperationActor } from './request-operations';
import type { InternalUser } from './service-requests';
import { parseCompiledRule, parseRuleDefinition, normalizeStoredSubmissionRule, submissionRulesId } from './submission-rule-schema.ts';
import type { RuleDefinition, SubmissionRule } from './submission-rule-schema';
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
export async function saveRuleDraft(actor: OperationActor, definition: RuleDefinition, existing?: Pick<SubmissionRule, 'id' | 'revision'>) {
  const parsed = parseRuleDefinition(definition), id = existing?.id ?? crypto.randomUUID();
  const rules = await mutateRules(actor, rules => {
    const previous = rules.find(r => r.id === id);
    if (existing && (!previous || previous.revision !== existing.revision)) throw new Error('规则已被其他页面修改，请刷新后重试。');
    const next: SubmissionRule = { ...parsed, id, revision: (previous?.revision ?? 0) + 1, status: 'pending', updatedAt: new Date().toISOString(), updatedBy: actor.name, ...(previous?.active ? { active: previous.active } : {}) };
    return previous ? rules.map(r => r.id === id ? next : r) : [...rules, next];
  });
  return rules.find(r => r.id === id)!;
}
export async function finishRuleCompilation(actor: OperationActor, draft: SubmissionRule, result: { compiled?: unknown; summary?: string; error?: string }) {
  return mutateRules(actor, rules => {
    if (!rules.some(rule => rule.id === draft.id)) throw new Error('规则已被移除，本次转译结果未生效。');
    return rules.map(rule => {
    if (rule.id !== draft.id) return rule;
    if (rule.revision !== draft.revision) throw new Error('规则已变更，本次旧转译结果未生效，请刷新。');
    if (result.error) return { ...rule, status: 'error', error: result.error.slice(0, 1500) };
    const compiled = parseCompiledRule(result.compiled);
    if (!result.summary?.trim()) throw new Error('缺少转译说明。');
    return { ...rule, status: 'ready', error: undefined, updatedAt: new Date().toISOString(), active: { ...parseRuleDefinition(rule), compiled, summary: result.summary, enabled: true } };
    });
  });
}
export async function toggleSubmissionRule(actor: OperationActor, rule: SubmissionRule) {
  return mutateRules(actor, rules => {
    if (!rules.some(current => current.id === rule.id)) throw new Error('规则已被移除，请刷新。');
    return rules.map(current => {
    if (current.id !== rule.id) return current;
    if (current.revision !== rule.revision || !current.active) throw new Error('规则已变化，请刷新后重试。');
    return { ...current, revision: current.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name, active: { ...current.active, enabled: !current.active.enabled } };
    });
  });
}
