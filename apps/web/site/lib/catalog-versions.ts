import { defaultConfig, openDatabase } from './service-requests';
import type { CatalogService, RequestConfig } from './service-requests';

export type VersionedService = CatalogService & {
  version?: number;
  updatedAt?: string;
  [key: string]: unknown;
};
export type CatalogVersion = {
  id: string;
  payload: {
    service: VersionedService;
    internal: RequestConfig;
    customer: RequestConfig;
    savedAt: string;
    reason: string;
  };
};

// One transaction writes the catalog, both configuration snapshots, and history.
export async function commitCatalogVersion(
  serviceId: string,
  change: {
    service?: VersionedService;
    config?: RequestConfig;
    audience?: 'internal' | 'customer';
    reason: string;
  },
) {
  const db = await openDatabase();
  let savedConfig: RequestConfig | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['references', 'configs'], 'readwrite');
      const refs = tx.objectStore('references');
      const configs = tx.objectStore('configs');
      const workspace = refs.get('workspace');
      const internal = configs.get(serviceId);
      const customer = refs.get(`customer-request-config:${serviceId}`);
      const history = refs.get(`catalog-history:${serviceId}`);
      let loaded = 0;
      const finish = () => {
        if (++loaded !== 4) return;
        try {
          const current = workspace.result?.payload.services.find(
            (s: VersionedService) => s.id === serviceId,
          );
          if (!current) {
            reject(new Error('目录尚未保存，请刷新后重试。'));
            tx.abort();
            return;
          }
          const oldInternal = internal.result ?? defaultConfig(current);
          const oldCustomer =
            customer.result?.payload ?? defaultConfig(current);
          const entries: CatalogVersion['payload'][] =
            history.result?.payload ?? [];
          const now = new Date().toISOString();
          const version = current.version ?? 1;
          if (change.service && (change.service.version ?? 1) !== version) {
            throw new Error('目录已被更新，请刷新后重新编辑。');
          }
          savedConfig =
            change.audience === 'customer' ? oldCustomer : oldInternal;
          if (!entries.length)
            entries.push({
              service: { ...current, version },
              internal: oldInternal,
              customer: oldCustomer,
              savedAt: now,
              reason: '版本管理启用时的初始快照',
            });
          const nextInternal =
            change.audience === 'internal' ? change.config! : oldInternal;
          const nextCustomer =
            change.audience === 'customer' ? change.config! : oldCustomer;
          const clean = (value: object) =>
            JSON.stringify(
              Object.fromEntries(
                Object.entries(value).filter(
                  ([key]) =>
                    !['version', 'updatedAt', 'revision'].includes(key),
                ),
              ),
              (_key, val) =>
                val &&
                typeof val === 'object' &&
                !Array.isArray(val) &&
                !(val instanceof Blob)
                  ? Object.fromEntries(
                      Object.entries(val).sort(([a], [b]) =>
                        a.localeCompare(b),
                      ),
                    )
                  : val,
            );
          // File replacements have unique IDs, so their metadata captures changes.
          const contentChanged = !(
            clean({
              ...(change.service ?? current),
              status: current.status,
            }) === clean(current) &&
            clean(nextInternal) === clean(oldInternal) &&
            clean(nextCustomer) === clean(oldCustomer)
          );
          if (
            !contentChanged &&
            (!change.service || change.service.status === current.status)
          ) {
            return;
          }
          const next = {
            ...(change.service ?? current),
            version: contentChanged ? version + 1 : version,
            updatedAt: now,
          };
          if (contentChanged)
            entries.push({
              service: next,
              internal: nextInternal,
              customer: nextCustomer,
              savedAt: now,
              reason: change.reason,
            });
          refs.put({
            ...workspace.result,
            payload: {
              ...workspace.result.payload,
              services: workspace.result.payload.services.map(
                (s: VersionedService) => (s.id === serviceId ? next : s),
              ),
            },
          });
          if (contentChanged)
            refs.put({ id: `catalog-history:${serviceId}`, payload: entries });
          configs.put(nextInternal);
          refs.put({
            id: `customer-request-config:${serviceId}`,
            payload: nextCustomer,
          });
          savedConfig =
            change.audience === 'customer' ? nextCustomer : nextInternal;
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
      for (const request of [workspace, internal, customer, history])
        request.onsuccess = finish;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    window.dispatchEvent(new Event('catalog-version-saved'));
    return savedConfig;
  } finally {
    db.close();
  }
}
