'use client';
import { useI18n } from '@/lib/i18n/context';


import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCheck,
  ClipboardList,
  CircleAlert,
  TriangleAlert,
} from 'lucide-react';
import {
  readLocal,
  canAccessRequest,
  type ServiceRequest,
  type CustomerRef,
} from '@/lib/service-requests';
import { readServiceProjects } from '@/lib/service-project-store';
import { projectReviewContext } from '@/lib/service-project-review-store';
import {
  parseServiceProviderConfig,
  serviceProviderSettingsId,
} from '@/lib/service-provider-settings';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import type { ProjectCollaboratorDirectory } from '@/lib/service-project-collaborators';
import { isResponsibleProjectManager } from '@/lib/service-project-work-order-policy';
import { canPerformAssessmentRole } from '@/lib/assessment-routing';
import { WorkspaceFollowups, WorkspaceRecentActivity } from '@/components/workspace-followups';
import { projectWorkspaceFollowups, sortWorkspaceFollowups, workspaceActivities } from '@/lib/workspace-dashboard';
import { requestNextStep } from '@/lib/request-next-step';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  activeDashboardProject,
  projectOverdue,
  projectProgress,
  projectRisks,
  type ProjectDashboardContext,
} from '@/lib/project-manager-dashboard';

type Props = {
  actor: OperationActor;
  customers: CustomerRef[];
  directory: ProjectCollaboratorDirectory;
  onOpen: (view: 'projects' | 'requests', id?: string) => void;
};
const categories = [
  '全部事项',
  '请求评估',
  '请求受理',
  '项目启动',
  '工单派单',
  '工时确认',
  '交付复核',
  '待客户确认',
];
const localDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export function ProjectManagerHome({
  actor,
  customers,
  directory,
  onOpen,
}: Props) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const [projects, setProjects] = useState<ServiceProjectRecord[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [reviewContext, setReviewContext] = useState<ProjectDashboardContext>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [category, setCategory] = useState('全部事项');
  const [projectFilter, setProjectFilter] = useState('全部在管');
  const projectListRef = useRef<HTMLDivElement>(null);
  const [projectListMinHeight, setProjectListMinHeight] = useState(0);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(() => new Date());
  const { id: actorId, name: actorName, role: actorRole } = actor;
  useEffect(() => {
    const reader = { id: actorId, name: actorName, role: actorRole };
    let active = true;
    const load = async () => {
      try {
        const [savedProjects, savedRequests, references] = await Promise.all([
          readServiceProjects(reader),
          readLocal<ServiceRequest>('requests'),
          readLocal<{ id: string; payload?: unknown }>('references'),
        ]);
        if (!active) return;
        const context: ProjectDashboardContext = {
          ...projectReviewContext(references, savedRequests),
          serviceProviders: parseServiceProviderConfig(
            references.find((row) => row.id === serviceProviderSettingsId)
              ?.payload,
          ),
        };
        setProjects(savedProjects);
        setReviewContext(context);
        setRequests(
          savedRequests.filter((record) =>
            canAccessRequest(record, {
              actor: reader,
              directory: directory.users,
            }),
          ),
        );
        setNow(new Date());
        setError('');
      } catch (reason) {
        if (active)
          setError(
            reason instanceof Error ? reason.message : '工作台数据读取失败。',
          );
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [actorId, actorName, actorRole, directory.users]);
  const today = localDay(now);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const until = localDay(weekEnd);
  const scopedProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          actor.role === 'SmartX 系统管理员' ||
          isResponsibleProjectManager(project, actor),
      ),
    [projects, actor],
  );
  const live = scopedProjects.filter(activeDashboardProject);
  const dueSoon = live.filter(
    (project) =>
      project.plannedCompletionDate &&
      project.plannedCompletionDate >= today &&
      project.plannedCompletionDate <= until,
  );
  const risks = live
    .map((project) => ({
      project,
      labels: projectRisks(project, today, reviewContext),
    }))
    .filter((row) => row.labels.length)
    .sort(
      (a, b) =>
        Number(projectOverdue(b.project, today)) -
        Number(projectOverdue(a.project, today)),
    );
  const customerName = (id: string) =>
    customers.find((customer) => customer.id === id)?.name ?? '未关联客户';
  const followups = projectWorkspaceFollowups(live, today);
  for (const request of requests) {
    if (['草稿', '已取消', '已转服务项目', '评估完成'].includes(request.status))
      continue;
    if (!canPerformAssessmentRole(request, actor, 'manager', directory.users))
      continue;
    const next = requestNextStep(
      request,
      directory.users,
      customers,
      directory.contacts,
    );
    if (!next.actor?.includes('项目经理')) continue;
    followups.push({
      id: request.id,
      title: request.title,
      customerId: request.customerId,
      kind: request.status === '待受理' ? '请求受理' : '请求评估',
      view: 'requests',
      date: request.expectedServiceDate ?? '',
      overdue: false,
    });
  }
  sortWorkspaceFollowups(followups);
  const shownProjects = live
    .filter(
      (project) =>
        (projectFilter === '全部在管' ||
          (projectFilter === '近7天到期'
            ? dueSoon.includes(project)
            : projectFilter === '风险项目'
              ? projectRisks(project, today, reviewContext).length > 0
              : project.status === projectFilter)) &&
        `${project.name} ${project.id} ${customerName(project.customerId)}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(projectOverdue(b, today)) - Number(projectOverdue(a, today)) ||
        (a.plannedCompletionDate || '9999').localeCompare(
          b.plannedCompletionDate || '9999',
        ),
    );
  const activities = workspaceActivities(scopedProjects);
  const selectProjectFilter = (filter: string) => {
    // Keep the document from shrinking and clamping the page's scroll position.
    const height = projectListRef.current?.getBoundingClientRect().height ?? 0;
    setProjectListMinHeight((previous) => Math.max(previous, height));
    setProjectFilter(filter);
  };
  const focusProjects = (filter: string) => {
    setProjectFilter(filter);
    document
      .getElementById('pm-projects')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (loading) return <output className="pm-home">{localize("正在读取工作台…")}</output>;
  if (error)
    return (
      <div className="pm-home">
        <p role="alert" className="sr-error">
          {localize(error)}
        </p>
      </div>
    );
  return (
    <div className="pm-home">
      <TooltipProvider delay={120}>
        <div className="pm-metrics">
          {localize([
            {
              label: '在管项目',
              value: live.length,
              note: '未完成、未取消的项目，包含已暂停项目。',
              icon: BriefcaseBusiness,
              tone: 'blue',
              action: () => focusProjects('全部在管'),
            },
            {
              label: '待办与跟进',
              value: followups.length,
              note: '待处理及待跟进事项，同一项目不同类型分别计数。',
              icon: ClipboardList,
              tone: 'purple',
              action: () => {
                setCategory('全部事项');
                document
                  .getElementById('pm-tasks')
                  ?.scrollIntoView({ behavior: 'smooth' });
              },
            },
            {
              label: '近7天到期',
              value: dueSoon.length,
              note: '今天起 7 天内到期的在管项目，按计划完成日期统计。',
              icon: CalendarDays,
              tone: 'green',
              action: () => focusProjects('近7天到期'),
            },
            {
              label: '风险项目',
              value: risks.length,
              note: '逾期、暂停、客户拒绝确认或服务依据不足的在管项目，按项目去重。',
              icon: TriangleAlert,
              tone: 'orange',
              action: () => focusProjects('风险项目'),
            },
          ].map((card) => (
            <div className="pm-metric" key={card.label}>
              <div className="pm-metric-top">
                <div className="pm-metric-label">
                  <span>{localize(card.label)}</span>
                  <Tooltip>
                    <TooltipTrigger
                      className="pm-metric-info"
                      aria-label={localizeMessage("{0}统计说明", [localize(card.label)])}
                    >
                      <CircleAlert size={15} aria-hidden="true" />
                    </TooltipTrigger>
                    <TooltipContent
                      className="pm-metric-tooltip"
                      side="bottom"
                      align="start"
                    >
                      <strong>{localize(card.label)}</strong>
                      <p>{localize(card.note)}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <card.icon
                  className={`pm-icon pm-${card.tone}`}
                  size={17}
                  aria-hidden="true"
                />
              </div>
              <button
                type="button"
                className="pm-metric-action"
                aria-label={localizeMessage("查看{0}：{1}项", [localize(card.label), localize(card.value)])}
                onClick={card.action}
              >
                <strong>
                  {localize(card.value)}
                  <small>{localize("项")}</small>
                </strong>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
            </div>
          )))}
        </div>
      </TooltipProvider>
      <div className="pm-columns">
        <WorkspaceFollowups id="pm-tasks" tasks={followups} categories={categories} selectedCategory={category} onCategoryChange={setCategory} customerName={customerName} onOpen={onOpen} />
        <WorkspaceRecentActivity activities={activities} customerName={customerName} onOpen={onOpen} emptyText="暂无项目动态" />
      </div>
      <section className="pm-panel" id="pm-projects">
        <div className="pm-panel-heading">
          <h2>
            {localize("项目进展")}<span>{localize(shownProjects.length)}</span>
          </h2>
          <button
            type="button"
            className="pm-link"
            onClick={() => onOpen('projects')}
          >
            {localize("全部服务项目")}<ArrowUpRight size={15} />
          </button>
        </div>
        <div className="pm-project-toolbar">
          <div className="pm-filters">
            {localize([
              '全部在管',
              '待启动',
              '进行中',
              '待复核',
              '待确认',
              '已暂停',
              '近7天到期',
              '风险项目',
            ].map((value) => (
              <button
                type="button"
                aria-pressed={projectFilter === value}
                key={value}
                onClick={() => selectProjectFilter(value)}
              >
                {localize(value)}
              </button>
            )))}
          </div>
          <input
            aria-label={localize("搜索项目")}
            placeholder={localize("搜索项目 / 客户")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          className="pm-table-wrap"
          ref={projectListRef}
          style={{ minHeight: projectListMinHeight || undefined }}
        >
          <table className="pm-table">
            <thead>
              <tr>
                <th>{localize("项目 / 客户")}</th>
                <th>{localize("项目经理")}</th>
                <th>{localize("状态")}</th>
                <th>{localize("步骤完成进度")}</th>
                <th>{localize("计划完成")}</th>
                <th>
                  <span className="sr-only">{localize("操作")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {localize(shownProjects.map((project) => {
                const progress = projectProgress(project);
                return (
                  <tr key={project.id}>
                    <td>
                      <button
                        type="button"
                        className="pm-project-name"
                        onClick={() => onOpen('projects', project.id)}
                      >
                        {localize(project.name)}
                      </button>
                      <small>{localize(customerName(project.customerId))}</small>
                    </td>
                    <td>
                      {localize(localizeList(project.collaborators?.internal
                        ?.filter((person) =>
                          person.assignmentRoles?.includes('项目经理'),
                        )
                        .map((person) => person.name) ?? [], '、') || '未指派')}
                    </td>
                    <td>
                      <span className="pm-tag" data-status={project.status}>
                        {localize(project.status)}
                      </span>
                    </td>
                    <td>
                      <div
                        className="pm-progress"
                        title={localize("已完成或跳过的步骤／总步骤")}
                      >
                        <progress
                          aria-label={localizeMessage("{0}已完成或跳过 {1} 步／共 {2} 步", [localize(project.name), localize(progress.completed), localize(progress.total)])}
                          value={progress.percent}
                          max={100}
                        />
                        <span>
                          {localize(progress.completed)}/{localize(progress.total)}
                        </span>
                      </div>
                    </td>
                    <td
                      className={
                        projectOverdue(project, today) ? 'pm-danger' : ''
                      }
                    >
                      {localize(project.plannedCompletionDate || '未设置')}
                      {localize(projectOverdue(project, today) && <small>{localize("已逾期")}</small>)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="pm-link"
                        onClick={() => onOpen('projects', project.id)}
                      >
                        {localize("查看")}</button>
                    </td>
                  </tr>
                );
              }))}
            </tbody>
          </table>
          {localize(!shownProjects.length && <Empty text="暂无符合条件的项目" />)}
        </div>
      </section>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  const { localize } = useI18n();
  return (
    <div className="pm-empty">
      <CheckCheck size={24} />
      <span>{localize(text)}</span>
    </div>
  );
}
