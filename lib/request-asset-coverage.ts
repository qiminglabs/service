import type { ServiceRequest } from './service-requests';
import type { RequestAsset } from './request-operations';
import type { AssetAllocation, AssessmentPlan } from './request-assessment';
import { effortTotalsByMethod, roundDays } from './request-pricing.ts';

export type DayMethod = '远程' | '现场';
export type DayRequirement = { method: DayMethod; days: number };
export function assetDayMethod(asset: Pick<RequestAsset, 'name'>): DayMethod | undefined {
  const remote = asset.name.includes('远程'), onsite = asset.name.includes('现场');
  return remote === onsite ? undefined : remote ? '远程' : '现场';
}
export function requestDayRequirements(record: ServiceRequest): DayRequirement[] {
  const assessment = record.operations?.assessment;
  if (assessment?.effort?.lines?.length) {
    const totals = effortTotalsByMethod(record, assessment.effort.lines);
    if (totals.some(total => total.method === '未区分')) return [];
    return totals.map(total => ({ method: total.method as DayMethod, days: total.days }));
  }
  // An old total can only be classified when every request item has the same method.
  const methods = effortTotalsByMethod(record, (record.items ?? []).map(item => ({ itemId: item.id, serviceId: item.serviceId,
    serviceName: item.serviceName, estimatedDays: 0, billableDays: 0, priceCoefficient: 1 })));
  const days = assessment?.effort?.days ?? assessment?.plans.at(-1)?.effort;
  return methods.length === 1 && methods[0].method !== '未区分' && days !== undefined
    ? [{ method: methods[0].method as DayMethod, days }] : [];
}
export function coverageByMethod(requirements: DayRequirement[], allocations: AssetAllocation[]) {
  return requirements.map(requirement => {
    const lockedDays = roundDays(allocations.filter(allocation => (allocation.method ?? assetDayMethod(allocation)) === requirement.method)
      .reduce((sum, allocation) => sum + allocation.days, 0));
    return { ...requirement, lockedDays, gap: roundDays(Math.max(0, requirement.days - lockedDays)) };
  });
}
export function planDayGaps(plan?: AssessmentPlan): DayRequirement[] {
  return plan?.requirements ? coverageByMethod(plan.requirements, plan.allocations)
    .filter(row => row.gap > 0).map(row => ({ method: row.method, days: row.gap })) : [];
}
export function formatDayRequirements(requirements: DayRequirement[]) {
  return requirements.map(row => `${row.method} ${row.days} 人天`).join('、');
}
export function allocationMethodIssue(record: ServiceRequest, allocations: AssetAllocation[], assets: RequestAsset[]): string | null {
  const requirements = requestDayRequirements(record);
  if (!requirements.length) return '无法区分远程、现场计价人天，请先按服务方式重新核定人天。';
  const resolved: AssetAllocation[] = [];
  for (const allocation of allocations) {
    if (!Number.isFinite(allocation.days) || allocation.days <= 0) return '锁定人天必须为有效正数。';
    const asset = assets.find(asset => asset.id === allocation.assetId);
    const method = asset && assetDayMethod(asset);
    if (!asset || !method) return `${allocation.name} 无法识别人天类别，请选择远程或现场人天资产。`;
    if (allocation.method && allocation.method !== method) return `${asset.name} 人天类别已变更，请重新关联。`;
    if (!requirements.some(row => row.method === method)) return `本次没有${method}计价人天，不能锁定${method}资产。`;
    resolved.push({ ...allocation, method });
  }
  for (const row of coverageByMethod(requirements, resolved)) {
    if (row.lockedDays > row.days + 1e-8) return `${row.method}锁定人天不能超过${row.method}计价总人天 ${row.days} 人天。`;
  }
  return null;
}
