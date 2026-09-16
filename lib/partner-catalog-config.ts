import {
  openDatabase,
  customerRequestConfigId,
  partnerRequestConfigId,
  resolveRequestConfig,
  type CatalogService,
  type RequestConfig,
} from './service-requests.ts';

type Reference = { id: string; payload?: unknown };

// Copy each customer form once. An existing partner form, including an empty
// configuration, is authoritative and must never be replaced on later loads.
export function planPartnerCatalogConfigs(references: Reference[]) {
  const workspace = references.find((record) => record.id === 'workspace')
    ?.payload as { services?: CatalogService[] } | undefined;
  const records = new Map(references.map((record) => [record.id, record]));
  return (workspace?.services ?? []).flatMap((service) => {
    const id = partnerRequestConfigId(service.id);
    if (records.has(id)) return [];
    const customer = records.get(customerRequestConfigId(service.id))
      ?.payload as RequestConfig | undefined;
    return [
      {
        id,
        payload: structuredClone(
          resolveRequestConfig(service, customer ? [customer] : []),
        ),
      },
    ];
  });
}

export async function initializePartnerCatalogConfigs() {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite');
      const refs = tx.objectStore('references');
      const read = refs.getAll();
      read.onsuccess = () => {
        try {
          for (const record of planPartnerCatalogConfigs(read.result))
            refs.put(record);
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          tx.error ?? new Error('合作伙伴中心申请表单初始化未完成，请重试。'),
        );
    });
  } finally {
    db.close();
  }
}
