import {
  activeOrder,
  slotState,
  scheduleViewWindow,
  rangeSlots,
  type PersonalScheduleSnapshot,
} from './scheduling.ts';
import { assignedEngineers } from './service-work-orders.ts';
import { engineerKey } from './work-order-assignment.ts';

export function engineerWork(
  snapshot: PersonalScheduleSnapshot,
  today: string,
) {
  const person = snapshot.resources[0];
  if (!person) return [];
  return snapshot.projects
    .flatMap((project) =>
      (project.workOrders ?? [])
        .filter((order) =>
          assignedEngineers(order).some(
            (personAssigned) => engineerKey(personAssigned) === person.key,
          ),
        )
        .map((order) => {
          const active = activeOrder(project, order);
          const status =
            project.status === '已取消'
              ? '已取消'
              : project.status === '已暂停' && active
                ? '已暂停'
                : order.status;
          const completed = order.steps.filter((step) =>
            ['已完成', '已跳过'].includes(step.status),
          ).length;
          const nextStep =
            order.steps.find((step) => step.status === '进行中') ??
            order.steps.find((step) => step.status === '待执行');
          return {
            project,
            order,
            status,
            active,
            completed,
            total: order.steps.length,
            nextStep: nextStep?.definition.name,
            overdue:
              active &&
              !!order.plannedCompletionDate &&
              order.plannedCompletionDate < today,
          };
        }),
    )
    .sort(
      (a, b) =>
        Number(b.overdue) - Number(a.overdue) ||
        Number(b.active && b.status === '进行中') -
          Number(a.active && a.status === '进行中') ||
        (a.order.plannedCompletionDate || '9999').localeCompare(
          b.order.plannedCompletionDate || '9999',
        ) ||
        a.order.id.localeCompare(b.order.id),
    );
}

// Use effective personal day bookings, including working-day rules and release of future reservations.
export function engineerDayOrders(
  snapshot: PersonalScheduleSnapshot,
  date: string,
  today: string,
) {
  const person = snapshot.resources[0];
  return new Set(
    person
      ? slotState(snapshot, person, { date }, today).bookings.map((booking) =>
          JSON.stringify([booking.projectId, booking.orderId]),
        )
      : [],
  );
}

export const engineerWorkKey = (row: ReturnType<typeof engineerWork>[number]) =>
  JSON.stringify([row.project.id, row.order.id]);

export function engineerWorklogs(
  projects: import('./service-projects').ServiceProjectRecord[],
  actorId: string,
) {
  if (!actorId) return [];
  return projects
    .flatMap((project) =>
      (project.operations?.worklogs ?? [])
        .filter((log) => log.userId === actorId)
        .map((log) => ({
          project,
          log,
          order: project.workOrders?.find(
            (order) => order.id === log.workOrderId,
          ),
          status: log.voidedAt
            ? '已作废'
            : log.confirmedAt
              ? '已确认'
              : '待确认',
        })),
    )
    .sort(
      (a, b) =>
        b.log.date.localeCompare(a.log.date) ||
        (b.log.startTime || '').localeCompare(a.log.startTime || '') ||
        b.log.createdAt.localeCompare(a.log.createdAt),
    );
}

export function engineerWorklogTotals(
  rows: ReturnType<typeof engineerWorklogs>,
) {
  const active = rows.filter(({ log }) => !log.voidedAt);
  return {
    hours: active.reduce((total, { log }) => total + log.hours, 0),
    pending: active.filter(({ log }) => !log.confirmedAt).length,
  };
}

export type EngineerDateScope = 'day' | 'week' | 'month' | 'all';
export function engineerDateRange(date: string, scope: EngineerDateScope) {
  if (scope === 'all') return undefined;
  if (scope === 'day') return { start: date, end: date };
  const { start, end } = scheduleViewWindow(date, scope);
  return { start, end };
}

export function engineerWorkInRange(
  snapshot: PersonalScheduleSnapshot,
  rows: ReturnType<typeof engineerWork>,
  range: ReturnType<typeof engineerDateRange>,
  today: string,
) {
  if (!range) return rows;
  const keys = new Set<string>();
  for (const { date } of rangeSlots(range.start, range.end)) {
    for (const key of engineerDayOrders(snapshot, date, today)) keys.add(key);
  }
  return rows.filter((row) => keys.has(engineerWorkKey(row)));
}

export function groupEngineerProjects<
  T extends { project: import('./service-projects').ServiceProjectRecord },
>(rows: T[]) {
  const groups = new Map<string, { project: T['project']; rows: T[] }>();
  for (const row of rows) {
    let group = groups.get(row.project.id);
    if (!group) {
      group = { project: row.project, rows: [] };
      groups.set(row.project.id, group);
    }
    group.rows.push(row);
  }
  return [...groups.values()];
}

export function engineerWorklogsInRange(
  rows: ReturnType<typeof engineerWorklogs>,
  range: ReturnType<typeof engineerDateRange>,
) {
  return rows.filter(
    ({ log }) => !range || (log.date >= range.start && log.date <= range.end),
  );
}

export const engineerProjectPageSize = 10;

export function engineerProjectPage<T>(groups: T[], requestedPage: number) {
  const total = groups.length;
  const pages = Math.max(1, Math.ceil(total / engineerProjectPageSize));
  const page = Math.min(Math.max(1, requestedPage), pages);
  const offset = (page - 1) * engineerProjectPageSize;
  return {
    groups: groups.slice(offset, offset + engineerProjectPageSize),
    page,
    pages,
    total,
    start: total ? offset + 1 : 0,
    end: Math.min(offset + engineerProjectPageSize, total),
  };
}
