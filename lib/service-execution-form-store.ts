import {
  openDatabase,
  readLocal,
  type InternalUser,
} from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import type { OperationActor } from './request-operations';
import {
  parseServiceFlowConfig,
  serviceFlowConfigId,
} from './service-flows.ts';
import { serviceFlowHistory } from './service-flow-history.ts';
import {
executionFormsId,parseExecutionForms,bindExecutionForms,
type ExecutionFormLibrary
} from './service-execution-forms.ts';

type Reference = { id: string; payload?: unknown };
export function executionFormsFromRows(rows: Reference[]) {
  const config = parseServiceFlowConfig(
    rows.find((row) => row.id === serviceFlowConfigId)?.payload,
  );
  const library = parseExecutionForms(rows.find((row) => row.id === executionFormsId)?.payload);
  return { library, config };
}
export async function readExecutionFormData() {
  return executionFormsFromRows(await readLocal<Reference>('references'));
}
export async function saveExecutionForms(
  input: ExecutionFormLibrary,
  actor: OperationActor,
) {
  if (!canManageRouting(actor))
    throw new Error('仅系统管理员可维护服务步骤表单。');
  const checked = parseExecutionForms(input);
  const db = await openDatabase();
  try {
    return await new Promise<ExecutionFormLibrary>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'),
        store = tx.objectStore('references'),
        read = store.getAll();
      let saved: ExecutionFormLibrary;
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () =>
        reject(tx.error ?? new Error('表单保存失败，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('表单保存失败。'));
      read.onsuccess = () => {
        try {
          const rows = read.result as Reference[];
          const workspace = rows.find((row) => row.id === 'workspace')
            ?.payload as { users?: InternalUser[] } | undefined;
          if (
            !workspace?.users?.some(
              (user) => user.id === actor.id && user.status === '启用',
            )
          )
            throw new Error('当前管理员已停用，无法保存。');
          const current = executionFormsFromRows(rows);
          if (current.library.revision !== checked.revision)
            throw new Error('表单已被其他页面修改，请重新加载后再保存。');
          const now = new Date().toISOString();
          saved = {
            ...checked,
            revision: checked.revision + 1,
            forms: checked.forms.map((form) => {
              const previous = current.library.forms.find(
                (row) => row.id === form.id,
              );
              return JSON.stringify(previous) === JSON.stringify(form)
                ? form
                : { ...form, updatedAt: now, updatedBy: actor.name };
            }),
          };
          // Referenced forms cannot be deleted; updates refresh active definitions and preserve old snapshots.
          for (const flow of current.config.flows)
            for (const step of flow.steps) {
              if (step.type !== 'form') continue;
              const id =
                step.executionFormId;
              if (!saved.forms.some((form) => form.id === id))
                throw new Error(`表单已被步骤「${step.name}」引用，不能删除。`);
            }
          const next = parseServiceFlowConfig(
            bindExecutionForms(current.config, saved),
          );
          const changed = new Set(
            next.flows
              .filter(
                (flow) =>
                  JSON.stringify(flow) !==
                  JSON.stringify(
                    current.config.flows.find((row) => row.id === flow.id),
                  ),
              )
              .map((flow) => flow.id),
          );
          if (changed.size) {
            next.history = serviceFlowHistory(
              current.config,
              next,
              changed,
              actor.name,
              now,
            );
            next.revision++;
            next.updatedAt = now;
            next.updatedBy = actor.name;
            store.put({ id: serviceFlowConfigId, payload: next });
          }
          store.put({ id: executionFormsId, payload: saved });
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
