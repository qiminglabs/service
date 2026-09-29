'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarDays, TriangleAlert, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  assignmentPeriod,
  assignmentOverlaps,
  type AssignmentPeriod,
  type AssignmentScheduleEntry,
} from '@/lib/work-order-assignment-schedule';
import type { OperationActor } from '@/lib/request-operations';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import { assignedEngineers } from '@/lib/service-work-orders';
import {
  assignmentCandidates,
  engineerKey,
  orderCertificationRequirements,
  missingAssignmentCertifications,
  type AssignmentDirectory,
} from '@/lib/work-order-assignment';
import {
  readWorkOrderAssignmentContext,
  saveStoredWorkOrderAssignment,
} from '@/lib/service-work-order-store';

export function WorkOrderAssignmentDialog({
  project,
  actor,
  orderIds,
  onClose,
  onBusy,
  onSaved,
}: {
  project: ServiceProjectRecord;
  actor: OperationActor;
  orderIds: string[];
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void;
}) {
  const orders = (project.workOrders ?? []).filter((order) =>
    orderIds.includes(order.id),
  );
  const initialPeople = orders.length === 1 ? assignedEngineers(orders[0]) : [];
  const [directory, setDirectory] = useState<AssignmentDirectory | null>(null);
  const [schedules, setSchedules] = useState<AssignmentScheduleEntry[]>([]);
  const [selectedKeys, setSelectedKeys] = useState(
    initialPeople.map(engineerKey),
  );
  const [query, setQuery] = useState('');
  const [company, setCompany] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const revision = useRef(project.revision);
  const lock = useRef(false);
  const orderSelection = JSON.stringify(orderIds);
  const { id: actorId, name: actorName, role: actorRole } = actor;
  useEffect(() => {
    let active = true;
    const load = () =>
      readWorkOrderAssignmentContext(
        { id: actorId, name: actorName, role: actorRole },
        project.id,
        JSON.parse(orderSelection),
      )
        .then((value) => {
          if (active) {
            setDirectory(value.directory);
            setSchedules(value.schedules);
          }
        })
        .catch((cause) => {
          if (active)
            setError(
              cause instanceof Error
                ? cause.message
                : '派单信息读取失败，请关闭后重新打开。',
            );
        });
    void load();
    window.addEventListener('focus', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
    };
  }, [actorId, actorName, actorRole, project.id, orderSelection]);
  const candidates = directory ? assignmentCandidates(project, directory) : [];
  const selected = candidates.filter((person) =>
    selectedKeys.includes(engineerKey(person)),
  );
  const unavailable = selectedKeys.filter(
    (key) => !candidates.some((person) => engineerKey(person) === key),
  );
  const companies = [
    ...new Map(
      candidates.map((person) => [person.companyId, person.companyName]),
    ).entries(),
  ];
  const filtered = candidates.filter(
    (person) =>
      (!company || person.companyId === company) &&
      `${person.name} ${person.email} ${person.companyName}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  let requirements: string[] = [],
    requirementError = '';
  if (directory) {
    try {
      requirements = [
        ...new Set(
          orders.flatMap((order) =>
            orderCertificationRequirements(order, directory),
          ),
        ),
      ];
    } catch (cause) {
      requirementError =
        cause instanceof Error ? cause.message : '无法读取认证要求。';
    }
  }
  const missing = missingAssignmentCertifications(requirements, selected);
  const periods = orders.map((order) => assignmentPeriod(project, order));
  const overlaps = assignmentOverlaps(
    periods.filter((period): period is AssignmentPeriod => !!period),
    selected.map(engineerKey),
    schedules,
  );
  const title =
    orders.length > 1
      ? '批量指派工单'
      : initialPeople.length
        ? '改派工单'
        : '指派工单';
  async function save() {
    if (
      lock.current ||
      !directory ||
      !selected.length ||
      unavailable.length ||
      missing.length ||
      requirementError
    )
      return;
    lock.current = true;
    setSaving(true);
    onBusy(true);
    setError('');
    try {
      const saved = await saveStoredWorkOrderAssignment(
        project.id,
        revision.current,
        actor,
        {
          orderIds,
          assignees: selected.map(({ id, group }) => ({ id, group })),
        },
      );
      onSaved(saved);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '指派失败，请重试。');
    } finally {
      lock.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent className="wo-dispatch-dialog" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {project.name} · {orders.length} 张工单 ·{' '}
            {project.serviceProviderName || '未设置服务方'}
          </DialogDescription>
        </DialogHeader>
        <div className="wo-dispatch-body">
          <div className="wo-dispatch-project-dates">
            <CalendarDays size={16} aria-hidden="true" />
            <strong>项目日期</strong>
            <span>
              {project.expectedServiceDate || '未设置'} 至{' '}
              {project.plannedCompletionDate || '未设置'}
            </span>
          </div>
          <div className="wo-dispatch-orders">
            {orders.map((order, index) => (
              <span key={order.id}>
                <strong>{order.item.serviceName}</strong>
                <small>{order.id}</small>
                <span className="wo-dispatch-order-dates">
                  {periods[index]?.source === 'project'
                    ? '采用项目日期'
                    : '工单日期'}
                  ：
                  {periods[index]
                    ? `${periods[index]!.start} 至 ${periods[index]!.end}`
                    : `${order.expectedServiceDate || '未设置'} 至 ${order.plannedCompletionDate || '未设置'}`}
                </span>
              </span>
            ))}
          </div>
          <div className="wo-dispatch-requirements">
            <strong>所需认证</strong>
            <span>
              {directory
                ? requirements.join('、') ||
                  (requirementError ? '无法确定' : '无认证要求')
                : '读取中…'}
            </span>
          </div>
          <div className="wo-dispatch-filters">
            <label>
              <Search size={16} aria-hidden="true" />
              <Input
                aria-label="搜索可派工程师"
                placeholder="搜索姓名、邮箱或企业"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <select
              aria-label="筛选工程师企业"
              value={company}
              onChange={(event) => setCompany(event.target.value)}
            >
              <option value="">全部企业</option>
              {companies.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </div>
          <div className="wo-dispatch-selected" aria-live="polite">
            <strong>已选 {selectedKeys.length} 人</strong>
            {selectedKeys.map((key) => {
              const person =
                candidates.find((person) => engineerKey(person) === key) ??
                initialPeople.find((person) => engineerKey(person) === key);
              return (
                <span key={key}>
                  {person?.name || key}
                  {unavailable.includes(key) && '（不可用）'}
                  <button
                    type="button"
                    aria-label={`移除${person?.name || key}`}
                    disabled={saving}
                    onClick={() =>
                      setSelectedKeys((keys) =>
                        keys.filter((item) => item !== key),
                      )
                    }
                  >
                    <X size={13} />
                  </button>
                </span>
              );
            })}
          </div>
          {directory &&
            selected.length > 0 &&
            (overlaps.length > 0 || periods.some((period) => !period)) && (
              <section
                className="wo-dispatch-schedule-warning"
                role="status"
                aria-live="polite"
              >
                {overlaps.length > 0 && (
                  <>
                    <header>
                      <TriangleAlert size={17} aria-hidden="true" />
                      <strong>
                        {overlaps.length}{' '}
                        名已选工程师存在工单日期重叠，可继续指派
                      </strong>
                    </header>
                    <div className="wo-dispatch-overlaps">
                      {overlaps.map((group) => (
                        <div key={group.key}>
                          <strong>
                            {
                              selected.find(
                                (person) => engineerKey(person) === group.key,
                              )?.name
                            }{' '}
                            · {group.orders.length} 张已有工单
                          </strong>
                          <ul>
                            {group.orders.map((entry) => (
                              <li key={entry.key}>
                                <span>
                                  {entry.orderName} · {entry.projectName}
                                </span>
                                <small>
                                  重叠日期：
                                  {entry.ranges
                                    .map((range) =>
                                      range.start === range.end
                                        ? range.start
                                        : `${range.start} 至 ${range.end}`,
                                    )
                                    .join('、')}
                                  {entry.period.source === 'project' &&
                                    '（按项目日期）'}
                                </small>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {periods.some((period) => !period) && (
                  <p>部分工单日期未完整设置或无效，暂未检查其日期重叠。</p>
                )}
              </section>
            )}
          <div className="wo-dispatch-table-scroll">
            <table className="reference-table wo-dispatch-table">
              <thead>
                <tr>
                  <th>选择</th>
                  <th>姓名</th>
                  <th>所属企业</th>
                  <th>角色</th>
                  <th>有效认证</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((person) => (
                  <tr
                    key={engineerKey(person)}
                    data-selected={selectedKeys.includes(engineerKey(person))}
                  >
                    <td>
                      <Checkbox
                        aria-label={`选择工程师 ${person.name} ${person.companyName}`}
                        disabled={saving}
                        checked={selectedKeys.includes(engineerKey(person))}
                        onCheckedChange={(checked) =>
                          setSelectedKeys((keys) =>
                            checked
                              ? [...keys, engineerKey(person)]
                              : keys.filter(
                                  (key) => key !== engineerKey(person),
                                ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <strong>{person.name}</strong>
                      <small>{person.email}</small>
                    </td>
                    <td>{person.companyName}</td>
                    <td>{person.role}</td>
                    <td>
                      {person.certifications.length ? (
                        <div className="wo-dispatch-certs">
                          {[
                            ...new Set(
                              person.certifications.map(
                                (cert) => cert.certification,
                              ),
                            ),
                          ].map((name) => (
                            <span className="wo-dispatch-cert" key={name}>
                              {name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        '无有效认证'
                      )}
                    </td>
                  </tr>
                ))}
                {!filtered.length && (
                  <tr>
                    <td colSpan={5} className="routing-empty">
                      {!directory
                        ? error
                          ? '无法读取工程师'
                          : '正在读取工程师…'
                        : query || company
                          ? '暂无匹配工程师'
                          : '当前服务方下暂无可派工程师'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {directory && !requirementError && selectedKeys.length > 0 && (
            <p
              className={
                missing.length || unavailable.length
                  ? 'sr-error'
                  : 'wo-dispatch-covered'
              }
              role="status"
            >
              {unavailable.length
                ? '包含不可用工程师，请移除后重新选择。'
                : missing.length
                  ? `认证未满足：${missing.join('、')}`
                  : '所选人员认证并集已满足全部所选工单要求'}
            </p>
          )}
          {(error || requirementError) && (
            <p className="sr-error" role="alert">
              {error || requirementError}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={onClose}>
            取消
          </Button>
          <Button
            disabled={
              saving ||
              !directory ||
              !selected.length ||
              !!unavailable.length ||
              !!missing.length ||
              !!requirementError
            }
            onClick={() => void save()}
          >
            {saving
              ? '指派中…'
              : orders.length > 1
                ? '确认批量指派'
                : title === '改派工单'
                  ? '确认改派'
                  : '确认指派'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
