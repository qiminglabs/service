import { applyCatalogConfigRules, defaultConfig, normalizeCatalogRequestConfig, openDatabase } from './service-requests.ts';
import type { RequestConfig } from './service-requests';
import type { CatalogVersion, VersionedService } from './catalog-versions';

export const catalogFormInitializationId = 'catalog-form-initialization:SC-IMP-009:v2:2026-09-14';
const sourceId = 'SC-IMP-009';
type Reference = { id: string; payload: unknown };
type Workspace = { services: VersionedService[]; [key: string]: unknown };

function content(config: RequestConfig) {
  const { revision: _revision, ...rest } = config;
  return JSON.stringify(rest, (_key, value) => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Blob)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

// Prepare the entire batch from one snapshot, before any source record changes.
export function planCatalogFormInitialization(references: Reference[], configs: RequestConfig[], now: string) {
  if (references.some(record => record.id === catalogFormInitializationId)) return null;
  const workspaceRecord = references.find(record => record.id === 'workspace');
  const workspace = workspaceRecord?.payload as Workspace | undefined;
  const source = workspace?.services.find(service => service.id === sourceId);
  if (!workspace || !source) return null;
  const sourceHistory = references.find(record => record.id === `catalog-history:${sourceId}`)?.payload as CatalogVersion['payload'][] | undefined;
  const template = sourceHistory?.find(entry => entry.service.version === 2)?.internal
    ?? (source.version === 2 ? configs.find(config => config.serviceId === sourceId) : undefined);
  // Never substitute a default form or a later revision for the requested v2.
  if (!template || template.serviceId !== sourceId) return null;
  const snapshot = structuredClone(normalizeCatalogRequestConfig(template));
  const configWrites: RequestConfig[] = [];
  const referenceWrites: Reference[] = [];
  const services = workspace.services.map(service => {
    const oldInternal = applyCatalogConfigRules(service, normalizeCatalogRequestConfig(configs.find(config => config.serviceId === service.id) ?? defaultConfig(service)));
    const oldCustomer = applyCatalogConfigRules(service, normalizeCatalogRequestConfig(
      (references.find(record => record.id === `customer-request-config:${service.id}`)?.payload as RequestConfig | undefined) ?? defaultConfig(service),
    ));
    const copy = (previous: RequestConfig) => {
      const next = applyCatalogConfigRules(service, { ...structuredClone(snapshot), serviceId: service.id, revision: previous.revision });
      if (content(previous) !== content(next)) next.revision++;
      return next;
    };
    const internal = copy(oldInternal);
    const customer = copy(oldCustomer);
    configWrites.push(internal);
    referenceWrites.push({ id: `customer-request-config:${service.id}`, payload: customer });
    if (content(internal) === content(oldInternal) && content(customer) === content(oldCustomer)) return service;
    const version = service.version ?? 1;
    const entries = structuredClone((references.find(record => record.id === `catalog-history:${service.id}`)?.payload ?? []) as CatalogVersion['payload'][]);
    if (!entries.some(entry => entry.service.version === version)) entries.push({
      service: { ...service, version }, internal: oldInternal, customer: oldCustomer,
      savedAt: now, reason: '申请表单初始化前的快照',
    });
    const next = { ...service, version: version + 1, updatedAt: now };
    entries.push({ service: next, internal, customer, savedAt: now, reason: '按 SC-IMP-009 v2 内部申请表单初始化内部及客户中心申请表单' });
    referenceWrites.push({ id: `catalog-history:${service.id}`, payload: entries });
    return next;
  });
  referenceWrites.push({ id: 'workspace', payload: { ...workspace, services } });
  referenceWrites.push({ id: catalogFormInitializationId, payload: {
    sourceId, sourceVersion: 2, template: snapshot, initializedAt: now,
    serviceIds: services.map(service => service.id), formCount: services.length * 2,
  } });
  return { configs: configWrites, references: referenceWrites };
}

export async function initializeCatalogFormsFromBackupV2() {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      // Both audiences, their histories and the completion marker commit together.
      const tx = db.transaction(['references', 'configs'], 'readwrite');
      const refs = tx.objectStore('references');
      const configs = tx.objectStore('configs');
      const referenceRead = refs.getAll();
      const configRead = configs.getAll();
      let loaded = 0;
      const prepare = () => {
        if (++loaded !== 2) return;
        try {
          const plan = planCatalogFormInitialization(referenceRead.result, configRead.result, new Date().toISOString());
          if (!plan) return;
          for (const record of plan.configs) configs.put(record);
          for (const record of plan.references) refs.put(record);
        } catch (error) { reject(error); tx.abort(); }
      };
      referenceRead.onsuccess = prepare;
      configRead.onsuccess = prepare;
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('申请表单初始化已中止'));
      tx.onerror = () => reject(tx.error);
    });
  } finally { db.close(); }
}
