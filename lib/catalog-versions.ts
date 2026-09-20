import { isDemoAdministrator } from './demo-permissions.ts';
import type { OperationActor } from './request-operations';
import type { InternalUser } from './service-requests';
import {
  updateLocalReference,
  defaultConfig,
  openDatabase,
  applyCatalogConfigRules,
} from './service-requests.ts';
import { workspaceDayQuantityIssue } from './day-quantity.ts';
import type {
  CatalogService,
  CatalogFormAudience,
  RequestConfig,
} from './service-requests';
import { prepareMaterialDeduplication } from './request-materials.ts';

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
    partner?: RequestConfig;
    savedAt: string;
    reason: string;
  };
};

export const canManageCatalog = isDemoAdministrator;
const catalogPermissionError = '仅启用的系统管理员可以修改服务目录及申请表单配置。';

export async function createStoredCatalogService(service: VersionedService, actor: OperationActor) {
  if (!canManageCatalog(actor)) throw new Error(catalogPermissionError);
  await updateLocalReference<{ services: VersionedService[]; users: InternalUser[] }>('workspace', workspace => {
    if (!workspace || !canManageCatalog(actor, workspace.users ?? [])) throw new Error(catalogPermissionError);
    if (workspace.services.some(current => current.id === service.id)) throw new Error('服务编码已存在，请重新创建。');
    return { ...workspace, services: [...workspace.services, { ...service, status: '草稿', version: 1, owner: actor.name }] };
  });
  window.dispatchEvent(new Event('catalog-version-saved'));
}

// One transaction writes the catalog, all configuration snapshots, and history.
export async function commitCatalogVersion(
  serviceId: string,
  change: {
    service?: VersionedService;
    config?: RequestConfig;
    audience?: CatalogFormAudience;
    reason: string;
  },
  actor: OperationActor,
) {
  if (!canManageCatalog(actor)) throw new Error(catalogPermissionError);
  if (change.config)
    change = {
      ...change,
      config: await prepareMaterialDeduplication(change.config),
    };
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
      const partner = refs.get(`partner-request-config:${serviceId}`);
      const history = refs.get(`catalog-history:${serviceId}`);
      let loaded = 0;
      const finish = () => {
        if (++loaded !== 5) return;
        try {
          if (!canManageCatalog(actor, workspace.result?.payload.users ?? [])) throw new Error(catalogPermissionError);
          const current = workspace.result?.payload.services.find(
            (s: VersionedService) => s.id === serviceId,
          );
          if (!current) {
            reject(new Error('目录尚未保存，请刷新后重试。'));
            tx.abort();
            return;
          }
          const oldInternal = applyCatalogConfigRules(
            current,
            internal.result ?? defaultConfig(current),
          );
          if (change.service) {
            const issue = workspaceDayQuantityIssue(
              { services: [change.service] },
              { services: [current] },
            );
            if (issue) throw new Error(issue);
          }
          const oldCustomer = applyCatalogConfigRules(
            current,
            customer.result?.payload ?? defaultConfig(current),
          );
          const oldPartner = applyCatalogConfigRules(
            current,
            partner.result?.payload ?? structuredClone(oldCustomer),
          );
          if (!partner.result)
            refs.put({
              id: `partner-request-config:${serviceId}`,
              payload: oldPartner,
            });
          const entries: CatalogVersion['payload'][] =
            history.result?.payload ?? [];
          const now = new Date().toISOString();
          const version = current.version ?? 1;
          if (change.service && (change.service.version ?? 1) !== version) {
            throw new Error('目录已被更新，请刷新后重新编辑。');
          }
          savedConfig =
            change.audience === 'partner'
              ? oldPartner
              : change.audience === 'customer'
                ? oldCustomer
                : oldInternal;
          if (!entries.length)
            entries.push({
              service: { ...current, version },
              internal: oldInternal,
              customer: oldCustomer,
              partner: oldPartner,
              savedAt: now,
              reason: '版本管理启用时的初始快照',
            });
          const nextInternal = applyCatalogConfigRules(
            change.service ?? current,
            change.audience === 'internal' ? change.config! : oldInternal,
          );
          const nextCustomer = applyCatalogConfigRules(
            change.service ?? current,
            change.audience === 'customer' ? change.config! : oldCustomer,
          );
          const nextPartner = applyCatalogConfigRules(
            change.service ?? current,
            change.audience === 'partner' ? change.config! : oldPartner,
          );
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
            clean(nextCustomer) === clean(oldCustomer) &&
            clean(nextPartner) === clean(oldPartner)
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
              partner: nextPartner,
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
          refs.put({
            id: `partner-request-config:${serviceId}`,
            payload: nextPartner,
          });
          savedConfig =
            change.audience === 'partner'
              ? nextPartner
              : change.audience === 'customer'
                ? nextCustomer
                : nextInternal;
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
      for (const request of [workspace, internal, customer, partner, history])
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
