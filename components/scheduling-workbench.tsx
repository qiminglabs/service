'use client';
import { useI18n } from '@/lib/i18n/context';


import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UserRound,
  ArrowUpRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { DateField } from '@/components/date-field';
import { schedulingTransaction } from '@/lib/scheduling-store';
import {
  scheduleToday,
  scheduleViewWindow,
  moveScheduleViewDate,
  type ScheduleView,
  slotTotals,
  pendingProjects,
  type ScheduleSnapshot,
  type ScheduleAction,
  type CalendarException,
  type Resource,
  type WorkCalendar,
} from '@/lib/scheduling';
import { canAssignWorkOrders } from '@/lib/work-order-assignment';
import { WorkOrderAssignmentDialog } from '@/components/work-order-assignment-dialog';
import { SchedulingDayCell } from '@/components/scheduling-day-cell';
import type { CustomerRef } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

type CalendarOverviewPanel =
  | { kind: 'calendar' }
  | { kind: 'personal-calendar'; resourceKey?: string }
  | { kind: 'resource'; resource: Resource };
type Panel =
  | {
      kind: 'exception';
      scope: 'personal' | 'global';
      exception?: CalendarException;
      resourceKey?: string;
      date?: string;
      returnTo?: CalendarOverviewPanel;
    }
  | CalendarOverviewPanel;
function exceptionOverview(
  panel: Extract<Panel, { kind: 'exception' }>,
): CalendarOverviewPanel {
  return (
    panel.returnTo ?? {
      kind: panel.scope === 'personal' ? 'personal-calendar' : 'calendar',
    }
  );
}
type Props = {
  actor: OperationActor;
  customers: CustomerRef[];
  onOpen: (projectId: string, orderId: string) => void;
  onOpenProject: (projectId: string) => void;
};
const labels = {
  available: '可用',
  occupied: '有排班',
  unavailable: '不可用',
};
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : '操作失败，请重试。';

export function SchedulingWorkbench({
  actor,
  customers,
  onOpen,
  onOpenProject,
}: Props) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const [snapshot, setSnapshot] = useState<ScheduleSnapshot>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [anchor, setAnchor] = useState(scheduleToday);
  const [view, setView] = useState<ScheduleView>('week');
  const periodName = view === 'week' ? '周' : '月';
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('');
  const [company, setCompany] = useState('');
  const [cert, setCert] = useState('');
  const [panel, setPanel] = useState<Panel>();
  const [assignment, setAssignment] = useState<{
    projectId: string;
    orderIds: string[];
  }>();
  const [assignmentBusy, setAssignmentBusy] = useState(false);
  const assignmentProject = snapshot?.projects.find(
    (project) => project.id === assignment?.projectId,
  );
  const [pendingQuery, setPendingQuery] = useState('');
  const actorId = actor.id,
    actorRole = actor.role,
    actorName = actor.name;
  const mounted = useRef(false);
  const load = useCallback(async () => {
    try {
      const saved = await schedulingTransaction({
        id: actorId,
        role: actorRole,
        name: actorName,
      });
      if (mounted.current) {
        setSnapshot(saved);
        setError('');
      }
    } catch (cause) {
      if (mounted.current) setError(message(cause));
    }
  }, [actorId, actorRole, actorName]);
  useEffect(() => {
    mounted.current = true;
    void load();
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('resource-scheduling')
        : null;
    if (channel) channel.onmessage = () => void load();
    window.addEventListener('focus', load);
    return () => {
      mounted.current = false;
      channel?.close();
      window.removeEventListener('focus', load);
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const { start, end, dates } = useMemo(
    () => scheduleViewWindow(anchor, view),
    [anchor, view],
  );
  const slots = dates.map((date) => ({ date }));
  const filtered = (snapshot?.resources ?? []).filter(
    (p) =>
      (!group || p.group === group) &&
      (!company || p.company === company) &&
      (!cert || p.certifications.includes(cert)) &&
      `${p.name} ${p.company}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const totals = snapshot
    ? slots.map((slot) => slotTotals(snapshot, filtered, slot))
    : [];
  const pending = snapshot ? pendingProjects(snapshot, actor) : [];
  const pendingVisible = pending.filter(({ project, orders }) =>
    `${project.name} ${customers.find((c) => c.id === project.customerId)?.name ?? project.customerId} ${orders.map((order) => `${order.id} ${order.item.serviceName}`).join(' ')}`
      .toLowerCase()
      .includes(pendingQuery.trim().toLowerCase()),
  );
  async function save(action: ScheduleAction, revision: number) {
    const next = await schedulingTransaction(actor, { revision, action });
    setSnapshot(next);
    setPanel((current) =>
      current?.kind === 'exception' ? exceptionOverview(current) : undefined,
    );
    setNotice('已保存');
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('resource-scheduling')
        : null;
    channel?.postMessage('updated');
    channel?.close();
  }
  function close() {
    setPanel(undefined);
    void load();
  }
  const resetDate = (date: string) => {
    if (!date) return;
    setAnchor(date);
  };
  return (
    <div className="schedule-workbench">
      {localize(error && (
        <p className="sr-error" role="alert">
          {localize(error)}
        </p>
      ))}
      {localize(notice && (
        <div className="schedule-notice" role="status">
          {localize(notice)}
        </div>
      ))}
      <div className="schedule-layout">
        <aside className="schedule-pending">
          <div className="schedule-pending-title">
            <h2>
              {localize("待排事项")}{localize(' ')}
              <span aria-label={localizeMessage("{0} 个项目", [localize(pending.length)])}>
                {localize(pending.length)}
              </span>
            </h2>
          </div>
          <Input
            aria-label={localize("搜索待排项目")}
            placeholder={localize("搜索客户、项目或工单")}
            value={pendingQuery}
            onChange={(e) => setPendingQuery(e.target.value)}
          />
          <div className="schedule-pending-list">
            {localize(pendingVisible.map(({ project, orders }) => (
              <article key={project.id}>
                <div className="schedule-pending-project-heading">
                  <span className="schedule-project-type">{localize("服务项目")}</span>
                  <h3>{localize(project.name)}</h3>
                  <button
                    aria-label={localizeMessage("查看项目 {0}", [localize(project.name)])}
                    onClick={() => onOpenProject(project.id)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </div>
                <p>
                  {localize(customers.find((c) => c.id === project.customerId)?.name ||
                    project.customerId)}
                </p>
                <ul
                  className="schedule-pending-project-orders"
                  aria-label={localize("项目可指派工单")}
                >
                  {localize(orders.map((order) => (
                    <li key={order.id} title={localize(order.id)}>
                      {localize("工单：")}{localize(order.item.serviceName)}
                    </li>
                  )))}
                </ul>
                <small>
                  {localize(project.expectedServiceDate || '未定开始')} —{localize(' ')}
                  {localize(project.plannedCompletionDate || '未定完成')}
                </small>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={
                    assignmentBusy ||
                    !canAssignWorkOrders(project, actor) ||
                    !orders.length
                  }
                  onClick={() =>
                    setAssignment({
                      projectId: project.id,
                      orderIds: orders.map((order) => order.id),
                    })
                  }
                >
                  {localize("指派")}</Button>
              </article>
            )))}
            {localize(!pendingVisible.length && (
              <div className="schedule-empty">
                {localize(snapshot
                  ? pendingQuery
                    ? '暂无匹配项目'
                    : '暂无待排事项'
                  : '读取中…')}
              </div>
            ))}
          </div>
        </aside>
        <div className="schedule-main">
          <section className="schedule-board" aria-label={localize("工程师排期")}>
            <div className="schedule-toolbar">
              <div className="schedule-period">
                <div
                  className="schedule-view-switch"
                  role="group"
                  aria-label={localize("排期时间视图")}
                >
                  {localize((['week', 'month'] as const).map((option) => (
                    <Button
                      key={option}
                      variant="ghost"
                      aria-pressed={view === option}
                      onClick={() => {
                        setView(option);
                      }}
                    >
                      {localize(option === 'week' ? '周' : '月')}
                    </Button>
                  )))}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={localizeMessage("上一{0}", [localize(periodName)])}
                  onClick={() =>
                    resetDate(moveScheduleViewDate(anchor, view, -1))
                  }
                >
                  <ChevronLeft />
                </Button>
                <DateField
                  label={localize(view === 'week' ? '查看周' : '查看月份')}
                  hideLabel
                  value={start}
                  onChange={resetDate}
                />
                <span className="schedule-period-end">{localize("至")}{localize(end)}</span>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={localizeMessage("下一{0}", [localize(periodName)])}
                  onClick={() =>
                    resetDate(moveScheduleViewDate(anchor, view, 1))
                  }
                >
                  <ChevronRight />
                </Button>
                <Button
                  variant="outline"
                  onClick={() => resetDate(scheduleToday())}
                >
                  {localize("今天")}</Button>
              </div>
              <div className="schedule-actions">
                <Button
                  variant="outline"
                  disabled={!snapshot}
                  onClick={() => setPanel({ kind: 'calendar' })}
                >
                  <CalendarDays size={16} />
                  {localize("全局日历")}</Button>
                <Button
                  variant="outline"
                  disabled={!snapshot?.resources.length}
                  onClick={() => setPanel({ kind: 'personal-calendar' })}
                >
                  <UserRound size={16} />
                  {localize("个人日历")}</Button>
              </div>
            </div>
            <div className="schedule-filters">
              <label className="schedule-search">
                <Search size={16} />
                <Input
                  aria-label={localize("搜索工程师")}
                  placeholder={localize("搜索工程师")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <select
                aria-label={localize("工程师类型")}
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value);
                  setCompany('');
                }}
              >
                <option value="">{localize("全部类型")}</option>
                <option value="internal">{localize("内部工程师")}</option>
                <option value="partner">{localize("伙伴工程师")}</option>
              </select>
              <select
                aria-label={localize("所属公司")}
                value={company}
                onChange={(e) => setCompany(e.target.value)}
              >
                <option value="">{localize("全部公司")}</option>
                {localize([
                  ...new Set(
                    (snapshot?.resources ?? [])
                      .filter((p) => !group || p.group === group)
                      .map((p) => p.company),
                  ),
                ].map((name) => (
                  <option value={name} key={name}>{localize(name)}</option>
                )))}
              </select>
              <select
                aria-label={localize("认证筛选")}
                value={cert}
                onChange={(e) => setCert(e.target.value)}
              >
                <option value="">{localize("全部认证")}</option>
                {localize([
                  ...new Set(
                    snapshot?.resources.flatMap((p) => p.certifications) ?? [],
                  ),
                ].map((name) => (
                  <option value={name} key={name}>{localize(name)}</option>
                )))}
              </select>
            </div>
            <div className="schedule-legend">
              {localize(Object.entries(labels).map(([state, label]) => (
                <span key={state}>
                  <i data-state={state} />
                  {localize(label)}
                </span>
              )))}
            </div>
            <div className="schedule-grid-scroll">
              <table
                className="schedule-grid"
                data-view={view}
                style={{
                  minWidth: view === 'month' ? 188 + dates.length * 76 : 850,
                }}
              >
                <colgroup>
                  <col style={{ width: 188 }} />
                  {localize(dates.map((date) => (
                    <col key={date} />
                  )))}
                </colgroup>
                <thead>
                  <tr>
                    <th className="schedule-person-heading">
                      {localize("工程师")}<small>{localize(filtered.length)} {localize(" 人")}</small>
                    </th>
                    {localize(dates.map((date) => (
                      <th key={date} data-today={date === scheduleToday()}>
                        {localize(date.slice(5))}{localize(' ')}
                        <small>
                          {
                            localize([
                              '周日',
                              '周一',
                              '周二',
                              '周三',
                              '周四',
                              '周五',
                              '周六',
                            ][new Date(`${date}T00:00:00Z`).getUTCDay()])
                          }
                        </small>
                      </th>
                    )))}
                  </tr>
                  <tr className="schedule-capacity">
                    <th>{localize("可用人数")}</th>
                    {localize(totals.map((total, index) => (
                      <td key={index}>
                        <span
                          className="schedule-capacity-value"
                          aria-label={localizeMessage("{0} 可用 {1} 人", [localize(slots[index].date), localize(total.available)])}
                        >
                          {localize(total.available)}
                        </span>
                      </td>
                    )))}
                  </tr>
                </thead>
                <tbody>
                  {localize(snapshot &&
                    filtered.map((person) => (
                      <tr key={person.key}>
                        <th>
                          <button
                            className="schedule-person"
                            onClick={() =>
                              setPanel({ kind: 'resource', resource: person })
                            }
                          >
                            <span>
                              <strong>{localize(person.name)}</strong>
                              <small>{localize(person.company)}</small>
                            </span>
                          </button>
                        </th>
                        {localize(slots.map((slot) => (
                          <SchedulingDayCell
                            key={slot.date}
                            snapshot={snapshot}
                            person={person}
                            slot={slot}
                            actor={actor}
                            customers={customers}
                            onOpen={onOpen}
                          />
                        )))}
                      </tr>
                    )))}
                  {localize((!snapshot || !filtered.length) && (
                    <tr>
                      <td colSpan={dates.length + 1} className="schedule-empty">
                        {localize(!snapshot
                          ? error
                            ? '无法读取调度数据'
                            : '正在读取调度数据…'
                          : query || group || company || cert
                            ? '暂无匹配工程师'
                            : '暂无启用的工程师')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
      {localize(assignment && assignmentProject && (
        <WorkOrderAssignmentDialog
          key={`${assignment.projectId}:${assignment.orderIds.join(',')}`}
          project={assignmentProject}
          actor={actor}
          orderIds={assignment.orderIds}
          onClose={() => setAssignment(undefined)}
          onBusy={setAssignmentBusy}
          onSaved={(project) => {
            setSnapshot((current) =>
              current
                ? {
                    ...current,
                    projects: current.projects.map((item) =>
                      item.id === project.id ? project : item,
                    ),
                  }
                : current,
            );
            setNotice('工单指派已保存');
            void load();
          }}
        />
      ))}
      {localize(panel && snapshot && (
        <SchedulePanel
          key={JSON.stringify(panel)}
          panel={panel}
          snapshot={snapshot}
          onClose={close}
          onPanel={setPanel}
          onSave={save}
        />
      ))}
    </div>
  );
}

function SchedulePanel({
  panel,
  snapshot,
  onClose,
  onPanel,
  onSave,
}: {
  panel: Panel;
  snapshot: ScheduleSnapshot;
  onClose: () => void;
  onPanel: (panel: Panel) => void;
  onSave: (action: ScheduleAction, revision: number) => Promise<void>;
}) {
  const { localize, localizeList } = useI18n();
  const revision = useRef(snapshot.data.revision);
  const [resourceKey, setResourceKey] = useState(
    panel.kind === 'exception'
      ? (panel.exception?.resourceKey ?? panel.resourceKey ?? '')
      : '',
  );
  const [start, setStart] = useState(
    panel.kind === 'exception'
      ? (panel.exception?.start ?? panel.date ?? scheduleToday())
      : scheduleToday(),
  );
  const [end, setEnd] = useState(
    panel.kind === 'exception'
      ? (panel.exception?.end ?? panel.date ?? scheduleToday())
      : scheduleToday(),
  );
  const [note, setNote] = useState(
    panel.kind === 'exception' ? (panel.exception?.note ?? '') : '',
  );
  const personalCalendar =
    panel.kind === 'exception' && panel.scope === 'personal';
  const personalRecords = snapshot.data.exceptions
    .filter(
      (entry) =>
        entry.resourceKey &&
        (panel.kind !== 'personal-calendar' ||
          !panel.resourceKey ||
          entry.resourceKey === panel.resourceKey),
    )
    .sort(
      (a, b) => b.start.localeCompare(a.start) || b.end.localeCompare(a.end),
    );
  const [exceptionKind, setExceptionKind] = useState<CalendarException['kind']>(
    panel.kind === 'exception'
      ? (panel.exception?.kind ?? (personalCalendar ? '调休休息' : '节假日'))
      : '请假',
  );
  const [calendar, setCalendar] = useState<WorkCalendar>(
    structuredClone(snapshot.data.calendar),
  );
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function commit(action: ScheduleAction) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(action, revision.current);
    } catch (cause) {
      setError(message(cause));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const title =
    panel.kind === 'exception'
      ? panel.exception
        ? personalCalendar
          ? '编辑个人日历事项'
          : '编辑全局日历事项'
        : personalCalendar
          ? '登记调休／加班'
          : '登记全局日历事项'
      : panel.kind === 'calendar'
        ? '全局日历'
        : panel.kind === 'personal-calendar'
          ? '个人日历'
          : panel.resource.name;
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <SheetContent className="schedule-sheet" showCloseButton={!busy}>
        <SheetHeader>
          <SheetTitle>{localize(title)}</SheetTitle>
          <SheetDescription className="sr-only">{localize("服务调度")}</SheetDescription>
        </SheetHeader>
        <div className="schedule-sheet-body">
          <fieldset disabled={busy}>
            {localize(panel.kind === 'exception' && (
              <>
                {localize(personalCalendar ? (
                  <label className="schedule-field">
                    {localize("工程师 *")}<select
                      required
                      value={resourceKey}
                      onChange={(e) => setResourceKey(e.target.value)}
                    >
                      <option value="" disabled>
                        {localize("请选择工程师")}</option>
                      {localize(snapshot.resources.map((p) => (
                        <option key={p.key} value={p.key}>
                          {localize(p.name)} · {localize(p.company)}
                        </option>
                      )))}
                    </select>
                  </label>
                ) : (
                  <div className="schedule-detail-row">
                    <span>{localize("适用人员")}</span>
                    <strong>{localize("全部工程师")}</strong>
                  </div>
                ))}
                <label className="schedule-field">
                  {localize("类型")}<select
                    value={exceptionKind}
                    onChange={(e) =>
                      setExceptionKind(
                        e.target.value as CalendarException['kind'],
                      )
                    }
                  >
                    {localize((personalCalendar
                      ? [
                          ...new Set([
                            '调休休息',
                            '加班上班',
                            '其他占用',
                            ...(panel.exception ? [panel.exception.kind] : []),
                          ]),
                        ]
                      : ['节假日', '调休上班']
                    ).map((kind) => (
                      <option value={kind} key={kind}>{localize(kind)}</option>
                    )))}
                  </select>
                </label>
              </>
            ))}
            {localize(panel.kind === 'exception' && (
              <>
                <div className="schedule-date-pair">
                  <DateField
                    label={localize("开始日期")}
                    required
                    value={start}
                    onChange={(value) => {
                      setStart(value);
                      if (value > end) setEnd(value);
                    }}
                  />
                  <DateField
                    label={localize("结束日期")}
                    required
                    value={end}
                    onChange={setEnd}
                  />
                </div>
                <label className="schedule-field">
                  {localize("备注")}<textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                  />
                </label>
              </>
            ))}
            {localize(panel.kind === 'calendar' && (
              <>
                <div className="schedule-field">
                  {localize("每周工作日")}<div className="schedule-weekdays">
                    {localize([1, 2, 3, 4, 5, 6, 0].map((day) => (
                      <label key={day}>
                        <Checkbox
                          checked={calendar.weekdays.includes(day)}
                          onCheckedChange={(checked) =>
                            setCalendar((c) => ({
                              ...c,
                              weekdays: checked
                                ? [...c.weekdays, day]
                                : c.weekdays.filter((n) => n !== day),
                            }))
                          }
                        />
                        {
                          localize([
                            '周日',
                            '周一',
                            '周二',
                            '周三',
                            '周四',
                            '周五',
                            '周六',
                          ][day])
                        }
                      </label>
                    )))}
                  </div>
                </div>
                <div className="schedule-subheading">
                  <h3>
                    {localize("节假日与调休（")}{
                      localize(snapshot.data.exceptions.filter((e) => !e.resourceKey)
                        .length)
                    }{localize(' ')}
                    {localize("条）")}</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      onPanel({ kind: 'exception', scope: 'global' })
                    }
                  >
                    <Plus size={14} />
                    {localize("添加")}</Button>
                </div>
                {localize(snapshot.data.exceptions
                  .filter((e) => !e.resourceKey)
                  .map((e) => (
                    <button
                      className="schedule-record"
                      key={e.id}
                      onClick={() =>
                        onPanel({
                          kind: 'exception',
                          scope: e.resourceKey ? 'personal' : 'global',
                          exception: e,
                        })
                      }
                    >
                      <strong>{localize(e.kind)}</strong>
                      <span>
                        {localize(e.start)} — {localize(e.end)}
                      </span>
                    </button>
                  )))}
                {localize(!snapshot.data.exceptions.some((e) => !e.resourceKey) && (
                  <div className="schedule-empty">{localize("暂无节假日或调休事项")}</div>
                ))}
              </>
            ))}
            {localize(panel.kind === 'personal-calendar' && (
              <>
                <label className="schedule-field">
                  {localize("工程师")}<select
                    value={panel.resourceKey ?? ''}
                    onChange={(event) =>
                      onPanel({
                        kind: 'personal-calendar',
                        resourceKey: event.target.value,
                      })
                    }
                  >
                    <option value="">{localize("全部工程师")}</option>
                    {localize(snapshot.resources.map((person) => (
                      <option key={person.key} value={person.key}>
                        {localize(person.name)} · {localize(person.company)}
                      </option>
                    )))}
                  </select>
                </label>
                <div className="schedule-subheading">
                  <h3>{localize("已登记事项（")}{localize(personalRecords.length)} {localize(" 条）")}</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onPanel({
                        kind: 'exception',
                        scope: 'personal',
                        resourceKey: panel.resourceKey,
                        returnTo: panel,
                      })
                    }
                  >
                    <Plus size={14} />
                    {localize("登记调休／加班")}</Button>
                </div>
                {localize(personalRecords.map((entry) => {
                  const person = snapshot.resources.find(
                    (resource) => resource.key === entry.resourceKey,
                  );
                  return (
                    <button
                      className="schedule-record"
                      key={entry.id}
                      onClick={() =>
                        onPanel({
                          kind: 'exception',
                          scope: 'personal',
                          exception: entry,
                          returnTo: panel,
                        })
                      }
                    >
                      <strong>
                        {localize(person?.name ?? entry.resourceKey)} · {localize(entry.kind)}
                      </strong>
                      {localize(person && <small>{localize(person.company)}</small>)}
                      <span>
                        {localize(entry.start)} — {localize(entry.end)}
                      </span>
                      {localize(entry.note && <small>{localize(entry.note)}</small>)}
                    </button>
                  );
                }))}
                {localize(!personalRecords.length && (
                  <div className="schedule-empty">{localize("暂无个人日历事项")}</div>
                ))}
              </>
            ))}
            {localize(panel.kind === 'resource' && (
              <>
                <div className="schedule-resource-heading">
                  <span className={`schedule-avatar ${panel.resource.group}`}>
                    {localize(panel.resource.name.slice(-2))}
                  </span>
                  <div>
                    <strong>{localize(panel.resource.company)}</strong>
                    <small>
                      {localize(panel.resource.group === 'internal'
                        ? '内部工程师'
                        : '伙伴工程师')}
                    </small>
                  </div>
                </div>
                <div className="schedule-detail-row">
                  <span>{localize("有效认证")}</span>
                  <strong>
                    {localize(localizeList(panel.resource.certifications, '、') || '无有效认证')}
                  </strong>
                </div>
                <div className="schedule-detail-row">
                  <span>{localize("全局日历")}</span>
                  <strong>{localize("统一工作日设置")}</strong>
                </div>
                <div className="schedule-detail-row">
                  <span>{localize("每周工作日")}</span>
                  <strong>
                    {localize(localizeList([1, 2, 3, 4, 5, 6, 0]
                      .filter((day) =>
                        snapshot.data.calendar.weekdays.includes(day),
                      )
                      .map(
                        (day) =>
                          [
                            '周日',
                            '周一',
                            '周二',
                            '周三',
                            '周四',
                            '周五',
                            '周六',
                          ][day],
                      ), '、'))}
                  </strong>
                </div>
                <div className="schedule-subheading">
                  <h3>
                    {localize("个人日历事项（")}{
                      localize(snapshot.data.exceptions.filter(
                        (e) => e.resourceKey === panel.resource.key,
                      ).length)
                    }{localize(' ')}
                    {localize("条）")}</h3>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onPanel({
                        kind: 'exception',
                        scope: 'personal',
                        resourceKey: panel.resource.key,
                        returnTo: panel,
                      })
                    }
                  >
                    <Plus size={14} />
                    {localize("登记调休／加班")}</Button>
                </div>
                {localize(snapshot.data.exceptions
                  .filter((e) => e.resourceKey === panel.resource.key)
                  .map((e) => (
                    <button
                      className="schedule-record"
                      key={e.id}
                      onClick={() =>
                        onPanel({
                          kind: 'exception',
                          scope: e.resourceKey ? 'personal' : 'global',
                          exception: e,
                          returnTo: panel,
                        })
                      }
                    >
                      <strong>{localize(e.kind)}</strong>
                      <span>
                        {localize(e.start)} — {localize(e.end)}
                      </span>
                      {localize(e.note && <small>{localize(e.note)}</small>)}
                    </button>
                  )))}
                {localize(!snapshot.data.exceptions.some(
                  (e) => e.resourceKey === panel.resource.key,
                ) && <div className="schedule-empty">{localize("暂无个人日历事项")}</div>)}
              </>
            ))}
          </fieldset>
          {localize(error && (
            <p className="sr-error" role="alert">
              {localize(error)}
            </p>
          ))}
        </div>
        <SheetFooter className="schedule-sheet-footer">
          {localize(panel.kind === 'exception' && panel.exception && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void commit({
                  type: 'remove-exception',
                  id: panel.exception!.id,
                })
              }
            >
              {localize("移除事项")}</Button>
          ))}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              panel.kind === 'exception'
                ? onPanel(exceptionOverview(panel))
                : onClose()
            }
          >
            {localize(panel.kind === 'exception' ? '返回' : '关闭')}
          </Button>
          {localize(panel.kind === 'exception' && (
            <Button
              disabled={
                busy || !start || !end || (personalCalendar && !resourceKey)
              }
              onClick={() =>
                void commit({
                  type: 'exception',
                  scope: panel.scope,
                  exception: {
                    id: panel.exception?.id ?? crypto.randomUUID(),
                    resourceKey,
                    start,
                    end,
                    kind: exceptionKind,
                    note,
                  },
                })
              }
            >
              {localize(busy ? '保存中…' : '保存事项')}
            </Button>
          ))}
          {localize(panel.kind === 'calendar' && (
            <Button
              disabled={busy}
              onClick={() => void commit({ type: 'calendar', calendar })}
            >
              {localize(busy ? '保存中…' : '保存日历')}
            </Button>
          ))}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
