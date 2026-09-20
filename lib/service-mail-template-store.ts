import {
  openDatabase,
  readLocal,
  type InternalUser,
} from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import type { OperationActor } from './request-operations';
import {
  mailConfigFromRows,
  changeMailTemplate,
  serviceMailTemplatesId,
  type ServiceMailTemplate,
} from './service-mail-templates.ts';
type Reference = { id: string; payload?: unknown };
function fromRows(rows: Reference[]) {
  const workspace = rows.find((row) => row.id === 'workspace')?.payload as
    | { users?: InternalUser[] }
    | undefined;
  return { config: mailConfigFromRows(rows), users: workspace?.users ?? [] };
}
export type ServiceMailTemplateData = ReturnType<typeof fromRows>;
export async function readServiceMailTemplates() {
  return fromRows(await readLocal<Reference>('references'));
}
export async function saveServiceMailTemplate(
  template: ServiceMailTemplate,
  revision: number,
  actor: OperationActor,
): Promise<ServiceMailTemplateData> {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可配置邮件模板。');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'),
        store = tx.objectStore('references'),
        read = store.getAll();
      let saved: ServiceMailTemplateData;
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () =>
        reject(tx.error ?? new Error('邮件模板未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('邮件模板保存失败。'));
      read.onsuccess = () => {
        try {
          const current = fromRows(read.result);
          const admin = current.users.find(
            (user) => user.id === actor.id && user.status === '启用',
          );
          if (!admin) throw new Error('当前管理员已停用，无法保存。');
          const config = changeMailTemplate(
            current.config,
            template,
            revision,
            admin.name,
          );
          saved = { ...current, config };
          store.put({ id: serviceMailTemplatesId, payload: config });
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
