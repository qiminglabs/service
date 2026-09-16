'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, FileText, Plus, Search } from 'lucide-react';
import { projectFieldReadonly, projectCustomerReadonly, projectCustomFieldReadonly } from '@/lib/service-project-readonly';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { ServiceProjectCollaborators } from '@/components/service-project-collaborators';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { ServiceProjectItems } from '@/components/service-project-items';
import { ServiceProjectMaterials } from '@/components/service-project-materials';
import { ServiceProjectOperations } from '@/components/service-project-operations';
import { ServiceProjectProgress } from '@/components/service-project-progress';
import { ServiceProjectOther } from '@/components/service-project-other';
import { ServiceProjectCancellation } from '@/components/service-project-cancellation';
import { projectOperationsOf } from '@/lib/service-project-activity';
import type { ProjectOperationAction } from '@/lib/service-project-operations';
import { RequestFieldControl, RequestFieldsContext } from '@/components/request-field-settings';
import type {
  CatalogService,
  ObjectRef,
  RequestItem,
} from '@/lib/service-requests';
import {
  changeProjectItems,
  resetProjectItemCustomer,
  type ProjectItemChange,
} from '@/lib/service-project-items';
import { ServiceProjectSupplements } from '@/components/service-project-supplements';
import type { ProjectSupplementInput } from '@/lib/service-project-supplements';
import {
  resolveProjectCollaborators,
  type ProjectCollaborators,
  type ProjectCollaboratorDirectory,
  type ProjectCollaboratorGroup,
} from '@/lib/service-project-collaborators';
import {
  canManageServiceProjects,
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
  updateStoredServiceProject,
  saveProjectCollaborators,
  saveProjectSupplement,
  readProjectItemContext,
  saveProjectItems,
  saveProjectOperation,
} from '@/lib/service-project-store';

const emptyForm: ServiceProjectInput & { status: ServiceProjectStatus } = {
  name: '',
  expectedServiceDate: '',
  customerId: '',
  serviceProviderId: '',
  note: '',
  status: '待启动',
};
const timeLabel = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false });

export function ServiceProjects({
  initialProjectId,
  customers,
  actor,
  fields,
  collaboratorDirectory,
  services,
  businessObjects,
  itemFields,
}: {
  initialProjectId?: string;
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
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [open, setOpen] = useState(false);
  const [detailTab, setDetailTab] = useState('overview');
  const [editing, setEditing] = useState<ServiceProjectRecord | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [draftItems, setDraftItems] = useState<RequestItem[]>([]);
  const [draftCollaborators, setDraftCollaborators] =
    useState<ProjectCollaborators>({});
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const labels = Object.fromEntries(
    normalizeProjectFields(fields).map((field) => [field.id, field.name]),
  );
  const readonly =
    editing?.status === '已完成' ||
    editing?.status === '已取消' ||
    (!!editing && !canManageServiceProjects(actor, editing));
  const allowed = canManageServiceProjects(actor);
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
          if (initialProjectId && openedLink.current !== initialProjectId) {
            openedLink.current = initialProjectId;
            const project = result.find(project => project.id === initialProjectId);
            if (project) show(project);
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
  }, [actor, initialProjectId]);

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
    setError('');
    setDetailTab('overview');
    setEditing(project ?? null);
    setDraftCollaborators({});
    setDraftItems([]);
    setForm(
      project
        ? {
            name: project.name,
            expectedServiceDate: project.expectedServiceDate,
            customerId: project.customerId,
            serviceProviderId: project.serviceProviderId ?? '',
            note: project.note,
            customValues: structuredClone(project.customValues ?? {}),
            status: project.status,
          }
        : { ...emptyForm, ...(actor.role === '合作伙伴服务工程师' ? { serviceProviderId: ownProvider?.id ?? '' } : {}) },
    );
    setFormError('');
    setNotice('');
    setOpen(true);
  }

  async function save() {
    if (saveLock.current || readonly || !allowed) return;
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
            draftCollaborators,
            draftItems,
          );
      setRecords((current) =>
        [result, ...current.filter((record) => record.id !== result.id)].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt),
        ),
      );
      setEditing(result);
      setForm({
        name: result.name,
        expectedServiceDate: result.expectedServiceDate,
        customerId: result.customerId,
        serviceProviderId: result.serviceProviderId ?? '',
        note: result.note,
        customValues: structuredClone(result.customValues ?? {}),
        status: result.status,
      });
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

  async function cancelProject(reason: string): Promise<string | null> {
    if (!editing || saving || saveLock.current) return '正在保存，请稍后重试。';
    saveLock.current = true; setSaving(true); setFormError('');
    try {
      const result = await cancelStoredServiceProject(editing.id, editing.revision, reason, actor);
      setEditing(result);
      setRecords(current => current.map(project => project.id === result.id ? result : project));
      setForm({ name: result.name, expectedServiceDate: result.expectedServiceDate, customerId: result.customerId,
        serviceProviderId: result.serviceProviderId ?? '', note: result.note, customValues: structuredClone(result.customValues ?? {}), status: result.status });
      setNotice('服务项目已取消，当前项目资产已解冻，特批额度已作废。');
      return null;
    } catch (cause) { return cause instanceof Error ? cause.message : '取消失败，请重试。'; }
    finally { saveLock.current = false; setSaving(false); }
  }

  async function persistItems(
    change: ProjectItemChange,
  ): Promise<string | null> {
    if (
      readonly ||
      !allowed ||
      saveLock.current ||
      (editing && form.customerId !== editing.customerId)
    )
      return '项目当前无法编辑，请先保存基本信息后重试。';
    saveLock.current = true;
    setSaving(true);
    try {
      if (!editing) {
        const context = await readProjectItemContext();
        setDraftItems(
          changeProjectItems(
            draftItems,
            change,
            form.customerId,
            context,
            projectItemAudience(actor),
            actor,
          ),
        );
      } else {
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
      }
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
    if (readonly || !allowed || saveLock.current)
      return '项目当前无法编辑，请稍后重试。';
    if (
      editing &&
      group === 'partner' &&
      (form.serviceProviderId ?? '') !== (editing.serviceProviderId ?? '')
    )
      return '请先保存服务方变更，再选择合作伙伴协作人。';
    if (!editing) {
      try {
        const resolved = resolveProjectCollaborators(
          form.customerId,
          {
            [group]: ids.map((id) => ({ id, name: '', details: '' })),
          },
          collaboratorDirectory,
          form.serviceProviderId,
        );
        setDraftCollaborators((current) => ({
          ...current,
          [group]: resolved[group],
        }));
        return null;
      } catch (cause) {
        return cause instanceof Error
          ? cause.message
          : '协作人添加失败，请重试。';
      }
    }
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
    if (!editing || readonly || !allowed || saveLock.current)
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

  if (!allowed)
    return (
      <p className="sr-error" role="alert">
        当前身份无权访问服务项目。
      </p>
    );

  if (open) {
    const currentStatus = editing?.status ?? '待启动';
    const cancelled = currentStatus === '已取消';
    return (
      <section
        className="sr-workspace sr-workspace--detail catalog-detail"
        data-project-detail="true"
        aria-label={editing ? '项目详情' : '创建服务项目'}
      >
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
                  {currentStatus}
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
            {editing && <ServiceProjectCancellation key={editing.id} record={editing} actor={actor} users={collaboratorDirectory.users} busy={saving} cancel={cancelProject} />}
            {currentStatus !== '待启动' && (
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => {
                  setOpen(false);
                  setFormError('');
                  setNotice('');
                }}
              >
                返回列表
              </Button>
            )}
            {!readonly && (
              <Button
                type="button"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? '保存中…' : editing ? '保存修改' : '创建项目'}
              </Button>
            )}
          </div>
        </header>
        <ServiceProjectProgress status={currentStatus} cancelledFromStatus={editing?.cancellation?.fromStatus} />
        {notice && <output className="sr-notice">{notice}</output>}
        {formError && (
          <p role="alert" className="sr-error">
            {formError}
          </p>
        )}
        <div className="sr-ops-workspace">
          <Tabs
            value={detailTab}
            onValueChange={(value) => setDetailTab(String(value))}
            className="sr-ops-tabs"
          >
            <TabsList
              variant="line"
              className="sr-ops-tab-list"
              aria-label="服务项目工作区"
            >
              <TabsTrigger value="overview">项目信息</TabsTrigger>
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
                  <TabsTrigger value="worklogs">
                    工时
                    <span>
                      {
                        projectOperationsOf(editing).worklogs.filter(
                          (log) => !log.voidedAt,
                        ).length
                      }
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="activity">
                    活动
                    <span>
                      {projectOperationsOf(editing).activities.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="other">其他</TabsTrigger>
                </>
              )}
            </TabsList>
            {readonly && (
              <p className="sr-ops-hint">项目已结束，信息仅供查看。</p>
            )}
            <div className="sr-detail-layout">
              <div className="sr-detail-main">
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
                  <form
                    id="service-project-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    <section
                      className={`sr-panel${projectItemAudience(actor) === 'internal' ? ' sr-customer-visible-panel' : ''}`}
                      aria-labelledby="project-basic-heading"
                    >
                      <div className="sr-panel-heading">
                        <div className="sr-panel-title-with-visibility"><h3 id="project-basic-heading">基本信息</h3>{projectItemAudience(actor) === 'internal' && <CustomerVisibleBadge />}</div>
                      </div>
                      {editing?.requestConversion?.mapping.readonly && Object.values(editing.requestConversion.mapping.readonly).some(Boolean) && <p className="sr-project-readonly-notice">部分信息由来源请求带入，已按转换配置设为只读。</p>}
                      <fieldset className="sr-form-grid" disabled={saving || cancelled}>
                        <label htmlFor="project-name">
                          {labels.name} <em>*</em>{projectFieldReadonly(editing, 'name') && <small>只读</small>}
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
                          required
                          value={form.expectedServiceDate}
                          readonly={readonly || projectFieldReadonly(editing, 'expectedServiceDate')}
                          disabled={saving}
                          onChange={(value) =>
                            setForm({ ...form, expectedServiceDate: value })
                          }
                        />
                        <div className="service-project-customer">
                          <label htmlFor="project-customer">
                            {labels.customerId} <em>*</em>{projectCustomerReadonly(editing) && <small>只读</small>}
                          </label>
                          {readonly || projectCustomerReadonly(editing) ? (
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
                                if (
                                  !editing &&
                                  form.customerId !== (customer?.id ?? '')
                                ) {
                                  setDraftCollaborators((current) => ({
                                    ...current,
                                    customer: [],
                                  }));
                                  setDraftItems((current) =>
                                    resetProjectItemCustomer(current),
                                  );
                                }
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
                                if (
                                  !editing &&
                                  (form.serviceProviderId ?? '') !==
                                    (provider?.id ?? '')
                                )
                                  setDraftCollaborators((current) => ({
                                    ...current,
                                    partner: [],
                                  }));
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
                          {labels.note}（选填）{projectFieldReadonly(editing, 'note') && <small>只读</small>}
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
                          <div className="sr-help">{field.name}{projectCustomFieldReadonly(editing, field.id) ? '（转换后只读）' : ''}</div>
                          <RequestFieldControl field={field} value={form.customValues?.[field.id] ?? ''} disabled={readonly || saving || projectCustomFieldReadonly(editing, field.id)} onChange={value => setForm(current => ({ ...current, customValues: { ...current.customValues, [field.id]: value } }))} />
                        </fieldset>)}
                      </fieldset>
                    </section>
                  </form>
                  <RequestFieldsContext.Provider value={itemFields}>
                    <ServiceProjectItems
                      project={editing ?? undefined}
                      actor={actor}
                      key={editing?.id ?? 'new-project'}
                      id={editing?.id ?? 'new-project'}
                      customerId={editing?.customerId ?? form.customerId}
                      items={editing?.items ?? draftItems}
                      services={services}
                      objects={businessObjects}
                      readonly={readonly}
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
                    customerId={editing?.customerId ?? form.customerId} items={editing?.items ?? draftItems}
                    actor={actor} readonly={readonly} busy={saving || (!!editing && form.customerId !== editing.customerId)} save={persistItems}
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
                          <dd>{editing.sourceServiceRequestId ? actor.role === '合作伙伴服务工程师' ? editing.sourceServiceRequestId : <a className="sr-source-request-link" href={`/?request=${encodeURIComponent(editing.sourceServiceRequestId)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">{editing.sourceServiceRequestId}</a> : '未关联'}</dd>
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
                      users={collaboratorDirectory.users}
                      contacts={collaboratorDirectory.contacts}
                      customers={customers}
                      busy={saving}
                      publish={publishSupplement}
                      joinMention={(id) =>
                        persistCollaborators('internal', [
                          ...new Set([
                            ...(editing.collaborators?.internal ?? []).map(
                              (person) => person.id,
                            ),
                            id,
                          ]),
                        ])
                      }
                    />
                  </TabsContent>
                )}
                {editing && (
                  <TabsContent value="other" keepMounted>
                    <ServiceProjectOther record={editing} />
                  </TabsContent>
                )}
                {editing && (
                  <ServiceProjectOperations
                    key={editing.id}
                    record={editing}
                    actor={actor}
                    busy={saving}
                    save={persistOperation}
                  />
                )}
              </div>
              <ServiceProjectCollaborators
                showCustomerVisibility={projectItemAudience(actor) === 'internal'}
                project={
                  editing ?? {
                    customerId: form.customerId,
                    serviceProviderId: form.serviceProviderId,
                    collaborators: draftCollaborators,
                  }
                }
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
              />
            </div>
          </Tabs>
        </div>
      </section>
    );
  }

  return (
    <div className="sr-workspace" aria-label="服务项目">
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
                <option key={value}>{value}</option>
              ))}
            </select>
          </div>
          <Button
            className="ct-button ct-button--primary"
            disabled={!ready || saving}
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
                  {labels.name} / {labels.id}
                </th>
                <th>{labels.customerId}</th>
                {projectItemAudience(actor) === 'internal' && <th>服务方</th>}
                {projectItemAudience(actor) === 'internal' && <th>来源服务请求</th>}
                <th>服务项</th>
                <th>{labels.expectedServiceDate}</th>
                <th>{labels.status}</th>
                {projectItemAudience(actor) === 'internal' && <th>创建站点</th>}
                <th>创建时间/创建人</th>
                <th>操作</th>
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
                    ? <a className="app-list-link" href={`/?request=${encodeURIComponent(record.sourceServiceRequestId)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">{requestNames[record.sourceServiceRequestId] || record.requestConversion?.assessmentSnapshot?.requestTitle || record.sourceServiceRequestId}</a>
                    : '未关联'}</td>}
                  <td>{record.items?.length ?? 0} 项</td>
                  <td>{record.expectedServiceDate}</td>
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
                      {record.status}
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
