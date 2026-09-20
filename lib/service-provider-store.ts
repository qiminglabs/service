import { openDatabase, readLocal, type InternalUser } from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import type { OperationActor } from './request-operations';
import type { Partner } from './partner-directory';
import { parseServiceProviderConfig, changeServiceProvider, serviceProviderSettingsId } from './service-provider-settings.ts';

type Reference = { id: string; payload?: unknown };
function fromRows(rows: Reference[]) {
  const workspace = rows.find(row => row.id === 'workspace')?.payload as { users?: InternalUser[]; partners?: Partner[] } | undefined;
  return {
    config: parseServiceProviderConfig(rows.find(row => row.id === serviceProviderSettingsId)?.payload),
    partners: workspace?.partners ?? [],
    users: workspace?.users ?? [],
  };
}
export type ServiceProviderData = ReturnType<typeof fromRows>;
export async function readServiceProviders() { return fromRows(await readLocal<Reference>('references')); }

// Keep company qualifications in a dedicated record so workspace autosaves cannot overwrite them.
export async function saveServiceProvider(partnerId: string, enabled: boolean, expectedRevision: number, actor: OperationActor): Promise<ServiceProviderData> {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可配置服务商。');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'), store = tx.objectStore('references'), read = store.getAll();
      let saved: ServiceProviderData;
      tx.oncomplete = () => resolve(saved);
      tx.onabort = () => reject(tx.error ?? new Error('服务商配置未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('服务商配置保存失败。'));
      read.onsuccess = () => {
        try {
          const current = fromRows(read.result);
          const admin = current.users.find(user => user.id === actor.id && user.status === '启用');
          if (!admin) throw new Error('当前管理员已停用，无法保存。');
          const config = changeServiceProvider(current.config, current.partners, partnerId, enabled, expectedRevision, admin.name);
          saved = { ...current, config };
          store.put({ id: serviceProviderSettingsId, payload: config });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
