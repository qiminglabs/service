'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  readLocal,
  canAccessRequest,
  type CustomerRef,
  type ServiceRequest,
} from '@/lib/service-requests';
import { readServiceProjects } from '@/lib/service-project-store';
import { projectReviewContext } from '@/lib/service-project-review-store';
import type { ProjectReviewContext } from '@/lib/service-project-review';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import { collaborationDashboard } from '@/lib/collaboration-dashboard';
import {
  WorkspaceFollowups,
  WorkspaceRecentActivity,
} from '@/components/workspace-followups';

type Props = {
  actor: OperationActor;
  customers: CustomerRef[];
  onOpen: (view: 'projects' | 'requests', id: string) => void;
};
const sections = [
  { key: 'projects', label: '服务项目' },
  { key: 'requests', label: '服务请求' },
] as const;
type Section = (typeof sections)[number]['key'];

export function CollaborationHome({ actor, customers, onOpen }: Props) {
  const [data, setData] = useState<{
    projects: ServiceProjectRecord[];
    requests: ServiceRequest[];
    context: ProjectReviewContext;
  }>();
  const [error, setError] = useState('');
  const [selectedSection, setSection] = useState<Section | null>(null);
  const { id, name, role } = actor;
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [projects, requests, references] = await Promise.all([
          readServiceProjects({ id, name, role }),
          readLocal<ServiceRequest>('requests'),
          readLocal<{ id: string; payload?: unknown }>('references'),
        ]);
        if (active) {
          setData({
            projects,
            requests,
            context: projectReviewContext(references, requests),
          });
          setError('');
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : '主页数据读取失败。',
          );
      }
    };
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [id, name, role]);
  const dashboard = useMemo(
    () =>
      data &&
      collaborationDashboard(
        data.projects,
        data.requests,
        { id, name, role },
        data.context,
      ),
    [data, id, name, role],
  );
  if (error)
    return (
      <div className="pm-home">
        <p role="alert" className="sr-error">
          {error}
        </p>
      </div>
    );
  if (!dashboard || !data)
    return <output className="pm-home">正在读取主页…</output>;
  const customerName = (customerId: string) =>
    customers.find((customer) => customer.id === customerId)?.name ??
    '未关联客户';
  const section =
    selectedSection ??
    sections.find((item) => dashboard[item.key].length)?.key ??
    'projects';
  const records = dashboard[section];
  const visibleRequests = data.requests.filter((request) =>
    canAccessRequest(request, { actor, directory: data.context.users }),
  );
  return (
    <div className="pm-home collaboration-home">
      <div className="collaboration-layout">
        <div className="pm-columns collaboration-top-panels">
          <WorkspaceFollowups
            id="collaboration-tasks"
            tasks={dashboard.tasks}
            customerName={customerName}
            onOpen={onOpen}
          />
          <WorkspaceRecentActivity
            activities={dashboard.activities}
            customerName={customerName}
            onOpen={onOpen}
          />
        </div>
        <section
          className="pm-panel"
          id="collaboration-records"
          aria-labelledby="collaboration-records-title"
        >
          <div className="pm-panel-heading">
            <h2 id="collaboration-records-title">未完成项目与申请</h2>
          </div>
          <div
            className="collaboration-record-tabs pm-filters"
            aria-label="未完成记录分类"
          >
            {sections.map((item) => (
              <button
                type="button"
                key={item.key}
                aria-pressed={section === item.key}
                onClick={() => {
                  setSection(item.key);
                }}
              >
                {item.label}
                <span>{dashboard[item.key].length}</span>
              </button>
            ))}
          </div>
          <div
            className="collaboration-record-list"
            aria-label={`${sections.find((item) => item.key === section)?.label}列表`}
          >
            {records.length > 0 && (
              <table className="collaboration-record-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>客户</th>
                    <th>状态</th>
                    <th>申请人</th>
                    <th>申请日期</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => {
                    const project = 'name' in record ? record : undefined;
                    const request = 'title' in record ? record : undefined;
                    const title = project?.name ?? request?.title ?? record.id;
                    const view = project ? 'projects' : 'requests';
                    const sourceRequest =
                      request ??
                      visibleRequests.find(
                        (item) => item.id === project?.sourceServiceRequestId,
                      );
                    const application =
                      sourceRequest ??
                      (project?.sourceServiceRequestId ? undefined : project);
                    const applicant =
                      application?.createdBy || sourceRequest?.owner || '—';
                    const appliedAt =
                      application?.submittedAt || application?.createdAt;
                    const applicationDate =
                      appliedAt && Number.isFinite(Date.parse(appliedAt))
                        ? new Date(appliedAt).toLocaleDateString('sv-SE')
                        : '—';
                    return (
                      <tr className="collaboration-record" key={record.id}>
                        <td>
                          <button
                            type="button"
                            className="pm-project-name"
                            onClick={() => onOpen(view, record.id)}
                          >
                            {title}
                          </button>
                        </td>
                        <td className="collaboration-record-customer">
                          {customerName(record.customerId)}
                        </td>
                        <td>
                          <span className="pm-tag" data-status={record.status}>
                            {record.status}
                          </span>
                        </td>
                        <td className="collaboration-record-applicant">
                          {applicant}
                        </td>
                        <td className="collaboration-record-date">
                          {applicationDate}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="pm-link"
                            aria-label={`查看${title}详情`}
                            onClick={() => onOpen(view, record.id)}
                          >
                            查看详情
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            {!records.length && (
              <Empty
                text={`暂无未完成的${sections.find((item) => item.key === section)?.label}`}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="pm-empty">
      <span>{text}</span>
    </div>
  );
}
