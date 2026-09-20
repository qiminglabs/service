import { approvalRulesId, readApprovalRulesPayload } from './approval-rules.ts';
export type ApprovalScope = 'request' | 'project';
export const projectApprovalRulesId = 'service-project-special-approval-rules';
export const approvalStorageId = (scope: ApprovalScope) => scope === 'project' ? projectApprovalRulesId : approvalRulesId;
type Reference = { id: string; payload?: unknown };
export function scopedApprovalRules(records: Reference[], scope: ApprovalScope) {
  return readApprovalRulesPayload(records.find(row => row.id === approvalStorageId(scope))?.payload);
}
export function initialProjectApprovalRules(records: Reference[]) {
  return records.some(row => row.id === projectApprovalRulesId)
    ? scopedApprovalRules(records, 'project') : structuredClone(scopedApprovalRules(records, 'request'));
}
