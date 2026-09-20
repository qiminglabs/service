'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { canAssignWorkOrders } from '@/lib/work-order-assignment';
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
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [dispatchIds, setDispatchIds] = useState<string[] | null>(null);
  const [notice, setNotice] = useState('');
  if (!canViewWorkOrderOverview(project, actor)) return null;
  const orders = project.workOrders ?? [];
  const dispatchable = orders.filter(order => !['已完成', '已取消'].includes(order.status));
  const selectedOrders = dispatchable.filter(order => selectedOrderIds.includes(order.id));
  const today = new Date().toLocaleDateString('sv-SE');
  const cancelled = project.status === '已取消';
  const canAssign = canAssignWorkOrders(project, actor);
  const completed = orders.filter((order) => order.status === '已完成').length;
  return (
    <section className="wo-overview" aria-label="工单概览">
      <div className="wo-overview-panel">
        <header className="wo-overview-heading">
          <h3>项目工单</h3>
          <span>
            已完成 {completed} / {orders.filter(order => order.status !== '已取消').length} 张
          </span>
          <WorkOrderChangeAction project={project} actor={actor} busy={busy} onBusy={onBusy} onSaved={onSaved} services={services} />
          {canAssign && <Button disabled={busy || !selectedOrders.length} onClick={() => setDispatchIds(selectedOrders.map(order => order.id))}>批量指派{selectedOrders.length ? `（${selectedOrders.length}）` : ''}</Button>}
        </header>
        {notice && <output className="sr-notice">{notice}</output>}
        {orders.length === 0 ? (
          <div className="wo-overview-empty">
            {project.status === '待启动' ? '项目启动后生成工单' : '暂无工单'}
          </div>
        ) : (
          <div className="sr-table-scroll">
            <table className="sr-table wo-overview-table">
              <thead>
                <tr>
                  {canAssign && <th className="wo-overview-select-cell"><Checkbox aria-label="选择全部可指派工单" disabled={busy || !dispatchable.length} checked={!!dispatchable.length && selectedOrders.length === dispatchable.length} indeterminate={!!selectedOrders.length && selectedOrders.length < dispatchable.length} onCheckedChange={checked => setSelectedOrderIds(checked ? dispatchable.map(order => order.id) : [])} /></th>}
                  <th>工单</th>
                  <th>执行工程师</th>
                  <th>状态</th>
                  <th>步骤进度</th>
                  <th>计划时间</th>
                  <th>最近更新</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const progress = workOrderProgress(order);
                  const late = workOrderOverdue(project, order, today);
                  const status =
                    cancelled && !['已完成', '已取消'].includes(order.status)
                      ? '已取消'
                      : order.status;
                  return (
                    <tr key={order.id}>
                      {canAssign && <td className="wo-overview-select-cell"><Checkbox aria-label={`选择工单 ${order.item.serviceName} ${order.id}`} disabled={busy || ['已完成', '已取消'].includes(order.status)} checked={!['已完成', '已取消'].includes(order.status) && selectedOrderIds.includes(order.id)} onCheckedChange={checked => setSelectedOrderIds(ids => checked ? [...ids, order.id] : ids.filter(id => id !== order.id))} /></td>}
                      <td>
                        <button
                          type="button"
                          className="wo-overview-link"
                          disabled={busy}
                          onClick={() => onExecute(order.id)}
                        >
                          {order.item.serviceName}
                        </button>
                        <small className="wo-overview-id" title={order.id}>
                          {order.id}
                        </small>
                      </td>
                      <td>
                        {assignedEngineers(order).length ? assignedEngineers(order).map(person => <span className="wo-overview-assignee" key={`${person.group}:${person.id}`}>{person.name}<small>{person.group === 'internal' ? '原厂工程师' : '合作伙伴工程师'}</small></span>) : <span className="wo-overview-muted">未指派</span>}
                      </td>
                      <td>
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
                          {status}
                        </span>
                        {order.cancellation && <small>{order.cancellation.reason}<br />{order.cancellation.actorName} · {new Date(order.cancellation.at).toLocaleString('zh-CN', { hour12: false })}</small>}
                        {late && (
                          <small className="wo-overview-overdue">已逾期</small>
                        )}
                      </td>
                      <td>
                        <span>
                          {progress.completed + progress.skipped} / {progress.total} 完成
                        </span>
                        <progress
                          className="wo-overview-progress"
                          value={progress.completed + progress.skipped}
                          max={progress.total || 1}
                          aria-label={`${order.item.serviceName}步骤完成进度`}
                        />
                      </td>
                      <td>
                        <span>{order.expectedServiceDate || '未设置'}</span>
                        <small>
                          至 {order.plannedCompletionDate || '未设置'}
                        </small>
                      </td>
                      <td>
                        {workOrderUpdatedAt(order)
                          ? new Date(workOrderUpdatedAt(order)).toLocaleString(
                              'zh-CN',
                              { hour12: false },
                            )
                          : '—'}
                      </td>
                      <td>
                        <div className="wo-overview-actions">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => onExecute(order.id)}
                          >
                            查看
                          </Button>
                          {canAssign && !['已完成', '已取消'].includes(order.status) && <Button variant="outline" size="sm" disabled={busy} onClick={() => { setNotice(''); setDispatchIds([order.id]); }}>改派</Button>}
                          <WorkOrderSuspensionAction project={project} actor={actor} order={order} busy={busy} onBusy={onBusy} onSaved={onSaved} />
                          <WorkOrderChangeAction compact project={project} actor={actor} order={order} busy={busy} onBusy={onBusy} onSaved={onSaved} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dispatchIds && <WorkOrderAssignmentDialog project={project} actor={actor} orderIds={dispatchIds} onClose={() => setDispatchIds(null)} onBusy={onBusy} onSaved={saved => { onSaved(saved); setSelectedOrderIds([]); setNotice('工单指派已保存。'); }} />}
    </section>
  );
}
