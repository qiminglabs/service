import type { ObjectRef, ServiceRequest } from './service-requests';
import type { EffortPricingLine } from './request-pricing';
export type EntitlementAllocation = { itemId: string; objectId: string; name: string; kind: 'inspection' | 'upgrade'; quantity: number };
export const entitlementLabel = (kind: EntitlementAllocation['kind']) => kind === 'inspection' ? '巡检权益' : '升级权益';
export function effortEntitlementAllocations(lines: EffortPricingLine[] = []): EntitlementAllocation[] {
  return lines.flatMap(line => line.kind === 'entitlement' && line.entitlementKind
    ? (line.entitlementObjects ?? []).flatMap(object => object.nodes - object.deficit > 0
      ? [{ itemId: line.itemId, objectId: object.objectId, name: object.name, kind: line.entitlementKind!, quantity: object.nodes - object.deficit }] : []) : []);
}
export function activeEntitlementAllocations(record: ServiceRequest): EntitlementAllocation[] {
  if (record.status === '已取消') return [];
  const assessment = record.operations?.assessment;
  const plan = assessment?.plans.at(-1);
  if (!plan || plan.releasedAt) return [];
  const released = record.projectReservationReleases?.filter(release => release.planId === plan.id).flatMap(release => release.entitlementAllocations) ?? [];
  return (plan.entitlementAllocations ?? effortEntitlementAllocations(assessment?.effort?.lines)).map(allocation => ({ ...allocation,
    quantity: Math.max(0, allocation.quantity - released.filter(entry => entry.itemId === allocation.itemId && entry.objectId === allocation.objectId && entry.kind === allocation.kind).reduce((sum, entry) => sum + entry.quantity, 0)),
  })).filter(allocation => allocation.quantity > 0);
}
export function entitlementAvailable(object: ObjectRef, kind: EntitlementAllocation['kind'], records: ServiceRequest[] = [], exceptId = ''): number | undefined {
  const balance = kind === 'inspection' ? object.inspectionEntitlement : object.upgradeEntitlement;
  if (typeof balance !== 'number' || !Number.isInteger(balance) || balance < 0) return undefined;
  const locked = records.filter(record => record.id !== exceptId && record.customerId === object.customerId)
    .flatMap(activeEntitlementAllocations).filter(allocation => allocation.objectId === object.id && allocation.kind === kind)
    .reduce((sum, allocation) => sum + allocation.quantity, 0);
  return Math.max(0, balance - locked);
}
export function entitlementLockIssue(record: ServiceRequest, records: ServiceRequest[], objects: ObjectRef[]): string | null {
  if (record.status === '已取消') return null;
  const assessment = record.operations?.assessment;
  const plan = assessment?.plans.at(-1);
  if (!plan || plan.releasedAt) return null;
  const expected = effortEntitlementAllocations(assessment?.effort?.lines);
  const allocations = activeEntitlementAllocations(record);
  if (JSON.stringify(expected) !== JSON.stringify(allocations)) return '权益冻结明细与核定结果不一致，请重新进行服务依据关联。';
  const sums = new Map<string, number>();
  for (const allocation of allocations) {
    const object = objects.find(object => object.id === allocation.objectId && object.customerId === record.customerId && object.status === '启用' && object.product === 'SMTX OS 系统');
    if (!object || !Number.isInteger(allocation.quantity) || allocation.quantity <= 0) return '权益对应业务对象或冻结数量无效，请重新核定。';
    const key = `${allocation.objectId}:${allocation.kind}`;
    const total = (sums.get(key) ?? 0) + allocation.quantity;
    sums.set(key, total);
    const available = entitlementAvailable(object, allocation.kind, records, record.id);
    if (available === undefined || total > available) return `${object.name}的${entitlementLabel(allocation.kind)}可用数量不足或已被占用，请重新完成人天核定后进行服务依据关联。`;
  }
  return null;
}
