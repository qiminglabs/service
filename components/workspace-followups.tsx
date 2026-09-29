'use client';

import { useState } from 'react';
import { ArrowUpRight, CheckCheck, ClipboardList } from 'lucide-react';
import type {
  WorkspaceFollowup,
  workspaceActivities,
} from '@/lib/workspace-dashboard';

type SharedProps = {
  customerName: (id: string) => string;
  onOpen: (view: 'projects' | 'requests', id: string) => void;
};

export function WorkspaceFollowups({
  tasks,
  customerName,
  onOpen,
  id,
  categories = [],
  searchable = false,
  selectedCategory,
  onCategoryChange,
}: SharedProps & {
  tasks: WorkspaceFollowup[];
  id: string;
  categories?: string[];
  searchable?: boolean;
  selectedCategory?: string;
  onCategoryChange?: (category: string) => void;
}) {
  const [localCategory, setLocalCategory] = useState('全部事项');
  const category = selectedCategory ?? localCategory;
  const setCategory = onCategoryChange ?? setLocalCategory;
  const [query, setQuery] = useState('');
  const shown = tasks.filter(
    (task) =>
      (category === '全部事项' || task.kind === category) &&
      `${task.title} ${task.id} ${customerName(task.customerId)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section
      className="pm-panel workspace-followups"
      id={id}
      aria-labelledby={`${id}-title`}
    >
      <div className="pm-panel-heading">
        <h2 id={`${id}-title`}>
          待办与跟进 <span>{tasks.length}</span>
        </h2>
        <div className="workspace-followup-controls">
          {searchable && (
            <input
              aria-label="搜索待办"
              placeholder="搜索待办 / 编号 / 客户"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <select
            aria-label="事项类型"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            {[
              ...new Set([
                '全部事项',
                ...categories,
                ...tasks.map((task) => task.kind),
                category,
              ]),
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="pm-task-list">
        {shown.length ? (
          shown.map((task) => (
            <button
              type="button"
              className="pm-task"
              key={`${task.view}:${task.id}:${task.kind}`}
              onClick={() => onOpen(task.view, task.id)}
            >
              <span
                className={`pm-task-symbol ${task.overdue ? 'pm-orange' : 'pm-blue'}`}
              >
                <ClipboardList size={17} aria-hidden="true" />
              </span>
              <span className="pm-task-copy">
                <strong>
                  {task.title ||
                    (task.view === 'projects' ? '未命名项目' : '未命名请求')}
                </strong>
                <small>{customerName(task.customerId)}</small>
              </span>
              <span className="pm-task-end">
                <span className="pm-tag">{task.kind}</span>
                <small className={task.overdue ? 'pm-danger' : ''}>
                  {task.date
                    ? `${task.date}${task.overdue ? ' · 已逾期' : ''}`
                    : '未设置日期'}
                </small>
              </span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          ))
        ) : (
          <WorkspaceEmpty
            text={
              query || category !== '全部事项'
                ? '暂无符合条件的待跟进事项'
                : '当前没有待跟进事项'
            }
          />
        )}
      </div>
    </section>
  );
}

export function WorkspaceRecentActivity({
  activities,
  customerName,
  onOpen,
  emptyText = '暂无相关动态',
}: SharedProps & {
  activities: ReturnType<typeof workspaceActivities>;
  emptyText?: string;
}) {
  return (
    <section
      className="pm-panel workspace-recent-activity"
      aria-label="最近动态"
    >
      <div className="pm-panel-heading">
        <h2>最近动态</h2>
      </div>
      <div className="pm-activity-list">
        {activities.length ? (
          activities.map((activity) => (
            <button
              type="button"
              className="pm-activity"
              key={`${activity.view}:${activity.recordId}:${activity.id}`}
              onClick={() => onOpen(activity.view, activity.recordId)}
            >
              <span className="pm-activity-dot" />
              <span>
                <strong>
                  {activity.actor} · {activity.title}
                </strong>
                <small className="pm-activity-context">
                  <span title={activity.recordTitle}>
                    {activity.recordTitle}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span title={customerName(activity.customerId)}>
                    {customerName(activity.customerId)}
                  </span>
                </small>
              </span>
              <time dateTime={activity.at}>
                {new Date(activity.at).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                })}
              </time>
            </button>
          ))
        ) : (
          <WorkspaceEmpty text={emptyText} />
        )}
      </div>
    </section>
  );
}

function WorkspaceEmpty({ text }: { text: string }) {
  return (
    <div className="pm-empty">
      <CheckCheck size={24} aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
