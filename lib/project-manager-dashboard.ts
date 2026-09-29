import type { ServiceProjectRecord } from './service-projects';
import { assignedEngineers } from './service-work-orders.ts';
import {
  pendingProjectWorklogs,
  type ProjectReviewContext,
} from './service-project-review.ts';
import { projectAssetBasisRows } from './service-project-basis-rows.ts';
import { projectWorklogPricing } from './project-worklog-pricing.ts';
import { sumDays } from './day-quantity.ts';
import { isPartnerCreatedProject } from './service-project-work-order-policy.ts';
import type { ServiceProviderConfig } from './service-provider-settings';

export type ProjectDashboardContext = ProjectReviewContext & {
  serviceProviders?: ServiceProviderConfig;
};

export const activeDashboardProject = (project: ServiceProjectRecord) =>
  !['已完成', '已取消'].includes(project.status);
export const projectOverdue = (project: ServiceProjectRecord, today: string) =>
  activeDashboardProject(project) &&
  !!project.plannedCompletionDate &&
  project.plannedCompletionDate < today;
export function projectProgress(project: ServiceProjectRecord) {
  const orders = (project.workOrders ?? []).filter(
    (order) => order.status !== '已取消',
  );
  const steps = orders.flatMap((order) => order.steps ?? []);
  const completed = steps.filter(
    (step) => step.status === '已完成' || step.status === '已跳过',
  ).length;
  return {
    total: steps.length,
    completed,
    percent: steps.length ? Math.round((completed / steps.length) * 100) : 0,
  };
}
export function projectFollowups(project: ServiceProjectRecord): string[] {
  if (!activeDashboardProject(project) || project.status === '已暂停')
    return [];
  const result: string[] = [];
  if (project.status === '待启动') result.push('项目启动');
  if (
    project.status === '进行中' &&
    project.workOrders?.some(
      (order) =>
        ['待执行', '进行中'].includes(order.status) &&
        !assignedEngineers(order).length,
    )
  )
    result.push('工单派单');
  if (pendingProjectWorklogs(project).length) result.push('工时确认');
  if (project.status === '待复核') result.push('交付复核');
  if (
    project.status === '待确认' &&
    project.review?.confirmations.at(-1)?.state !== '已确认'
  )
    result.push('待客户确认');
  return result;
}
export function projectRisks(
  project: ServiceProjectRecord,
  today: string,
  context?: ProjectDashboardContext,
): string[] {
  if (!activeDashboardProject(project)) return [];
  const result: string[] = [];
  if (projectOverdue(project, today)) result.push('项目逾期');
  if (project.status === '已暂停') result.push('项目暂停');
  if (
    project.workOrders?.some(
      (order) =>
        !['已完成', '已取消'].includes(order.status) &&
        !!order.plannedCompletionDate &&
        order.plannedCompletionDate < today,
    )
  )
    result.push('工单逾期');
  const confirmation = project.review?.confirmations.at(-1);
  if (confirmation?.state === '已拒绝' && !confirmation.invalidatedAt)
    result.push('客户拒绝确认');
  if (context && projectServiceBasisInsufficient(project, context))
    result.push('服务依据不足');
  return result;
}

export function projectServiceBasisInsufficient(
  project: ServiceProjectRecord,
  context: ProjectDashboardContext,
): boolean {
  if (!activeDashboardProject(project)) return false;
  if (
    isPartnerCreatedProject(project) &&
    !context.serviceProviders?.entries.some(
      (entry) =>
        entry.enabled &&
        project.serviceProviderId === `partner:${entry.partnerId}`,
    )
  )
    return false;
  // Compare actual recorded labor, including unconfirmed logs. Entitlement and
  // unpriced logs are not hourly labor; pricing coefficients do not change it.
  const hours = (project.operations?.worklogs ?? []).reduce(
    (total, log) =>
      !log.voidedAt &&
      projectWorklogPricing(project, log, context.services).kind === 'hourly'
        ? total + log.hours
        : total,
    0,
  );
  if (hours <= 0) return false;
  // Use the same held quotas as the project's service basis, including valid
  // approved quotas, without double-counting inherited asset reservations.
  const days = sumDays(
    projectAssetBasisRows(project, context)
      .filter((row) => row.unit === '人天')
      .map((row) => row.held),
  );
  return hours - days * 8 > 1e-7;
}
