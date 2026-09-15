import { openDatabase, readLocal } from './service-requests.ts';
import type { InternalUser } from './service-requests';
import type { OperationActor } from './request-operations';
import { canManageRouting } from './assessment-routing-store.ts';
import { approvalConfigId, approvalConfigIssue, emptyApprovalConfig, type ApprovalConfig } from './approval-flows.ts';
type Reference = { id: string; payload?: unknown };
function unpack(records: Reference[]) {
  const workspace = records.find(row => row.id === 'workspace')?.payload as { users?: InternalUser[] } | undefined;
  const stored = records.find(row => row.id === approvalConfigId)?.payload as ApprovalConfig | undefined;
  if (stored && (stored.version !== 1 || !Number.isInteger(stored.revision) || !Array.isArray(stored.nodes))) throw new Error('审批配置无法读取，请恢复有效配置后重试。');
  return { config: stored ?? emptyApprovalConfig(), users: workspace?.users ?? [] };
}
export async function readApprovalData() { return unpack(await readLocal<Reference>('references')); }
export async function saveApprovalConfig(actor: OperationActor, config: ApprovalConfig, expectedRevision: number) {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护审批流程。');
  const db = await openDatabase();
  try {
    return await new Promise<ApprovalConfig>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'), store = tx.objectStore('references'), request = store.getAll();
      let result: ApprovalConfig;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('审批流程未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('审批流程保存失败。'));
      request.onsuccess = () => {
        try {
          const current = unpack(request.result);
          if (!current.users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('当前管理员已停用，无法保存。');
          if (current.config.revision !== expectedRevision) throw new Error('审批配置已被其他页面修改，请重新加载后再保存。');
          const issue = approvalConfigIssue(config, current.users);
          if (issue) throw new Error(issue);
          result = { ...structuredClone(config), revision: current.config.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name };
          store.put({ id: approvalConfigId, payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
