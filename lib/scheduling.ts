import { operationIdentities, fixedIdentityRoles } from './internal-users.ts';
import {
  engineerKey,
  assignWorkOrders,
  assignmentCandidates,
  dispatchableWorkOrders,
  type AssignmentDirectory,
} from './work-order-assignment.ts';
import { assignedEngineers } from './service-work-orders.ts';
import {
  canViewServiceProject,
  type ServiceProjectRecord,
} from './service-projects.ts';
import { normalizeServiceProjectStatus } from './service-project-status.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { projectScheduleIssue } from './service-project-dates.ts';
import type { OperationActor } from './request-operations';

export const schedulingId = 'resource-scheduling:v1';
export type Slot = { date: string };
export type Resource = {
  key: string;
  id: string;
  group: 'internal' | 'partner';
  name: string;
  company: string;
  certifications: string[];
};
export type Booking = {
  id: string;
  resourceKey: string;
  projectId: string;
  orderId: string;
  start: string;
  end: string;
  slots: Slot[];
  note: string;
  cancelled?: boolean;
};
export type CalendarException = {
  id: string;
  resourceKey: string;
  start: string;
  end: string;
  kind:
    | '请假'
    | '培训'
    | '其他占用'
    | '节假日'
    | '调休上班'
    | '调休休息'
    | '加班上班';
  note: string;
  source?: 'engineer';
  createdById?: string;
  createdAt?: string;
  updatedAt?: string;
};
export type WorkCalendar = {
  weekdays: number[];
};
export type ScheduleData = {
  revision: number;
  calendar: WorkCalendar;
  exceptions: CalendarException[];
  bookings: Booking[];
};
export type ScheduleSnapshot = {
  data: ScheduleData;
  directory: AssignmentDirectory;
  projects: ServiceProjectRecord[];
  resources: Resource[];
};
export type PersonalScheduleSnapshot = Omit<ScheduleSnapshot, 'directory'>;
type ScheduleReadSnapshot = Pick<ScheduleSnapshot, 'data' | 'projects'>;
export const defaultSchedule = (): ScheduleData => ({
  revision: 0,
  calendar: {
    weekdays: [1, 2, 3, 4, 5],
  },
  exceptions: [],
  bookings: [],
});
export const scheduleToday = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(
    new Date(),
  );
export function dateNumber(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期。');
  const n = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value)
    throw new Error('日期无效。');
  return n / 86400000;
}
export const dateString = (n: number) =>
  new Date(n * 86400000).toISOString().slice(0, 10);
export const shiftDate = (date: string, offset: number) =>
  dateString(dateNumber(date) + offset);
export function weekStart(date: string) {
  const n = dateNumber(date);
  return dateString(n - ((new Date(n * 86400000).getUTCDay() + 6) % 7));
}
export type ScheduleView = 'week' | 'month';
export function scheduleViewWindow(date: string, view: ScheduleView) {
  const day = dateNumber(date);
  const start = view === 'week' ? weekStart(date) : `${date.slice(0, 7)}-01`;
  const nextMonth = new Date(day * 86400000);
  nextMonth.setUTCDate(1);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const end =
    view === 'week'
      ? shiftDate(start, 6)
      : dateString(nextMonth.getTime() / 86400000 - 1);
  return {
    start,
    end,
    dates: Array.from(
      { length: dateNumber(end) - dateNumber(start) + 1 },
      (_, i) => shiftDate(start, i),
    ),
  };
}
export function moveScheduleViewDate(
  date: string,
  view: ScheduleView,
  direction: -1 | 1,
) {
  if (view === 'week') return shiftDate(date, direction * 7);
  const value = new Date(dateNumber(date) * 86400000);
  const day = value.getUTCDate();
  value.setUTCDate(1);
  value.setUTCMonth(value.getUTCMonth() + direction);
  const start = dateString(value.getTime() / 86400000);
  const target = scheduleViewWindow(start, 'month');
  return shiftDate(start, Math.min(day, target.dates.length) - 1);
}
export function rangeSlots(start: string, end: string): Slot[] {
  const a = dateNumber(start),
    b = dateNumber(end);
  if (b < a) throw new Error('结束日期不能早于开始日期。');
  if (b - a > 92) throw new Error('一次最多安排 93 天。');
  return Array.from({ length: b - a + 1 }, (_, i) => ({
    date: dateString(a + i),
  }));
}
export const slotKey = (slot: Slot) => slot.date;
export function resourceDirectory(
  directory: AssignmentDirectory,
  today = scheduleToday(),
): Resource[] {
  const identities = operationIdentities(directory.users, directory);
  const people: Resource[] = [];
  for (const group of ['internal', 'partner'] as const) {
    const source =
      group === 'internal' ? directory.users : directory.partnerUsers;
    for (const user of source) {
      if (
        user.status !== '启用' ||
        !identities.some(
          (identity) =>
            identity.id === user.id &&
            identity.role ===
              (group === 'internal'
                ? 'SmartX 服务工程师'
                : '合作伙伴服务工程师'),
        )
      )
        continue;
      const company =
        group === 'internal'
          ? 'SmartX'
          : directory.partners.find(
              (p) =>
                p.id === ('partnerId' in user ? user.partnerId : '') &&
                p.status === '启用',
            )?.name;
      if (!company) continue;
      people.push({
        key: `${group}:${user.id}`,
        id: user.id,
        group,
        name: user.name,
        company,
        certifications: [
          ...new Set(
            directory.serviceCertifications
              .filter(
                (c) =>
                  c.holderType === group &&
                  c.userId === user.id &&
                  c.status === '启用' &&
                  c.expiresOn >= today,
              )
              .map((c) => c.certification),
          ),
        ],
      });
    }
  }
  return people.sort(
    (a, b) =>
      a.group.localeCompare(b.group) ||
      a.company.localeCompare(b.company, 'zh-CN') ||
      a.name.localeCompare(b.name, 'zh-CN'),
  );
}
export function assertScheduler(
  actor: OperationActor,
  directory: AssignmentDirectory,
) {
  if (
    !actor.id ||
    !['SmartX 系统管理员', 'SmartX 项目经理'].includes(actor.role) ||
    fixedIdentityRoles[actor.id] !== actor.role ||
    !directory.users.some(
      (user) => user.id === actor.id && user.status === '启用',
    )
  )
    throw new Error('当前身份不能访问服务调度。');
}
export function personalScheduleSnapshot(
  snapshot: ScheduleSnapshot,
  actor: OperationActor,
): PersonalScheduleSnapshot {
  const group =
    actor.role === 'SmartX 服务工程师'
      ? 'internal'
      : actor.role === '合作伙伴服务工程师'
        ? 'partner'
        : undefined;
  const authorized = operationIdentities(
    snapshot.directory.users,
    snapshot.directory,
  ).some(
    (identity) => identity.id === actor.id && identity.role === actor.role,
  );
  if (!actor.id || !group || !authorized)
    throw new Error('当前身份不能访问服务日历。');

  const resourceKey = `${group}:${actor.id}`;
  const resource = snapshot.resources.find((item) => item.key === resourceKey);
  if (!resource) throw new Error('当前服务工程师不可用。');
  const projects = snapshot.projects.filter((project) =>
    project.workOrders?.some((order) =>
      assignedEngineers(order).some(
        (person) => engineerKey(person) === resourceKey,
      ),
    ),
  );
  const projectIds = new Set(projects.map((project) => project.id));
  return {
    data: {
      ...snapshot.data,
      exceptions: snapshot.data.exceptions.filter(
        (exception) =>
          !exception.resourceKey || exception.resourceKey === resourceKey,
      ),
      bookings: snapshot.data.bookings.filter(
        (booking) =>
          booking.resourceKey === resourceKey &&
          projectIds.has(booking.projectId),
      ),
    },
    projects,
    resources: [resource],
  };
}
export const activeOrder = (
  project: ServiceProjectRecord,
  order: NonNullable<ServiceProjectRecord['workOrders']>[number],
) =>
  !['已完成', '已取消'].includes(project.status) &&
  !['已完成', '已取消'].includes(order.status);
export function bookingIsEffective(
  booking: Booking,
  projects: ServiceProjectRecord[],
  date: string,
  today = scheduleToday(),
) {
  if (booking.cancelled) return false;
  const project = projects.find((p) => p.id === booking.projectId),
    order = project?.workOrders?.find((o) => o.id === booking.orderId);
  if (!project || !order) return false;
  // Historical reservations remain visible. Completion/cancellation/reassignment releases future slots.
  return (
    date < today ||
    (activeOrder(project, order) &&
      assignedEngineers(order).some(
        (p) => engineerKey(p) === booking.resourceKey,
      ))
  );
}
function exceptionApplies(
  exception: CalendarException,
  resource: Resource,
  slot: Slot,
) {
  return (
    (!exception.resourceKey || exception.resourceKey === resource.key) &&
    exception.start <= slot.date &&
    exception.end >= slot.date
  );
}
const workingException = (exception: CalendarException) =>
  ['调休上班', '加班上班'].includes(exception.kind);
export function calendarState(
  data: ScheduleData,
  resource: Resource,
  slot: Slot,
) {
  const exceptions = data.exceptions.filter((e) =>
    exceptionApplies(e, resource, slot),
  );
  const personal = exceptions.filter((e) => e.resourceKey);
  const global = exceptions.filter((e) => !e.resourceKey);
  const dayOff = personal.find((e) => !workingException(e));
  const companyOff = global.find((e) => !workingException(e));
  if (dayOff)
    return { state: 'unavailable' as const, label: dayOff.kind, exceptions };
  // Personal working overrides a company holiday; global working overrides weekends.
  const working =
    personal.some(workingException) ||
    (!companyOff &&
      (global.some(workingException) ||
        data.calendar.weekdays.includes(
          new Date(`${slot.date}T00:00:00Z`).getUTCDay(),
        )));
  if (!working)
    return {
      state: 'unavailable' as const,
      label: companyOff?.kind ?? '休息',
      exceptions,
    };
  return { state: 'available' as const, label: '可用', exceptions };
}
export function slotState(
  snapshot: ScheduleReadSnapshot,
  resource: Resource,
  slot: Slot,
  today = scheduleToday(),
) {
  const calendar = calendarState(snapshot.data, resource, slot);
  const bookings = workOrderBookings(snapshot).filter(
    (b) =>
      b.resourceKey === resource.key &&
      bookingIsEffective(b, snapshot.projects, slot.date, today) &&
      b.start <= slot.date &&
      b.end >= slot.date &&
      isWorkDay(snapshot.data, resource, slot),
  );
  if (bookings.length)
    return {
      ...calendar,
      state: 'occupied' as const,
      label: '有排班',
      bookings,
    };
  return { ...calendar, bookings };
}
export function slotTotals(
  snapshot: ScheduleReadSnapshot,
  resources: Resource[],
  slot: Slot,
  today = scheduleToday(),
) {
  const result = {
    available: 0,
    occupied: 0,
    unavailable: 0,
  };
  for (const resource of resources)
    result[slotState(snapshot, resource, slot, today).state]++;
  return result;
}
export function workOrderBookings(snapshot: ScheduleReadSnapshot): Booking[] {
  return snapshot.projects.flatMap((project) =>
    (project.workOrders ?? []).flatMap((order) => {
      if (projectScheduleIssue(order, true)) return [];
      return assignedEngineers(order).map((person) => {
        const key = engineerKey(person);
        const previous = snapshot.data.bookings.findLast(
          (b) =>
            b.projectId === project.id &&
            b.orderId === order.id &&
            b.resourceKey === key,
        );
        return {
          id: `order:${JSON.stringify([project.id, order.id, key])}`,
          projectId: project.id,
          orderId: order.id,
          resourceKey: key,
          start: order.expectedServiceDate,
          end: order.plannedCompletionDate!,
          slots: [],
          note: previous?.note ?? '',
        };
      });
    }),
  );
}
export function isWorkDay(data: ScheduleData, resource: Resource, slot: Slot) {
  const state = calendarState(data, resource, slot);
  return (
    state.label !== '休息' &&
    !(state.label === '节假日' && !state.exceptions.some((e) => e.resourceKey))
  );
}
export function pendingOrders(
  snapshot: ScheduleSnapshot,
  actor: OperationActor,
  today = scheduleToday(),
) {
  return snapshot.projects
    .filter((p) => canViewServiceProject(actor, p))
    .flatMap((project) =>
      (project.workOrders ?? [])
        .filter((order) => activeOrder(project, order))
        .flatMap((order) => {
          const people = assignedEngineers(order),
            invalidDates = !!projectScheduleIssue(order, true);
          const overdue = !invalidDates && order.plannedCompletionDate! < today;
          return !people.length || invalidDates || overdue
            ? [
                {
                  project,
                  order,
                  label: !people.length
                    ? '未派人'
                    : invalidDates
                      ? '工单日期待完善'
                      : '工单逾期 · 待调整',
                  missing: invalidDates ? people : [],
                },
              ]
            : [];
        }),
    )
    .sort((a, b) =>
      (a.order.expectedServiceDate || '9999').localeCompare(
        b.order.expectedServiceDate || '9999',
      ),
    );
}
export function pendingProjects(
  snapshot: ScheduleSnapshot,
  actor: OperationActor,
  today = scheduleToday(),
) {
  const projects = new Map<string, ServiceProjectRecord>();
  for (const { project } of pendingOrders(snapshot, actor, today)) {
    if (!projects.has(project.id)) projects.set(project.id, project);
  }
  // Project-level dispatch always includes the full eligible set, including
  // assigned orders, exactly as selecting all in the project's batch dialog.
  return [...projects.values()].map((project) => ({
    project,
    orders: dispatchableWorkOrders(project),
  }));
}
function setOrderDates(
  project: ServiceProjectRecord,
  orderId: string,
  start: string,
  end: string,
  actor: OperationActor,
) {
  const now = new Date().toISOString();
  return appendProjectActivity(
    {
      ...project,
      revision: project.revision + 1,
      updatedAt: now,
      workOrders: project.workOrders!.map((o) =>
        o.id === orderId
          ? {
              ...o,
              expectedServiceDate: start,
              plannedCompletionDate: end,
              updatedAt: now,
            }
          : o,
      ),
    },
    actor,
    '工单',
    start ? '调整工单排期' : '取消工单排期',
    `${orderId}：${start ? `${start} 至 ${end}` : '清空计划执行和完成日期'}`,
    now,
    false,
  );
}
export type ScheduleAction =
  | {
      type: 'booking';
      booking: Omit<Booking, 'slots'>;
      projectRevision: number;
    }
  | { type: 'cancel'; id: string; projectRevision: number }
  | {
      type: 'exception';
      scope: 'personal' | 'global';
      exception: CalendarException;
    }
  | { type: 'remove-exception'; id: string }
  | { type: 'calendar'; calendar: WorkCalendar };
export function applyScheduleAction(
  snapshot: ScheduleSnapshot,
  actor: OperationActor,
  action: ScheduleAction,
  today = scheduleToday(),
): { data: ScheduleData; project?: ServiceProjectRecord } {
  assertScheduler(actor, snapshot.directory);
  const data = structuredClone(snapshot.data);
  let changedProject: ServiceProjectRecord | undefined;
  if (action.type === 'booking') {
    const input = action.booking;
    const old = workOrderBookings(snapshot).find((b) => b.id === input.id);
    if (
      old &&
      (old.projectId !== input.projectId || old.orderId !== input.orderId)
    )
      throw new Error('修改排期不能更换所属工单。');
    const project = snapshot.projects.find((p) => p.id === input.projectId),
      order = project?.workOrders?.find((o) => o.id === input.orderId);
    if (!project || !order || !canViewServiceProject(actor, project))
      throw new Error('工单不存在或无权排期。');
    if (project.revision !== action.projectRevision)
      throw new Error('工单已更新，请关闭后重新打开排期。');
    if (
      project.status !== '进行中' ||
      !['待执行', '进行中'].includes(order.status)
    )
      throw new Error('仅可安排进行中项目下待执行或进行中的工单。');
    const resource = snapshot.resources.find(
      (p) => p.key === input.resourceKey,
    );
    if (
      !resource ||
      !assignmentCandidates(project, snapshot.directory, today).some(
        (p) => engineerKey(p) === resource.key,
      )
    )
      throw new Error('请选择该工单服务方下的有效工程师。');
    const issue = projectScheduleIssue(
      { expectedServiceDate: input.start, plannedCompletionDate: input.end },
      true,
    );
    if (issue) throw new Error(issue);
    const days = rangeSlots(input.start, input.end);
    let people = assignedEngineers(order);
    if (old && old.resourceKey !== resource.key)
      people = people.filter((p) => engineerKey(p) !== old.resourceKey);
    if (!people.some((p) => engineerKey(p) === resource.key))
      people = [
        ...people,
        { id: resource.id, name: resource.name, group: resource.group },
      ];
    changedProject = assignWorkOrders(
      project,
      actor,
      { orderIds: [order.id], assignees: people },
      snapshot.directory,
    );
    // A shared work-order date change applies to every assigned engineer.
    for (const assignee of people) {
      const member = snapshot.resources.find(
        (r) => r.key === engineerKey(assignee),
      );
      if (!member) throw new Error('工单包含不可用工程师，请先调整派单。');
      const slots = days.filter((day) => isWorkDay(data, member, day));
      if (!slots.length)
        throw new Error(`${member.name}在所选日期内没有工作日。`);
      for (const day of slots) {
        const state = calendarState(data, member, day);
        if (state.state !== 'available')
          throw new Error(
            `${member.name} ${day.date}${state.label}，请选择其他日期。`,
          );
      }
    }
    changedProject = setOrderDates(
      changedProject,
      order.id,
      input.start,
      input.end,
      actor,
    );
    // Legacy reservations are retained as history; dates and capacity come only from work orders.
    data.bookings = [
      ...data.bookings.filter((b) => b.id !== input.id),
      {
        ...input,
        slots: [],
        note: input.note.trim(),
        cancelled: false,
      },
    ];
  } else if (action.type === 'cancel') {
    const booking = workOrderBookings(snapshot).find((b) => b.id === action.id);
    const project = snapshot.projects.find((p) => p.id === booking?.projectId);
    const order = project?.workOrders?.find((o) => o.id === booking?.orderId);
    if (
      !booking ||
      !project ||
      !order ||
      !canViewServiceProject(actor, project) ||
      !activeOrder(project, order)
    )
      throw new Error('工单不存在、已结束或无权操作。');
    if (project.revision !== action.projectRevision)
      throw new Error('工单已更新，请重新打开排期。');
    changedProject = setOrderDates(project, order.id, '', '', actor);
  } else if (action.type === 'exception') {
    const e = action.exception;
    if (action.scope === 'personal' && !e.resourceKey)
      throw new Error('请选择具体工程师，个人日历不能调整全部工程师。');
    if (action.scope === 'global' && e.resourceKey)
      throw new Error('全局日历仅用于全部工程师。');
    const previous = data.exceptions.find((item) => item.id === e.id);
    if (previous && !!previous.resourceKey !== !!e.resourceKey)
      throw new Error('不能更改日历事项的个人或全局范围。');
    rangeSlots(e.start, e.end);
    if (
      ![
        '请假',
        '培训',
        '其他占用',
        '节假日',
        '调休上班',
        '调休休息',
        '加班上班',
      ].includes(e.kind)
    )
      throw new Error('请选择有效的日历类型。');
    if (
      e.resourceKey &&
      !snapshot.resources.some((p) => p.key === e.resourceKey)
    )
      throw new Error('工程师已不可用。');
    if (!e.resourceKey && !['节假日', '调休上班'].includes(e.kind))
      throw new Error('全员日历仅支持节假日和调休上班。');
    data.exceptions = [
      ...data.exceptions.filter((item) => item.id !== e.id),
      { ...e, note: e.note.trim() },
    ];
  } else if (action.type === 'remove-exception') {
    data.exceptions = data.exceptions.filter((e) => e.id !== action.id);
  } else {
    const c = action.calendar;
    if (
      !c.weekdays.length ||
      c.weekdays.some((n) => !Number.isInteger(n) || n < 0 || n > 6)
    )
      throw new Error('请选择有效工作日。');
    data.calendar = { weekdays: [...new Set(c.weekdays)] };
  }
  data.revision++;
  return { data: normalizeScheduleData(data), project: changedProject };
}
// Older local records may contain half-day/time fields; retain their dates and history only.
function normalizeScheduleData(data: ScheduleData): ScheduleData {
  return {
    ...data,
    calendar: { weekdays: [...data.calendar.weekdays] },
    bookings: data.bookings.map((record) => {
      const { period: _period, ...booking } = record as Booking & {
        period?: unknown;
      };
      return {
        ...booking,
        slots: [...new Set(booking.slots.map((slot) => slot.date))].map(
          (date) => ({ date }),
        ),
      };
    }),
    exceptions: data.exceptions.map((record) => {
      const { period: _period, ...exception } = record as CalendarException & {
        period?: unknown;
      };
      return exception;
    }),
  };
}
export function scheduleFromRows(
  rows: { id: string; payload?: unknown }[],
  directory: AssignmentDirectory,
): ScheduleSnapshot {
  return {
    data: normalizeScheduleData(
      (rows.find((r) => r.id === schedulingId)?.payload as
        | ScheduleData
        | undefined) ?? defaultSchedule(),
    ),
    directory,
    resources: resourceDirectory(directory),
    projects: rows
      .filter(
        (r) =>
          r.id.startsWith('service-project:') &&
          (r.payload as ServiceProjectRecord)?.id &&
          r.id === `service-project:${(r.payload as ServiceProjectRecord).id}`,
      )
      .map((r) =>
        normalizeServiceProjectStatus(r.payload as ServiceProjectRecord),
      ),
  };
}
