import {
  openDatabase,
  readLocal,
  type InternalUser,
} from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import type { OperationActor } from './request-operations';
import type { ServiceProjectRecord } from './service-projects';
import {
  parseServiceFlowConfig,
  serviceFlowConfigId,
  type ServiceFlowConfig,
  type FlowDictionary,
} from './service-flows.ts';

type Reference = { id: string; payload?: unknown };
function unpack(rows: Reference[]) {
  const workspace = rows.find((row) => row.id === 'workspace')?.payload as
    | (Partial<FlowDictionary> & { users?: InternalUser[] })
    | undefined;
  return {
    config: parseServiceFlowConfig(
      rows.find((row) => row.id === serviceFlowConfigId)?.payload,
    ),
    dictionary: {
      customers: workspace?.customers ?? [],
      services: workspace?.services ?? [],
    },
    users: workspace?.users ?? [],
  };
}
export async function readServiceFlowData() {
  const rows = await readLocal<Reference>('references');
  const projects = rows
    .filter(
      (row) =>
        row.id ===
        `service-project:${(row.payload as ServiceProjectRecord | undefined)?.id}`,
    )
    .map((row) => row.payload as ServiceProjectRecord);
  return { ...unpack(rows), projects };
}
export async function saveServiceFlowConfig(
  input: ServiceFlowConfig,
  actor: OperationActor,
) {
  const checked = parseServiceFlowConfig(input);
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护服务流程。');
  const db = await openDatabase();
  try {
    return await new Promise<ServiceFlowConfig>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'),
        store = tx.objectStore('references'),
        read = store.getAll();
      let result: ServiceFlowConfig;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error ?? new Error('服务流程未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('服务流程保存失败。'));
      read.onsuccess = () => {
        try {
          const current = unpack(read.result);
          if (
            !current.users.some(
              (user) => user.id === actor.id && user.status === '启用',
            )
          )
            throw new Error('当前管理员已停用，无法保存。');
          if (current.config.revision !== checked.revision)
            throw new Error(
              '配置已被其他页面修改，请关闭编辑窗口并重新加载后再保存。',
            );
          for (const rule of checked.assignment.rules)
            for (const condition of rule.conditions) {
              const entries =
                condition.field === 'serviceId'
                  ? current.dictionary.services
                  : condition.field === 'customerId'
                    ? current.dictionary.customers
                    : undefined;
              if (entries && !entries.some((row) => row.id === condition.value))
                throw new Error('条件中的客户或服务项已不存在，请重新选择。');
            }
          result = {
            ...checked,
            revision: checked.revision + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: actor.name,
          };
          store.put({ id: serviceFlowConfigId, payload: result });
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}
