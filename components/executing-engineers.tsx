'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Users } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import {
  executingEngineers,
  earliestEngineerScheduleDay,
  assignmentSchedule,
  scheduleDay,
  ganttWindow,
  moveGanttAnchor,
  ganttBarRange,
  type GanttView,
  type EngineerAssignment,
  type ExecutingEngineer,
} from '@/lib/project-manager-dashboard';

type Props = {
  projects: ServiceProjectRecord[];
  managerId?: string;
  onOpen: (projectId: string, orderId: string) => void;
};
const dayLabel = (day: number) =>
  new Date(day * 86400000).toISOString().slice(0, 10);

export function ExecutingEngineers({ projects, managerId, onOpen }: Props) {
  const team = useMemo(
    () => executingEngineers(projects, managerId),
    [projects, managerId],
  );
  const today = scheduleDay(new Date().toLocaleDateString('sv-SE'))!;
  const [view, setView] = useState<GanttView>('week');
  const defaultAnchor = earliestEngineerScheduleDay(team, today);
  const [selectedAnchor, setAnchor] = useState<number | null>(null);
  const anchor = selectedAnchor ?? defaultAnchor;
  const window = ganttWindow(anchor, view);
  const { start, end, days } = window;
  const ticks = Array.from({ length: days }, (_, index) => start + index);
  const period = view === 'week' ? '周' : '月';
  const openAssignment = ({ project, order }: EngineerAssignment) =>
    onOpen(project.id, order.id);
  const personLabel = (person: ExecutingEngineer) => (
    <>
      <span className="pm-avatar">{person.name.slice(-2)}</span>
      <span>
        <strong>{person.name}</strong>
        <small>
          {person.group === 'internal' ? '原厂工程师' : '合作伙伴工程师'}
        </small>
      </span>
    </>
  );
  return (
    <section className="pm-panel pm-engineers" aria-label="执行中工程师">
      <div className="pm-panel-heading">
        <h2>
          <Users size={17} />
          执行中工程师 <span>{team.length}人</span>
        </h2>
        <div className="pm-gantt-controls">
          <div className="pm-gantt-paging">
            <button
              type="button"
              aria-label={`上一${period}`}
              title={`上一${period}`}
              onClick={() =>
                setAnchor((value) =>
                  moveGanttAnchor(value ?? defaultAnchor, view, -1),
                )
              }
            >
              <ChevronLeft size={16} />
            </button>
            <span aria-live="polite">
              {view === 'week'
                ? `${dayLabel(start)} 至 ${dayLabel(end)}`
                : `${dayLabel(start).slice(0, 7).replace('-', '年')}月`}
            </span>
            <button
              type="button"
              aria-label={`下一${period}`}
              title={`下一${period}`}
              onClick={() =>
                setAnchor((value) =>
                  moveGanttAnchor(value ?? defaultAnchor, view, 1),
                )
              }
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="pm-segment" aria-label="甘特图时间视图">
            <button
              type="button"
              aria-pressed={view === 'week'}
              onClick={() => setView('week')}
            >
              周
            </button>
            <button
              type="button"
              aria-pressed={view === 'month'}
              onClick={() => setView('month')}
            >
              月
            </button>
          </div>
        </div>
      </div>
      {!team.length ? (
        <div className="pm-empty">
          <Users size={24} />
          <span>暂无执行中工程师</span>
        </div>
      ) : (
        <TooltipProvider delay={120}>
          <div className="pm-gantt-scroll" aria-label="工程师工单甘特图">
            <div
              className="pm-gantt"
              style={
                {
                  '--pm-tick-size': `${100 / days}%`,
                  minWidth: view === 'week' ? 900 : 210 + days * 36,
                } as CSSProperties
              }
            >
              <div className="pm-gantt-header">
                <div className="pm-gantt-person">执行工程师</div>
                <div
                  className="pm-gantt-axis"
                  aria-label={`${dayLabel(start)} 至 ${dayLabel(end)}`}
                >
                  {ticks.map((day) => (
                    <span
                      key={day}
                      style={{
                        left: `${((day - start) / days) * 100}%`,
                        width: `${100 / days}%`,
                      }}
                      title={dayLabel(day)}
                    >
                      {view === 'week'
                        ? `${dayLabel(day).slice(5)} ${['周日', '周一', '周二', '周三', '周四', '周五', '周六'][new Date(day * 86400000).getUTCDay()]}`
                        : Number(dayLabel(day).slice(8))}
                    </span>
                  ))}
                </div>
              </div>
              {team.map((person) => (
                <div className="pm-gantt-group" key={person.key}>
                  <div className="pm-gantt-person">
                    <div className="pm-engineer-person">
                      {personLabel(person)}
                    </div>
                    <small>
                      {person.projectCount} 个项目 · {person.assignments.length}{' '}
                      张工单
                    </small>
                  </div>
                  <div className="pm-gantt-tracks">
                    {today >= start && today <= end && (
                      <div
                        className="pm-gantt-today"
                        style={{
                          left: `${((today - start + 0.5) / days) * 100}%`,
                        }}
                        aria-label="今天"
                      />
                    )}
                    {!person.assignments.some((assignment) => {
                      const schedule = assignmentSchedule(assignment);
                      return !schedule || ganttBarRange(schedule, window);
                    }) && (
                      <div className="pm-gantt-period-empty">
                        本{period}无排期
                      </div>
                    )}
                    {person.assignments.map((assignment) => {
                      const schedule = assignmentSchedule(assignment);
                      const bar = schedule
                        ? ganttBarRange(schedule, window)
                        : null;
                      if (schedule && !bar) return null;
                      const paused =
                        assignment.project.status === '已暂停' ||
                        assignment.order.status === '已暂停';
                      const label = `${assignment.order.item.serviceName} · ${assignment.project.name}`;
                      return (
                        <div
                          className="pm-gantt-track"
                          key={`${assignment.project.id}:${assignment.order.id}`}
                        >
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button type="button" aria-label={label} />
                              }
                              className={`pm-gantt-bar${!schedule ? ' pm-gantt-unscheduled' : ''}`}
                              data-paused={paused || undefined}
                              aria-label={`${label}，计划开始 ${assignment.order.expectedServiceDate || '未设置'}，计划结束 ${assignment.order.plannedCompletionDate || '未设置'}，打开工单`}
                              style={
                                bar
                                  ? {
                                      left: `${bar.left}%`,
                                      width: `${bar.width}%`,
                                    }
                                  : undefined
                              }
                              onClick={() => openAssignment(assignment)}
                            >
                              <span>
                                {!schedule ? '未排期 · ' : ''}
                                {assignment.order.item.serviceName}
                                {paused ? ' · 暂停' : ''}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="pm-gantt-tooltip">
                              <strong>
                                {assignment.order.item.serviceName}
                              </strong>
                              <dl>
                                <dt>项目名称</dt>
                                <dd>{assignment.project.name}</dd>
                                <dt>计划开始日期</dt>
                                <dd>
                                  {assignment.order.expectedServiceDate ||
                                    '未设置'}
                                </dd>
                                <dt>计划结束日期</dt>
                                <dd>
                                  {assignment.order.plannedCompletionDate ||
                                    '未设置'}
                                </dd>
                                <dt>状态</dt>
                                <dd>
                                  {paused ? '已暂停' : assignment.order.status}
                                </dd>
                              </dl>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TooltipProvider>
      )}
    </section>
  );
}
