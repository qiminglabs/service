'use client';
import { useI18n } from '@/lib/i18n/context';


import { useState } from 'react';
import { ChevronDown, Clock3 } from 'lucide-react';
import {
  engineerWorklogTotals,
  groupEngineerProjects,
  type engineerWorklogs,
} from '@/lib/service-engineer-dashboard';
import { formatWorklogHours } from '@/lib/request-operations';
import type { CustomerRef } from '@/lib/service-requests';

type Props = {
  rows: ReturnType<typeof engineerWorklogs>;
  customers: CustomerRef[];
  onOpen: (projectId: string) => void;
};

export function EngineerWorklogs({ rows, customers, onOpen }: Props) {
  const { localize } = useI18n();
  const [expandedProjects, setExpandedProjects] = useState<
    Record<string, boolean>
  >({});
  const customerName = (id: string) =>
    customers.find((customer) => customer.id === id)?.name || '客户信息缺失';
  const shown = rows.filter((row) => !row.log.voidedAt);
  const totals = engineerWorklogTotals(shown);
  const groups = groupEngineerProjects(shown);
  return (
    <section className="eh-worklogs" aria-label={localize("我的工时记录")}>
      <div className="eh-worklog-summary" aria-live="polite">
        <span>
          {localize(groups.length)} {localize(" 个项目 ·")}{localize(shown.length)} {localize(" 条记录")}</span>
        <span>{localize("实际工时")}{localize(formatWorklogHours(totals.hours))} {localize(" 小时")}</span>
        <span>{localize("待确认")}{localize(totals.pending)} {localize(" 条")}</span>
      </div>
      {localize(groups.length ? (
        <div className="eh-project-list eh-worklog-projects">
          {localize(groups.map(({ project, rows: projectRows }) => {
            const expanded = expandedProjects[project.id] ?? false;
            const recordsId = `eh-worklog-records-${encodeURIComponent(project.id)}`;
            return (
              <section
                className="eh-project-group"
                key={project.id}
                aria-label={localize(`项目工时：${project.name}`)}
                data-collapsed={!expanded || undefined}
              >
                <header className="eh-project-heading">
                  <button
                    type="button"
                    className="eh-project-expand-area"
                    aria-label={localize(`${expanded ? '收起' : '展开'} ${project.name} 的工时记录`)}
                    aria-expanded={expanded}
                    aria-controls={recordsId}
                    onClick={() =>
                      setExpandedProjects((previous) => ({
                        ...previous,
                        [project.id]: !expanded,
                      }))
                    }
                  />
                  <span className="eh-project-type">{localize("服务项目")}</span>
                  <div>
                    <button
                      type="button"
                      className="eh-project-name"
                      title={localize(project.name)}
                      onClick={() => onOpen(project.id)}
                    >
                      {localize(project.name)}
                    </button>
                    <p title={localize(customerName(project.customerId))}>
                      {localize(customerName(project.customerId))}
                    </p>
                  </div>
                  <span className="eh-project-hours">
                    {localize(formatWorklogHours(
                      engineerWorklogTotals(projectRows).hours,
                    ))}{localize(' ')}
                    <small>{localize("小时")}</small>
                  </span>
                  <span
                    className="eh-project-toggle"
                    data-expanded={expanded}
                    aria-hidden="true"
                  >
                    <ChevronDown size={16} />
                  </span>
                </header>
                <div
                  className="eh-worklog-table-wrap"
                  id={recordsId}
                  hidden={!expanded}
                >
                  <table className="eh-worklog-table eh-grouped-worklogs">
                    <thead>
                      <tr>
                        <th>{localize("关联工单")}</th>
                        <th>{localize("工作日期 / 时段")}</th>
                        <th>{localize("工作内容")}</th>
                        <th>{localize("实际工时")}</th>
                        <th>{localize("状态")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {localize(projectRows.map(
                        ({ log, order, status: recordStatus }) => (
                          <tr
                            key={log.id}
                            data-voided={!!log.voidedAt || undefined}
                          >
                            <td>
                              <strong>
                                {localize(order?.item.serviceName ||
                                  (log.workOrderId
                                    ? '关联工单已移除'
                                    : '未关联工单'))}
                              </strong>
                            </td>
                            <td>
                              <time>{localize(log.date)}</time>
                              <small>
                                {localize(log.startTime && log.endTime
                                  ? `${log.startTime}–${log.endTime}`
                                  : '未记录时段')}
                              </small>
                            </td>
                            <td>
                              <p>{localize(log.description)}</p>
                              {localize(log.voidedAt && (
                                <small>
                                  {localize("作废原因：")}{localize(log.voidReason || '未填写')}
                                </small>
                              ))}
                            </td>
                            <td className="eh-hours">
                              {localize(formatWorklogHours(log.hours))}
                              <small>{localize("小时")}</small>
                            </td>
                            <td>
                              <span
                                className="pm-tag"
                                data-status={recordStatus}
                              >
                                {localize(recordStatus)}
                              </span>
                            </td>
                          </tr>
                        ),
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          }))}
        </div>
      ) : (
        <div className="eh-empty">
          <Clock3 size={28} />
          <strong>{localize("当前日期范围暂无符合条件的工时记录")}</strong>
        </div>
      ))}
    </section>
  );
}
