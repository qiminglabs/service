import {
  openDatabase,
  readLocal,
  type InternalUser,
  type CustomerRef,
} from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import { validateProjectReportTemplate } from './flow-report-templates.ts';
import type { OperationActor } from './request-operations';
import { normalizeProjectFields } from './service-project-fields.ts';
import type { RequestField } from '../components/request-field-settings';
import { executionFormsFromRows } from './service-execution-form-store.ts';
import {
  parseReportLibrary,
  reportTemplatesId,
  type ReportTemplateLibrary,
} from './report-templates.ts';
export async function readReportTemplateData() {
  const rows = await readLocal<{ id: string; payload?: unknown }>('references');
  const workspace = rows.find((r) => r.id === 'workspace')?.payload as
    | {
        projectFields?: RequestField[];
        requestFields?: RequestField[];
        customers?: CustomerRef[];
      }
    | undefined;
  return {
    library: parseReportLibrary(
      rows.find((r) => r.id === reportTemplatesId)?.payload as
        | ReportTemplateLibrary
        | undefined,
    ),
    customers: workspace?.customers ?? [],
    projectFields: normalizeProjectFields(workspace?.projectFields),
    orderFields: workspace?.requestFields ?? [],
    forms: executionFormsFromRows(rows).library.forms,
  };
}
export async function saveReportTemplates(
  input: ReportTemplateLibrary,
  actor: OperationActor,
) {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护报告模板。');
  const checked = parseReportLibrary(input),
    db = await openDatabase();
  try {
    return await new Promise<ReportTemplateLibrary>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'),
        store = tx.objectStore('references'),
        read = store.getAll();
      let saved: ReportTemplateLibrary;
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () => reject(tx.error ?? new Error('模板未保存。'));
      tx.onerror = () => reject(tx.error ?? new Error('模板保存失败。'));
      read.onsuccess = () => {
        try {
          const rows = read.result as { id: string; payload?: unknown }[];
          if (
            !(
              rows.find((r) => r.id === 'workspace')?.payload as {
                users?: InternalUser[];
              }
            )?.users?.some((u) => u.id === actor.id && u.status === '启用')
          )
            throw new Error('当前管理员已停用。');
          const current = parseReportLibrary(
            rows.find((r) => r.id === reportTemplatesId)?.payload as
              | ReportTemplateLibrary
              | undefined,
          );
          if (current.revision !== checked.revision)
            throw new Error('模板已被其他页面修改，请关闭编辑后重新进入。');
          for (const template of checked.templates) {
            const old = current.templates.find((t) => t.id === template.id);
            if (JSON.stringify(old) !== JSON.stringify(template))
              validateProjectReportTemplate(template);
          }
          saved = {
            revision: current.revision + 1,
            templates: checked.templates.map((t) => {
              const old = current.templates.find((x) => x.id === t.id);
              return JSON.stringify(old) === JSON.stringify(t)
                ? t
                : {
                    ...t,
                    version: old ? old.version + 1 : 1,
                    updatedAt: new Date().toISOString(),
                  };
            }),
          };
          store.put({ id: reportTemplatesId, payload: saved });
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
