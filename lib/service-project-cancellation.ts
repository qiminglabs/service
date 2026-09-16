import type { InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';
import type { ServiceProjectRecord } from './service-projects';
import { routingUsers } from './assessment-routing-schema.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { projectRequestSnapshots } from './project-request-snapshot.ts';
import { activeRequestAssetAllocations, type ProjectReservationRelease } from './project-reservation-release.ts';
import { activeEntitlementAllocations } from './request-entitlement-reservations.ts';
import { sumDays } from './day-quantity.ts';

export function canCancelServiceProject(project: ServiceProjectRecord, actor: OperationActor, users: InternalUser[]) {
  return ['待启动', '进行中', '待复核', '待确认'].includes(project.status)
    && actor.role === 'SmartX 项目经理' && routingUsers(users, 'manager').some(user => user.id === actor.id);
}
export function cancelServiceProject(project: ServiceProjectRecord, actor: OperationActor, users: InternalUser[], reason: string,
  source?: ServiceRequest, at = new Date().toISOString()): { project: ServiceProjectRecord; source?: ServiceRequest } {
  if (!canCancelServiceProject(project, actor, users)) throw new Error('仅启用的项目经理可取消待启动、进行中、待复核或待确认的服务项目。');
  if (!reason.trim()) throw new Error('请填写取消原因。');
  let next = structuredClone(project);
  let releasedSource: ServiceRequest | undefined;
  if (project.sourceServiceRequestId) {
    const creation = source?.operations?.projectCreation;
    if (!source || source.id !== project.sourceServiceRequestId || source.customerId !== project.customerId
      || source.status !== '已转服务项目' || !creation?.projects.some(entry => entry.id === project.id)) {
      throw new Error('来源请求或项目关联已变化，无法安全解冻额度，请刷新后重试。');
    }
    if (source.projectReservationReleases?.some(release => release.projectId === project.id)) throw new Error('项目额度已释放，请刷新后重试。');
    const snapshot = project.requestConversion?.assessmentSnapshot ?? projectRequestSnapshots(source, creation).get(project.id);
    if (!snapshot || snapshot.requestId !== source.id) throw new Error('缺少项目服务依据，无法解冻额度。');
    const basis = snapshot.basis;
    const sourcePlan = source.operations?.assessment?.plans?.at(-1);
    if (!basis && sourcePlan && !sourcePlan.releasedAt) throw new Error('缺少项目服务依据，无法解冻额度。');
    if (basis) {
      const activePlan = source.operations?.assessment?.plans?.at(-1);
      if (!activePlan || activePlan.id !== basis.id || activePlan.releasedAt) throw new Error('来源服务依据已变化，请刷新后重试。');
      const assets = activeRequestAssetAllocations(source);
      for (const asset of basis.allocations) {
        if (asset.days > sumDays(assets.filter(entry => entry.assetId === asset.assetId).map(entry => entry.days)) + 1e-8) throw new Error('项目冻结资产与剩余额度不一致，无法取消。');
      }
      const entitlements = activeEntitlementAllocations(source);
      for (const entitlement of basis.entitlementAllocations ?? []) {
        if (entitlement.quantity > entitlements.filter(entry => entry.itemId === entitlement.itemId && entry.objectId === entitlement.objectId && entry.kind === entitlement.kind).reduce((sum, entry) => sum + entry.quantity, 0)) throw new Error('项目冻结权益与剩余额度不一致，无法取消。');
      }
      const release: ProjectReservationRelease = { projectId: project.id, planId: basis.id, at,
        assetAllocations: structuredClone(basis.allocations), entitlementAllocations: structuredClone(basis.entitlementAllocations ?? []),
        invalidatedApprovals: snapshot.approvals.map(({ id, days, gaps }) => ({ id, days, gaps: structuredClone(gaps) })) };
      releasedSource = { ...source, projectReservationReleases: [...(source.projectReservationReleases ?? []), release] };
    }
    if (next.requestConversion) next.requestConversion.assessmentSnapshot = structuredClone(snapshot);
  }
  next = { ...next, status: '已取消', revision: project.revision + 1, updatedAt: at,
    cancellation: { at, actorId: actor.id, actor: actor.name, reason: reason.trim(), fromStatus: project.status } };
  return { project: appendProjectActivity(next, actor, '项目', '取消服务项目', reason.trim(), at), source: releasedSource };
}
