import { effectiveRequestApprovals } from './request-approval-quota.ts';
import type { Assessment, AssessmentPlan, GapApproval } from './request-assessment';
import type { ServiceRequest } from './service-requests';
import type { ProjectCreation } from './request-projects';
import { effortTotalsByMethod } from './request-pricing.ts';
import { assetDayMethod, type DayMethod, type DayRequirement } from './request-asset-coverage.ts';
import { effortEntitlementAllocations } from './request-entitlement-reservations.ts';
import { isDayQuantity, sumDays } from './day-quantity.ts';

export type ProjectRequestSnapshot = {
  version: 1;
  capturedAt: string;
  requestId: string;
  requestTitle: string;
  items: { id: string; name: string; method: string }[];
  effort?: Assessment['effort'];
  basis?: AssessmentPlan;
  approvals: (GapApproval & { sourceDays: number; sourceGaps?: DayRequirement[] })[];
};

// Allocate integer tenths using largest remainders. Stable group order breaks ties;
// every allocated tenth belongs to exactly one project and never exceeds its gap.
function distribute(days: number, remaining: number[]): number[] {
  if (!isDayQuantity(days)) throw new Error('服务依据人天精度无效，无法拆分项目。');
  const units = Math.round(days * 10), total = remaining.reduce((sum, value) => sum + value, 0);
  if (units > total) throw new Error('服务依据额度超过对应服务项的计价人天，无法拆分项目。');
  if (!units) return remaining.map(() => 0);
  const result = remaining.map(value => Math.floor(units * value / total));
  const order = remaining.map((value, index) => ({ index, remainder: units * value % total }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let rest = units - result.reduce((sum, value) => sum + value, 0);
  for (const { index } of order) if (rest > 0 && result[index] < remaining[index]) { result[index]++; rest--; }
  return result;
}

/** Called only inside the conversion transaction, never when reading a project. */
export function projectRequestSnapshots(record: ServiceRequest, creation: ProjectCreation): Map<string, ProjectRequestSnapshot> {
  const assessment = record.operations?.assessment;
  const effort = assessment?.effort;
  const latest = assessment?.plans?.at(-1);
  const plan = latest && !latest.releasedAt ? latest : undefined;
  const snapshots = creation.projects.map(project => {
    const ids = new Set(project.workOrders.map(order => order.sourceItemId));
    const items = record.items.filter(item => ids.has(item.id));
    const lines = effort?.lines?.filter(line => ids.has(line.itemId));
    // A legacy total without item-level pricing cannot be truthfully split.
    if (creation.projects.length > 1 && !effort?.lines?.length && (effort?.days || plan?.effort)) {
      throw new Error('请求缺少服务项人天核定明细，无法按项目拆分，请先补全核定记录。');
    }
    const snapshot: ProjectRequestSnapshot = {
      version: 1, capturedAt: creation.at, requestId: record.id, requestTitle: record.title,
      items: items.map(item => ({ id: item.id, name: item.serviceName, method: item.method })),
      ...(effort ? { effort: { ...effort, ...(effort.lines?.length ? {
        lines, days: sumDays((lines ?? []).map(line => line.billableDays)),
        estimatedDays: sumDays((lines ?? []).map(line => line.estimatedDays)),
      } : {}) } } : {}),
      approvals: [],
    };
    if (plan) {
      if (creation.projects.length > 1 && items.some(item => !lines?.some(line => line.itemId === item.id))) {
        throw new Error('请求缺少服务项人天核定明细，无法按项目拆分，请先补全核定记录。');
      }
      const requirements = effortTotalsByMethod(record, lines ?? []).filter(total => total.method !== '未区分')
        .map(total => ({ method: total.method as DayMethod, days: total.days }));
      snapshot.basis = { ...plan, effort: snapshot.effort?.days ?? plan.effort,
        requirements: effort?.lines?.length ? requirements : plan.requirements,
        allocations: [], entitlementAllocations: (plan.entitlementAllocations ?? effortEntitlementAllocations(effort?.lines)).filter(allocation => ids.has(allocation.itemId)) };
    }
    return snapshot;
  });
  // Without a split, preserve even older records exactly as they were captured.
  if (plan && snapshots.length === 1) {
    snapshots[0].basis = structuredClone(plan);
    snapshots[0].basis.entitlementAllocations ??= effortEntitlementAllocations(effort?.lines);
    snapshots[0].approvals = effectiveRequestApprovals(record).map(approval => ({ ...approval, sourceDays: approval.days, sourceGaps: approval.gaps }));
    return new Map([[creation.projects[0].id, structuredClone(snapshots[0])]]);
  }
  if (plan) {
    const remaining = new Map<DayMethod, number[]>();
    for (const method of ['远程', '现场'] as const) {
      remaining.set(method, snapshots.map(snapshot => Math.round(sumDays((snapshot.basis?.requirements ?? [])
        .filter(requirement => requirement.method === method).map(requirement => requirement.days)) * 10)));
    }
    const allocate = (days: number, method: DayMethod | undefined) => {
      if (!method) throw new Error('服务依据缺少远程或现场类别，无法拆分项目。');
      const capacities = remaining.get(method)!;
      const portions = distribute(days, capacities);
      portions.forEach((units, index) => { capacities[index] -= units; });
      return portions.map(units => units / 10);
    };
    for (const allocation of plan.allocations) {
      const method = allocation.method ?? assetDayMethod(allocation);
      allocate(allocation.days, method).forEach((days, index) => {
        if (days > 0) snapshots[index].basis!.allocations.push({ ...allocation, method, days });
      });
    }
    // Manual applications are additive; legacy whole-gap approvals retain their original semantics.
    for (const approval of effectiveRequestApprovals(record)) {
      const gaps = approval.gaps ?? (['远程', '现场'] as const).map(method => ({ method,
        days: sumDays(remaining.get(method)!.map(units => units / 10)) })).filter(gap => gap.days > 0);
      if (Math.abs(sumDays(gaps.map(gap => gap.days)) - approval.days) > 1e-8) {
        throw new Error('特批额度与分类人天不一致，无法拆分项目。');
      }
      const parts: DayRequirement[][] = snapshots.map(() => []);
      for (const gap of gaps) allocate(approval.manualAmount ? Math.min(gap.days, sumDays(remaining.get(gap.method)!.map(units => units / 10))) : gap.days, gap.method).forEach((days, index) => {
        if (days > 0) parts[index].push({ method: gap.method, days });
      });
      snapshots.forEach((snapshot, index) => {
        if (parts[index].length) snapshot.approvals.push({ ...approval, sourceDays: approval.days, sourceGaps: gaps,
          days: sumDays(parts[index].map(gap => gap.days)), gaps: parts[index] });
      });
    }
  }
  return new Map(creation.projects.map((project, index) => [project.id, structuredClone(snapshots[index])]));
}
