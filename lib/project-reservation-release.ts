import type { AssetAllocation, GapApproval } from './request-assessment';
import type { EntitlementAllocation } from './request-entitlement-reservations';
import type { ServiceRequest } from './service-requests';
import { sumDays } from './day-quantity.ts';

export type ProjectReservationRelease = {
  projectId: string;
  planId: string;
  at: string;
  assetAllocations: AssetAllocation[];
  entitlementAllocations: EntitlementAllocation[];
  invalidatedApprovals: Pick<GapApproval, 'id' | 'days' | 'gaps'>[];
};
export function activeRequestAssetAllocations(record: ServiceRequest): AssetAllocation[] {
  const plan = record.operations?.assessment?.plans?.at(-1);
  if (!plan || plan.releasedAt || record.status === '已取消') return [];
  const releases = record.projectReservationReleases?.filter(release => release.planId === plan.id) ?? [];
  return plan.allocations.map(asset => ({ ...asset, days: Math.max(0, sumDays([asset.days,
    ...releases.flatMap(release => release.assetAllocations.filter(entry => entry.assetId === asset.assetId).map(entry => -entry.days))])) }))
    .filter(asset => asset.days > 0);
}
