import type { InternalUser } from './service-requests';
import { fixedIdentityRoles } from './internal-users.ts';

export const approvalConfigId = 'request-approval-flow-config';
export type ApprovalNode = {
  id: string;
  name: string;
  source: 'people' | 'role' | 'manager' | 'org';
  userIds: string[];
  role: string;
  depth: number;
  method: 'all' | 'any' | 'serial';
  condition: 'always' | 'amount' | 'risk';
  threshold: number;
  reject: 'return' | 'end';
  missing: 'admin' | 'block';
};
export type ApprovalConfig = { version: 1; revision: number; name: string; nodes: ApprovalNode[]; updatedAt?: string; updatedBy?: string };
export function newApprovalNode(kind: 'normal' | 'conditional' | 'org' = 'normal'): ApprovalNode {
  return { id: crypto.randomUUID(), name: kind === 'org' ? '逐级主管审批' : kind === 'conditional' ? '条件审批' : '普通审批', source: kind === 'org' ? 'org' : 'manager', userIds: [], role: 'SmartX 项目经理', depth: 2, method: 'all', condition: kind === 'conditional' ? 'amount' : 'always', threshold: 10000, reject: 'return', missing: 'admin' };
}
export function emptyApprovalConfig(): ApprovalConfig { return { version: 1, revision: 0, name: '服务请求审批流程', nodes: [] }; }

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

export function reportingChain(users: InternalUser[], applicantId: string, depth: number): { users: InternalUser[]; issue?: string } {
  const chain: InternalUser[] = [], seen = new Set([applicantId]);
  let current = users.find(user => user.id === applicantId && user.status === '启用');
  if (!current) return { users: [], issue: '请选择启用的内部用户作为申请人。' };
  if (!Number.isInteger(depth) || depth < 1 || depth > 20) return { users: [], issue: '逐级审批层数须为 1–20。' };
  for (let i = 0; i < depth; i++) {
    if (!current.reportsToUserId) return { users: chain, issue: `${current.name}未设置汇报人，无法确定第 ${i + 1} 级审批人。` };
    if (seen.has(current.reportsToUserId)) return { users: chain, issue: '汇报关系形成循环，请先修正内部用户数据。' };
    const next = users.find(user => user.id === current!.reportsToUserId);
    if (!next || next.status !== '启用') return { users: chain, issue: `${current.name}的汇报人不存在或已停用。` };
    seen.add(next.id); chain.push(next); current = next;
  }
  return { users: chain };
}

export function moveApprovalNode(nodes: ApprovalNode[], id: string, insertionIndex: number): ApprovalNode[] {
  const from = nodes.findIndex(node => node.id === id);
  if (from < 0 || !Number.isInteger(insertionIndex) || insertionIndex < 0 || insertionIndex > nodes.length) return nodes;
  const next = [...nodes], [node] = next.splice(from, 1);
  next.splice(insertionIndex > from ? insertionIndex - 1 : insertionIndex, 0, node);
  return next;
}

export function approvalConfigIssue(config: ApprovalConfig, users: InternalUser[]): string | null {
  if (config.version !== 1 || !Number.isInteger(config.revision) || config.revision < 0) return '审批配置版本无效。';
  if (!config.name?.trim() || config.name.length > 80) return '请填写流程名称，最多 80 字。';
  if (!Array.isArray(config.nodes) || !config.nodes.length || config.nodes.length > 50) return '请配置 1–50 个审批节点。';
  const ids = new Set<string>();
  for (const [index, node] of config.nodes.entries()) {
    const prefix = `节点 ${index + 1}：`;
    if (!node.id || ids.has(node.id)) return prefix + '节点编号无效或重复。';
    ids.add(node.id);
    if (!node.name?.trim() || node.name.length > 80) return prefix + '请填写级别名称，最多 80 字。';
    if (!['people', 'role', 'manager', 'org'].includes(node.source) || !['all', 'any', 'serial'].includes(node.method) || !['always', 'amount', 'risk'].includes(node.condition) || !['return', 'end'].includes(node.reject) || !['admin', 'block'].includes(node.missing)) return prefix + '节点规则无效。';
    if (!Array.isArray(node.userIds)) return prefix + '审批人配置无效。';
    if (node.source === 'people' && (!node.userIds.length || new Set(node.userIds).size !== node.userIds.length || node.userIds.some(id => !users.some(user => user.id === id && user.status === '启用')))) return prefix + '请选择不重复且已启用的内部用户。';
    if (node.source === 'role' && !Object.values(fixedIdentityRoles).includes(node.role)) return prefix + '请选择有效的内部角色。';
    if (node.source === 'org' && (!Number.isInteger(node.depth) || node.depth < 1 || node.depth > 20)) return prefix + '逐级审批层数须为 1–20。';
    if (node.condition === 'amount' && (!Number.isFinite(node.threshold) || node.threshold < 0)) return prefix + '金额阈值须为非负数。';
  }
  return null;
}

export type ApprovalPreviewStep = { nodeId: string; name: string; users: InternalUser[]; status: 'ready' | 'skipped' | 'blocked' | 'admin'; detail: string; method?: ApprovalNode['method'] };
export function previewApproval(config: ApprovalConfig, users: InternalUser[], sample: { applicantId: string; amount: number; risk: 'normal' | 'high' }): ApprovalPreviewStep[] {
  const issue = approvalConfigIssue(config, users);
  if (issue) throw new Error(issue);
  if (!Number.isFinite(sample.amount) || sample.amount < 0) throw new Error('请输入有效的申请金额。');
  if (!users.some(user => user.id === sample.applicantId && user.status === '启用')) throw new Error('请选择启用的内部申请人。');
  return config.nodes.flatMap<ApprovalPreviewStep>(node => {
    if ((node.condition === 'amount' && sample.amount < node.threshold) || (node.condition === 'risk' && sample.risk !== 'high')) return [{ nodeId: node.id, name: node.name, users: [], status: 'skipped' as const, detail: '未满足生效条件，跳过此级。' }];
    const result = node.source === 'org' || node.source === 'manager'
      ? reportingChain(users, sample.applicantId, node.source === 'org' ? node.depth : 1)
      : { users: node.source === 'people' ? node.userIds.flatMap(id => users.filter(user => user.id === id && user.status === '启用')) : users.filter(user => user.status === '启用' && fixedIdentityRoles[user.id] === node.role) };
    if (result.issue || !result.users.length) return [{ nodeId: node.id, name: node.name, users: [], status: node.missing === 'admin' ? 'admin' as const : 'blocked' as const, detail: (result.issue || '没有符合条件的审批人。') + (node.missing === 'admin' ? '转交流程管理员处理。' : '暂停流转，等待补充审批人。') }];
    const rejection = node.reject === 'return' ? '驳回后退回申请人重新发起' : '驳回后结束申请';
    return node.source === 'org' ? result.users.map((user, index) => ({ nodeId: node.id, name: `${node.name} · 第 ${index + 1} 级`, users: [user], status: 'ready' as const, detail: rejection })) : [{ nodeId: node.id, name: node.name, users: result.users, status: 'ready' as const, method: node.method, detail: rejection }];
  });
}
