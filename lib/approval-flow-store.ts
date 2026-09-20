import { approvalStorageId, projectApprovalRulesId, scopedApprovalRules, initialProjectApprovalRules, type ApprovalScope } from './approval-scope.ts';
import { projectReviewContext } from './service-project-review-store.ts';
import { projectApprovalRequest } from './service-project-review.ts';
import type { ServiceProjectRecord } from './service-projects';
import { approvalPreviewRequirement } from './approval-preview.ts';
import { openDatabase, readLocal } from './service-requests.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';
import { canManageRouting } from './assessment-routing-store.ts';
import { approvalConfigIssue, normalizeApprovalConfig, type ApprovalConfig } from './approval-flows.ts';
import { approvalRuleIssue, sortApprovalRules, testedApprovalConditions, type ApprovalRule, type ApprovalRules } from './approval-rules.ts';
import type { RoutingDictionary } from './assessment-routing-schema.ts';
type Reference = { id: string; payload?: unknown };
function unpack(records: Reference[], scope: ApprovalScope = 'request') {
  const workspace = records.find(row => row.id === 'workspace')?.payload as Partial<RoutingDictionary> & { users?: InternalUser[] } | undefined;
  const collection = scopedApprovalRules(records, scope);
  return { collection, users: workspace?.users ?? [], dictionary: { customers: workspace?.customers ?? [], services: workspace?.services ?? [] } };
}
export async function readApprovalRules(scope: ApprovalScope = 'request') {
  return unpack(await readLocal<Reference>('references'), scope);
}
export async function readApprovalPreviewData(scope: ApprovalScope = 'request') {
  const [data, requests] = await Promise.all([readApprovalRules(scope), readLocal<ServiceRequest>('requests')]);
  if (scope === 'project') {
    const refs = await readLocal<{ id: string; payload?: any }>('references');
    const ctx = projectReviewContext(refs, requests);
    const projects = refs.filter(row => row.id.startsWith('service-project:') && row.payload && row.payload.createdSite !== '合作伙伴中心' && !['已完成', '已取消'].includes(row.payload.status)).map(row => row.payload as ServiceProjectRecord);
    return { ...data, requests: projects.map(project => {
      const last = project.review?.approvals.at(-1);
      const applicant = data.users.find(user => user.id === last?.authorId) ?? data.users.find(user => user.id === project.createdById) ?? data.users.find(user => user.id === ctx.customers.find(customer => customer.id === project.customerId)?.ownerUserId);
      return projectApprovalRequest(project, ctx, { id: applicant?.id ?? '', name: applicant?.name ?? project.createdBy, role: 'SmartX 销售经理' }, 'preview', last?.gaps?.length ? last.gaps : [{ method: '远程', days: 0.1 }]);
    }) };
  }
  return { ...data, requests: requests.filter(request => request.status !== '草稿' && approvalPreviewRequirement(request) === 'required') };
}
export async function readApprovalData(ruleId: string, scope: ApprovalScope = 'request') {
  const { collection, users } = await readApprovalRules(scope);
  const rule = collection.rules.find(rule => rule.id === ruleId);
  if (!rule) throw new Error('该审批规则已不存在，请返回规则列表。');
  return { config: rule.flow, rule, users };
}
async function mutate(actor: OperationActor, scope: ApprovalScope, change: (collection: ApprovalRules, users: InternalUser[], dictionary: RoutingDictionary) => void) {
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
          const records = request.result as Reference[];
          if (scope === 'project' && !records.some(row => row.id === projectApprovalRulesId)) records.push({ id: projectApprovalRulesId, payload: initialProjectApprovalRules(records) });
          const current = unpack(records, scope);
          if (!current.users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('当前管理员已停用，无法保存。');
          change(current.collection, current.users, current.dictionary);
          result = current.collection;
          store.put({ id: approvalStorageId(scope), payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
export async function saveApprovalRule(actor: OperationActor, rule: ApprovalRule, expectedRevision: number | null, scope: ApprovalScope = 'request') {
  return mutate(actor, scope, (collection, _users, dictionary) => {
    const current = collection.rules.find(item => item.id === rule.id);
    if (expectedRevision === null ? !!current : !current || current.revision !== expectedRevision) throw new Error('规则已被修改或删除，请重新加载后再保存。');
    if (current?.enabled === false) throw new Error('停用规则只读，不可编辑。');
    const issue = approvalRuleIssue(rule); if (issue) throw new Error(issue);
    if (collection.rules.some(item => item.enabled !== false && item.id !== rule.id && item.priority === rule.priority)) throw new Error('优先级重复，请选择其他数字后重新测试。');
    const conditions = testedApprovalConditions(rule.conditions, dictionary);
    const saved = { ...structuredClone(rule), enabled: true, version: current ? (current.version ?? Math.max(1, current.revision)) + 1 : 1, history: current ? archiveApprovalRule(current, actor) : [], conditions, flow: current?.flow ?? { ...rule.flow, name: rule.name.trim(), nodes: [] }, name: rule.name.trim(), revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name };
    if (current) collection.rules[collection.rules.indexOf(current)] = saved;
    else collection.rules.push(saved);
    collection.rules = sortApprovalRules(collection.rules);
  });
}
function archiveApprovalRule(rule: ApprovalRule, actor: OperationActor): NonNullable<ApprovalRule['history']> {
  const { history = [], ...snapshot } = structuredClone(rule);
  return [...history, { ...snapshot, version: rule.version ?? Math.max(1, rule.revision), enabled: false, archivedAt: new Date().toISOString(), archivedBy: actor.name }];
}
export async function disableApprovalRule(actor: OperationActor, rule: ApprovalRule, scope: ApprovalScope = 'request') {
  return mutate(actor, scope, collection => {
    const current = collection.rules.find(item => item.id === rule.id);
    if (!current || current.revision !== rule.revision) throw new Error('规则已被修改，请刷新后重试。');
    if (current.enabled === false) throw new Error('规则已停用。');
    current.version = current.version ?? Math.max(1, current.revision);
    current.enabled = false;
    current.revision += 1;
    current.updatedAt = new Date().toISOString(); current.updatedBy = actor.name;
  });
}
export async function saveApprovalConfig(actor: OperationActor, ruleId: string, config: ApprovalConfig, expectedRevision: number, expectedRuleRevision?: number, scope: ApprovalScope = 'request') {
  const collection = await mutate(actor, scope, (collection, users) => {
    const rule = collection.rules.find(item => item.id === ruleId);
    if (!rule) throw new Error('该审批规则已被删除，请返回规则列表。');
    if (rule.enabled === false) throw new Error('停用规则只读，不可编辑审批流程。');
    if (rule.flow.revision !== expectedRevision || (expectedRuleRevision !== undefined && rule.revision !== expectedRuleRevision)) throw new Error('审批流程已被其他页面修改，请重新加载后再保存。');
    const normalized = normalizeApprovalConfig(config);
    const issue = approvalConfigIssue(normalized, users); if (issue) throw new Error(issue);
    rule.history = archiveApprovalRule(rule, actor);
    rule.version = (rule.version ?? Math.max(1, rule.revision)) + 1;
    rule.flow = { ...normalized, revision: rule.flow.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name };
    rule.revision += 1; rule.updatedAt = rule.flow.updatedAt; rule.updatedBy = actor.name;
  });
  return collection.rules.find(rule => rule.id === ruleId)!.flow;
}

export async function saveDefaultApprovalUser(actor: OperationActor, userId: string, expectedRevision: number, scope: ApprovalScope = 'request') {
  return mutate(actor, scope, (collection, users) => {
    if ((collection.defaultRevision ?? 0) !== expectedRevision) throw new Error('默认审批人已被其他页面修改，请刷新页面后重新选择。');
    if (typeof userId !== 'string' || (userId && !users.some(user => user.id === userId && user.status === '启用'))) throw new Error('请选择一位已启用的内部用户作为默认审批人。');
    collection.defaultUserId = userId;
    collection.defaultRevision = (collection.defaultRevision ?? 0) + 1;
  });
}
