import {
  projectScheduleIssue,
  type ProjectSchedule,
} from './service-project-dates.ts';
import {
  canViewServiceProject,
  type ServiceProjectRecord,
} from './service-projects.ts';
import { assignedEngineers } from './service-work-orders.ts';
import { engineerKey } from './work-order-assignment.ts';
import type { OperationActor } from './request-operations';

export type AssignmentPeriod = {
  start: string;
  end: string;
  source: 'order' | 'project';
};
export function assignmentPeriod(
  project: ProjectSchedule,
  order: ProjectSchedule,
): AssignmentPeriod | null {
  if (!projectScheduleIssue(order, true))
    return {
      start: order.expectedServiceDate,
      end: order.plannedCompletionDate!,
      source: 'order',
    };
  // An incomplete or invalid order range is not silently replaced with a different range.
  if (
    !order.expectedServiceDate &&
    !order.plannedCompletionDate &&
    !projectScheduleIssue(project, true)
  ) {
    return {
      start: project.expectedServiceDate,
      end: project.plannedCompletionDate!,
      source: 'project',
    };
  }
  return null;
}
export type AssignmentScheduleEntry = {
  key: string;
  projectName: string;
  orderName: string;
  period: AssignmentPeriod;
  engineerKeys: string[];
};
export function assignmentScheduleEntries(
  projects: ServiceProjectRecord[],
  actor: OperationActor,
  targetProjectId: string,
  targetOrderIds: string[],
): AssignmentScheduleEntry[] {
  return projects.flatMap((project, projectIndex) => {
    if (['已完成', '已取消'].includes(project.status)) return [];
    const visible = canViewServiceProject(actor, project);
    return (project.workOrders ?? []).flatMap((order, orderIndex) => {
      if (
        ['已完成', '已取消'].includes(order.status) ||
        (project.id === targetProjectId && targetOrderIds.includes(order.id))
      )
        return [];
      const period = assignmentPeriod(project, order);
      const engineerKeys = [
        ...new Set(assignedEngineers(order).map(engineerKey)),
      ];
      if (!period || !engineerKeys.length) return [];
      return [
        {
          key: `${projectIndex}:${orderIndex}`,
          projectName: visible ? project.name : '其他项目',
          orderName: visible ? order.item.serviceName : '已安排工单',
          period,
          engineerKeys,
        },
      ];
    });
  });
}
export function assignmentOverlaps(
  periods: AssignmentPeriod[],
  selectedKeys: string[],
  entries: AssignmentScheduleEntry[],
) {
  return [...new Set(selectedKeys)].flatMap((key) => {
    const orders = entries
      .filter((entry) => entry.engineerKeys.includes(key))
      .flatMap((entry) => {
        const intersections = periods
          .flatMap((period) => {
            const start =
              period.start > entry.period.start
                ? period.start
                : entry.period.start;
            const end =
              period.end < entry.period.end ? period.end : entry.period.end;
            return start <= end ? [{ start, end }] : [];
          })
          .sort((a, b) => a.start.localeCompare(b.start));
        const ranges: Array<{ start: string; end: string }> = [];
        for (const range of intersections) {
          const last = ranges.at(-1);
          if (last && range.start <= last.end)
            last.end = last.end > range.end ? last.end : range.end;
          else ranges.push({ ...range });
        }
        return ranges.length ? [{ ...entry, ranges }] : [];
      })
      .sort((a, b) => a.ranges[0].start.localeCompare(b.ranges[0].start));
    return orders.length ? [{ key, orders }] : [];
  });
}
