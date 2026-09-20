import { executionFormsFromRows } from './service-execution-form-store.ts';
import {
  bindExecutionForms,
  executionFormsId,
} from './service-execution-forms.ts';
import { validateServiceFlowLanguage } from './service-flow-conditions.ts';
import {
  changedServiceFlows,
  serviceFlowHistory,
} from './service-flow-history.ts';
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
  validateServiceFlowScope,
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
  return {
    ...unpack(rows),
    projects,
    executionForms: executionFormsFromRows(rows).library,
  };
}
export async function saveServiceFlowConfig(
  input: ServiceFlowConfig,
  actor: OperationActor,
) {
  let checked = parseServiceFlowConfig(input);
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护服务流程。');
  const beforeData = await readServiceFlowData();
  const before = beforeData.config;
  checked = parseServiceFlowConfig(
    bindExecutionForms(checked, beforeData.executionForms),
  );
  if (before.revision !== checked.revision)
    throw new Error('配置已被其他页面修改，请重新加载后再保存。');
  const changed = await changedServiceFlows(before, checked);
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
          const formLibrary = executionFormsFromRows(read.result).library;
          if (formLibrary.revision !== beforeData.executionForms.revision)
            throw new Error('表单已更新，请重新加载后再保存流程。');
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
          for (const rule of checked.assignment.rules.filter(
            (rule) => rule.enabled,
          ))
            validateServiceFlowScope(rule, current.dictionary);
          for (const rule of checked.assignment.rules.filter(
            (rule) => rule.enabled,
          ))
            validateServiceFlowLanguage(rule, current.dictionary);
          for (const rule of checked.assignment.rules.filter(
            (rule) => rule.enabled,
          ))
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
            history: serviceFlowHistory(
              current.config,
              checked,
              changed,
              actor.name,
              new Date().toISOString(),
            ),
          };
          store.put({ id: serviceFlowConfigId, payload: result });
          store.put({ id: executionFormsId, payload: formLibrary });
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
