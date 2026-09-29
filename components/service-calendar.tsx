'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Coffee,
  TriangleAlert,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EngineerWorklogs } from '@/components/engineer-worklogs';
import { readServiceProjects } from '@/lib/service-project-store';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import { PersonalCalendarDialog } from '@/components/personal-calendar-dialog';
import { personalSchedulingTransaction } from '@/lib/scheduling-store';
import {
  calendarState,
  moveScheduleViewDate,
  scheduleToday,
  scheduleViewWindow,
  slotState,
  type CalendarException,
  type PersonalScheduleSnapshot,
} from '@/lib/scheduling';
import {
  engineerWork,
  engineerWorkKey,
  engineerWorklogs,
  engineerWorklogsInRange,
  groupEngineerProjects,
  engineerProjectPage,
  engineerProjectPageSize,
} from '@/lib/service-engineer-dashboard';
import {
  canEditPersonalCalendar,
  type PersonalCalendarAction,
  type PersonalCalendarKind,
} from '@/lib/personal-scheduling';
import type { OperationActor } from '@/lib/request-operations';
import type { CustomerRef } from '@/lib/service-requests';

type Props = {
  actor: OperationActor;
  customers: CustomerRef[];
  onOpen: (projectId: string, orderId: string) => void;
  onOpenWorklogs: (projectId: string) => void;
};
type View = '我的工作' | '我的工时';
type Editor = { kind: PersonalCalendarKind; entry?: CalendarException };
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const dayTitle = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
const calendarLabel = (entry: CalendarException) =>
  entry.kind === '调休休息'
    ? '调休'
    : entry.kind === '加班上班'
      ? '加班'
      : entry.kind;

export function ServiceEngineerHome({
  actor,
  customers,
  onOpen,
  onOpenWorklogs,
}: Props) {
  const [snapshot, setSnapshot] = useState<PersonalScheduleSnapshot>();
  const [worklogProjects, setWorklogProjects] = useState<
    ServiceProjectRecord[]
  >([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [today, setToday] = useState(scheduleToday);
  const [selectedDate, setSelectedDate] = useState(scheduleToday);
  const [worklogDate, setWorklogDate] = useState(scheduleToday);
  const [view, setView] = useState<View>('我的工作');
  const [filter, setFilter] = useState('未完成');
  const [workPage, setWorkPage] = useState(1);
  const workFiltersRef = useRef<HTMLDivElement>(null);
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const [editor, setEditor] = useState<Editor>();
  const mounted = useRef(false);
  const sequence = useRef(0);
  const { id: actorId, name: actorName, role: actorRole } = actor;
  const load = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const reader = { id: actorId, name: actorName, role: actorRole };
      const [result, projects] = await Promise.all([
        personalSchedulingTransaction(reader),
        readServiceProjects(reader),
      ]);
      if (mounted.current && request === sequence.current) {
        setSnapshot(result);
        setWorklogProjects(projects);
        setToday(scheduleToday());
        setError('');
      }
    } catch (cause) {
      if (mounted.current && request === sequence.current)
        setError(cause instanceof Error ? cause.message : '工作台读取失败。');
    }
  }, [actorId, actorName, actorRole]);
  useEffect(() => {
    mounted.current = true;
    const initialLoad = window.setTimeout(() => void load(), 0);
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('resource-scheduling')
        : null;
    if (channel) channel.onmessage = () => void load();
    window.addEventListener('focus', load);
    return () => {
      mounted.current = false;
      window.clearTimeout(initialLoad);
      channel?.close();
      window.removeEventListener('focus', load);
    };
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  async function save(action: PersonalCalendarAction, revision: number) {
    ++sequence.current;
    const result = await personalSchedulingTransaction(actor, {
      action,
      revision,
    });
    ++sequence.current;
    if (mounted.current) {
      setSnapshot(result);
      setError('');
      setNotice(action.type === 'remove' ? '已撤销登记' : '登记已保存');
    }
    const channel =
      typeof BroadcastChannel !== 'undefined'
        ? new BroadcastChannel('resource-scheduling')
        : null;
    channel?.postMessage('updated');
    channel?.close();
  }
  const work = useMemo(
    () => (snapshot ? engineerWork(snapshot, today) : []),
    [snapshot, today],
  );
  const month = useMemo(
    () => scheduleViewWindow(selectedDate, 'month'),
    [selectedDate],
  );
  const worklogs = useMemo(
    () => engineerWorklogs(worklogProjects, actorId),
    [worklogProjects, actorId],
  );
  const dateRange = useMemo(
    () => scheduleViewWindow(worklogDate, 'week'),
    [worklogDate],
  );
  const rangedWorklogs = engineerWorklogsInRange(worklogs, dateRange);
  const person = snapshot?.resources[0];
  const states = useMemo(() => {
    const result = new Map<string, ReturnType<typeof slotState>>();
    if (snapshot && person)
      for (const date of month.dates)
        result.set(date, slotState(snapshot, person, { date }, today));
    return result;
  }, [snapshot, person, month, today]);
  const customerName = (id: string) =>
    customers.find((customer) => customer.id === id)?.name || '客户信息缺失';
  const matchesFilter = (row: (typeof work)[number], value: string) =>
    value === '全部'
      ? true
      : value === '未完成'
        ? row.active
        : value === '已逾期'
          ? row.overdue
          : value === '已完成'
            ? row.status === value
            : row.active && row.status === value;
  const visibleWork = work.filter((row) => matchesFilter(row, filter));
  const projectGroups = groupEngineerProjects(visibleWork).sort(
    (a, b) =>
      Number(a.project.status === '已完成') -
      Number(b.project.status === '已完成'),
  );
  const projectPage = engineerProjectPage(projectGroups, workPage);
  const changeWorkPage = (page: number) => {
    setWorkPage(page);
    workFiltersRef.current?.scrollIntoView({ block: 'start' });
  };
  const overdue = work.filter((row) => row.overdue);
  const selectedDay = states.get(selectedDate);
  const selectedDayProjects = (snapshot?.projects ?? []).filter((project) =>
    selectedDay?.bookings.some((booking) => booking.projectId === project.id),
  );
  const leadingDays =
    (new Date(`${month.start}T00:00:00Z`).getUTCDay() + 6) % 7;
  const trailingDays = (7 - ((leadingDays + month.dates.length) % 7)) % 7;
  const hasConflict = (date: string) =>
    !!snapshot &&
    !!person &&
    !!states.get(date)?.bookings.length &&
    calendarState(snapshot.data, person, { date }).state === 'unavailable';
  const selectDate = (date: string) => {
    setSelectedDate(date);
  };
  const editEntry = (entry: CalendarException) => {
    if (person && canEditPersonalCalendar(entry, person.key, actor.id))
      setEditor({ entry, kind: entry.kind as PersonalCalendarKind });
  };

  function renderProjectGroup({
    project,
    rows,
  }: (typeof projectGroups)[number]) {
    const expanded =
      expandedProjects[project.id] ??
      (filter !== '已完成' && project.status !== '已完成');
    const ordersId = `eh-project-orders-${encodeURIComponent(project.id)}`;
    return (
      <section
        className="eh-project-group"
        key={project.id}
        aria-label={`项目：${project.name}`}
        data-collapsed={!expanded || undefined}
      >
        <header className="eh-project-heading">
          <button
            type="button"
            className="eh-project-expand-area"
            aria-label={`${expanded ? '收起' : '展开'} ${project.name} 的工单`}
            aria-expanded={expanded}
            aria-controls={ordersId}
            onClick={() =>
              setExpandedProjects((previous) => ({
                ...previous,
                [project.id]: !expanded,
              }))
            }
          />
          <span className="eh-project-type">服务项目</span>
          <div>
            <button
              type="button"
              className="eh-project-name"
              title={project.name}
              onClick={() => onOpen(project.id, '')}
            >
              {project.name}
            </button>
            <p title={customerName(project.customerId)}>
              {customerName(project.customerId)}
            </p>
          </div>
          <span className="pm-tag" data-status={project.status}>
            {project.status}
          </span>
          <span className="eh-project-count">{rows.length} 张工单</span>
          <span
            className="eh-project-toggle"
            data-expanded={expanded}
            aria-hidden="true"
          >
            <ChevronDown size={16} />
          </span>
        </header>
        <div id={ordersId} hidden={!expanded}>
          {rows.map((row) => (
            <article
              className="eh-work-item eh-project-order"
              key={engineerWorkKey(row)}
            >
              <div className="eh-work-content">
                <div className="eh-work-title">
                  <button
                    type="button"
                    onClick={() => onOpen(project.id, row.order.id)}
                  >
                    {row.order.item.serviceName || '未命名工单'}
                  </button>
                  <span className="pm-tag" data-status={row.status}>
                    {row.status}
                  </span>
                  {row.overdue && (
                    <span className="eh-overdue-tag">已逾期</span>
                  )}
                </div>
                <div className="eh-work-details">
                  <div className="eh-next-step">
                    <span>当前步骤</span>
                    <strong>
                      {row.status === '已暂停'
                        ? '已暂停'
                        : row.status === '已取消'
                          ? '已取消'
                          : row.nextStep ||
                            (row.total ? '步骤已完成' : '暂无执行步骤')}
                    </strong>
                  </div>
                  <div className="eh-work-bottom">
                    <span>
                      计划完成 {row.order.plannedCompletionDate || '待定'}
                    </span>
                  </div>
                </div>
              </div>
              <div className="eh-work-order-actions">
                <div className="pm-progress">
                  <progress
                    value={row.completed}
                    max={row.total || 1}
                    aria-label={`${row.order.item.serviceName}已完成或跳过 ${row.completed} 步，共 ${row.total} 步`}
                  />
                  <span>
                    {row.completed}/{row.total} 步
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="eh-work-action"
                  aria-label={`执行工单 ${row.order.item.serviceName || '未命名工单'}`}
                  onClick={() => onOpen(project.id, row.order.id)}
                >
                  {row.active ? '进入执行' : '查看工单'}
                  <ArrowUpRight size={14} />
                </Button>
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }

  if (!snapshot || !person)
    return (
      <div className="eh-home">
        {error ? (
          <p role="alert" className="sr-error">
            {error}
          </p>
        ) : (
          <output>正在读取工程师工作台…</output>
        )}
      </div>
    );

  return (
    <div className="eh-home">
      {error && (
        <p role="alert" className="sr-error">
          {error}
        </p>
      )}
      {notice && <output className="schedule-notice">{notice}</output>}
      <div className="eh-layout">
        <section className="eh-main-panel" aria-label="我的工作与工时">
          <nav className="eh-tabs" aria-label="工作台视图">
            {(['我的工作', '我的工时'] as const).map((value) => (
              <button
                type="button"
                key={value}
                aria-current={view === value ? 'page' : undefined}
                onClick={() => setView(value)}
              >
                {value}
              </button>
            ))}
          </nav>
          {view === '我的工时' ? (
            <>
              <div className="eh-worklog-dates" aria-label="工时日期筛选">
                <div className="eh-week-controls">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="上一周"
                    onClick={() =>
                      setWorklogDate((date) =>
                        moveScheduleViewDate(date, 'week', -1),
                      )
                    }
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <span className="eh-week-range" aria-live="polite">
                    {dateRange.start} — {dateRange.end}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="下一周"
                    onClick={() =>
                      setWorklogDate((date) =>
                        moveScheduleViewDate(date, 'week', 1),
                      )
                    }
                  >
                    <ChevronRight size={16} />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setWorklogDate(scheduleToday())}
                  >
                    本周
                  </Button>
                </div>
              </div>
              <EngineerWorklogs
                rows={rangedWorklogs}
                customers={customers}
                onOpen={onOpenWorklogs}
              />
            </>
          ) : (
            <>
              <div
                className="eh-work-filters"
                aria-label="工单状态"
                ref={workFiltersRef}
              >
                {[
                  '未完成',
                  '全部',
                  '待执行',
                  '进行中',
                  '已逾期',
                  '已暂停',
                  '已完成',
                ].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => {
                      if (value !== filter) {
                        setExpandedProjects({});
                        setWorkPage(1);
                      }
                      setFilter(value);
                    }}
                  >
                    {value}
                    <span>
                      {work.filter((row) => matchesFilter(row, value)).length}
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="eh-project-list eh-work-projects"
                aria-live="polite"
              >
                {projectPage.groups.map(renderProjectGroup)}
                {!projectGroups.length && (
                  <div className="eh-empty">
                    <CheckCheck size={28} />
                    <strong>暂无符合条件的工单</strong>
                  </div>
                )}
              </div>
              <nav className="eh-work-pagination" aria-label="我的工作分页">
                <span aria-live="polite">
                  第 {projectPage.start}–{projectPage.end} 个，共{' '}
                  {projectPage.total} 个项目
                </span>
                <div>
                  <span>每页 {engineerProjectPageSize} 个</span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={projectPage.page === 1}
                    onClick={() => changeWorkPage(projectPage.page - 1)}
                    aria-label="上一页项目"
                  >
                    <ChevronLeft size={15} />
                    上一页
                  </Button>
                  <span aria-live="polite">
                    {projectPage.page} / {projectPage.pages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={projectPage.page === projectPage.pages}
                    onClick={() => changeWorkPage(projectPage.page + 1)}
                    aria-label="下一页项目"
                  >
                    下一页
                    <ChevronRight size={15} />
                  </Button>
                </div>
              </nav>
            </>
          )}
        </section>
        <aside className="eh-sidebar">
          <section
            className="eh-month-panel eh-compact-calendar"
            aria-label="服务日历"
          >
            <div className="eh-calendar-title">
              <CalendarDays size={16} />
              <span>服务日历</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditor({ kind: '调休休息' })}
              >
                <Coffee size={14} />
                登记调休
              </Button>
            </div>
            <div className="eh-month-heading">
              <h3>
                {selectedDate.slice(0, 4)}年{Number(selectedDate.slice(5, 7))}月
              </h3>
              <div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="上一月"
                  onClick={() =>
                    selectDate(moveScheduleViewDate(selectedDate, 'month', -1))
                  }
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="下一月"
                  onClick={() =>
                    selectDate(moveScheduleViewDate(selectedDate, 'month', 1))
                  }
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
            <div className="eh-month-weekdays" aria-hidden="true">
              {weekdays.map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <div className="eh-month-grid">
              {Array.from({ length: leadingDays }, (_, i) => (
                <span aria-hidden="true" key={`before${i}`} />
              ))}
              {month.dates.map((date) => {
                const state = states.get(date)!;
                const off =
                  calendarState(snapshot.data, person, { date }).state ===
                  'unavailable';
                return (
                  <button
                    type="button"
                    key={date}
                    aria-label={`${date}，${off ? '休息' : '上班'}，${state.bookings.length}张工单`}
                    aria-pressed={date === selectedDate}
                    data-today={date === today || undefined}
                    data-off={off || undefined}
                    onClick={() => selectDate(date)}
                  >
                    <span>{Number(date.slice(8))}</span>
                    <div className="eh-day-dots" aria-hidden="true">
                      {!!state.bookings.length && <i data-kind="work" />}
                    </div>
                  </button>
                );
              })}
              {Array.from({ length: trailingDays }, (_, i) => (
                <span aria-hidden="true" key={`after${i}`} />
              ))}
            </div>
            <div className="eh-calendar-day" aria-live="polite">
              <h4>{dayTitle(selectedDate)}</h4>
              {selectedDayProjects.map((project) => (
                <button
                  type="button"
                  className="eh-calendar-booking"
                  key={project.id}
                  onClick={() => onOpen(project.id, '')}
                >
                  <strong>{project.name || '未命名项目'}</strong>
                  <span>{customerName(project.customerId)}</span>
                </button>
              ))}
              {!selectedDayProjects.length && <p>当天暂无项目安排</p>}
              {!!selectedDay?.exceptions.length && (
                <div className="eh-calendar-events">
                  {selectedDay.exceptions.map((entry) => (
                    <button
                      type="button"
                      key={entry.id}
                      disabled={
                        !canEditPersonalCalendar(entry, person.key, actor.id)
                      }
                      onClick={() => editEntry(entry)}
                      title={entry.note || calendarLabel(entry)}
                    >
                      {calendarLabel(entry)}
                    </button>
                  ))}
                </div>
              )}
              {hasConflict(selectedDate) && (
                <output className="eh-conflict">
                  <TriangleAlert size={14} />
                  当天休息安排与已派工单重叠，请协调调整排期。
                </output>
              )}
            </div>
          </section>
          {!!overdue.length && (
            <section className="eh-attention">
              <div>
                <TriangleAlert size={17} />
                <h3>待关注</h3>
                <span>{overdue.length}</span>
              </div>
              {overdue.slice(0, 3).map((row) => (
                <article
                  className="eh-attention-item"
                  key={engineerWorkKey(row)}
                >
                  <button
                    type="button"
                    onClick={() => onOpen(row.project.id, '')}
                  >
                    {row.project.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onOpen(row.project.id, row.order.id)}
                  >
                    {row.order.item.serviceName || '未命名工单'} · 计划完成{' '}
                    {row.order.plannedCompletionDate}
                  </button>
                </article>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setView('我的工作');
                  setFilter('已逾期');
                  setWorkPage(1);
                  setExpandedProjects({});
                }}
              >
                查看全部逾期工单
                <ArrowUpRight size={14} />
              </Button>
            </section>
          )}
        </aside>
      </div>
      {editor && (
        <PersonalCalendarDialog
          key={editor.entry?.id ?? editor.kind}
          snapshot={snapshot}
          initialDate={selectedDate}
          initialKind={editor.kind}
          entry={editor.entry}
          onClose={() => {
            setEditor(undefined);
            void load();
          }}
          onSave={save}
        />
      )}
    </div>
  );
}
