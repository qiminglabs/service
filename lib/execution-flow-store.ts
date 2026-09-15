import { openDatabase, readLocal } from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import type { OperationActor } from './request-operations';
import type { InternalUser } from './service-requests';
import { emptyExecutionConfig, executionConfigId, executionConfigIssue, type ExecutionConfig } from './execution-flows.ts';
type Workspace = { services: { id: string; name: string }[]; customers: { team?: string }[]; users: InternalUser[] };
type Reference = { id: string; payload: unknown };
function unpack(refs: Reference[]) {
  const workspace = refs.find(row => row.id === 'workspace')?.payload as Partial<Workspace> | undefined;
  const stored = refs.find(row => row.id === executionConfigId)?.payload as ExecutionConfig | undefined;
  if (stored && (stored.version !== 1 || !Array.isArray(stored.flows) || !Array.isArray(stored.assignments) || !Number.isInteger(stored.revision))) throw new Error('执行流程配置无法读取，请恢复有效配置后重试。');
  return { config: stored ?? emptyExecutionConfig(), workspace: { services: workspace?.services ?? [], customers: workspace?.customers ?? [], users: workspace?.users ?? [] } };
}
export async function readExecutionData() { return unpack(await readLocal<Reference>('references')); }
export async function saveExecutionConfig(actor: OperationActor, config: ExecutionConfig, expectedRevision: number) {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护执行流程。');
  const db = await openDatabase();
  try {
    return await new Promise<ExecutionConfig>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'), store = tx.objectStore('references'), request = store.getAll();
      let result: ExecutionConfig;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('配置未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('配置保存失败。'));
      request.onsuccess = () => {
        try {
          const current = unpack(request.result);
          if (!current.workspace.users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('当前管理员已停用，无法保存。');
          if (current.config.revision !== expectedRevision) throw new Error('配置已被其他页面修改，请关闭编辑并刷新后重试。');
          const issue = executionConfigIssue(config, current.workspace.services);
          if (issue) throw new Error(issue);
          result = { ...structuredClone(config), revision: current.config.revision + 1 };
          store.put({ id: executionConfigId, payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
