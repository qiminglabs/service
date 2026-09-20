'use client';
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Check,
  Download,
  Play,
  Save,
  ChevronDown,
  BookOpen,
  Minus,
} from 'lucide-react';
import type { ProjectCollaboratorDirectory } from '@/lib/service-project-collaborators';
import { DateField } from '@/components/date-field';
import { WorkOrderBasicInfoEditor } from '@/components/work-order-basic-info-editor';
import { WorkOrderFormFields } from '@/components/work-order-form-fields';
import { projectScheduleIssue } from '@/lib/service-project-dates';
import { projectFieldReadonly } from '@/lib/service-project-readonly';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { FormFieldsLayout } from '@/components/request-form-layout';
import { ExecutionFieldControl } from '@/components/service-execution-field-control';
import { ServiceStepMaterialPreview } from '@/components/service-step-material-preview';
import { executionFormLayout } from '@/lib/service-execution-forms';
import {
  downloadFile,
  type InternalUser,
  type StoredFile,
} from '@/lib/service-requests';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import {
  canStartServiceProject,
  canExecuteSpecificWorkOrder,
  assignedEngineers,
  workStepForm,
  type ServiceWorkOrder,
  type WorkOrderStep,
  type WorkStepData,
  type WorkStepAction,
} from '@/lib/service-work-orders';
import {
  startStoredServiceProject,
  saveStoredWorkStep,
} from '@/lib/service-work-order-store';
import { safeStepLink } from '@/lib/service-flow-steps';
import {
  stepDocuments,
  stepFiles,
  type StepDocument,
  type StepFile,
} from '@/lib/service-step-deliverables';
import { generalStepDescription } from '@/lib/service-step-general';

export function StartProjectButton({
  project,
  actor,
  users,
  busy,
  onSaved,
}: {
  project: ServiceProjectRecord;
  actor: OperationActor;
  users: InternalUser[];
  busy: boolean;
  onSaved: (project: ServiceProjectRecord) => void;
}) {
  const [open, setOpen] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [executionDate, setExecutionDate] = useState(
    project.expectedServiceDate ?? '',
  );
  const [completionDate, setCompletionDate] = useState(
    project.plannedCompletionDate ?? '',
  );
  const lock = useRef(false);
  if (!canStartServiceProject(project, actor, users)) return null;
  return (
    <>
      <Button
        disabled={busy || saving}
        onClick={() => {
          setExecutionDate(project.expectedServiceDate ?? '');
          setCompletionDate(project.plannedCompletionDate ?? '');
          setOpen(true);
          setError('');
        }}
      >
        <Play size={16} />
        启动项目
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!saving) setOpen(value);
        }}
      >
        <DialogContent showCloseButton={!saving}>
          <DialogHeader>
            <DialogTitle>启动项目并生成工单</DialogTitle>
            <DialogDescription>
              启动后将锁定全部服务项，每个服务项生成一张工单，按当前分配规则保存执行流程。请先保存项目信息及服务项修改。
            </DialogDescription>
          </DialogHeader>
          <p>项目：{project.name}</p>
          <p>服务项：{project.items?.length ?? 0} 项</p>
          <div className="sr-form-grid" style={{ padding: 0 }}>
            <DateField
              id="start-project-execution-date"
              label="计划执行日期"
              required
              value={executionDate}
              readonly={projectFieldReadonly(project, 'expectedServiceDate')}
              disabled={saving}
              onChange={setExecutionDate}
            />
            <DateField
              id="start-project-completion-date"
              label="计划完成日期"
              required
              value={completionDate}
              disabled={saving}
              onChange={setCompletionDate}
            />
          </div>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={saving || !project.items?.length}
              onClick={async () => {
                if (lock.current) return;
                const schedule = {
                  expectedServiceDate: executionDate,
                  plannedCompletionDate: completionDate,
                };
                const issue = projectScheduleIssue(schedule, true);
                if (issue) {
                  setError(issue);
                  return;
                }
                lock.current = true;
                setSaving(true);
                setError('');
                try {
                  const next = await startStoredServiceProject(
                    project.id,
                    project.revision,
                    actor,
                    schedule,
                  );
                  onSaved(next);
                  setOpen(false);
                } catch (issue) {
                  setError(
                    issue instanceof Error ? issue.message : '启动失败。',
                  );
                } finally {
                  lock.current = false;
                  setSaving(false);
                }
              }}
            >
              {saving ? '正在生成…' : '启动并生成工单'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
export type WorkOrderSections = { basic: boolean; execution: boolean; system: boolean };

export function ServiceWorkOrders({
  sectionMemory,
  onSectionsChange,
  directory,
  selectedOrderId,
  onOrderChange,
  project,
  actor,
  busy,
  onSaved,
  onDirty,
  onBusy,
}: {
  sectionMemory: Record<string, WorkOrderSections>;
  onSectionsChange: Dispatch<SetStateAction<Record<string, WorkOrderSections>>>;
  directory: ProjectCollaboratorDirectory;
  selectedOrderId: string;
  onOrderChange: (id: string) => void;
  project: ServiceProjectRecord;
  actor: OperationActor;
  busy: boolean;
  onSaved: (project: ServiceProjectRecord) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const dirty = useRef(false);
  const markDirty = (value: boolean) => {
    dirty.current = value;
    onDirty(value);
  };
  const canLeave = () =>
    !dirty.current ||
    window.confirm('当前步骤有未保存的修改，是否放弃并切换？');
  const orders = project.workOrders ?? [];
  const order = orders.find((order) => order.id === selectedOrderId) ?? orders[0];
  if (!order)
    return (
      <section className="sr-panel wo-empty">
        <h3>工单</h3>
        <p>
          {project.status === '待启动'
            ? '项目经理启动项目后，将按服务项自动生成工单。'
            : '该项目暂无工单记录。'}
        </p>
      </section>
    );
  return (
    <div className="wo-workspace">
      <div className="wo-toolbar">
        <div className="wo-order-switcher">
          <span id="work-order-label" className="wo-switcher-label">
            当前工单
          </span>
          <Select
            value={order.id}
            disabled={busy}
            onValueChange={(value) => {
              if (value && value !== order.id && canLeave()) {
                markDirty(false);
                onOrderChange(value);
              }
            }}
          >
            <SelectTrigger
              aria-labelledby="work-order-label"
              className="wo-order-trigger"
              title={order.item.serviceName}
            >
              <span className="wo-order-caption">
                <span className="wo-order-name">{order.item.serviceName}</span>
              </span>
            </SelectTrigger>
            <SelectContent align="start" alignItemWithTrigger={false}>
              {orders.map((entry) => (
                <SelectItem
                  key={entry.id}
                  value={entry.id}
                  label={`${entry.id} · ${entry.item.serviceName}`}
                >
                  <span className="wo-order-option">
                    <strong>{entry.item.serviceName}</strong>
                    <small>
                      {entry.id} ·{' '}
                      {project.status === '已取消' ? '已取消' : entry.status}
                    </small>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span
            className="wo-status"
            data-tone={
              (project.status === '已取消' || order.status === '已取消' || order.status === '待执行')
                ? 'gray'
                : order.status === '已完成'
                  ? 'green'
                  : 'blue'
            }
          >
            {project.status === '已取消'
              ? '已取消'
              : order.status === '进行中'
                ? '执行中'
                : order.status}
          </span>
        </div>
        <div className="wo-toolbar-context">
          <div className="wo-engineers" aria-label="执行工程师">
            <span>执行工程师</span>
            <span>
              {assignedEngineers(order).map(person => person.name).join('、') || '未指派'}
            </span>
          </div>
        </div>
      </div>
      <WorkOrderDetail
        sectionMemory={sectionMemory}
        onSectionsChange={onSectionsChange}
        directory={directory}
        key={order.id}
        project={project}
        order={order}
        actor={actor}
        busy={busy}
        onSaved={onSaved}
        onBusy={onBusy}
        onDirty={markDirty}
        canLeave={canLeave}
      />
    </div>
  );
}
function WorkOrderDetail({
  sectionMemory,
  onSectionsChange,
  directory,
  project,
  order,
  actor,
  busy,
  onSaved,
  onDirty,
  onBusy,
  canLeave,
}: {
  sectionMemory: Record<string, WorkOrderSections>;
  onSectionsChange: Dispatch<SetStateAction<Record<string, WorkOrderSections>>>;
  directory: ProjectCollaboratorDirectory;
  project: ServiceProjectRecord;
  order: ServiceWorkOrder;
  actor: OperationActor;
  busy: boolean;
  onSaved: (project: ServiceProjectRecord) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
  canLeave: () => boolean;
}) {
  const [sections, setSections] = useState<WorkOrderSections>(() => {
    const remembered = sectionMemory[order.id];
    if (remembered) return remembered;
    const cancelled = order.status === '已取消' || project.status === '已取消';
    const completed = order.status === '已完成';
    return {
      basic: cancelled || completed,
      execution: !cancelled && (!completed || project.status === '待复核'),
      system: cancelled,
    };
  });
  useEffect(() => {
    onSectionsChange(memory => memory[order.id] === sections ? memory : { ...memory, [order.id]: sections });
  }, [onSectionsChange, order.id, sections]);
  const toggleSection = (section: keyof WorkOrderSections, open: boolean) => {
    setSections(current => current[section] === open ? current : { ...current, [section]: open });
  };
  const cancellation = order.cancellation ?? (project.status === '已取消' && project.cancellation
    ? { ...project.cancellation, actorName: project.cancellation.actor } : undefined);
  const [stepId, setStepId] = useState(
    order.steps.find((step) => !['已完成', '已跳过'].includes(step.status))
      ?.definition.id ??
      order.steps[0]?.definition.id ??
      '',
  );
  const selected =
    order.steps.find((step) => step.definition.id === stepId) ?? order.steps[0];
  const done = order.steps.filter((step) =>
    ['已完成', '已跳过'].includes(step.status),
  ).length;
  return (
    <>
      <details className="wo-basic wo-basic-info" open={sections.basic} onToggle={event => toggleSection('basic', event.currentTarget.open)}>
        <summary>
          <span>
            基本信息
          </span>
          <span className="wo-basic-toggle">
            <span className="wo-expand-label">查看详情</span>
            <span className="wo-collapse-label">收起详情</span>
            <ChevronDown size={15} aria-hidden="true" />
          </span>
        </summary>
        <WorkOrderBasicInfoEditor directory={directory} project={project} order={order} actor={actor} busy={busy} onBusy={onBusy} onSaved={onSaved} />
        <WorkOrderFormFields item={order.item} readonly leadingFields={[
          { id: 'plannedStart', label: '计划执行日期', value: order.expectedServiceDate || '—' },
          { id: 'plannedEnd', label: '计划完成日期', value: order.plannedCompletionDate || '未填写' },
          { id: 'contact', label: '现场联系人', value: order.contactName || '—' },
          { id: 'phone', label: '联系电话', value: order.contactPhone || '—' },
        ]} />
      </details>
      <details className="wo-basic wo-execution-section" open={sections.execution} onToggle={event => toggleSection('execution', event.currentTarget.open)}>
        <summary>
          <span className="wo-execution-summary">
            执行信息
            <span className="wo-execution-progress">
              <progress value={done} max={order.steps.length || 1} aria-label="工单步骤完成进度" />
              <span className="wo-execution-count">{done} / {order.steps.length} 完成</span>
            </span>
          </span>
          <span className="wo-basic-toggle"><span className="wo-expand-label">查看详情</span><span className="wo-collapse-label">收起详情</span><ChevronDown size={15} aria-hidden="true" /></span>
        </summary>
        <section className="wo-execution">
          <aside className="wo-navigation" aria-label="执行步骤">
            <div className="wo-navigation-inner">
              <div className="wo-progress"><strong>执行步骤</strong></div>
              <div className="wo-step-list">
              {order.steps.map((step, index) => (
                <div key={step.definition.id}>
                  {step.phaseName &&
                    (index === 0 ||
                      order.steps[index - 1].phaseName !== step.phaseName) && (
                      <h4 className="wo-phase">
                        <span>{step.phaseName}</span>
                        <span>
                          {
                            order.steps.filter(
                              (entry) =>
                                entry.phaseName === step.phaseName &&
                                ['已完成', '已跳过'].includes(entry.status),
                            ).length
                          }
                          /
                          {
                            order.steps.filter(
                              (entry) => entry.phaseName === step.phaseName,
                            ).length
                          }
                        </span>
                      </h4>
                    )}
                  <button
                    type="button"
                    className="wo-step-link"
                    disabled={busy}
                    data-selected={selected?.definition.id === step.definition.id}
                    data-complete={step.status === '已完成'}
                    data-skipped={step.status === '已跳过'}
                    title={`${step.definition.name} · ${step.status} · ${step.definition.required ? '必做' : '可选'}`}
                    aria-label={`${index + 1}. ${step.definition.name}，${step.status}，${step.definition.required ? '必做' : '可选'}`}
                    onClick={() => {
                      if (step.definition.id !== stepId && canLeave()) {
                        onDirty(false);
                        setStepId(step.definition.id);
                      }
                    }}
                    aria-current={
                      selected?.definition.id === step.definition.id
                        ? 'step'
                        : undefined
                    }
                  >
                    <span className="wo-step-number">
                      {step.status === '已完成' ? (
                        <Check size={16} />
                      ) : step.status === '已跳过' ? (
                        <Minus size={16} />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <span>
                      <strong>{step.definition.name}</strong>
                    </span>
                  </button>
                </div>
              ))}
            </div>
            </div>
          </aside>
          {selected && (
            <WorkStepEditor
              key={`${order.id}:${selected.definition.id}`}
              project={project}
              order={order}
              step={selected}
              actor={actor}
              busy={busy}
              onBusy={onBusy}
              onDirty={onDirty}
              onSaved={(next) => {
                onSaved(next);
                const updatedOrder = next.workOrders?.find(
                  (row) => row.id === order.id,
                );
                const saved = updatedOrder?.steps.find(
                  (row) => row.definition.id === selected.definition.id,
                );
                if (
                  saved &&
                  !['已完成', '已跳过'].includes(selected.status) &&
                  ['已完成', '已跳过'].includes(saved.status)
                ) {
                  const nextStep = updatedOrder?.steps.find(
                    (row) => !['已完成', '已跳过'].includes(row.status),
                  );
                  if (nextStep) setStepId(nextStep.definition.id);
                }
              }}
            />
          )}
        </section>
      </details>
      <details className="wo-basic wo-system" open={sections.system} onToggle={event => toggleSection('system', event.currentTarget.open)}>
        <summary><span>系统信息</span><span className="wo-basic-toggle"><span className="wo-expand-label">查看详情</span><span className="wo-collapse-label">收起详情</span><ChevronDown size={15} aria-hidden="true" /></span></summary>
        <dl className="sr-system-info">
          <div>
            <dt>工单编号</dt>
            <dd>{order.id}</dd>
          </div>
          <div>
            <dt>服务目录</dt>
            <dd>
              {order.item.serviceName}（{order.item.serviceId}）
            </dd>
          </div>
          <div>
            <dt>客户</dt>
            <dd>{order.customerName}</dd>
          </div>
          <div>
            <dt>服务方</dt>
            <dd>{order.providerName || '未指定'}</dd>
          </div>
          <div>
            <dt>执行流程</dt>
            <dd>
              {order.flowName} · {order.matchedRuleName || '默认服务流程'}
            </dd>
          </div>
          <div>
            <dt>生成时间</dt>
            <dd>
              {new Date(order.createdAt).toLocaleString('zh-CN', {
                hour12: false,
              })}{' '}
              · {order.createdBy}
            </dd>
          </div>
          {cancellation && <>
            <div><dt>取消原因</dt><dd className="whitespace-pre-wrap">{cancellation.reason}</dd></div>
            <div><dt>取消时间</dt><dd>{new Date(cancellation.at).toLocaleString('zh-CN', { hour12: false })} · {cancellation.actorName}</dd></div>
          </>}
          <div><dt>实际执行日期</dt><dd>{order.startedAt ? new Date(order.startedAt).toLocaleDateString('zh-CN') : order.status === '待执行' ? '—' : '未记录'}</dd></div>
          <div><dt>实际完成日期</dt><dd>{order.completedAt ? new Date(order.completedAt).toLocaleDateString('zh-CN') : order.status === '已完成' ? '未记录' : '—'}</dd></div>
        </dl>
      </details>
    </>
  );
}
function WorkStepEditor({
  project,
  order,
  step,
  actor,
  busy,
  onSaved,
  onDirty,
  onBusy,
}: {
  project: ServiceProjectRecord;
  order: ServiceWorkOrder;
  step: WorkOrderStep;
  actor: OperationActor;
  busy: boolean;
  onSaved: (project: ServiceProjectRecord) => void;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const definition = step.definition;
  const [data, setData] = useState<WorkStepData>(() =>
    structuredClone(step.data),
  );
  const [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [material, setMaterial] = useState<StepDocument | StepFile>();
  const [skipping, setSkipping] = useState(false),
    [reason, setReason] = useState('');
  const lock = useRef(false);
  const completed = step.status === '已完成';
  const editable =
    canExecuteSpecificWorkOrder(project, order, actor) &&
    order.status !== '已完成' &&
    step.status !== '已跳过';
  const disabled = !editable || saving || busy;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function change(patch: Partial<WorkStepData>) {
    setData((current) => ({ ...current, ...patch }));
    setDirty(true);
    onDirty(true);
    setNotice('');
    setError('');
  }
  function materialFiles(id: string) {
    return definition.type === 'combined'
      ? data.attachments
      : (data.deliverables[id] ?? []);
  }
  function updateMaterialFiles(id: string, files: StoredFile[]) {
    change(
      definition.type === 'combined'
        ? { attachments: files }
        : { deliverables: { ...data.deliverables, [id]: files } },
    );
  }
  async function submit(type: WorkStepAction['type']) {
    if (disabled || lock.current) return;
    lock.current = true;
    setSaving(true);
    onBusy(true);
    setError('');
    try {
      const next = await saveStoredWorkStep(
        project.id,
        project.revision,
        actor,
        { orderId: order.id, stepId: definition.id, type, data, reason },
      );
      const saved = next
        .workOrders!.find((row) => row.id === order.id)!
        .steps.find((row) => row.definition.id === definition.id)!;
      setData(structuredClone(saved.data));
      setDirty(false);
      onDirty(false);
      setNotice(
        type === 'save'
          ? '已保存'
          : type === 'complete'
            ? '步骤已完成'
            : '步骤已跳过',
      );
      setSkipping(false);
      onSaved(next);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '保存失败。');
    } finally {
      lock.current = false;
      setSaving(false);
      onBusy(false);
    }
  }
  const form =
    definition.type === 'form' ? workStepForm(definition) : undefined;
  const generalDescription =
    definition.type === 'combined' ? generalStepDescription(definition) : '';
  const entries: (StepDocument | StepFile)[] =
    definition.type === 'document'
      ? stepDocuments(definition)
      : definition.type === 'upload'
        ? stepFiles(definition)
        : definition.type === 'combined'
          ? [
              {
                id: `${definition.id}:attachments`,
                name: '执行附件',
                required: !!definition.attachmentRequired,
                deliverToCustomer: false,
                instructions: '',
                minFiles: 1,
                formats: '',
              },
            ]
          : [];
  return (
    <article className="wo-step-editor">
      <header className="wo-step-header">
        <div className="wo-step-title">
          <h3>{definition.name}</h3>
          <span
            className="wo-status"
            data-tone={
              step.status === '已完成'
                ? 'green'
                : (step.status === '已跳过' || step.status === '待执行')
                  ? 'gray'
                  : 'blue'
            }
          >
            {step.status}
          </span>
        </div>
      </header>
      {(definition.instructions ||
        generalDescription ||
        definition.materials.length > 0) && (
        <details className="wo-guide" open>
          <summary>
            <BookOpen size={20} aria-hidden="true" />
            <span className="wo-guide-title">执行指引</span>
            <span className="wo-guide-action">
              <span className="wo-expand-label">查看指引</span>
              <span className="wo-collapse-label">收起指引</span>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </summary>
          <div className="wo-instructions">
            {definition.instructions && <p>{definition.instructions}</p>}
            {generalDescription && <p>{generalDescription}</p>}
            {definition.materials.map((item) =>
              item.kind === 'text' ? (
                <p key={item.id}>{item.content}</p>
              ) : item.kind === 'link' ? (
                safeStepLink(item.url) && (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.title || item.url} ↗
                  </a>
                )
              ) : (
                <Button
                  key={item.id}
                  variant="ghost"
                  onClick={() =>
                    downloadFile({
                      id: item.id,
                      name: item.name,
                      blob: item.blob,
                      size: item.blob.size,
                      uploadedAt: order.createdAt,
                    })
                  }
                >
                  <Download size={14} />
                  {item.name}
                </Button>
              ),
            )}
          </div>
        </details>
      )}
      {(form || definition.type === 'combined') && (
        <fieldset disabled={disabled} className="wo-fields">
          {form && (
            <>
              {form.description && (
                <p className="sr-help">{form.description}</p>
              )}
              <FormFieldsLayout
                fields={executionFormLayout(form)}
                renderField={(id) => {
                  const field = form.fields.find((field) => field.id === id)!;
                  return (
                    <label className="wo-form-field">
                      <span>
                        {field.name}
                        {field.required && <em> *</em>}
                      </span>
                      <ExecutionFieldControl
                        field={field}
                        value={data.values[id] ?? ''}
                        disabled={disabled}
                        onChange={(value) =>
                          change({ values: { ...data.values, [id]: value } })
                        }
                      />
                    </label>
                  );
                }}
              />
            </>
          )}
          {definition.type === 'combined' && (
            <label className="wo-form-field">
              <span>执行说明{definition.recordRequired && <em> *</em>}</span>
              <Textarea
                value={data.description}
                maxLength={60000}
                rows={8}
                placeholder="记录本步骤的执行情况与结果"
                onChange={(event) =>
                  change({ description: event.target.value })
                }
              />
            </label>
          )}
        </fieldset>
      )}
      {entries.map((item) => (
        <section className="wo-deliverable" key={item.id}>
          <div>
            <h4>
              {item.name}
              {item.required && <em> *</em>}
            </h4>
          </div>
          {item.instructions && <p>{item.instructions}</p>}
          {'template' in item && item.template && (
            <Button
              variant="ghost"
              onClick={() => downloadFile(item.template!)}
            >
              <Download size={14} />
              下载模板
            </Button>
          )}
          <FileList
            files={materialFiles(item.id)}
            disabled={disabled}
            remove={(id) =>
              updateMaterialFiles(
                item.id,
                materialFiles(item.id).filter((file) => file.id !== id),
              )
            }
          />
          {editable && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => setMaterial(item)}
            >
              {definition.type === 'document' ? '填写 / 上传文档' : '上传文件'}
            </Button>
          )}
        </section>
      ))}
      {step.skipReason && (
        <p className="wo-readonly">跳过原因：{step.skipReason}</p>
      )}
      {step.updatedAt && (
        <p className="sr-help wo-step-updated">
          {step.updatedBy} ·{' '}
          {new Date(step.updatedAt).toLocaleString('zh-CN', { hour12: false })}
        </p>
      )}
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="sr-success">{notice}</output>}
      {editable && (
        <footer className="wo-step-footer">
          <span className="sr-help">
            {dirty ? '有未保存的修改' : completed ? '' : '完成后自动进入下一步'}
          </span>
          <div>
            {!completed && !definition.required && (
              <Button
                variant="ghost"
                disabled={disabled}
                onClick={() => setSkipping(true)}
              >
                跳过
              </Button>
            )}
            <Button
              variant={completed ? 'default' : 'outline'}
              disabled={disabled}
              onClick={() => void submit('save')}
            >
              <Save size={15} />
              {completed ? '保存修改' : '保存草稿'}
            </Button>
            {!completed && (
              <Button
                disabled={disabled}
                onClick={() => void submit('complete')}
              >
                <Check size={15} />
                完成此步骤
              </Button>
            )}
          </div>
        </footer>
      )}
      {material && (
        <ServiceStepMaterialPreview
          item={material}
          reportContext={{project,orderId:order.id,customerName:order.customerName}}
          kind={definition.type === 'document' ? 'document' : 'upload'}
          initialFiles={materialFiles(material.id)}
          onApply={(files) => updateMaterialFiles(material.id, files)}
          onClose={() => setMaterial(undefined)}
        />
      )}
      <Dialog
        open={skipping}
        onOpenChange={(value) => {
          if (!saving) setSkipping(value);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>跳过可选步骤</DialogTitle>
            <DialogDescription>请记录本次无需执行的原因。</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="跳过原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={2000}
          />
          {error && <p className="sr-error">{error}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setSkipping(false)}
            >
              取消
            </Button>
            <Button
              disabled={saving || !reason.trim()}
              onClick={() => void submit('skip')}
            >
              确认跳过
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}
function FileList({
  files,
  disabled,
  remove,
}: {
  files: StoredFile[];
  disabled: boolean;
  remove: (id: string) => void;
}) {
  return (
    <div className="wo-file-list">
      {files.map((file) => (
        <div key={file.id}>
          <span>{file.name}</span>
          <Button variant="ghost" onClick={() => downloadFile(file)}>
            下载
          </Button>
          {!disabled && (
            <Button variant="ghost" onClick={() => remove(file.id)}>
              移除
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
