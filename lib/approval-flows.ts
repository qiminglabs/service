import type { InternalUser } from './service-requests';

export const approvalConfigId = 'request-approval-flow-config';
export type ApprovalNode = {
  id: string;
  name: string;
  source: 'people' | 'manager' | 'org';
  userIds: string[];
  depth: number;
  stopUserIds: string[];
  reject: 'return';
};
export type ApprovalConfig = { version: 1; revision: number; name: string; nodes: ApprovalNode[]; updatedAt?: string; updatedBy?: string };
export function newApprovalNode(kind: 'normal' | 'org' = 'normal'): ApprovalNode {
  return { id: crypto.randomUUID(), name: kind === 'org' ? '逐级主管审批' : '普通审批', source: kind === 'org' ? 'org' : 'manager', userIds: [], depth: 2, stopUserIds: [], reject: 'return' };
}
export function emptyApprovalConfig(): ApprovalConfig { return { version: 1, revision: 0, name: '服务请求审批流程', nodes: [] }; }

/** Migrate retired node settings without guessing individual approvers for a role. */
export function normalizeApprovalConfig(config: ApprovalConfig): ApprovalConfig {
  return { ...structuredClone(config), nodes: config.nodes.map(node => {
    const { condition: _condition, threshold: _threshold, role: _role, method: _method, missing: _missing, source, ...rest } = structuredClone(node) as Omit<ApprovalNode, 'source'> & { source: ApprovalNode['source'] | 'role'; condition?: unknown; threshold?: unknown; role?: unknown; method?: unknown; missing?: unknown };
    return { ...rest, stopUserIds: source === 'org' ? rest.stopUserIds ?? [] : [], source: source === 'role' ? 'people' : source, userIds: source === 'people' && Array.isArray(rest.userIds) && rest.userIds.length === 1 ? rest.userIds : [], name: rest.name === '条件审批' ? '普通审批' : rest.name, reject: 'return' };
  }) };
}

/** A reporting relationship is a directed link, never a copied display name. */
export function reportingRelationshipIssue(users: InternalUser[], userId: string, reportsToUserId: string): string | null {
  if (!reportsToUserId) return null;
  const seen = new Set([userId]);
  let id: string | undefined = reportsToUserId;
  while (id) {
    if (seen.has(id)) return id === userId && id === reportsToUserId ? '汇报人不能是自己。' : '汇报关系不能形成循环。';
    seen.add(id);
    const person = users.find(user => user.id === id);
    if (!person) return '汇报关系中存在已不存在的内部用户。';
    if (id === reportsToUserId && person.status !== '启用') return '请选择启用的内部用户作为汇报人。';
    id = person.reportsToUserId;
  }
  return null;
}

export function reportingChain(users: InternalUser[], applicantId: string, depth: number, stopUserIds: string[] = []): { users: InternalUser[]; issue?: string } {
  const chain: InternalUser[] = [], seen = new Set([applicantId]);
  let current = users.find(user => user.id === applicantId && user.status === '启用');
  if (!current) return { users: [], issue: '请选择启用的内部用户作为申请人。' };
  const stopIssue = approvalStopUsersIssue(stopUserIds, users);
  if (stopIssue) return { users: [], issue: stopIssue };
  const stops = new Set(stopUserIds);
  if (!stops.size && (!Number.isInteger(depth) || depth < 1 || depth > 20)) return { users: [], issue: '逐级审批层数须为 1–20。' };
  for (let i = 0; i < (stops.size ? users.length : depth); i++) {
    if (!current.reportsToUserId) return { users: chain, issue: stops.size ? `未到达审批截止人：${current.name}未设置汇报人。` : `${current.name}未设置汇报人，无法确定第 ${i + 1} 级审批人。` };
    if (seen.has(current.reportsToUserId)) return { users: chain, issue: '汇报关系形成循环，请先修正内部用户数据。' };
    const next = users.find(user => user.id === current!.reportsToUserId);
    if (!next || next.status !== '启用') return { users: chain, issue: `${current.name}的汇报人不存在或已停用。` };
    seen.add(next.id); chain.push(next); current = next;
    if (stops.has(next.id)) return { users: chain };
  }
  return stops.size ? { users: chain, issue: '未到达审批截止人，请检查汇报关系。' } : { users: chain };
}

function approvalStopUsersIssue(stopUserIds: string[], users: InternalUser[], allowUnavailable = false): string | null {
  if (!Array.isArray(stopUserIds) || stopUserIds.some(id => typeof id !== 'string' || !id) || new Set(stopUserIds).size !== stopUserIds.length) return '审批截止人配置无效。';
  if (!allowUnavailable && stopUserIds.some(id => !users.some(user => user.id === id && user.status === '启用'))) return '审批截止人不存在或已停用，请重新选择。';
  return null;
}

export function approvalConfigIssue(config: ApprovalConfig, users: InternalUser[], options: { allowUnavailableApprovers?: boolean } = {}): string | null {
  if (config.version !== 1 || !Number.isInteger(config.revision) || config.revision < 0) return '审批配置版本无效。';
  if (!config.name?.trim() || config.name.length > 80) return '请填写流程名称，最多 80 字。';
  if (!Array.isArray(config.nodes) || !config.nodes.length || config.nodes.length > 50) return '请配置 1–50 个审批节点。';
  const ids = new Set<string>();
  for (const [index, node] of config.nodes.entries()) {
    const prefix = `节点 ${index + 1}：`;
    if (!node.id || ids.has(node.id)) return prefix + '节点编号无效或重复。';
    ids.add(node.id);
    if (!node.name?.trim() || node.name.length > 80) return prefix + '请填写级别名称，最多 80 字。';
    if (!['people', 'manager', 'org'].includes(node.source) || node.reject !== 'return') return prefix + '节点规则无效。';
    if (!Array.isArray(node.userIds)) return prefix + '审批人配置无效。';
    if (node.userIds.length > 1) return prefix + '每级仅支持一位内部用户作为审批人。';
    if (node.source === 'people' && !options.allowUnavailableApprovers && (node.userIds.length !== 1 || node.userIds.some(id => !users.some(user => user.id === id && user.status === '启用')))) return prefix + '请选择一位已启用的内部用户。';
    if (node.source === 'org') {
      const stopIssue = approvalStopUsersIssue(node.stopUserIds ?? [], users, options.allowUnavailableApprovers);
      if (stopIssue) return prefix + stopIssue;
      if (!node.stopUserIds?.length && (!Number.isInteger(node.depth) || node.depth < 1 || node.depth > 20)) return prefix + '逐级审批层数须为 1–20。';
    }
  }
  return null;
}
