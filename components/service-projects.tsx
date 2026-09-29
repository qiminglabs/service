'use client';

import { ServiceProjectDailyReports } from '@/components/service-project-daily-reports';
import { PartnerProjectConfirmation } from '@/components/partner-project-confirmation';
import { isPartnerCreatedProject } from '@/lib/service-project-work-order-policy';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Plus, Search } from 'lucide-react';
import { projectFieldReadonly, projectCustomerReadonly, projectCustomFieldReadonly } from '@/lib/service-project-readonly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DateField } from '@/components/date-field';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxList,
  ComboboxItem,
} from '@/components/ui/combobox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import type { RequestField } from '@/components/request-field-settings';
import type { CustomerRef } from '@/lib/service-requests';
import { readLocal, type ServiceRequest } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';
import { normalizeProjectFields, isSystemProjectField } from '@/lib/service-project-fields';
import {
  projectServiceProviders,
  ownProjectServiceProvider,
  type ProjectServiceProvider,
} from '@/lib/service-project-providers';
import { ServiceProjectBasicInfo, projectFieldText } from '@/components/service-project-basic-info';
import { ServiceProjectCollaborators } from '@/components/service-project-collaborators';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { ServiceProjectItems } from '@/components/service-project-items';
import { ServiceProjectMaterials } from '@/components/service-project-materials';
import { ServiceProjectOperations } from '@/components/service-project-operations';
import { ServiceProjectReview } from '@/components/service-project-review';
import { ServiceWorkOrders, StartProjectButton, type WorkOrderSections } from '@/components/service-work-orders';
import { ServiceProjectFiles } from '@/components/service-project-files';
import { projectFiles } from '@/lib/service-project-files';
import { ServiceProjectDeliverables } from '@/components/service-project-deliverables';
import { projectDeliverables } from '@/lib/service-project-deliverables';
import { projectItemsLocked, canViewWorkOrderOverview } from '@/lib/service-work-orders';
import { SubmitProjectReviewButton, ReturnProjectReviewButton } from '@/components/work-order-change-actions';
import { ServiceWorkOrderOverview } from '@/components/service-work-order-overview';
import { serviceProjectStatusLabel } from '@/lib/service-project-status';
import { ServiceProjectNextStepBanner } from '@/components/service-project-next-step';
import { serviceProjectNextStep } from '@/lib/service-project-next-step';
import { ServiceProjectProgress } from '@/components/service-project-progress';
import { canPauseServiceProject, canResumeServiceProject } from '@/lib/service-project-suspension';
import { ServiceProjectPause } from '@/components/service-project-pause';
import { ServiceProjectCancellation } from '@/components/service-project-cancellation';
import { projectOperationsOf } from '@/lib/service-project-activity';
import { canPerformProjectOperation, type ProjectOperationAction } from '@/lib/service-project-operations';
import { RequestFieldControl, RequestFieldsContext } from '@/components/request-field-settings';
import type {
  CatalogService,
  ObjectRef,
} from '@/lib/service-requests';
import type { ProjectItemChange } from '@/lib/service-project-items';
import { ServiceProjectSupplements } from '@/components/service-project-supplements';
import type { ProjectSupplementInput } from '@/lib/service-project-supplements';
import {
  type ProjectCollaboratorDirectory,
  type ProjectCollaboratorGroup,
} from '@/lib/service-project-collaborators';
import {
  canManageServiceProjects,
  canViewServiceProject,
  projectItemAudience,
  serviceProjectIssue,
  serviceProjectStatuses,
  type ServiceProjectRecord,
  type ServiceProjectInput,
  type ServiceProjectStatus,
} from '@/lib/service-projects';
import {
  readServiceProjects,
  createStoredServiceProject,
  cancelStoredServiceProject,
  saveServiceProjectSuspension,
  updateStoredServiceProject,
  saveProjectCollaborators,
  saveProjectSupplement,
  saveProjectItems,
  saveProjectOperation,
} from '@/lib/service-project-store';

const emptyForm: ServiceProjectInput & { status: ServiceProjectStatus } = {
  name: '',
  expectedServiceDate: '',
  plannedCompletionDate: '',
  customerId: '',
  serviceProviderId: '',
  note: '',
  status: '待启动',
};
function projectForm(project: ServiceProjectRecord): typeof emptyForm {
  return {
    name: project.name,
    expectedServiceDate: project.expectedServiceDate,
    plannedCompletionDate: project.plannedCompletionDate ?? '',
    customerId: project.customerId,
    serviceProviderId: project.serviceProviderId ?? '',
    note: project.note,
    customValues: structuredClone(project.customValues ?? {}),
    status: project.status,
  };
}
const timeLabel = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false });

export function ServiceProjects({
  initialProjectId,
  initialWorkOrderId,
  initialWorkOrderView = 'work-orders',
  customers,
  actor,
  fields,
  collaboratorDirectory,
  services,
  businessObjects,
  itemFields,
}: {
  initialProjectId?: string;
  initialWorkOrderId?: string;
  initialWorkOrderView?: 'work-orders' | 'work-order-overview' | 'worklogs';
  customers: CustomerRef[];
  actor: OperationActor;
  fields: RequestField[];
  collaboratorDirectory: ProjectCollaboratorDirectory;
  services: CatalogService[];
  businessObjects: ObjectRef[];
  itemFields: RequestField[];
}) {
  const openedLink = useRef('');
  const [records, setRecords] = useState<ServiceProjectRecord[]>([]);
  const [requestNames, setRequestNames] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewValidation, setReviewValidation] = useState<{ message: string } | null>(null);
  const reviewValidationAlert = useRef<HTMLElement>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [open, setOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState('');
  const [workOrderSectionMemory, setWorkOrderSectionMemory] = useState<Record<string, WorkOrderSections>>({});
  const [editing, setEditing] = useState<ServiceProjectRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [basicDialogOpen, setBasicDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const labels = Object.fromEntries(
    normalizeProjectFields(fields).map((field) => [field.id, field.name]),
  );
  const readonly =
    editing?.status === '已完成' ||
    editing?.status === '已取消' ||
    editing?.status === '已暂停' ||
    (!!editing && !canManageServiceProjects(actor, editing));
  const allowed = canViewServiceProject(actor);
  const deliverables = editing ? projectDeliverables(editing) : [];
  const showAllFiles = projectItemAudience(actor) === 'internal';
  const allFiles = editing && showAllFiles ? projectFiles(editing, [...collaboratorDirectory.users, ...collaboratorDirectory.partnerUsers]) : [];
  const workOrderDirty = useRef(false);
  const leaveWorkOrder = () => !workOrderDirty.current || window.confirm('当前步骤有未保存的修改，是否放弃并离开？');

  const customerName = (id: string) =>
    customers.find((customer) => customer.id === id)?.name ?? id;
  const options = customers.filter(
    (customer) =>
      customer.status === '启用' || customer.id === editing?.customerId,
  );
  if (
    editing &&
    !options.some((customer) => customer.id === editing.customerId)
  )
    options.push({
      id: editing.customerId,
      name: editing.customerId,
      status: '停用',
    });
  const selectedCustomer =
    options.find((customer) => customer.id === form.customerId) ?? null;
  const providerLocked = actor.role === '合作伙伴服务工程师' || editing?.createdSite === '合作伙伴中心';
  const ownProvider = ownProjectServiceProvider(actor.id, collaboratorDirectory.partners, collaboratorDirectory.partnerUsers);
  const availableProviders = projectServiceProviders(
    collaboratorDirectory.partners,
  );
  const providerOptions = [...availableProviders];
  if (
    editing?.serviceProviderId &&
    !providerOptions.some(
      (provider) => provider.id === editing.serviceProviderId,
    )
  )
    providerOptions.push({
      id: editing.serviceProviderId,
      name: editing.serviceProviderName || editing.serviceProviderId,
    });
  const selectedProvider =
    providerOptions.find(
      (provider) => provider.id === form.serviceProviderId,
    ) ?? null;

  useEffect(() => {
    if (!open) return;
    detailHeading.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [open]);

  useEffect(() => {
    if (!reviewValidation) return;
    reviewValidationAlert.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    reviewValidationAlert.current?.focus({ preventScroll: true });
  }, [reviewValidation]);

  useEffect(() => {
    let active = true;
    Promise.all([
      readServiceProjects(actor),
      projectItemAudience(actor) === 'internal' ? readLocal<ServiceRequest>('requests') : Promise.resolve([]),
    ])
      .then(([result, requests]) => {
        if (active) {
          setRecords(result);
          setRequestNames(Object.fromEntries(requests.map(request => [request.id, request.title])));
          setReady(true);
          if (!initialProjectId) setError('');
          const linkKey = `${initialProjectId ?? ''}:${initialWorkOrderId ?? ''}:${initialWorkOrderView}`;
          if (initialProjectId && openedLink.current !== linkKey) {
            openedLink.current = linkKey;
            const project = result.find(project => project.id === initialProjectId);
            if (project) {
              show(project);
              if (initialWorkOrderView === 'worklogs' && !isPartnerCreatedProject(project)) setDetailTab('worklogs');
              else if (initialWorkOrderId && project.workOrders?.some(order => order.id === initialWorkOrderId)) {
                setSelectedWorkOrderId(initialWorkOrderId);
                setDetailTab(initialWorkOrderView === 'work-order-overview' && canViewWorkOrderOverview(project, actor) ? 'work-order-overview' : 'work-orders');
              }
            }
            else setError(['SmartX 系统管理员', 'SmartX 项目经理'].includes(actor.role)
              ? '链接中的项目不存在，可能已在初始化数据时被替换。请从列表选择项目。'
              : '链接中的项目不存在，或当前身份无权访问。请从列表选择可访问的项目。');
          }
        }
      })
      .catch(() => {
        if (active) setError('无法读取服务项目，请刷新后重试。');
      });
    return () => {
      active = false;
    };
  }, [actor, initialProjectId, initialWorkOrderId, initialWorkOrderView]);

  async function reload() {
    setReady(false);
    setError('');
    try {
      const [projects, requests] = await Promise.all([
        readServiceProjects(actor),
        projectItemAudience(actor) === 'internal' ? readLocal<ServiceRequest>('requests') : Promise.resolve([]),
      ]);
      setRecords(projects);
      setRequestNames(Object.fromEntries(requests.map(request => [request.id, request.title])));
      setReady(true);
    } catch {
      setError('无法读取服务项目，请刷新后重试。');
    }
  }

  function show(project?: ServiceProjectRecord) {
    setWorkOrderSectionMemory({});
    setReviewValidation(null);
    setError('');
    workOrderDirty.current = false;
    setSelectedWorkOrderId('');
    setDetailTab('overview');
    setEditing(project ?? null);
    setBasicDialogOpen(!project);
    setForm(
      project
        ? projectForm(project)
        : { ...emptyForm, ...(actor.role === '合作伙伴服务工程师' ? { serviceProviderId: ownProvider?.id ?? '' } : {}) },
    );
    setFormError('');
    setNotice('');
    setOpen(!!project);
  }

  async function save() {
    if (saveLock.current || !basicDialogOpen || readonly || !canManageServiceProjects(actor, editing ?? undefined)) return;
    const issue = serviceProjectIssue(
      form,
      customers,
      editing ?? undefined,
      collaboratorDirectory.partners,
    );
    if (issue) {
      setFormError(issue);
      return;
    }
    const affected: string[] = [];
    if (editing && form.customerId !== editing.customerId) {
      if (editing.collaborators?.customer?.length) affected.push('原客户协作人');
      if (editing.items?.some(item => item.businessObjectIds.length || item.businessObjectSnapshot || item.materials.length)) affected.push('服务项中的业务对象及材料');
    }
    if (editing && (form.serviceProviderId ?? '') !== (editing.serviceProviderId ?? '') && editing.collaborators?.partner?.length) affected.push('原合作伙伴协作人');
    if (affected.length && !window.confirm(`保存后将清空${affected.join('、')}，是否继续？`)) return;
    saveLock.current = true;
    setSaving(true);
    setFormError('');
    try {
      const result = editing
        ? await updateStoredServiceProject(
            editing.id,
            editing.revision,
            { ...form, status: editing.status },
            actor,
          )
        : await createStoredServiceProject(
            form,
            actor,
          );
      setRecords((current) =>
        [result, ...current.filter((record) => record.id !== result.id)].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt),
        ),
      );
      setEditing(result);
      setForm(projectForm(result));
      setBasicDialogOpen(false);
      if (!editing) { setOpen(true); setDetailTab('overview'); }
      setNotice(editing ? '项目已保存。' : `项目 ${result.id} 已创建。`);
    } catch (cause) {
      setFormError(
        cause instanceof Error ? cause.message : '保存失败，请重试。',
      );
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function changeSuspension(action: 'pause' | 'resume', reason = ''): Promise<string | null> {
    if (!editing || saving || saveLock.current || !leaveWorkOrder()) return '操作未执行，请先保存或放弃工单修改。';
    saveLock.current = true; setSaving(true); setFormError('');
    try {
      const result = await saveServiceProjectSuspension(editing.id, editing.revision, action, actor, reason);
      workOrderDirty.current = false;
      setEditing(result); setForm(projectForm(result));
      setRecords(current => current.map(project => project.id === result.id ? result : project));
      setNotice(action === 'pause' ? '项目已暂停。' : `项目已恢复至${result.status}。`);
      return null;
    } catch (cause) { const issue = cause instanceof Error ? cause.message : '项目状态保存失败。'; setFormError(issue); return issue; }
    finally { saveLock.current = false; setSaving(false); }
  }

  async function cancelProject(reason: string): Promise<string | null> {
    if (!editing || saving || saveLock.current) return '正在保存，请稍后重试。';
    saveLock.current = true; setSaving(true); setFormError('');
    try {
      const result = await cancelStoredServiceProject(editing.id, editing.revision, reason, actor);
      setEditing(result);
      setRecords(current => current.map(project => project.id === result.id ? result : project));
      setForm({ name: result.name, expectedServiceDate: result.expectedServiceDate, plannedCompletionDate: result.plannedCompletionDate ?? '', customerId: result.customerId,
        serviceProviderId: result.serviceProviderId ?? '', note: result.note, customValues: structuredClone(result.customValues ?? {}), status: result.status });
      setBasicDialogOpen(false);
      setNotice('服务项目及全部工单已取消，不可恢复；当前项目资产已解冻，特批额度已作废。');
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : '取消失败，请重试。'; }
    finally { saveLock.current = false; setSaving(false); }
  }

  async function persistItems(
    change: ProjectItemChange,
  ): Promise<string | null> {
    if (
      !editing ||
      readonly ||
      !allowed ||
      saveLock.current ||
      (editing && form.customerId !== editing.customerId)
    )
      return '项目当前无法编辑，请先保存基本信息后重试。';
    saveLock.current = true;
    setSaving(true);
    try {
        const result = await saveProjectItems(
          editing.id,
          editing.revision,
          change,
          actor,
        );
        setEditing(result);
        setRecords((current) =>
          current.map((project) =>
            project.id === result.id ? result : project,
          ),
        );
        setNotice(change.type === 'materials' ? '项目材料已保存。' : '服务项已保存。');
      return null;
    } catch (cause) {
      return cause instanceof Error
        ? cause.message
        : '服务项保存失败，请重试。';
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function persistCollaborators(
    group: ProjectCollaboratorGroup,
    ids: string[],
  ): Promise<string | null> {
    if (!editing || readonly || !allowed || saveLock.current)
      return '项目当前无法编辑，请稍后重试。';
    if (
      editing &&
      group === 'partner' &&
      (form.serviceProviderId ?? '') !== (editing.serviceProviderId ?? '')
    )
      return '请先保存服务方变更，再选择合作伙伴协作人。';
    saveLock.current = true;
    setSaving(true);
    setFormError('');
    try {
      const result = await saveProjectCollaborators(
        editing.id,
        editing.revision,
        group,
        ids,
        actor,
      );
      setEditing(result);
      setRecords((current) =>
        current.map((project) => (project.id === result.id ? result : project)),
      );
      setNotice('协作人已保存。');
      return null;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : '协作人保存失败，请重试。';
      setFormError(message);
      return message;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function persistOperation(
    action: ProjectOperationAction,
  ): Promise<string | null> {
    if (!editing || !allowed || saveLock.current || !canPerformProjectOperation(editing, actor, action.type))
      return '项目当前无法编辑，请稍后重试。';
    saveLock.current = true;
    setSaving(true);
    try {
      const result = await saveProjectOperation(
        editing.id,
        editing.revision,
        action,
        actor,
      );
      setEditing(result);
      setRecords((current) =>
        current.map((project) => (project.id === result.id ? result : project)),
      );
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : '保存失败，请重试。';
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  async function publishSupplement(
    input: ProjectSupplementInput,
  ): Promise<string | null> {
    if (!editing || readonly || !allowed || saveLock.current)
      return '项目当前无法编辑，请稍后重试。';
    saveLock.current = true;
    setSaving(true);
    setFormError('');
    try {
      const result = await saveProjectSupplement(
        editing.id,
        editing.revision,
        input,
        actor,
      );
      setEditing(result);
      setRecords((current) =>
        current.map((project) => (project.id === result.id ? result : project)),
      );
      setNotice('补充信息已发布。');
      return null;
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : '补充信息保存失败，请重试。';
      setFormError(message);
      return message;
    } finally {
      saveLock.current = false;
      setSaving(false);
    }
  }

  const needle = query.trim().toLocaleLowerCase();
  const visible = records.filter(
    (record) =>
      (status === '全部状态' || record.status === status) &&
      [record.id, record.name, customerName(record.customerId)].some((value) =>
        value.toLocaleLowerCase().includes(needle),
      ),
  );

  function closeBasicDialog() {
    if (saving) return;
    const initial = editing ? projectForm(editing) : { ...emptyForm, ...(actor.role === '合作伙伴服务工程师' ? { serviceProviderId: ownProvider?.id ?? '' } : {}) };
    if (JSON.stringify(form) !== JSON.stringify(initial) && !window.confirm('基本信息有未保存的修改，是否放弃？')) return;
    setForm(initial);
    setFormError('');
    setBasicDialogOpen(false);
  }
  const basicDialog = <Dialog open={basicDialogOpen} onOpenChange={value => { if (!value) closeBasicDialog(); }}>
    <DialogContent className="service-project-basic-dialog" showCloseButton={!saving} aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{editing ? '编辑基本信息' : '新建服务项目'}</DialogTitle></DialogHeader>
      <form id="service-project-basic-form" onSubmit={event => { event.preventDefault(); void save(); }}>
                      <fieldset className="sr-form-grid" disabled={saving || editing?.status === '已取消'}>
                        <label htmlFor="project-name">
                          {labels.name} <em>*</em>
                          <Input
                            id="project-name"
                            required
                            maxLength={100}
                            value={form.name}
                            readOnly={readonly || projectFieldReadonly(editing, 'name')}
                            onChange={(event) =>
                              setForm({ ...form, name: event.target.value })
                            }
                            placeholder="请输入项目名称"
                          />
                        </label>
                        <DateField
                          id="project-date"
                          label={labels.expectedServiceDate}
                          required={!!editing && editing.status !== '待启动'}
                          value={form.expectedServiceDate}
                          readonly={readonly || projectFieldReadonly(editing, 'expectedServiceDate')}
                          disabled={saving}
                          onChange={(value) =>
                            setForm({ ...form, expectedServiceDate: value })
                          }
                        />
                        <div className="service-project-customer">
                          <label htmlFor="project-customer">
                            {labels.customerId} <em>*</em>
                          </label>
                          {readonly || projectCustomerReadonly(editing) || (!!editing && (editing.status !== '待启动' || !!editing.collaborators?.customer?.some(person => person.assignmentRoles?.length))) ? (
                            <Input
                              id="project-customer"
                              value={customerName(form.customerId)}
                              readOnly
                            />
                          ) : (
                            <Combobox
                              items={options}
                              value={selectedCustomer}
                              disabled={saving}
                              required
                              itemToStringLabel={(customer: CustomerRef) =>
                                customer.name
                              }
                              itemToStringValue={(customer: CustomerRef) =>
                                customer.id
                              }
                              isItemEqualToValue={(
                                a: CustomerRef,
                                b: CustomerRef,
                              ) => a.id === b.id}
                              onValueChange={(customer: CustomerRef | null) => {
                                setForm({
                                  ...form,
                                  customerId: customer?.id ?? '',
                                });
                              }}
                            >
                              <ComboboxInput
                                id="project-customer"
                                aria-label={labels.customerId}
                                aria-required="true"
                                placeholder="搜索并选择客户"
                                className="w-full"
                                disabled={saving}
                                showClear
                              />
                              <ComboboxContent>
                                <ComboboxEmpty>暂无匹配的客户</ComboboxEmpty>
                                <ComboboxList>
                                  {(customer: CustomerRef) => (
                                    <ComboboxItem
                                      key={customer.id}
                                      value={customer}
                                      disabled={customer.status !== '启用'}
                                    >
                                      {customer.name}
                                      {customer.status !== '启用' &&
                                        '（已停用）'}
                                    </ComboboxItem>
                                  )}
                                </ComboboxList>
                              </ComboboxContent>
                            </Combobox>
                          )}
                        </div>
                        <DateField id="project-completion-date" label={labels.plannedCompletionDate}
                          value={form.plannedCompletionDate ?? ''} readonly={readonly} disabled={saving}
                          required={!!editing && editing.status !== '待启动' && !!editing.plannedCompletionDate}
                          onChange={value => setForm({ ...form, plannedCompletionDate: value })} />
                        <div className="service-project-customer">
                          <label htmlFor="project-provider">
                            {labels.serviceProviderId}
                          </label>
                          {readonly || providerLocked || projectFieldReadonly(editing, 'serviceProviderId') ? (
                            <Input
                              id="project-provider"
                              className="service-project-provider-readonly"
                              readOnly
                              value={selectedProvider?.name ?? '未选择'}
                            />
                          ) : (
                            <Combobox
                              items={providerOptions}
                              value={selectedProvider}
                              disabled={saving}
                              itemToStringLabel={(
                                provider: ProjectServiceProvider,
                              ) => provider.name}
                              itemToStringValue={(
                                provider: ProjectServiceProvider,
                              ) => provider.id}
                              isItemEqualToValue={(
                                a: ProjectServiceProvider,
                                b: ProjectServiceProvider,
                              ) => a.id === b.id}
                              onValueChange={(
                                provider: ProjectServiceProvider | null,
                              ) => {
                                setForm({
                                  ...form,
                                  serviceProviderId: provider?.id ?? '',
                                });
                              }}
                            >
                              <ComboboxInput
                                id="project-provider"
                                aria-label={labels.serviceProviderId}
                                placeholder="搜索并选择服务方"
                                className="w-full"
                                disabled={saving}
                                showClear
                              />
                              <ComboboxContent>
                                <ComboboxEmpty>暂无匹配的服务方</ComboboxEmpty>
                                <ComboboxList>
                                  {(provider: ProjectServiceProvider) => (
                                    <ComboboxItem
                                      key={provider.id}
                                      value={provider}
                                      disabled={
                                        !availableProviders.some(
                                          (item) => item.id === provider.id,
                                        )
                                      }
                                    >
                                      {provider.name}
                                    </ComboboxItem>
                                  )}
                                </ComboboxList>
                              </ComboboxContent>
                            </Combobox>
                          )}
                        </div>
                        {editing &&
                          form.customerId !== editing.customerId &&
                          Boolean(editing.collaborators?.customer?.length) && (
                            <p className="sr-help sr-span">
                              保存客户变更后，将清空原客户协作人，请为新客户重新选择。
                            </p>
                          )}

                        {editing &&
                          (form.serviceProviderId ?? '') !==
                            (editing.serviceProviderId ?? '') && (
                            <p className="sr-help sr-span">
                              保存服务方变更后，将清空原合作伙伴协作人，请按新的服务方重新选择。
                            </p>
                          )}
                        <label htmlFor="project-note" className="sr-span">
                          {labels.note}（选填）
                          <textarea
                            id="project-note"
                            rows={3}
                            value={form.note}
                            readOnly={readonly || projectFieldReadonly(editing, 'note')}
                            onChange={(event) =>
                              setForm({ ...form, note: event.target.value })
                            }
                            placeholder="请输入项目说明"
                          />
                        </label>
                        {normalizeProjectFields(fields).filter(field => !isSystemProjectField(field.id)).map(field => <fieldset key={field.id} disabled={readonly || saving || projectCustomFieldReadonly(editing, field.id)}>
                          <div className="sr-help">{field.name}</div>
                          <RequestFieldControl field={field} value={form.customValues?.[field.id] ?? ''} disabled={readonly || saving || projectCustomFieldReadonly(editing, field.id)} onChange={value => setForm(current => ({ ...current, customValues: { ...current.customValues, [field.id]: value } }))} />
                        </fieldset>)}
                      </fieldset>
        {formError && <p className="sr-error" role="alert">{formError}</p>}
      </form>
      <DialogFooter>
        <Button type="button" variant="outline" disabled={saving} onClick={closeBasicDialog}>取消</Button>
        <Button type="submit" form="service-project-basic-form" disabled={saving}>{saving ? '保存中…' : editing ? '保存' : '创建项目'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;

  if (!allowed)
    return (
      <p className="sr-error" role="alert">
        当前身份无权访问服务项目。
      </p>
    );

  if (open && editing) {
    const currentStatus = editing?.status ?? '待启动';
    const cancelled = currentStatus === '已取消';
    return (
      <section
        className="sr-workspace sr-workspace--detail catalog-detail"
        data-project-detail="true"
        aria-label={editing ? '项目详情' : '创建服务项目'}
      >
        {basicDialog}
        <header
          className={
            editing ? 'detail-heading' : 'detail-heading sr-form-page-heading'
          }
        >
          <div>
            <button
              type="button"
              className="detail-back"
              disabled={saving}
              onClick={() => {
                if (!leaveWorkOrder()) return;
                workOrderDirty.current = false;
                setOpen(false);
                setFormError('');
                setNotice('');
              }}
            >
              <ArrowLeft aria-hidden="true" />
              返回服务项目列表
            </button>
            <div className="detail-title-row">
              <h2 ref={detailHeading} tabIndex={-1}>
                {editing ? editing.name : '创建服务项目'}
              </h2>
              {editing && (
                <span
                  className="sr-badge"
                  data-tone={
                    currentStatus === '已完成'
                      ? 'green'
                      : cancelled
                        ? 'cancelled'
                        : currentStatus === '待启动'
                          ? 'muted'
                          : 'blue'
                  }
                >
                  {serviceProjectStatusLabel(currentStatus, projectItemAudience(actor) !== 'internal')}
                </span>
              )}
            </div>
            {editing && (
              <p>
                {editing.id} · {customerName(editing.customerId)}
              </p>
            )}
          </div>
          <div className="detail-actions">
            {editing && <StartProjectButton project={editing} actor={actor} users={collaboratorDirectory.users} busy={saving || basicDialogOpen} onSaved={result => {
              setEditing(result); setForm(current => ({ ...current, status: result.status, expectedServiceDate: result.expectedServiceDate, plannedCompletionDate: result.plannedCompletionDate ?? '' }));
              setRecords(current => current.map(project => project.id === result.id ? result : project));
              setDetailTab('work-order-overview'); setNotice('项目已启动，服务项已锁定，工单已生成。');
            }} />}
            {editing && <ReturnProjectReviewButton project={editing} actor={actor} busy={saving || basicDialogOpen} onBusy={setSaving} onSaved={result => {
              setEditing(result); setForm(current => ({ ...current, status: result.status }));
              setRecords(current => current.map(project => project.id === result.id ? result : project));
              setDetailTab('work-order-overview'); setNotice('项目已整体退回执行。');
            }} />}
            {editing && <SubmitProjectReviewButton project={editing} actor={actor} beforeSubmit={() => !workOrderDirty.current} busy={saving || basicDialogOpen} onBusy={setSaving} onValidationError={message => setReviewValidation(message ? { message } : null)} onSaved={result => {
              setEditing(result); setForm(current => ({ ...current, status: result.status }));
              setRecords(current => current.map(project => project.id === result.id ? result : project));
              setNotice('项目已提交复核。');
              setDetailTab(projectItemAudience(actor) === 'internal' ? 'review' : 'work-order-overview');
            }} />}
            {canPauseServiceProject(editing, actor, collaboratorDirectory.users) && <ServiceProjectPause name={editing.name} busy={saving || basicDialogOpen} pause={reason => changeSuspension('pause', reason)} />}
            {canResumeServiceProject(editing, actor, collaboratorDirectory.users) && <Button variant="outline" disabled={saving || basicDialogOpen} onClick={() => void changeSuspension('resume')}>恢复项目</Button>}
            {editing && <ServiceProjectCancellation key={editing.id} record={editing} actor={actor} users={collaboratorDirectory.users} busy={saving || basicDialogOpen} cancel={cancelProject} />}

          </div>
        </header>
        <ServiceProjectProgress external={projectItemAudience(actor) !== 'internal'} skipReview={editing ? isPartnerCreatedProject(editing) : false} status={currentStatus} pausedFromStatus={editing?.suspension?.fromStatus} cancelledFromStatus={editing?.cancellation?.fromStatus} />
        <ServiceProjectNextStepBanner key={editing.id} next={serviceProjectNextStep(editing, collaboratorDirectory, customers, projectItemAudience(actor) !== 'internal')} />
        {reviewValidation && currentStatus === '进行中' && (
          <section className="sr-error sr-validation-alert" role="alert" ref={reviewValidationAlert} tabIndex={-1}>
            <strong>尚未提交复核，请补充以下内容</strong>
            <ul><li>{reviewValidation.message}</li></ul>
          </section>
        )}
        {notice && <output className="sr-notice">{notice}</output>}
        {formError && !basicDialogOpen && (
          <p role="alert" className="sr-error">
            {formError}
          </p>
        )}
        <div className="sr-ops-workspace">
          <Tabs
            value={detailTab}
            onValueChange={(value) => { if (saving || (String(value) !== detailTab && !leaveWorkOrder())) return; workOrderDirty.current = false; setDetailTab(String(value)); }}
            className="sr-ops-tabs"
          >
            <TabsList
              variant="line"
              className="sr-ops-tab-list"
              aria-label="服务项目工作区"
            >
              <TabsTrigger value="overview">项目信息</TabsTrigger>
              {editing && canViewWorkOrderOverview(editing, actor) && <TabsTrigger value="work-order-overview">工单概览</TabsTrigger>}
              {editing && <TabsTrigger value="work-orders">工单执行</TabsTrigger>}
              {editing && <TabsTrigger value="service-reports">服务日报</TabsTrigger>}
              {editing && <TabsTrigger value="deliverables">项目文件</TabsTrigger>}
              {editing && (
                <TabsTrigger value="supplements">
                  补充信息
                  {Boolean(editing.supplements?.length) && (
                    <span>{editing.supplements!.length}</span>
                  )}
                </TabsTrigger>
              )}
              {editing && (
                <>
                  <TabsTrigger value="meetings">
                    会议
                    <span>{projectOperationsOf(editing).meetings.length}</span>
                  </TabsTrigger>
                  {(isPartnerCreatedProject(editing) || projectItemAudience(actor) === 'partner') && <TabsTrigger value="confirmation">客户确认</TabsTrigger>}
                  {projectItemAudience(actor) === 'internal' && <>
                  {!isPartnerCreatedProject(editing) && <TabsTrigger value="review">复核</TabsTrigger>}
                  </>}
                  {!isPartnerCreatedProject(editing) && <TabsTrigger value="worklogs">
                    工时
                    <span>
                      {
                        projectOperationsOf(editing).worklogs.filter(
                          (log) => !log.voidedAt,
                        ).length
                      }
                    </span>
                  </TabsTrigger>}
                  {projectItemAudience(actor) === 'internal' && <>
                  <TabsTrigger value="activity">
                    活动
                    <span>
                      {projectOperationsOf(editing).activities.length}
                    </span>
                  </TabsTrigger>
                  </>}
                </>
              )}
            </TabsList>
            <div className={`sr-detail-layout${detailTab === 'work-orders' ? ' wo-detail-layout' : ''}`}>
              <div className="sr-detail-main">
                {editing && <TabsContent value="service-reports">
                  <div className="service-report-sections">
                    <ServiceProjectDailyReports key={`daily:${editing.id}:${actor.id}`} project={editing} actor={actor} customerName={customerName(editing.customerId)} directory={collaboratorDirectory} busy={saving} onBusy={setSaving} onSaved={result => {
                      setEditing(result); setRecords(current => current.map(project => project.id === result.id ? result : project));
                    }} />
                  </div>
                </TabsContent>}
                {editing && (isPartnerCreatedProject(editing) || projectItemAudience(actor) === 'partner') && <TabsContent value="confirmation"><PartnerProjectConfirmation project={editing} actor={actor} busy={saving} onBusy={setSaving} beforeSubmit={() => !workOrderDirty.current} onSaved={result => {
                  setEditing(result); setForm(current => ({ ...current, status: result.status })); setRecords(current => current.map(project => project.id === result.id ? result : project)); setNotice(result.status === '已完成' ? '项目已完成。' : '已发起客户确认。');
                }} /></TabsContent>}
                {editing && !isPartnerCreatedProject(editing) && projectItemAudience(actor) === 'internal' && <TabsContent value="review"><ServiceProjectReview onViewOrder={id => { setSelectedWorkOrderId(id); setDetailTab('work-orders'); }} project={editing} actor={actor} busy={saving} onBusy={setSaving} onSaved={result => {
                  setEditing(result); setForm(current => ({ ...current, status: result.status })); setRecords(current => current.map(project => project.id === result.id ? result : project)); setNotice('项目复核已保存。');
                }} /></TabsContent>}
                {editing && canViewWorkOrderOverview(editing, actor) && <TabsContent value="work-order-overview" keepMounted>
                  <RequestFieldsContext.Provider value={itemFields}><ServiceWorkOrderOverview key={editing.id} project={editing} actor={actor} directory={collaboratorDirectory} services={services} busy={saving} onBusy={setSaving} onSaved={result => {
                    setEditing(result); setRecords(current => current.map(project => project.id === result.id ? result : project));
                  }} onExecute={id => { setSelectedWorkOrderId(id); setDetailTab('work-orders'); }} /></RequestFieldsContext.Provider>
                </TabsContent>}
                {editing && <TabsContent value="work-orders"><RequestFieldsContext.Provider value={itemFields}><ServiceWorkOrders sectionMemory={workOrderSectionMemory} onSectionsChange={setWorkOrderSectionMemory} directory={collaboratorDirectory} key={editing.id} selectedOrderId={selectedWorkOrderId} onOrderChange={setSelectedWorkOrderId} project={editing} actor={actor} busy={saving} onBusy={setSaving} onDirty={value => { workOrderDirty.current = value; }} onSaved={result => {
                  setEditing(result); setRecords(current => current.map(project => project.id === result.id ? result : project));
                }} /></RequestFieldsContext.Provider></TabsContent>}
                {editing && <TabsContent value="deliverables">
                  <ServiceProjectDeliverables key={`deliverables:${editing.id}`} projectName={editing.name} items={deliverables} showCustomerVisibility={projectItemAudience(actor) === 'internal'} />
                  {showAllFiles && <ServiceProjectFiles key={`all-files:${editing.id}`} projectName={editing.name} items={allFiles} />}
                </TabsContent>}
                <TabsContent value="overview" keepMounted>
                  {editing?.cancellation && (
                    <section className="sr-panel sr-ops-panel" role="status">
                      <div className="sr-ops-heading">
                        <div>
                          <h3>取消原因</h3>
                          <p className="whitespace-pre-wrap break-words">{editing.cancellation.reason}</p>
                        </div>
                      </div>
                    </section>
                  )}
                    <section
                      className={`sr-panel${projectItemAudience(actor) === 'internal' ? ' sr-customer-visible-panel' : ''}`}
                      aria-labelledby="project-basic-heading"
                    >
                      <div className="sr-panel-heading">
                        <div className="sr-panel-title-with-visibility"><h3 id="project-basic-heading">基本信息</h3>{projectItemAudience(actor) === 'internal' && <CustomerVisibleBadge />}</div>
                        {!readonly && editing && (
              <Button type="button" variant="outline" disabled={saving} onClick={() => {
                setForm(projectForm(editing));
                setFormError('');
                setBasicDialogOpen(true);
              }}>编辑基本信息</Button>
            )}
                      </div>
                      {editing && (
                        <ServiceProjectBasicInfo fields={[
                          { id: 'name', label: labels.name, value: editing.name },
                          { id: 'expectedServiceDate', label: labels.expectedServiceDate, value: editing.expectedServiceDate },
                          { id: 'customerId', label: labels.customerId, value: customerName(editing.customerId) },
                          { id: 'plannedCompletionDate', label: labels.plannedCompletionDate, value: editing.plannedCompletionDate },
                          { id: 'serviceProviderId', label: labels.serviceProviderId, value: providerOptions.find(provider => provider.id === editing.serviceProviderId)?.name ?? editing.serviceProviderName },
                          { id: 'note', label: labels.note, value: editing.note, fullWidth: true },
                          ...normalizeProjectFields(fields).filter(field => !isSystemProjectField(field.id)).map(field => ({
                            id: field.id, label: field.name, value: projectFieldText(field, editing.customValues?.[field.id] ?? ''),
                          })),
                        ]} />
                      )}
                    </section>
                  <RequestFieldsContext.Provider value={itemFields}>
                    <ServiceProjectItems
                      project={editing ?? undefined}
                      actor={actor}
                      key={editing?.id ?? 'new-project'}
                      id={editing?.id ?? 'new-project'}
                      customerId={editing?.customerId ?? form.customerId}
                      items={editing.items ?? []}
                      services={services}
                      objects={businessObjects}
                      readonly={readonly || projectItemsLocked(editing)}
                      busy={
                        saving ||
                        (!!editing && form.customerId !== editing.customerId)
                      }
                      save={persistItems}
                    />
                  </RequestFieldsContext.Provider>
                  <ServiceProjectMaterials
                    project={editing ?? undefined}
                    key={editing?.id ?? 'new-project'} id={editing?.id ?? 'new-project'}
                    customerId={editing?.customerId ?? form.customerId} items={editing.items ?? []}
                    actor={actor} readonly={readonly || projectItemsLocked(editing)} busy={saving || (!!editing && form.customerId !== editing.customerId)} save={persistItems}
                  />
                  {editing && (
                    <section
                      className={`sr-panel${projectItemAudience(actor) === 'internal' ? ' sr-customer-visible-panel' : ''}`}
                      aria-labelledby="project-system-heading"
                    >
                      <div className="sr-panel-heading">
                        <div className="sr-panel-title-with-visibility"><h3 id="project-system-heading">系统信息</h3>{projectItemAudience(actor) === 'internal' && <CustomerVisibleBadge />}</div>
                      </div>
                      <dl className="sr-system-info">
                        <div>
                          <dt>来源服务请求</dt>
                          <dd>{editing.sourceServiceRequestId ? actor.role === '合作伙伴服务工程师' ? editing.sourceServiceRequestId : <a className="sr-source-request-link" href={`/?request=${encodeURIComponent(editing.sourceServiceRequestId)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">{requestNames[editing.sourceServiceRequestId] || editing.requestConversion?.assessmentSnapshot?.requestTitle || editing.sourceServiceRequestId}</a> : '未关联'}</dd>
                        </div>
                        <div>
                          <dt>创建站点</dt>
                          <dd>{editing.createdSite ?? '内部系统'}</dd>
                        </div>
                        <div>
                          <dt>创建时间</dt>
                          <dd>{timeLabel(editing.createdAt)}</dd>
                        </div>
                        <div>
                          <dt>更新时间</dt>
                          <dd>{timeLabel(editing.updatedAt)}</dd>
                        </div>
                        <div>
                          <dt>提交时间</dt>
                          <dd>
                            {editing.submittedAt
                              ? timeLabel(editing.submittedAt)
                              : '未提交'}
                          </dd>
                        </div>
                        <div>
                          <dt>创建人</dt>
                          <dd>{editing.createdBy}</dd>
                        </div>
                      </dl>
                    </section>
                  )}
                </TabsContent>
                {editing && (
                  <TabsContent value="supplements" keepMounted>
                    <ServiceProjectSupplements
                      key={editing.id}
                      record={editing}
                      actor={actor}
                      directory={{ ...collaboratorDirectory, customers }}
                      users={collaboratorDirectory.users}
                      contacts={collaboratorDirectory.contacts}
                      customers={customers}
                      busy={saving}
                      publish={publishSupplement}
                    />
                  </TabsContent>
                )}
                {editing && (
                  <ServiceProjectOperations
                    key={editing.id}
                    record={editing}
                    actor={actor}
                    busy={saving}
                    save={persistOperation}
                    services={services}
                    onOpenWorkOrder={id => { setSelectedWorkOrderId(id); setDetailTab('work-orders'); }}
                  />
                )}
              </div>
              {detailTab !== 'work-orders' && <ServiceProjectCollaborators
                internalReadonly={projectItemAudience(actor) !== 'internal'}
                showCustomerVisibility={projectItemAudience(actor) === 'internal'}
                project={editing}
                directory={collaboratorDirectory}
                partnerBusy={
                  !!editing &&
                  (form.serviceProviderId ?? '') !==
                    (editing.serviceProviderId ?? '')
                }
                busy={
                  saving ||
                  (!!editing && form.customerId !== editing.customerId)
                }
                readonly={readonly}
                save={persistCollaborators}
              />}
            </div>
          </Tabs>
        </div>
      </section>
    );
  }

  return (
    <div className="sr-workspace" aria-label="服务项目">
      {basicDialog}
      {error && (
        <div className="sr-error" role="alert">
          {error}
          {!ready && (
            <Button variant="outline" onClick={() => void reload()}>
              重试读取
            </Button>
          )}
        </div>
      )}
      {notice && <output className="sr-notice">{notice}</output>}
      <section className="sr-panel sr-request-list-panel">
        <div className="sr-toolbar app-list-toolbar">
          <div className="sr-filter-group">
            <div className="sr-search">
              <Search size={16} />
              <Input
                aria-label="搜索服务项目"
                placeholder={`搜索${labels.name}、编号或${labels.customerId}`}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <select
              aria-label="筛选项目状态"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option>全部状态</option>
              {serviceProjectStatuses.map((value) => (
                <option key={value} value={value}>{serviceProjectStatusLabel(value, projectItemAudience(actor) !== 'internal')}</option>
              ))}
            </select>
          </div>
          <Button
            className="ct-button ct-button--primary"
            disabled={!ready || saving || !canManageServiceProjects(actor)}
            onClick={() => show()}
          >
            <Plus size={16} />
            新建服务项目
          </Button>
        </div>
        <div className="sr-table-scroll">
          <table className="sr-table app-list-table">
            <thead>
              <tr>
                <th>
                  {labels.name}
                </th>
                <th>{labels.customerId}</th>
                {projectItemAudience(actor) === 'internal' && <th>服务方</th>}
                {projectItemAudience(actor) === 'internal' && <th>来源服务请求</th>}
                <th>服务项</th>
                <th>{labels.expectedServiceDate}</th>
                <th>{labels.plannedCompletionDate}</th>
                <th>{labels.status}</th>
                {projectItemAudience(actor) === 'internal' && <th>创建站点</th>}
                <th>创建时间/创建人</th>
                <th data-list-actions>操作</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((record) => (
                <tr key={record.id}>
                  <td>
                    <button
                      className="sr-title-link app-list-link"
                      onClick={() => show(record)}
                    >
                      {record.name}
                    </button>
                    <small>{record.id}</small>
                  </td>
                  <td>{customerName(record.customerId)}</td>
                  {projectItemAudience(actor) === 'internal' && <td>{availableProviders.find(provider => provider.id === record.serviceProviderId)?.name || record.serviceProviderName || '未指定'}</td>}
                  {projectItemAudience(actor) === 'internal' && <td>{record.sourceServiceRequestId
                    ? <><a className="app-list-link" href={`/?request=${encodeURIComponent(record.sourceServiceRequestId)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">{requestNames[record.sourceServiceRequestId] || record.requestConversion?.assessmentSnapshot?.requestTitle || record.sourceServiceRequestId}</a><small>{record.sourceServiceRequestId}</small></>
                    : '未关联'}</td>}
                  <td>{record.items?.length ?? 0} 项</td>
                  <td>{record.expectedServiceDate || '—'}</td>
                  <td>{record.plannedCompletionDate || '未填写'}</td>
                  <td>
                    <span
                      className="sr-badge"
                      data-tone={
                        record.status === '已完成'
                          ? 'green'
                          : record.status === '已取消'
                            ? 'cancelled'
                            : ['待复核', '待确认'].includes(record.status)
                              ? 'amber'
                              : record.status === '进行中'
                                ? 'blue'
                                : undefined
                      }
                    >
                      {serviceProjectStatusLabel(record.status, projectItemAudience(actor) !== 'internal')}
                    </span>
                  </td>
                  {projectItemAudience(actor) === 'internal' && <td>{record.createdSite ?? '内部系统'}</td>}
                  <td>{timeLabel(record.createdAt)}<small>{record.createdBy || '—'}</small></td>
                  <td>
                    <Button
                      variant="ghost"
                      className="app-list-link"
                      onClick={() => show(record)}
                    >
                      查看
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!visible.length && !error && (
          <div className="sr-empty">
            <FileText size={32} />
            <h3>
              {!ready
                ? '正在读取本地资料…'
                : query || status !== '全部状态'
                  ? '没有匹配的项目'
                  : '从一份服务项目开始'}
            </h3>
            <p>
              {!ready
                ? '正在加载服务项目。'
                : query || status !== '全部状态'
                  ? '请调整搜索条件或状态筛选。'
                  : '点击“新建服务项目”填写项目基本信息。'}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
