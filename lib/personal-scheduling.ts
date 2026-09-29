import {
  personalScheduleSnapshot,
  rangeSlots,
  type CalendarException,
  type ScheduleSnapshot,
} from './scheduling.ts';
import type { OperationActor } from './request-operations';

export type PersonalCalendarKind = '调休休息' | '加班上班';
export type PersonalCalendarAction =
  | {
      type: 'save';
      id?: string;
      kind: PersonalCalendarKind;
      start: string;
      end: string;
      note: string;
    }
  | { type: 'remove'; id: string };

export function canEditPersonalCalendar(
  entry: CalendarException,
  resourceKey: string,
  actorId: string,
) {
  return (
    entry.resourceKey === resourceKey &&
    entry.source === 'engineer' &&
    entry.createdById === actorId &&
    ['调休休息', '加班上班'].includes(entry.kind)
  );
}

export function applyPersonalCalendarAction(
  snapshot: ScheduleSnapshot,
  actor: OperationActor,
  action: PersonalCalendarAction,
) {
  // Resolve the enabled identity and resource inside the transaction; callers cannot choose a resource.
  const person = personalScheduleSnapshot(snapshot, actor).resources[0];
  const previous = action.id
    ? snapshot.data.exceptions.find((entry) => entry.id === action.id)
    : undefined;
  if (
    action.id &&
    (!previous || !canEditPersonalCalendar(previous, person.key, actor.id))
  )
    throw new Error('只能修改或撤销本人登记的调休、加班。');
  if (action.type !== 'save' && action.type !== 'remove')
    throw new Error('不支持的个人日历操作。');
  const data = structuredClone(snapshot.data);
  if (action.type === 'remove') {
    if (!previous) throw new Error('登记记录不存在。');
    data.exceptions = data.exceptions.filter(
      (entry) => entry.id !== previous.id,
    );
  } else {
    if (!['调休休息', '加班上班'].includes(action.kind))
      throw new Error('仅支持登记调休或加班。');
    rangeSlots(action.start, action.end);
    if (typeof action.note !== 'string' || action.note.length > 1000)
      throw new Error('备注不能超过 1000 字。');
    if (
      data.exceptions.some(
        (entry) =>
          entry.id !== previous?.id &&
          entry.resourceKey === person.key &&
          entry.start <= action.end &&
          entry.end >= action.start,
      )
    )
      throw new Error('所选日期已有个人日历事项，请调整日期或修改原登记。');
    const now = new Date().toISOString();
    const entry: CalendarException = {
      id: previous?.id ?? `personal:${crypto.randomUUID()}`,
      resourceKey: person.key,
      kind: action.kind,
      start: action.start,
      end: action.end,
      note: action.note.trim(),
      source: 'engineer',
      createdById: actor.id,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    data.exceptions = [
      ...data.exceptions.filter((item) => item.id !== entry.id),
      entry,
    ];
  }
  data.revision++;
  return data;
}
