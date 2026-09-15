import { openDatabase } from './service-requests.ts';
import type { RequestConfig } from './service-requests';
import { buildRequestSamples, requestSamplesMarker } from './demo-service-requests.ts';

type Reference = { id: string; payload?: unknown };
export const ruleBasedRequestSamplesMarker = 'request-samples-rule-approval-shared-materials-2026-09-15-v1';

export function planRuleBasedRequestSamples(references: Reference[], configs: RequestConfig[], now = new Date()) {
  if (references.some(reference => reference.id === ruleBasedRequestSamplesMarker)) return null;
  const workspace = references.find(reference => reference.id === 'workspace')?.payload as Parameters<typeof buildRequestSamples>[0] | undefined;
  if (!workspace) return null;
  return buildRequestSamples(workspace, [], configs, references, now, true);
}

// This one-time reset is explicitly requested for service requests only.
// Read the current rules, directory and catalog forms in the same transaction.
export async function reinitializeRuleBasedRequestSamples(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['requests', 'configs', 'references'], 'readwrite');
      const refs = tx.objectStore('references');
      const referenceRead = refs.getAll(), configRead = tx.objectStore('configs').getAll();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('服务请求重新初始化失败，原数据已保留。'));
      tx.onerror = () => reject(tx.error);
      let loaded = 0;
      const ready = () => {
        if (++loaded !== 2) return;
        try {
          const samples = planRuleBasedRequestSamples(referenceRead.result, configRead.result);
          if (!samples) return;
          const requests = tx.objectStore('requests');
          requests.clear();
          samples.forEach(sample => requests.add(sample));
          const payload = { initializedAt: new Date().toISOString(), count: samples.length };
          refs.put({ id: requestSamplesMarker, payload });
          refs.put({ id: ruleBasedRequestSamplesMarker, payload });
        } catch (error) { tx.abort(); reject(error); }
      };
      referenceRead.onsuccess = ready; configRead.onsuccess = ready;
    });
  } finally { db.close(); }
}
