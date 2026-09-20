import { isDemoAdministrator } from './demo-permissions.ts';
import { canonicalMailTemplate, parseMailConfig, type ServiceMailConfig } from './service-mail-templates.ts';
import { buildProjectDailyReport, reportMailText, type DailyReportInput } from './service-project-daily-reports.ts';
import type { Partner, PartnerUser } from './partner-directory';
import type { ServiceProjectRecord } from './service-projects';
import type { CatalogService, CustomerRef, ContactRef, InternalUser, ObjectRef, ServiceRequest } from './service-requests';
import type { OperationActor, RequestAsset } from './request-operations';
import type { AssetAllocation, GapApproval } from './request-assessment';
import type { ApprovalRules } from './approval-rules';
import type { DayMethod } from './request-asset-coverage';
import type { EntitlementAllocation } from './request-entitlement-reservations';
import type { EffortPricingLine } from './request-pricing';
import { isInternal } from './request-operations.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import { isPartnerCreatedProject, isAssignedProjectEngineer, canManagePartnerProjectConfirmation, partnerProjectConfirmationIssue, canManageProjectAsManager, projectReviewIssue, projectCustomerConfirmationLocked } from './service-project-work-order-policy.ts';
import { assetAvailable } from './request-assessment.ts';
import { assetDayMethod } from './request-asset-coverage.ts';
import { entitlementAvailable, effortEntitlementAllocations, activeEntitlementAllocations } from './request-entitlement-reservations.ts';
import { calculateBillableDays } from './request-pricing.ts';
import { calculateWorklogPricing } from './project-worklog-pricing.ts';
import { isDayQuantity, roundDays, sumDays } from './day-quantity.ts';
import { createApprovalExecution, decideApprovalExecution } from './approval-execution.ts';
import { activeRequestAssetAllocations } from './project-reservation-release.ts';
import { projectDeliverables, type ProjectDeliverable } from './service-project-deliverables.ts';
import { appendProjectActivity } from './service-project-activity.ts';

export type ProjectReviewLine = EffortPricingLine & { actualHours: number; method: DayMethod };
export type ProjectReviewBasis = { id: string; allocations: AssetAllocation[]; entitlementAllocations: EntitlementAllocation[]; at: string; author: string; capacities?: AssetAllocation[] };
export type ProjectConfirmation = { reportId?: string; changes?: { name: string; unit: string; before: number; after: number }[]; fingerprint?: string; services?: { id: string; name: string; method: string; description: string }[]; deliverables?: ProjectDeliverable[]; id: string; at: string; by: string; note: string; allocations: AssetAllocation[]; entitlementAllocations: EntitlementAllocation[]; state: '待确认' | '已确认' | '已拒绝'; decidedAt?: string; decidedBy?: string; reason?: string; invalidatedAt?: string };
export type ProjectApproval = GapApproval & { independent?: true };
export type ProjectReview = {
  effort?: { lines: ProjectReviewLine[]; fingerprint: string; note: string; author: string; at: string; stage?: '过程' | '最终' };
  history?: { at: string; author: string; effort?: ProjectReview['effort']; basis?: ProjectReviewBasis }[];
  settlement?: { at: string; allocations: AssetAllocation[]; entitlementAllocations: EntitlementAllocation[]; released: AssetAllocation[]; releasedEntitlements: EntitlementAllocation[] };
  basis?: ProjectReviewBasis;
  approvals: ProjectApproval[];
  confirmations: ProjectConfirmation[];
};
export type ProjectReviewContext = {
  mailTemplates?: ServiceMailConfig;
  partners?: Partner[]; partnerUsers?: PartnerUser[];
  services: CatalogService[]; assets: RequestAsset[]; businessObjects: ObjectRef[]; requests: ServiceRequest[];
  users: InternalUser[]; customers: CustomerRef[]; contacts: ContactRef[]; rules: ApprovalRules;
  conversions: Partial<Record<'inspection' | 'upgrade', { days: number; version: number }>>;
};
export type ProjectReviewAction =
  | { type: 'effort'; items: { itemId: string; finalBillableDays: number }[]; note: string }
  | { type: 'basis'; allocations: { assetId: string; days: number }[] }
  | { type: 'gap-submit'; method: DayMethod; days: number; reason: string }
  | { type: 'gap-decide'; id: string; approve: boolean; note: string }
  | { type: 'confirm'; note: string; mail?: DailyReportInput }
  | { type: 'customer-decision'; confirmationId: string; accepted: boolean; reason: string };
export const projectReviewOf = (p: ServiceProjectRecord): ProjectReview => p.review ?? { approvals: [], confirmations: [] };
export function reviewOrders(p: ServiceProjectRecord) {
  return (p.workOrders ?? []).filter(order => order.status !== '已取消' || p.operations?.worklogs.some(log => log.workOrderId === order.id && !log.voidedAt));
}
export function projectReviewFingerprint(p: ServiceProjectRecord) {
  return JSON.stringify({ orders: reviewOrders(p).map(order => [order.id, order.item.serviceId, order.item.method, order.item.businessObjectIds, order.item.description, order.item.values, order.catalogSnapshot]),
    logs: (p.operations?.worklogs ?? []).filter(log => !log.voidedAt).map(log => [log.id, log.workOrderId, log.hours, log.pricing]) });
}
export const pendingProjectWorklogs = (p: ServiceProjectRecord) => (p.operations?.worklogs ?? []).filter(log => !log.voidedAt && !log.confirmedAt);
export const projectReviewStale = (p: ServiceProjectRecord) => !!p.review?.effort && (p.review.effort.fingerprint !== projectReviewFingerprint(p) || (!['已完成', '已取消'].includes(p.status) && (pendingProjectWorklogs(p).length > 0 || p.review.effort.lines.some(line => line.kind === 'entitlement' && line.billableDays !== 0))));
export function canManageProjectReviewBasis(p: ServiceProjectRecord, actor: OperationActor, ctx: ProjectReviewContext) {
  if (!isInternal(actor.role) || !ctx.users.some(user => user.id === actor.id && user.status === '启用')) return false;
  if (isDemoAdministrator(actor, ctx.users)) return true;
  const source = ctx.requests.find(r => r.id === p.sourceServiceRequestId);
  const applicant = source ? source.createdById : p.createdSite !== '合作伙伴中心' ? p.createdById : '';
  return actor.id === applicant || actor.id === ctx.customers.find(c => c.id === p.customerId)?.ownerUserId;
}
export function canInitiateProjectConfirmation(p: ServiceProjectRecord, actor: OperationActor, ctx: ProjectReviewContext) {
  if (actor.role === '合作伙伴服务工程师') {
    const user = ctx.partnerUsers?.find(person => person.id === actor.id && person.status === '启用');
    if (!user || !ctx.partners?.some(partner => partner.id === user.partnerId && partner.status === '启用')) return false;
    if (isPartnerCreatedProject(p) && p.serviceProviderId !== `partner:${user.partnerId}`) return false;
  } else if (fixedIdentityRoles[actor.id] !== actor.role || !ctx.users.some(user => user.id === actor.id && user.status === '启用')) return false;
  return isPartnerCreatedProject(p) ? canManagePartnerProjectConfirmation(p, actor)
    : canManageProjectReviewBasis(p, actor, ctx) || isAssignedProjectEngineer(p, actor);
}
export function sourceBasis(p: ServiceProjectRecord, ctx: ProjectReviewContext) {
  const source = ctx.requests.find(r => r.id === p.sourceServiceRequestId && r.status !== '已取消');
  const snapshot = p.requestConversion?.assessmentSnapshot;
  const active = source?.operations?.assessment?.plans.at(-1);
  return !source?.projectReservationReleases?.some(row => row.projectId === p.id) && active && !active.releasedAt && active.id === snapshot?.basis?.id ? snapshot : undefined;
}
export function projectAssetAvailable(p: ServiceProjectRecord, asset: RequestAsset, ctx: ProjectReviewContext) {
  const inherited = sumDays(sourceBasis(p, ctx)?.basis?.allocations.filter(row => row.assetId === asset.id).map(row => row.days) ?? []);
  return assetAvailable({ ...asset, balanceDays: asset.balanceDays === undefined ? undefined : sumDays([asset.balanceDays, inherited]),
    projectReservations: asset.projectReservations?.filter(row => row.projectId !== p.id), projectConsumptions: asset.projectConsumptions?.filter(row => row.projectId !== p.id) }, ctx.requests, '');
}
function objectAvailable(p: ServiceProjectRecord, object: ObjectRef, kind: 'inspection' | 'upgrade', ctx: ProjectReviewContext) {
  const inherited = (sourceBasis(p, ctx)?.basis?.entitlementAllocations ?? []).filter(row => row.objectId === object.id && row.kind === kind).reduce((s, row) => s + row.quantity, 0);
  const key = kind === 'inspection' ? 'inspectionEntitlement' : 'upgradeEntitlement';
  return entitlementAvailable({ ...object, [key]: object[key] === undefined ? undefined : object[key] + inherited,
    projectReservations: object.projectReservations?.filter(row => row.projectId !== p.id), projectConsumptions: object.projectConsumptions?.filter(row => row.projectId !== p.id) }, kind, ctx.requests);
}
export function calculateProjectReviewEffort(p: ServiceProjectRecord, ctx: ProjectReviewContext, inputs?: { itemId: string; finalBillableDays: number }[]): ProjectReviewLine[] {
  const orders = reviewOrders(p);
  if (!orders.length) throw new Error('项目尚无工单，无法核定人天。');
  const logs = (p.operations?.worklogs ?? []).filter(log => !log.voidedAt);
  if (logs.some(log => !orders.some(order => order.id === log.workOrderId))) throw new Error('请先将所有有效工时关联到本项目工单。');
  if (inputs && (inputs.length !== orders.length || new Set(inputs.map(row => row.itemId)).size !== orders.length || inputs.some(row => !orders.some(order => order.id === row.itemId)))) throw new Error('请完整核定每张工单的人天。');
  const used = new Map<string, number>();
  return orders.map(order => {
    const actualHours = logs.filter(log => log.workOrderId === order.id).reduce((s, log) => s + log.hours, 0);
    let method = order.item.method;
    if (method.startsWith('[')) { try { const values = JSON.parse(method); if (values.length === 1) method = values[0]; } catch { /* Invalid method is rejected below. */ } }
    if (method !== '远程' && method !== '现场') throw new Error(`${order.item.serviceName}：请在工单中明确远程或现场服务方式。`);
    const estimatedDays = roundDays(actualHours / 8);
    const finalBillableDays = inputs?.find(row => row.itemId === order.id)?.finalBillableDays;
    if (inputs && (!isDayQuantity(finalBillableDays) || finalBillableDays > 100000)) throw new Error('最终计价人天须为非负数，最多一位小数且不超过 100000。');
    if (!isDayQuantity(estimatedDays) || estimatedDays > 100000) throw new Error('核定人天须为非负数，最多一位小数且不超过 100000。');
    const pricing = calculateWorklogPricing(order, actualHours, ctx.services);
    const base = { itemId: order.id, serviceId: order.item.serviceId, serviceName: order.item.serviceName, actualHours, estimatedDays, method: method as DayMethod };
    if (pricing.kind === 'pending') throw new Error(`${order.item.serviceName}：${pricing.reason}。`);
    if (pricing.kind === 'hourly') return { ...base, priceCoefficient: pricing.coefficient, billableDays: finalBillableDays ?? calculateBillableDays(estimatedDays, pricing.coefficient) };
    if (inputs && finalBillableDays !== 0) throw new Error(`${order.item.serviceName}：权益类工单的最终计价人天固定为 0。`);
    const kind = pricing.unit === '巡检权益' ? 'inspection' : 'upgrade';
    if (!order.item.businessObjectIds.length || new Set(order.item.businessObjectIds).size !== order.item.businessObjectIds.length) throw new Error(`${order.item.serviceName}：请关联有效且不重复的业务对象。`);
    const objects = order.item.businessObjectIds.map(id => {
      const object = ctx.businessObjects.find(o => o.id === id && o.customerId === p.customerId && o.status === '启用' && o.product === 'SMTX OS 系统');
      if (!object || !Number.isInteger(object.nodeCount) || object.nodeCount <= 0) throw new Error(`${order.item.serviceName}：业务对象已失效或节点数量无效。`);
      const available = objectAvailable(p, object, kind, ctx);
      if (available === undefined) throw new Error(`${object.name}：权益余额未正确维护。`);
      const key = `${id}:${kind}`, remaining = Math.max(0, available - (used.get(key) ?? 0));
      used.set(key, (used.get(key) ?? 0) + Math.min(object.nodeCount, remaining));
      return { objectId: id, name: object.name, nodes: object.nodeCount, available: remaining, deficit: Math.max(0, object.nodeCount - remaining) };
    });
    const deficit = objects.reduce((s, o) => s + o.deficit, 0);
    return { ...base, kind: 'entitlement' as const, entitlementKind: kind, deficitEntitlements: deficit,
      entitlementObjects: objects, priceCoefficient: 0, billableDays: 0 };
  });
}
export function projectSourceIssue(p: ServiceProjectRecord, ctx: ProjectReviewContext): string | null {
  if (!p.requestConversion?.assessmentSnapshot?.basis || p.review?.settlement) return null;
  return sourceBasis(p, ctx) ? null : '来源申请依据已失效或发生变更，请先核实来源记录。';
}
export function projectBaselineLine(p: ServiceProjectRecord, orderId: string) {
  const order = p.workOrders?.find(order => order.id === orderId);
  const sourceId = p.requestConversion?.workOrders?.find(row => row.id === orderId)?.sourceItemId ?? order?.item.id;
  // Never match by service name: two work orders can use the same catalog.
  return p.requestConversion?.assessmentSnapshot?.effort?.lines?.find(line => line.itemId === sourceId);
}
export function matchingApprovals(p: ServiceProjectRecord) {
  return projectReviewOf(p).approvals.filter(a => a.days > 0 && a.state !== '已失效' && (a.independent || a.planId === p.review?.basis?.id));
}
export function currentProjectReviewApproval(p: ServiceProjectRecord) {
  const approvals = matchingApprovals(p);
  return approvals.find(a => a.state === '待审批') ?? approvals.at(-1);
}
export function projectReviewCapacities(p: ServiceProjectRecord, ctx: ProjectReviewContext): AssetAllocation[] {
  const rows = new Map<string, AssetAllocation>();
  for (const row of [...(sourceBasis(p, ctx)?.basis?.allocations ?? []), ...(p.review?.basis?.capacities ?? p.review?.basis?.allocations ?? [])]) {
    const method = row.method ?? assetDayMethod(row);
    if (!method) continue;
    const previous = rows.get(row.assetId);
    rows.set(row.assetId, { ...row, method, days: Math.max(previous?.days ?? 0, row.days) });
  }
  return [...rows.values()];
}
export function projectReviewCoverage(p: ServiceProjectRecord, ctx: ProjectReviewContext) {
  const review = projectReviewOf(p), inherited = review.settlement ? p.requestConversion?.assessmentSnapshot : sourceBasis(p, ctx);
  const lines = review.effort?.lines ?? calculateProjectReviewEffort(p, ctx);
  const capacities = projectReviewCapacities(p, ctx);
  return (['远程', '现场'] as const).map(method => {
    const days = sumDays(lines.filter(line => line.method === method).map(line => line.billableDays));
    const assets = sumDays((review.basis?.allocations ?? allocateProjectAssets(lines, capacities)).filter(row => row.method === method).map(row => row.days));
    const sourceApproval = sumDays((inherited?.approvals ?? []).filter(row => row.state === '已通过').flatMap(row => row.gaps?.filter(gap => gap.method === method).map(gap => gap.days) ?? (inherited?.basis?.requirements?.length === 1 && inherited.basis.requirements[0].method === method ? [row.days] : [])));
    const projectApproval = sumDays(matchingApprovals(p).filter(a => a.state === '已通过').flatMap(a => a.gaps?.filter(g => g.method === method).map(g => g.days) ?? []));
    return { method, days, assets, sourceApproval, projectApproval,
      capacity: sumDays(capacities.filter(row => row.method === method).map(row => row.days)),
      gap: Math.max(0, sumDays([days, -assets, -sourceApproval, -projectApproval])) };
  });
}
function allocateProjectAssets(lines: ProjectReviewLine[], capacities: AssetAllocation[]) {
  const remaining = new Map((['远程', '现场'] as const).map(method => [method, sumDays(lines.filter(l => l.method === method).map(l => l.billableDays))]));
  return capacities.flatMap(row => {
    const method = row.method ?? assetDayMethod(row);
    if (!method) return [];
    const days = Math.min(row.days, remaining.get(method) ?? 0);
    remaining.set(method, sumDays([remaining.get(method) ?? 0, -days]));
    return days > 0 ? [{ ...row, days, method }] : [];
  });
}
function carriedBasis(p: ServiceProjectRecord, ctx: ProjectReviewContext, at: string, author: string): ProjectReviewBasis {
  const capacities = projectReviewCapacities(p, ctx);
  return { id: p.review?.basis?.id ?? crypto.randomUUID(), capacities,
    allocations: allocateProjectAssets(p.review!.effort!.lines, capacities),
    entitlementAllocations: effortEntitlementAllocations(p.review!.effort!.lines), at, author };
}
export function projectReviewProjection(p: ServiceProjectRecord, ctx: ProjectReviewContext): ServiceProjectRecord {
  if (p.review?.effort && !projectReviewStale(p)) return p;
  const review = projectReviewOf(p);
  const next = { ...p, review: { ...review, effort: { lines: calculateProjectReviewEffort(p, ctx), fingerprint: projectReviewFingerprint(p), note: '', author: '', at: '' } } };
  next.review.basis = carriedBasis(next, ctx, '', '');
  return next;
}
export function projectReviewCovered(p: ServiceProjectRecord, ctx: ProjectReviewContext) {
  return !!p.review?.basis && !projectSourceIssue(p, ctx) && projectReviewCoverage(p, ctx).every(row => row.gap === 0);
}
export function projectEntitlementCoverage(p: ServiceProjectRecord, projection = p) {
  const rows = new Map<string, { objectId: string; name: string; kind: 'inspection' | 'upgrade'; inherited: number; held: number; usage: number }>();
  const add = (row: EntitlementAllocation, field: 'inherited' | 'held' | 'usage') => {
    const key = `${row.objectId}:${row.kind}`;
    const current = rows.get(key) ?? { objectId: row.objectId, name: row.name, kind: row.kind, inherited: 0, held: 0, usage: 0 };
    current[field] += row.quantity; rows.set(key, current);
  };
  for (const row of p.requestConversion?.assessmentSnapshot?.basis?.entitlementAllocations ?? []) add(row, 'inherited');
  for (const row of p.review?.basis?.entitlementAllocations ?? []) add(row, 'held');
  for (const row of projection.review?.basis?.entitlementAllocations ?? []) add(row, 'usage');
  return [...rows.values()].map(row => ({ ...row, held: Math.max(row.held, row.inherited), extra: Math.max(0, row.usage - Math.max(row.held, row.inherited)), release: Math.max(0, row.inherited - row.usage) }));
}
export function projectConfirmationChanges(p: ServiceProjectRecord) {
  const snapshot = p.requestConversion?.assessmentSnapshot;
  if (!snapshot?.basis) return [];
  const changes = new Map<string, { name: string; unit: string; before: number; after: number }>();
  const add = (key: string, name: string, unit: string, field: 'before' | 'after', value: number) => {
    const row = changes.get(key) ?? { name, unit, before: 0, after: 0 };
    row[field] = sumDays([row[field], value]); changes.set(key, row);
  };
  for (const [field, basis] of [['before', snapshot.basis], ['after', p.review?.basis]] as const) {
    for (const row of basis?.allocations ?? []) add(row.assetId, row.name, '人天', field, row.days);
    for (const row of basis?.entitlementAllocations ?? []) add(`${row.objectId}:${row.kind}`, `${row.name} · ${row.kind === 'inspection' ? '巡检权益' : '升级权益'}`, '份', field, row.quantity);
  }
  return [...changes.values()].filter(row => row.before !== row.after);
}
export function projectConfirmationContent(p: ServiceProjectRecord) {
  return { services: reviewOrders(p).filter(o => o.status !== '已取消').map(o => ({ id: o.id, name: o.item.serviceName, method: o.item.method, description: o.item.description })), deliverables: projectDeliverables(p) };
}
export function projectConfirmationFingerprint(p: ServiceProjectRecord) {
  const content = projectConfirmationContent(p);
  return JSON.stringify({ name: p.name, services: content.services,
    deliverables: content.deliverables.map(d => [d.id, d.file.id, d.file.name, d.file.size, d.file.uploadedAt]),
    allocations: isPartnerCreatedProject(p) ? undefined : p.review?.basis?.allocations, entitlements: isPartnerCreatedProject(p) ? undefined : p.review?.basis?.entitlementAllocations });
}
export function projectCustomerConfirmationStale(p: ServiceProjectRecord) {
  const last = p.review?.confirmations.at(-1);
  return (isPartnerCreatedProject(p) ? !!partnerProjectConfirmationIssue(p) : projectReviewStale(p)) || !!last?.invalidatedAt || !!last?.fingerprint && last.fingerprint !== projectConfirmationFingerprint(p);
}
function assertBasis(p: ServiceProjectRecord, ctx: ProjectReviewContext) {
  const sourceIssue = projectSourceIssue(p, ctx); if (sourceIssue) throw new Error(sourceIssue);
  const review = projectReviewOf(p);
  if (!review.effort || projectReviewStale(p)) throw new Error('工时、工单或计价规则已变化，请重新核定人天。');
  if (!review.basis) throw new Error('请先关联服务依据。');
  for (const allocation of review.basis.allocations) {
    const asset = ctx.assets.find(asset => asset.id === allocation.assetId && asset.customerId === p.customerId && ['启用', '使用中'].includes(asset.status));
    if (!asset || assetDayMethod(asset) !== allocation.method) throw new Error(`${allocation.name}：资产已失效或类别已变更，请重新关联。`);
    const available = projectAssetAvailable(p, asset, ctx);
    if (available === null || allocation.days > available + 1e-8) throw new Error(`${allocation.name}：可用人天不足，请重新关联。`);
  }
  const used = new Map<string, number>();
  for (const line of review.effort.lines) for (const saved of line.entitlementObjects ?? []) {
    if (ctx.businessObjects.find(object => object.id === saved.objectId)?.nodeCount !== saved.nodes) throw new Error(`${saved.name}：节点数量已变更，请重新核定人天。`);
  }
  for (const allocation of review.basis.entitlementAllocations) {
    const object = ctx.businessObjects.find(o => o.id === allocation.objectId && o.customerId === p.customerId && o.status === '启用');
    const free = object && objectAvailable(p, object, allocation.kind, ctx);
    const key = `${allocation.objectId}:${allocation.kind}`;
    used.set(key, (used.get(key) ?? 0) + allocation.quantity);
    if (free === undefined || used.get(key)! > free) throw new Error(`${allocation.name}：权益不足或已失效，请重新核定人天。`);
  }
}
export function projectApprovalRequest(p: ServiceProjectRecord, ctx: ProjectReviewContext, actor: OperationActor, planId: string, requirements: { method: DayMethod; days: number }[]): ServiceRequest {
  const source = ctx.requests.find(r => r.id === p.sourceServiceRequestId);
  return { ...source, id: p.id, title: p.name, customerId: p.customerId, createdById: actor.id, createdBy: actor.name,
    createdSite: '内部系统', createdByAudience: 'internal', status: '待评估', items: reviewOrders(p).map(order => ({ ...order.item, id: order.id })),
    operations: { assessment: { managerId: '', manager: '', rounds: [], tasks: [], approvals: [], plans: [{ id: planId, allocations: [], requirements, effort: sumDays(requirements.map(row => row.days)), salesId: actor.id }] } },
  } as unknown as ServiceRequest;
}
// Used only after a valid customer confirmation; the store commits completion,
// consumption and source-reservation release atomically.
function settleConfirmedProject(next: ServiceProjectRecord, ctx: ProjectReviewContext, now: string) {
  const review = next.review!;
  assertBasis(next, ctx);
  if (!projectReviewCovered(next, ctx)) throw new Error('服务依据已变化，请重新关联。');
  if (projectCustomerConfirmationStale(next)) throw new Error('客户确认内容已变化，请重新发起确认。');
  const capacities = projectReviewCapacities(next, ctx);
  const inheritedEntitlements = sourceBasis(next, ctx)?.basis?.entitlementAllocations ?? [];
  const remainingEntitlements = new Map<string, number>();
  for (const row of review.basis!.entitlementAllocations) { const key = `${row.objectId}:${row.kind}`; remainingEntitlements.set(key, (remainingEntitlements.get(key) ?? 0) + row.quantity); }
  const releasedEntitlements = inheritedEntitlements.flatMap(row => { const key = `${row.objectId}:${row.kind}`, used = Math.min(row.quantity, remainingEntitlements.get(key) ?? 0); remainingEntitlements.set(key, (remainingEntitlements.get(key) ?? 0) - used); return row.quantity > used ? [{ ...row, quantity: row.quantity - used }] : []; });
  review.settlement = { at: now, allocations: structuredClone(review.basis!.allocations), entitlementAllocations: structuredClone(review.basis!.entitlementAllocations),
    released: capacities.map(row => ({ ...row, days: Math.max(0, sumDays([row.days, -sumDays(review.basis!.allocations.filter(a => a.assetId === row.assetId).map(a => a.days))])) })).filter(row => row.days > 0),
    releasedEntitlements };
  next.status = '已完成';
}

export function applyProjectReview(p: ServiceProjectRecord, action: ProjectReviewAction, actor: OperationActor, ctx: ProjectReviewContext, now = new Date().toISOString()): ServiceProjectRecord {
  if (!['effort', 'basis', 'gap-submit', 'gap-decide', 'confirm', 'customer-decision'].includes(action.type)) throw new Error('不支持的项目复核操作。');
  if (!['已完成', '已取消', '已暂停'].includes(p.status) && projectCustomerConfirmationLocked(p) && ['effort', 'basis', 'gap-submit', 'gap-decide', 'confirm'].includes(action.type))
    throw new Error('客户已确认项目，核定、服务依据及确认内容已锁定，不能修改或重新发起确认。');
  if (isPartnerCreatedProject(p)) return applyPartnerConfirmation(p, action, actor, ctx, now);
  if (['已完成', '已取消', '已暂停'].includes(p.status) || p.status === '待启动' && !['gap-submit', 'gap-decide'].includes(action.type)) throw new Error('当前项目阶段不可处理复核。');
  const customer = action.type === 'customer-decision';
  if (customer) {
    if (!isDemoAdministrator(actor, ctx.users) && (actor.role !== '客户' || !p.collaborators?.customer?.some(person => person.id === actor.id)
      || !ctx.contacts.some(person => person.id === actor.id && person.customerId === p.customerId && person.status === '启用')
      || !ctx.customers.some(c => c.id === p.customerId && c.status === '启用'))) throw new Error('仅本项目有效客户协作人可确认。');
  } else if (action.type === 'confirm') {
    if (!canInitiateProjectConfirmation(p, actor, ctx)) throw new Error('仅内部申请人、客户所有人、已指派工单的有效执行工程师或系统管理员可发起客户确认。');
  } else if (!isInternal(actor.role) || fixedIdentityRoles[actor.id] !== actor.role || !ctx.users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('仅有效内部人员可处理项目复核。');
  if (p.status === '待确认' && ['effort', 'basis', 'gap-submit', 'gap-decide'].includes(action.type))
    throw new Error('已发起客户确认，人天核定和服务依据已锁定；客户拒绝并返回待复核后才能调整。');

  const next = structuredClone(p), review = next.review = structuredClone(projectReviewOf(p));
  const basisOwner = canManageProjectReviewBasis(p, actor, ctx), manager = canManageProjectAsManager(p, actor);
  const waiting = currentProjectReviewApproval(p)?.state === '待审批';
  let title = '';
  if (action.type === 'effort') {
    if (!manager) throw new Error('仅负责项目经理或系统管理员可核定人天。');
    const issue = projectSourceIssue(p, ctx); if (issue) throw new Error(issue);
    if (pendingProjectWorklogs(p).length) throw new Error('请先由项目经理确认全部有效工时，再核定最终计价人天。');
    const lines = calculateProjectReviewEffort(p, ctx, action.items);
    const automatic = calculateProjectReviewEffort(p, ctx);
    if (lines.some(line => line.billableDays !== automatic.find(row => row.itemId === line.itemId)?.billableDays) && !action.note.trim()) throw new Error('调整系统建议的最终计价人天时，请填写调整原因。');
    if (review.effort) (review.history ??= []).push({ at: now, author: actor.name, effort: structuredClone(review.effort), basis: structuredClone(review.basis) });
    review.effort = { lines, fingerprint: projectReviewFingerprint(p),
      stage: p.status === '进行中' ? '过程' : '最终', note: action.note.trim(), author: actor.name, at: now };
    review.basis = carriedBasis(next, ctx, now, actor.name);
    const confirmation = review.confirmations.at(-1);
    if (confirmation && !confirmation.invalidatedAt && (!confirmation.fingerprint || confirmation.fingerprint !== projectConfirmationFingerprint(next))) {
      confirmation.invalidatedAt = now;
    }
    title = '核定项目人天';
  } else if (action.type === 'basis') {
    if (!basisOwner) throw new Error('服务依据由内部申请人或当前客户所有人关联。');
    if (waiting || p.status === '待确认') throw new Error('审批或客户确认中，暂不能调整服务依据。');
    if (!review.effort || projectReviewStale(p)) throw new Error('请先按最新工时核定人天。');
    if (new Set(action.allocations.map(a => a.assetId)).size !== action.allocations.length) throw new Error('不能重复关联同一资产。');
    (review.history ??= []).push({ at: now, author: actor.name, effort: structuredClone(review.effort), basis: structuredClone(review.basis) });
    const allocations = action.allocations.map(input => {
      const asset = ctx.assets.find(a => a.id === input.assetId && a.customerId === p.customerId && ['启用', '使用中'].includes(a.status));
      const method = asset && assetDayMethod(asset);
      if (!asset || !method || !isDayQuantity(input.days) || input.days <= 0) throw new Error('请选择有效的远程或现场资产，关联人天须为正数且最多一位小数。');
      return { assetId: asset.id, name: asset.name, days: input.days, method };
    });
    for (const method of ['远程', '现场']) if (sumDays(allocations.filter(a => a.method === method).map(a => a.days)) > sumDays(review.effort.lines.filter(l => l.method === method).map(l => l.billableDays))) throw new Error(`${method}资产关联人天不能超过该类计价人天。`);
    for (const allocation of allocations) {
      const asset = ctx.assets.find(a => a.id === allocation.assetId)!;
      const available = projectAssetAvailable(p, asset, ctx);
      if (available === null || allocation.days > available) throw new Error(`${asset.name}：可用人天不足，请重新关联。`);
    }
    const capacities = projectReviewCapacities(p, ctx);
    for (const allocation of allocations) { const row = capacities.find(a => a.assetId === allocation.assetId); if (row) row.days = Math.max(row.days, allocation.days); else capacities.push(allocation); }
    for (const method of ['远程', '现场']) {
      const old = sumDays(projectReviewCapacities(p, ctx).filter(a => a.method === method).map(a => a.days));
      const limit = Math.max(old, sumDays(review.effort.lines.filter(l => l.method === method).map(l => l.billableDays)));
      if (sumDays(capacities.filter(a => a.method === method).map(a => a.days)) > limit) throw new Error(`${method}补充额度超过待覆盖人天。`);
    }
    // Association supplements the inherited authorization; it never erases it.
    review.basis = { id: review.basis?.id ?? crypto.randomUUID(), capacities, allocations: allocateProjectAssets(review.effort.lines, capacities), entitlementAllocations: effortEntitlementAllocations(review.effort.lines), at: now, author: actor.name };
    review.confirmations.forEach(c => { c.invalidatedAt ??= now; });
    assertBasis(next, ctx);
    title = '关联项目服务依据';
  } else if (action.type === 'gap-submit') {
    if (!basisOwner) throw new Error('仅内部申请人或当前客户所有人可发起特批。');
    if (action.method !== '远程' && action.method !== '现场') throw new Error('请选择远程或现场服务方式。');
    if (!isDayQuantity(action.days) || action.days <= 0 || action.days > 100000) throw new Error('申请人天须大于 0，按 0.1 粒度填写且不超过 100000。');
    if (currentProjectReviewApproval(next)?.state === '待审批') throw new Error('已有额度审批处理中，请待审批结束后再提交。');
    if (!action.reason.trim()) throw new Error('请填写申请理由。');
    const gaps = [{ method: action.method, days: action.days }];
    const planId = crypto.randomUUID();
    const workflow = createApprovalExecution(projectApprovalRequest(next, ctx, actor, planId, gaps), ctx.rules, ctx.users, ctx.customers, now);
    if (!isDemoAdministrator(actor, ctx.users) && workflow.steps.some(step => step.approverId === actor.id)) throw new Error('审批流程不能包含申请人本人，请调整审批配置。');
    review.approvals.push({ id: crypto.randomUUID(), planId, independent: true, days: action.days, gaps, reason: action.reason.trim(), authorId: actor.id, author: actor.name,
      approverId: workflow.steps[0].approverId, approver: workflow.steps[0].approver, at: now, state: '待审批', workflow });
    title = '发起项目额度特批';
  } else if (action.type === 'gap-decide') {
    const approval = matchingApprovals(next).find(a => a.id === action.id && a.state === '待审批');
    if (!approval?.workflow || !action.note.trim()) throw new Error('审批已变更或缺少审批意见。');
    decideApprovalExecution(approval, actor, ctx.users, action.approve, action.note, now);
    title = action.approve ? '项目额度审批通过' : '项目额度审批拒绝';
  } else if (action.type === 'confirm') {
    if (p.status !== '待复核') throw new Error('仅可在待复核阶段发起客户确认。');
    if (waiting) throw new Error('请先完成正在进行的额度审批，再发起客户确认。');
    const issue = projectReviewIssue(p); if (issue) throw new Error(issue);
    if (review.effort?.stage === '过程') throw new Error('请先确认最终人天核定。');
    assertBasis(next, ctx);
    if (!projectReviewCovered(next, ctx)) throw new Error('服务依据不足，请先完成额度特批。');
    if (!p.collaborators?.customer?.some(person => ctx.contacts.some(c => c.id === person.id && c.customerId === p.customerId && c.status === '启用'))) throw new Error('请先添加有效的客户协作人。');
    const previous = review.confirmations.at(-1);
    if (previous && !previous.invalidatedAt && previous.state !== '已拒绝' && previous.fingerprint === projectConfirmationFingerprint(next)) {
      next.status = '待确认'; title = '沿用客户确认';
    } else {
    if (previous && previous.state !== '已拒绝') previous.invalidatedAt ??= now;
    review.confirmations.push({ changes: projectConfirmationChanges(next), ...projectConfirmationContent(next), fingerprint: projectConfirmationFingerprint(next), id: crypto.randomUUID(), at: now, by: actor.name, note: action.note.trim(), allocations: structuredClone(review.basis!.allocations), entitlementAllocations: structuredClone(review.basis!.entitlementAllocations), state: '待确认' });
    next.status = '待确认'; title = '发起项目客户确认';
    }
  } else if (action.type === 'customer-decision') {
    const confirmation = review.confirmations.at(-1);
    if (p.status !== '待确认' || confirmation?.id !== action.confirmationId || confirmation.state !== '待确认' || confirmation.invalidatedAt) throw new Error('客户确认已更新，请重新打开项目。');
    if (!action.accepted && !action.reason.trim()) throw new Error('请填写拒绝原因。');
    if (action.accepted && projectCustomerConfirmationStale(p)) throw new Error('工时或交付内容已变化，请重新核定后确认。');
    if (action.accepted) { assertBasis(next, ctx); if (!projectReviewCovered(next, ctx)) throw new Error('当前服务依据不足，暂不能确认。'); }
    Object.assign(confirmation, { state: action.accepted ? '已确认' : '已拒绝', decidedAt: now, decidedBy: isDemoAdministrator(actor) ? `${actor.name}（管理员代确认）` : actor.name, reason: action.reason.trim() });
    if (action.accepted) settleConfirmedProject(next, ctx, now);
    else next.status = '待复核';
    title = action.accepted ? '客户确认通过，自动完成项目并核销服务资产' : '客户拒绝项目确认';

  }
  if (action.type === 'confirm' && action.mail) { recordConfirmationMail(next, action, actor, ctx, now); title = '发送项目报告并发起确认（本地）'; }
  next.revision++; next.updatedAt = now;
  return appendProjectActivity(next, actor, '复核', title, '', now, customer || action.type === 'confirm');
}
function applyPartnerConfirmation(p: ServiceProjectRecord, action: ProjectReviewAction, actor: OperationActor, ctx: ProjectReviewContext, now: string): ServiceProjectRecord {
  if (!['confirm', 'customer-decision'].includes(action.type)) throw new Error('合作伙伴创建的项目无需人天复核、服务依据关联或额度审批。');
  if (['待启动', '已完成', '已取消', '已暂停'].includes(p.status)) throw new Error('当前项目阶段不能处理客户确认。');
  if (action.type === 'customer-decision') {
    if (!isDemoAdministrator(actor, ctx.users) && (actor.role !== '客户' || !p.collaborators?.customer?.some(person => person.id === actor.id) ||
      !ctx.contacts.some(person => person.id === actor.id && person.customerId === p.customerId && person.status === '启用') ||
      !ctx.customers.some(customer => customer.id === p.customerId && customer.status === '启用'))) throw new Error('仅本项目有效客户协作人可以确认项目。');
  } else {
    if (!canInitiateProjectConfirmation(p, actor, ctx)) throw new Error('当前身份无权或账号已失效；仅项目创建人、负责项目经理、已指派工单的有效执行工程师或系统管理员可以发起确认。');
    if (actor.role === '合作伙伴服务工程师') {
      const user = ctx.partnerUsers?.find(person => person.id === actor.id && person.status === '启用');
      if (!user || p.serviceProviderId !== `partner:${user.partnerId}` || !ctx.partners?.some(partner => partner.id === user.partnerId && partner.status === '启用')) throw new Error('合作伙伴账号或所属企业已失效。');
    } else if (fixedIdentityRoles[actor.id] !== actor.role || !ctx.users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('操作人已失效。');
  }
  const next = structuredClone(p), review = next.review = structuredClone(projectReviewOf(p));
  const confirmation = review.confirmations.at(-1);
  let title = '';
  if (action.type === 'confirm') {
    if (!['进行中', '待复核'].includes(p.status) && !(p.status === '待确认' && projectCustomerConfirmationStale(p))) throw new Error('当前项目已发起客户确认。');
    const issue = partnerProjectConfirmationIssue(p); if (issue) throw new Error(issue);
    if (!p.collaborators?.customer?.some(person => ctx.contacts.some(contact => contact.id === person.id && contact.customerId === p.customerId && contact.status === '启用'))) throw new Error('请先添加有效的客户协作人。');
    if (confirmation && confirmation.state !== '已拒绝') confirmation.invalidatedAt ??= now;
    review.confirmations.push({ ...projectConfirmationContent(next), fingerprint: projectConfirmationFingerprint(next), id: crypto.randomUUID(), at: now, by: actor.name, note: action.note.trim(), allocations: [], entitlementAllocations: [], state: '待确认' });
    next.status = '待确认'; title = '发起项目客户确认';
  } else if (action.type === 'customer-decision') {
    if (p.status !== '待确认' || confirmation?.id !== action.confirmationId || confirmation.state !== '待确认' || confirmation.invalidatedAt) throw new Error('客户确认已更新，请重新打开项目。');
    if (!action.accepted && !action.reason.trim()) throw new Error('请填写拒绝原因。');
    if (action.accepted && projectCustomerConfirmationStale(p)) throw new Error('项目交付内容已变化，请重新发起客户确认。');
    Object.assign(confirmation, { state: action.accepted ? '已确认' : '已拒绝', decidedAt: now, decidedBy: isDemoAdministrator(actor) ? `${actor.name}（管理员代确认）` : actor.name, reason: action.reason.trim() });
    next.status = action.accepted ? '已完成' : '进行中';
    title = action.accepted ? '客户确认通过，自动完成项目' : '客户拒绝项目确认';

  }
  if (action.type === 'confirm' && action.mail) { recordConfirmationMail(next, action, actor, ctx, now); title = '发送项目报告并发起确认（本地）'; }
  next.revision++; next.updatedAt = now;
  return appendProjectActivity(next, actor, '项目', title, '', now, true);
}

export function updateProjectReviewReservations(p: ServiceProjectRecord, ctx: ProjectReviewContext) {
  if (isPartnerCreatedProject(p)) return {
    assets: ctx.assets.map(asset => asset.projectReservations?.some(row => row.projectId === p.id) ? { ...asset, projectReservations: asset.projectReservations.filter(row => row.projectId !== p.id) } : asset),
    businessObjects: ctx.businessObjects.map(object => object.projectReservations?.some(row => row.projectId === p.id) ? { ...object, projectReservations: object.projectReservations.filter(row => row.projectId !== p.id) } : object),
  };
  const settled = p.review?.settlement;
  const basis = p.status === '已取消' || settled ? undefined : p.review?.basis;
  const inherited = sourceBasis(p, ctx)?.basis;
  const assets = ctx.assets.map(asset => {
    const rows = (asset.projectReservations ?? []).filter(row => row.projectId !== p.id);
    const days = Math.max(0, sumDays([...((basis?.capacities ?? basis?.allocations)?.filter(a => a.assetId === asset.id).map(a => a.days) ?? []), ...(inherited?.allocations.filter(a => a.assetId === asset.id).map(a => -a.days) ?? [])]));
    if (days) rows.push({ projectId: p.id, days });
    const consumptions = (asset.projectConsumptions ?? []).filter(row => row.projectId !== p.id);
    const consumed = sumDays(settled?.allocations.filter(a => a.assetId === asset.id).map(a => a.days) ?? []);
    if (consumed) consumptions.push({ projectId: p.id, days: consumed, at: settled!.at });
    return { ...asset, projectReservations: rows, projectConsumptions: consumptions };
  });
  const businessObjects = ctx.businessObjects.map(object => {
    const rows = (object.projectReservations ?? []).filter(row => row.projectId !== p.id);
    for (const kind of ['inspection', 'upgrade'] as const) {
      const quantity = Math.max(0, (basis?.entitlementAllocations ?? []).filter(a => a.objectId === object.id && a.kind === kind).reduce((s, a) => s + a.quantity, 0)
        - (inherited?.entitlementAllocations ?? []).filter(a => a.objectId === object.id && a.kind === kind).reduce((s, a) => s + a.quantity, 0));
      if (quantity) rows.push({ projectId: p.id, kind, quantity });
    }
    const consumptions = (object.projectConsumptions ?? []).filter(row => row.projectId !== p.id);
    for (const kind of ['inspection', 'upgrade'] as const) {
      const quantity = (settled?.entitlementAllocations ?? []).filter(a => a.objectId === object.id && a.kind === kind).reduce((s, a) => s + a.quantity, 0);
      if (quantity) consumptions.push({ projectId: p.id, kind, quantity, at: settled!.at });
    }
    return { ...object, projectReservations: rows, projectConsumptions: consumptions };
  });
  return { assets, businessObjects };
}

// Release the converted project's full source reservation in the same transaction
// that records its final consumption. Sibling projects retain their own shares.
export function settleProjectSource(p: ServiceProjectRecord, ctx: ProjectReviewContext): ServiceRequest | undefined {
  if (!p.review?.settlement || !p.sourceServiceRequestId || !p.requestConversion?.assessmentSnapshot?.basis) return undefined;
  const source = ctx.requests.find(r => r.id === p.sourceServiceRequestId);
  const snapshot = sourceBasis(p, ctx);
  if (!source || !snapshot?.basis) throw new Error('来源申请额度已变更，无法完成核销。');
  const active = activeRequestAssetAllocations(source);
  for (const row of snapshot.basis.allocations) if (row.days > sumDays(active.filter(a => a.assetId === row.assetId).map(a => a.days))) throw new Error('来源申请冻结额度不足，无法完成核销。');
  const entitlements = activeEntitlementAllocations(source);
  for (const row of snapshot.basis.entitlementAllocations ?? []) if (row.quantity > entitlements.filter(a => a.itemId === row.itemId && a.objectId === row.objectId && a.kind === row.kind).reduce((s, a) => s + a.quantity, 0)) throw new Error('来源申请冻结权益不足，无法完成核销。');
  return { ...source, projectReservationReleases: [...(source.projectReservationReleases ?? []), {
    projectId: p.id, planId: snapshot.basis.id, at: p.review.settlement.at,
    assetAllocations: structuredClone(snapshot.basis.allocations), entitlementAllocations: structuredClone(snapshot.basis.entitlementAllocations ?? []), invalidatedApprovals: [],
  }] };
}

function recordConfirmationMail(project: ServiceProjectRecord, action: Extract<ProjectReviewAction, { type: 'confirm' }>, actor: OperationActor, ctx: ProjectReviewContext, now: string) {
  const confirmation = project.review!.confirmations.at(-1)!;
  if (confirmation.state !== '待确认' || confirmation.reportId) throw new Error('此确认版本已关联报告，请沿用原确认邮件。');
  if (action.mail?.kind !== 'project' || action.mail.projectDocument) throw new Error('客户确认须使用项目报告邮件。');
  const emailTemplate = canonicalMailTemplate(ctx.mailTemplates ?? parseMailConfig(undefined), 'review', action.mail.emailTemplate, ctx.customers.find(customer => customer.id === project.customerId)?.name ?? project.customerId);
  const report = buildProjectDailyReport(project, actor, { ...action.mail, emailTemplate }, now);
  report.confirmation = { id: confirmation.id, notice: reportMailText(report, project.name).confirmationNotice };
  project.dailyReports = [...(project.dailyReports ?? []), report];
  confirmation.reportId = report.id;
}
