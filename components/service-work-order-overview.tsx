'use client';
import { useI18n } from '@/lib/i18n/context';


import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { canAssignWorkOrders, dispatchableWorkOrders } from '@/lib/work-order-assignment';
import { WorkOrderAssignmentDialog } from '@/components/work-order-assignment-dialog';
import { WorkOrderChangeAction, WorkOrderSuspensionAction } from '@/components/work-order-change-actions';
import type { CatalogService } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { ProjectCollaboratorDirectory } from '@/lib/service-project-collaborators';
import {
  canViewWorkOrderOverview,
  assignedEngineers,
  workOrderProgress,
  workOrderOverdue,
  workOrderUpdatedAt,
} from '@/lib/service-work-orders';

export function ServiceWorkOrderOverview({
  project,
  actor,
  services,
  busy,
  onBusy,
  onSaved,
  onExecute,
}: {
  project: ServiceProjectRecord;
  actor: OperationActor;
  directory: ProjectCollaboratorDirectory;
  services: CatalogService[];
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void;
  onExecute: (id: string) => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [dispatchIds, setDispatchIds] = useState<string[] | null>(null);
  const [notice, setNotice] = useState('');
  if (!canViewWorkOrderOverview(project, actor)) return null;
  const orders = project.workOrders ?? [];
  const dispatchable = dispatchableWorkOrders(project);
  const selectedOrders = dispatchable.filter(order => selectedOrderIds.includes(order.id));
  const today = new Date().toLocaleDateString('sv-SE');
  const cancelled = project.status === '已取消';
  const canAssign = canAssignWorkOrders(project, actor);
  const completed = orders.filter((order) => order.status === '已完成').length;
  return (
    <section className="wo-overview" aria-label={localize("工单概览")}>
      <div className="wo-overview-panel">
        <header className="wo-overview-heading">
          <h3>{localize("项目工单")}</h3>
          <span>
            {localize("已完成")}{localize(completed)} / {localize(orders.filter(order => order.status !== '已取消').length)} {localize(" 张")}</span>
          <WorkOrderChangeAction project={project} actor={actor} busy={busy} onBusy={onBusy} onSaved={onSaved} services={services} />
          {localize(canAssign && <Button disabled={busy || !selectedOrders.length} onClick={() => setDispatchIds(selectedOrders.map(order => order.id))}>{localize("批量指派")}{localize(selectedOrders.length ? localizeMessage("（{0}）", [String(localize(selectedOrders.length))]) : '')}</Button>)}
        </header>
        {localize(notice && <output className="sr-notice">{localize(notice)}</output>)}
        {localize(orders.length === 0 ? (
          <div className="wo-overview-empty">
            {localize(project.status === '待启动' ? '项目启动后生成工单' : '暂无工单')}
          </div>
        ) : (
          <div className="sr-table-scroll">
            <table className="sr-table wo-overview-table">
              <thead>
                <tr>
                  {localize(canAssign && <th className="wo-overview-select-cell"><Checkbox aria-label={localize("选择全部可指派工单")} disabled={busy || !dispatchable.length} checked={!!dispatchable.length && selectedOrders.length === dispatchable.length} indeterminate={!!selectedOrders.length && selectedOrders.length < dispatchable.length} onCheckedChange={checked => setSelectedOrderIds(checked ? dispatchable.map(order => order.id) : [])} /></th>)}
                  <th>{localize("工单")}</th>
                  <th>{localize("执行工程师")}</th>
                  <th>{localize("状态")}</th>
                  <th>{localize("步骤进度")}</th>
                  <th>{localize("计划时间")}</th>
                  <th>{localize("最近更新")}</th>
                  <th>{localize("操作")}</th>
                </tr>
              </thead>
              <tbody>
                {localize(orders.map((order) => {
                  const progress = workOrderProgress(order);
                  const late = workOrderOverdue(project, order, today);
                  const status =
                    cancelled && !['已完成', '已取消'].includes(order.status)
                      ? '已取消'
                      : order.status;
                  return (
                    <tr key={order.id}>
                      {localize(canAssign && <td className="wo-overview-select-cell"><Checkbox aria-label={localizeMessage("选择工单 {0} {1}", [localize(order.item.serviceName), localize(order.id)])} disabled={busy || ['已完成', '已取消'].includes(order.status)} checked={!['已完成', '已取消'].includes(order.status) && selectedOrderIds.includes(order.id)} onCheckedChange={checked => setSelectedOrderIds(ids => checked ? [...ids, order.id] : ids.filter(id => id !== order.id))} /></td>)}
                      <td className="wo-overview-text-cell">
                        <button
                          type="button"
                          className="wo-overview-link"
                          disabled={busy}
                          onClick={() => onExecute(order.id)}
                        >
                          {localize(order.item.serviceName)}
                        </button>
                        <small className="wo-overview-id" title={localize(order.id)}>
                          {localize(order.id)}
                        </small>
                      </td>
                      <td className="wo-overview-text-cell">
                        {localize(assignedEngineers(order).length ? assignedEngineers(order).map(person => <span className="wo-overview-assignee" key={`${person.group}:${person.id}`}>{localize(person.name)}<small>{localize(person.group === 'internal' ? '原厂工程师' : '合作伙伴工程师')}</small></span>) : <span className="wo-overview-muted">{localize("未指派")}</span>)}
                      </td>
                      <td className="wo-overview-text-cell">
                        <span
                          className="wo-status"
                          data-tone={
                            status === '已完成'
                              ? 'green'
                              : status === '进行中'
                                ? 'blue'
                                : 'gray'
                          }
                        >
                          {localize(status)}
                        </span>
                        {localize(order.cancellation && <small>{localize(order.cancellation.reason)}<br />{localize(order.cancellation.actorName)} · {localize(new Date(order.cancellation.at).toLocaleString('zh-CN', { hour12: false }))}</small>)}
                        {localize(late && (
                          <small className="wo-overview-overdue">{localize("已逾期")}</small>
                        ))}
                      </td>
                      <td>
                        <span>
                          {localize(progress.completed + progress.skipped)} / {localize(progress.total)} {localize(" 完成")}</span>
                        <progress
                          className="wo-overview-progress"
                          value={progress.completed + progress.skipped}
                          max={progress.total || 1}
                          aria-label={localizeMessage("{0}步骤完成进度", [localize(order.item.serviceName)])}
                        />
                      </td>
                      <td>
                        <span>{localize(order.expectedServiceDate || '未设置')}</span>
                        <small>
                          {localize("至")}{localize(order.plannedCompletionDate || '未设置')}
                        </small>
                      </td>
                      <td>
                        {localize(workOrderUpdatedAt(order)
                          ? new Date(workOrderUpdatedAt(order)).toLocaleString(
                              'zh-CN',
                              { hour12: false },
                            )
                          : '—')}
                      </td>
                      <td>
                        <div className="wo-overview-actions">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => onExecute(order.id)}
                          >
                            {localize("查看")}</Button>
                          {localize(canAssign && !['已完成', '已取消'].includes(order.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setNotice(''); setDispatchIds([order.id]); }}>{localize("改派")}</Button>)}
                          <WorkOrderSuspensionAction project={project} actor={actor} order={order} busy={busy} onBusy={onBusy} onSaved={onSaved} />
                          <WorkOrderChangeAction compact project={project} actor={actor} order={order} busy={busy} onBusy={onBusy} onSaved={onSaved} />
                        </div>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
      {localize(dispatchIds && <WorkOrderAssignmentDialog project={project} actor={actor} orderIds={dispatchIds} onClose={() => setDispatchIds(null)} onBusy={onBusy} onSaved={saved => { onSaved(saved); setSelectedOrderIds([]); setNotice('工单指派已保存。'); }} />)}
    </section>
  );
}
