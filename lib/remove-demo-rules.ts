import { openDatabase } from './service-requests.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import { assessmentRoutingId, type RoutingConfig } from './assessment-routing-schema.ts';
import { approvalRulesId, type ApprovalRules } from './approval-rules.ts';

type Reference = { id: string; payload?: unknown };
export const removedDemoRulesMarker = 'demo-rules-removed-2026-09-15-v1';
const submissionIds = new Set(['demo-rule-item-description', 'demo-rule-presales', 'demo-rule-customer-contact', 'demo-rule-assessment-materials', 'demo-rule-confirmation-effort']);
const hardwareIds = new Set(['demo-hardware-onsite', 'demo-hardware-customer']);
const approvalIds = new Set(['demo-approval-upgrade', 'demo-approval-customer']);

// Delete only the nine seeded rules explicitly selected by the user.
// Preserve other rules, default users, trigger settings and request history.
export function removedDemoRuleUpdates(references: Reference[]): Reference[] {
  if (references.some(reference => reference.id === removedDemoRulesMarker)) return [];
  const changes: Reference[] = [];
  for (const reference of references) {
    if (reference.id === submissionRulesId && Array.isArray(reference.payload)) {
      const rules = reference.payload.filter(rule => !submissionIds.has(rule?.id));
      if (rules.length !== reference.payload.length) changes.push({ ...reference, payload: rules });
    }
    if (reference.id === assessmentRoutingId) {
      const config = reference.payload as RoutingConfig | undefined;
      if (Array.isArray(config?.hardware?.rules)) {
        const rules = config.hardware.rules.filter(rule => !hardwareIds.has(rule.id));
        if (rules.length !== config.hardware.rules.length) changes.push({ ...reference, payload: { ...config, revision: config.revision + 1, hardware: { ...config.hardware, rules } } });
      }
    }
    if (reference.id === approvalRulesId) {
      const config = reference.payload as ApprovalRules | undefined;
      if (Array.isArray(config?.rules)) {
        const rules = config.rules.filter(rule => !approvalIds.has(rule.id));
        if (rules.length !== config.rules.length) changes.push({ ...reference, payload: { ...config, rules } });
      }
    }
  }
  return [...changes, { id: removedDemoRulesMarker, payload: { completedAt: new Date().toISOString() } }];
}

export async function removeSelectedDemoRules(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite');
      const store = tx.objectStore('references');
      const request = store.getAll();
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('样例规则删除失败，请刷新重试。'));
      tx.onerror = () => reject(tx.error);
      request.onsuccess = () => {
        try { removedDemoRuleUpdates(request.result).forEach(reference => store.put(reference)); }
        catch (error) { tx.abort(); reject(error); }
      };
    });
  } finally { db.close(); }
}
