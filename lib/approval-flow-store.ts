import { approvalPreviewRequirement } from './approval-preview.ts';
import { openDatabase, readLocal } from './service-requests.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';
import { canManageRouting } from './assessment-routing-store.ts';
import { approvalConfigId, approvalConfigIssue, normalizeApprovalConfig, type ApprovalConfig } from './approval-flows.ts';
import { approvalRulesId, approvalRuleIssue, sortApprovalRules, testedApprovalConditions, readApprovalRulesPayload, type ApprovalRule, type ApprovalRules } from './approval-rules.ts';
import type { RoutingDictionary } from './assessment-routing-schema.ts';
type Reference = { id: string; payload?: unknown };
function unpack(records: Reference[]) {
  const workspace = records.find(row => row.id === 'workspace')?.payload as Partial<RoutingDictionary> & { users?: InternalUser[] } | undefined;
  const collection = readApprovalRulesPayload(records.find(row => row.id === approvalRulesId)?.payload, records.find(row => row.id === approvalConfigId)?.payload as ApprovalConfig | undefined);
  return { collection, users: workspace?.users ?? [], dictionary: { customers: workspace?.customers ?? [], services: workspace?.services ?? [] } };
}
export async function readApprovalRules() { return unpack(await readLocal<Reference>('references')); }
export async function readApprovalPreviewData() {
  const [data, requests] = await Promise.all([readApprovalRules(), readLocal<ServiceRequest>('requests')]);
  return { ...data, requests: requests.filter(request => request.status !== '草稿' && approvalPreviewRequirement(request) === 'required') };
}
export async function readApprovalData(ruleId: string) {
  const { collection, users } = await readApprovalRules();
  const rule = collection.rules.find(rule => rule.id === ruleId);
  if (!rule) throw new Error('该审批规则已不存在，请返回规则列表。');
  return { config: rule.flow, rule, users };
}
async function mutate(actor: OperationActor, change: (collection: ApprovalRules, users: InternalUser[], dictionary: RoutingDictionary) => void) {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护审批流程。');
  const db = await openDatabase();
  try {
    return await new Promise<ApprovalRules>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'), store = tx.objectStore('references'), request = store.getAll();
      let result: ApprovalRules;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('审批配置未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('审批配置保存失败。'));
      request.onsuccess = () => {
        try {
          const current = unpack(request.result);
          if (!current.users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('当前管理员已停用，无法保存。');
          change(current.collection, current.users, current.dictionary);
          result = current.collection;
          store.put({ id: approvalRulesId, payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
export async function saveApprovalRule(actor: OperationActor, rule: ApprovalRule, expectedRevision: number | null) {
  return mutate(actor, (collection, _users, dictionary) => {
    const current = collection.rules.find(item => item.id === rule.id);
    if (expectedRevision === null ? !!current : !current || current.revision !== expectedRevision) throw new Error('规则已被修改或删除，请重新加载后再保存。');
    const issue = approvalRuleIssue(rule); if (issue) throw new Error(issue);
    if (collection.rules.some(item => item.id !== rule.id && item.priority === rule.priority)) throw new Error('优先级重复，请选择其他数字后重新测试。');
    const conditions = testedApprovalConditions(rule.conditions, dictionary);
    const saved = { ...structuredClone(rule), conditions, flow: current?.flow ?? { ...rule.flow, name: rule.name.trim(), nodes: [] }, name: rule.name.trim(), revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name };
    if (current) collection.rules[collection.rules.indexOf(current)] = saved;
    else collection.rules.push(saved);
    collection.rules = sortApprovalRules(collection.rules);
  });
}
export async function deleteApprovalRule(actor: OperationActor, rule: ApprovalRule) {
  return mutate(actor, collection => {
    const current = collection.rules.find(item => item.id === rule.id);
    if (!current || current.revision !== rule.revision) throw new Error('规则已被修改或删除，请重新加载后再删除。');
    collection.rules = collection.rules.filter(item => item.id !== rule.id);
  });
}
export async function saveApprovalConfig(actor: OperationActor, ruleId: string, config: ApprovalConfig, expectedRevision: number) {
  const collection = await mutate(actor, (collection, users) => {
    const rule = collection.rules.find(item => item.id === ruleId);
    if (!rule) throw new Error('该审批规则已被删除，请返回规则列表。');
    if (rule.flow.revision !== expectedRevision) throw new Error('审批流程已被其他页面修改，请重新加载后再保存。');
    const normalized = normalizeApprovalConfig(config);
    const issue = approvalConfigIssue(normalized, users); if (issue) throw new Error(issue);
    rule.flow = { ...normalized, revision: rule.flow.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name };
    rule.revision += 1; rule.updatedAt = rule.flow.updatedAt; rule.updatedBy = actor.name;
  });
  return collection.rules.find(rule => rule.id === ruleId)!.flow;
}

export async function saveDefaultApprovalUser(actor: OperationActor, userId: string, expectedRevision: number) {
  return mutate(actor, (collection, users) => {
    if ((collection.defaultRevision ?? 0) !== expectedRevision) throw new Error('默认审批人已被其他页面修改，请刷新页面后重新选择。');
    if (typeof userId !== 'string' || (userId && !users.some(user => user.id === userId && user.status === '启用'))) throw new Error('请选择一位已启用的内部用户作为默认审批人。');
    collection.defaultUserId = userId;
    collection.defaultRevision = (collection.defaultRevision ?? 0) + 1;
  });
}
