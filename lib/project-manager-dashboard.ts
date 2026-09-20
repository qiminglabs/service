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

export type EngineerAssignment = {
  project: ServiceProjectRecord;
  order: import('./service-work-orders').ServiceWorkOrder;
};
export type ExecutingEngineer = {
  key: string;
  id: string;
  name: string;
  group: 'internal' | 'partner';
  projectCount: number;
  assignments: EngineerAssignment[];
};

// An omitted manager selects all accessible projects for the administrator.
// Otherwise determine people from the manager's own portfolio, then count their
// unfinished assignments across every accessible project, regardless of owner.
export function executingEngineers(
  projects: ServiceProjectRecord[],
  managerId?: string,
): ExecutingEngineer[] {
  const active = projects.filter(activeDashboardProject);
  const unfinished = (
    order: import('./service-work-orders').ServiceWorkOrder,
  ) => !['已完成', '已取消'].includes(order.status);
  const people = new Map<string, ExecutingEngineer>();
  for (const project of active) {
    if (
      managerId !== undefined &&
      !project.collaborators?.internal?.some(
        (person) =>
          person.id === managerId &&
          person.assignmentRoles?.includes('项目经理'),
      )
    )
      continue;
    for (const order of (project.workOrders ?? []).filter(unfinished)) {
      for (const person of assignedEngineers(order)) {
        const key = `${person.group}:${person.id}`;
        if (!people.has(key))
          people.set(key, { ...person, key, projectCount: 0, assignments: [] });
      }
    }
  }
  for (const project of active) {
    for (const order of (project.workOrders ?? []).filter(unfinished)) {
      for (const key of new Set(
        assignedEngineers(order).map(
          (person) => `${person.group}:${person.id}`,
        ),
      )) {
        people.get(key)?.assignments.push({ project, order });
      }
    }
  }
  for (const person of people.values()) {
    person.projectCount = new Set(
      person.assignments.map((row) => row.project.id),
    ).size;
    person.assignments.sort(
      (a, b) =>
        (a.order.expectedServiceDate || '9999').localeCompare(
          b.order.expectedServiceDate || '9999',
        ) || a.order.id.localeCompare(b.order.id),
    );
  }
  return [...people.values()].sort(
    (a, b) =>
      b.assignments.length - a.assignments.length ||
      a.name.localeCompare(b.name, 'zh-CN'),
  );
}

// Ordinals keep date-only schedules independent of local daylight-saving shifts.
export function scheduleDay(value: string | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    return null;
  return Math.floor(date.getTime() / 86400000);
}
export function assignmentSchedule(assignment: EngineerAssignment) {
  const start = scheduleDay(assignment.order.expectedServiceDate);
  const end = scheduleDay(assignment.order.plannedCompletionDate);
  return start !== null && end !== null && end >= start ? { start, end } : null;
}

export function earliestEngineerScheduleDay(
  team: ExecutingEngineer[],
  fallback: number,
) {
  let earliest: number | undefined;
  for (const person of team) {
    for (const assignment of person.assignments) {
      const schedule = assignmentSchedule(assignment);
      if (schedule)
        earliest =
          earliest === undefined
            ? schedule.start
            : Math.min(earliest, schedule.start);
    }
  }
  return earliest ?? fallback;
}

export type GanttView = 'week' | 'month';
export function ganttWindow(anchor: number, view: GanttView) {
  const date = new Date(anchor * 86400000);
  const start =
    view === 'week'
      ? anchor - ((date.getUTCDay() + 6) % 7)
      : Math.floor(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1) / 86400000,
        );
  const end =
    view === 'week'
      ? start + 6
      : Math.floor(
          Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0) / 86400000,
        );
  return { start, end, days: end - start + 1 };
}
export function moveGanttAnchor(
  anchor: number,
  view: GanttView,
  direction: -1 | 1,
) {
  if (view === 'week') return anchor + direction * 7;
  const date = new Date(anchor * 86400000);
  const month = date.getUTCMonth() + direction;
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), month + 1, 0),
  ).getUTCDate();
  return Math.floor(
    Date.UTC(
      date.getUTCFullYear(),
      month,
      Math.min(date.getUTCDate(), lastDay),
    ) / 86400000,
  );
}
export function ganttBarRange(
  schedule: { start: number; end: number },
  window: { start: number; end: number; days: number },
) {
  if (schedule.end < window.start || schedule.start > window.end) return null;
  const start = Math.max(schedule.start, window.start),
    end = Math.min(schedule.end, window.end);
  return {
    left: ((start - window.start) / window.days) * 100,
    width: ((end - start + 1) / window.days) * 100,
  };
}
