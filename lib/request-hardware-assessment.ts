import { isDemoAdministrator } from './demo-permissions.ts';
import { canPerformAssessmentRole } from './assessment-routing.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';
import { operationIdentities, fixedIdentityRoles } from './internal-users.ts';

import { hardwareItems } from './hardware-assessment-trigger.ts';
export { hardwareItems, hardwareCompatibilityServiceId } from './hardware-assessment-trigger.ts';
export type HardwareReview = {
  id: string; assignmentId: string; authorId: string; author: string; at: string;
  outcome: '需补充' | '评估通过'; opinion: string;
  // Retained only for historical assessments; the current form records two fields.
  scope?: string; risks?: string; effortNote?: string;
  itemIds: string[]; source: string; invalidatedAt?: string;
};
export type HardwareAssessment = {
  reviewerId: string; reviewer: string; assignmentId: string; rounds: HardwareReview[];
};
// Fixed directory roles remain the authority for legacy and routed assessments.
export const isHardwareProductManager = (actor?: OperationActor) => !!actor?.id && actor.role === 'SmartX 硬件产品经理' && fixedIdentityRoles[actor.id] === actor.role;
export const hardwareReviewers = (users: InternalUser[]) => operationIdentities(users).filter(user => user.role === 'SmartX 硬件产品经理');
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const passed = (record: ServiceRequest) => !!record.operations?.assessment?.rounds.some(round => round.outcome === '评估通过');

// Include material version IDs and online content, not file bytes. Changes are also
// invalidated at save time so reverting a change cannot resurrect an old decision.
export function hardwareReviewSource(record: ServiceRequest): string {
  return JSON.stringify({ submittedAt: record.submittedAt, items: hardwareItems(record), supplements: record.operations?.supplements ?? [] });
}
export function currentHardwareReview(record: ServiceRequest): HardwareReview | undefined {
  const hardware = record.operations?.assessment?.hardware;
  const round = hardware?.rounds.at(-1);
  return round && !round.invalidatedAt && round.assignmentId === hardware?.assignmentId
    && round.authorId === hardware.reviewerId && round.source === hardwareReviewSource(record) ? round : undefined;
}
export function hardwarePassIssue(record: ServiceRequest, users: InternalUser[]): string | null {
  if (!hardwareItems(record).length) return null;
  const hardware = record.operations?.assessment?.hardware;
  if (!hardware || (!isDemoAdministrator({ id: hardware.reviewerId, name: hardware.reviewer, role: fixedIdentityRoles[hardware.reviewerId] ?? '' }, users) && ((record.operations?.assessment?.routing && !canPerformAssessmentRole(record, { id: hardware.reviewerId, name: hardware.reviewer, role: 'SmartX 硬件产品经理' }, 'hardware', users)) || !hardwareReviewers(users).some(user => user.id === hardware.reviewerId)))) return '请由已启用的硬件产品经理完成评估。';
  if (currentHardwareReview(record)?.outcome !== '评估通过') return '硬件产品经理评估尚未通过或材料已变化，请由硬件产品经理重新评估。';
  return null;
}

// Called against the latest persisted row, before any canonical cleanup.
export function hardwareAssessmentSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, actor: OperationActor | undefined, users: InternalUser[]): string | null {
  const before = previous?.operations?.assessment;
  const after = next.operations?.assessment;
  if (!previous) return after?.hardware ? '新建申请不能预置硬件评估结果。' : null;
  if (!hardwareItems(previous).length && !hardwareItems(next).length && !before?.hardware && !after?.hardware) return null;
  // The existing save validator checks the complete return-to-draft transaction.
  if (previous.status === '待评估' && next.status === '草稿') {
    return after?.hardware || !same(next.operations?.assessmentHistory?.at(-1)?.hardware, before?.hardware)
      ? '退回草稿须归档本轮硬件评估，并清空当前专业结论。' : null;
  }
  const changed = !same(before?.hardware, after?.hardware);
  const roundsChanged = !same(before?.rounds ?? [], after?.rounds ?? []);
  const manager = isDemoAdministrator(actor, users) || !!actor?.id && actor.role === 'SmartX 项目经理' && (!before?.managerId || before.managerId === actor.id);
  if (!same(before?.effort, after?.effort) && !manager) return '人天核定由负责项目经理执行。';
  if (passed(previous)) {
    return changed || roundsChanged ? '材料评估已通过，双方评估结论已锁定。' : null;
  }
  if (changed) {
    if (previous.status !== '待评估' || next.status !== '待评估' || !hardwareItems(previous).length || !actor?.id) return '仅待评估阶段可维护硬件产品经理评估。';
    if (hardwareReviewSource(previous) !== hardwareReviewSource(next)) return '材料已变化，请刷新后重新评估。';
    const old = before?.hardware, hardware = after?.hardware;
    if (!isDemoAdministrator(actor, users) && (!isHardwareProductManager(actor) || !hardwareReviewers(users).some(user => user.id === actor.id))) return '仅已启用的硬件产品经理可提交硬件产品经理评估。';
    if (!hardware || hardware.reviewerId !== actor.id || hardware.reviewer !== actor.name) return '评估人必须是实际提交评估的硬件产品经理。';
    // Keep the legacy grouping key for stored records; it no longer grants assignment permissions.
    if (!hardware.assignmentId || (old && hardware.assignmentId !== old.assignmentId)) return '评估记录已更新，请刷新后重试。';
    const { hardware: _oldHardware, ...oldAssessment } = before ?? { managerId: '', manager: '', rounds: [], tasks: [], plans: [], approvals: [] };
    const { hardware: _newHardware, ...newAssessment } = after ?? {};
    if (!same(oldAssessment, newAssessment)) return '硬件产品经理评估不能同时改写项目经理的评估或核定结果。';
    const originals = old?.rounds ?? [];
    if (hardware.rounds.length !== originals.length + 1 || originals.some((round, i) => !same(round, hardware.rounds[i]))) return '硬件评估记录已更新，请刷新后重试。';
    const round = hardware.rounds.at(-1)!;
    if (!round.id || originals.some(item => item.id === round.id) || round.authorId !== actor.id || round.author !== actor.name
      || round.assignmentId !== hardware.assignmentId || round.invalidatedAt || !Number.isFinite(Date.parse(round.at))
      || !['需补充', '评估通过'].includes(round.outcome) || !round.opinion?.trim()
      || [round.scope, round.risks, round.effortNote].some(value => value !== undefined && typeof value !== 'string')
      || round.source !== hardwareReviewSource(previous) || !same(round.itemIds, hardwareItems(previous).map(item => item.id))) return '硬件产品经理评估结论与当前材料或评估人不一致，请刷新后重新评估。';
  }
  if (roundsChanged) {
    if (!manager || previous.status !== '待评估' || next.status !== '待评估') return '材料评估由负责项目经理执行。';
    const rounds = after?.rounds ?? [], originals = before?.rounds ?? [];
    if (rounds.length !== originals.length + 1 || originals.some((round, i) => !same(round, rounds[i]))) return '材料评估记录已更新，请刷新后重试。';
    const round = rounds.at(-1)!;
    if (round.authorId !== actor?.id || !round.opinion?.trim() || !['需补充', '评估通过'].includes(round.outcome)) return '材料评估结论无效。';
    if (round.outcome === '评估通过') return hardwarePassIssue(previous, users) ?? hardwarePassIssue(next, users);
  }
  // Reject forged transitions that skip the joint material evaluation entirely.
  if (!passed(next) && (after?.effort || after?.plans.length || after?.confirmation) && !same(before, after)) return '请先完成双方材料评估。';
  return null;
}

export function invalidateHardwareReview(next: ServiceRequest, previous: ServiceRequest | undefined, now = new Date().toISOString()): ServiceRequest {
  if (!previous || passed(previous) || hardwareReviewSource(previous) === hardwareReviewSource(next)) return next;
  const hardware = next.operations?.assessment?.hardware;
  if (!hardware?.rounds.length || hardware.rounds.at(-1)?.invalidatedAt) return next;
  const result = structuredClone(next);
  result.operations!.assessment!.hardware!.rounds.at(-1)!.invalidatedAt = now;
  return result;
}
