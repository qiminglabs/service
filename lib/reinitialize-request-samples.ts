import { openDatabase } from './service-requests.ts';
import type { RequestConfig, ServiceRequest } from './service-requests';
import { buildRequestSamples, requestSamplesMarker, presalesRequestSamplesMarker } from './demo-service-requests.ts';

type Reference = { id: string; payload?: unknown };
export const ruleBasedRequestSamplesMarker = 'request-samples-rule-approval-shared-materials-2026-09-15-v1';

export function planRuleBasedRequestSamples(references: Reference[], configs: RequestConfig[], now = new Date()) {
  if (references.some(reference => reference.id === ruleBasedRequestSamplesMarker)) return null;
  const workspace = references.find(reference => reference.id === 'workspace')?.payload as Parameters<typeof buildRequestSamples>[0] | undefined;
  if (!workspace) return null;
  return buildRequestSamples(workspace, [], configs, references, now, true);
}

export function planPresalesRequestSamples(references: Reference[], configs: RequestConfig[], existing: ServiceRequest[], now = new Date()) {
  if (references.some(reference => reference.id === presalesRequestSamplesMarker)) return null;
  const workspace = references.find(reference => reference.id === 'workspace')?.payload as Parameters<typeof buildRequestSamples>[0] | undefined;
  if (!workspace) return null;
  return buildRequestSamples(workspace, existing, configs, references, now, true, 'presales');
}

// This one-time reset is explicitly requested for service requests only.
// Read the current rules, directory and catalog forms in the same transaction.
export async function reinitializeRuleBasedRequestSamples(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['requests', 'configs', 'references'], 'readwrite');
      const refs = tx.objectStore('references');
      const referenceRead = refs.getAll(), configRead = tx.objectStore('configs').getAll(), requestRead = tx.objectStore('requests').getAll();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('服务请求重新初始化失败，原数据已保留。'));
      tx.onerror = () => reject(tx.error);
      let loaded = 0;
      const ready = () => {
        if (++loaded !== 3) return;
        try {
          const replacement = planRuleBasedRequestSamples(referenceRead.result, configRead.result);
          const samples = replacement ?? planPresalesRequestSamples(referenceRead.result, configRead.result, requestRead.result);
          if (!samples) return;
          const requests = tx.objectStore('requests');
          if (replacement) requests.clear();
          samples.forEach(sample => requests.add(sample));
          const payload = { initializedAt: new Date().toISOString(), count: samples.length };
          if (replacement) {
            refs.put({ id: requestSamplesMarker, payload });
            refs.put({ id: ruleBasedRequestSamplesMarker, payload });
          }
          refs.put({ id: presalesRequestSamplesMarker, payload });
        } catch (error) { tx.abort(); reject(error); }
      };
      referenceRead.onsuccess = ready; configRead.onsuccess = ready; requestRead.onsuccess = ready;
    });
  } finally { db.close(); }
}
