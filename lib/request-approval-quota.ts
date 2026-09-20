import type { GapApproval } from './request-assessment';
import type { ServiceRequest } from './service-requests';
import { planDayGaps, requestDayRequirements, type DayRequirement } from './request-asset-coverage.ts';
import { sumDays } from './day-quantity.ts';

export function effectiveRequestApprovals(record: ServiceRequest): GapApproval[] {
  const plan = record.operations?.assessment?.plans.at(-1);
  if (!plan || plan.releasedAt) return [];
  const approved = (record.operations?.assessment?.approvals ?? []).filter(row => row.planId === plan.id && row.state === '已通过');
  const legacy = approved.filter(row => !row.manualAmount).at(-1);
  return approved.filter(row => row.manualAmount || row === legacy);
}

export function requestApprovalRemaining(record: ServiceRequest): DayRequirement[] {
  const plan = record.operations?.assessment?.plans.at(-1);
  if (!plan || plan.releasedAt) return [];
  const requirements = plan.requirements ?? requestDayRequirements(record);
  const gaps = planDayGaps({ ...plan, requirements });
  const approvals = effectiveRequestApprovals(record);
  return gaps.map(gap => ({ ...gap, days: Math.max(0, sumDays([gap.days, ...approvals.map(approval => {
    const days = approval.gaps?.length
      ? sumDays(approval.gaps.filter(row => row.method === gap.method).map(row => row.days))
      : requirements.length === 1 ? approval.days : 0;
    return -days;
  })])) })).filter(gap => gap.days > 0);
}

export function requestApprovalRemainingDays(record: ServiceRequest): number {
  const plan = record.operations?.assessment?.plans.at(-1);
  if (!plan || plan.releasedAt) return 0;
  if (plan.requirements?.length || requestDayRequirements(record).length)
    return sumDays(requestApprovalRemaining(record).map(row => row.days));
  return Math.max(0, sumDays([plan.effort, ...plan.allocations.map(row => -row.days), ...effectiveRequestApprovals(record).map(row => -row.days)]));
}
