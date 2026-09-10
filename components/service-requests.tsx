'use client';

import { isRequestApplicant, requestAudience } from '@/lib/request-collaboration';
import { commitCatalogVersion } from '@/lib/catalog-versions';
import { RequestFormBuilder } from '@/components/request-form-builder';
import { requestFormOrder, requestFieldWidth } from '@/lib/request-form-layout';
import { initializeRequestSamples } from '@/lib/demo-service-requests';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CircleAlert,
  ArrowLeft,
  ChevronRight,
  FileText,
  Plus,
  Save,
  Search,
  Settings2,
} from 'lucide-react';
import {
  fieldTypes,
  RequestFieldControl,
  RequestFieldsContext,
} from '@/components/request-field-settings';
import type { RequestField } from '@/components/request-field-settings';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { RequestMaterialDialog } from '@/components/request-material-dialog';
import { RequestStatusProgress } from '@/components/request-status-progress';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { DateField } from '@/components/date-field';
import {
  RequestProjectDialog,
  RequestProjects,
} from '@/components/request-projects';
import { isProjectCreationEligible } from '@/lib/request-projects';
import { RequestOperationsTabs } from '@/components/request-operations';
import {
  emptyAssessment,
  applyAssessmentAction,
  isProjectManager,
  repairCustomerRequestApprover,
} from '@/lib/request-assessment';
import { operationIdentities } from '@/lib/internal-users';
import {
  requestReturnNotice,
  appendActivity,
  operationsOf,
  isInternal,
  migrateRoleLabel,
} from '@/lib/request-operations';
import type { OperationActor, RequestAsset } from '@/lib/request-operations';
import {
  RequestExternalCollaborators,
  RequestInternalInfo,
} from '@/components/request-internal-info';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  canAccessRequest,
  canEditRequestItems,
  canCheckRequestCompleteness,
  canAddExternalCollaborators,
  customerCollaborationIssue,
  customerOwnerRemovalIssue,
  withRequestContact,
  requestContactRemovalIssue,
  canCreateRequest,
  requestCreationAccessIssue,
  requestCreationIssue,
  businessImpactOptions,
  requestStatuses,
  requestStatusTone,
  RequestIdentityError,
  businessObjectsEnabled,
  matchesObjectProduct,
  objectEntitlementAvailability,
  defaultConfig,
  readRequestConfigs,
  resolveRequestConfig,
  serviceAvailableForRequest,
  fieldLabels,
  itemIssues,
  visibleMaterialFiles,
  itemSummaryFields,
  itemBasicIssues,
  requestFieldIsRequired,
  newItem,
  newRequest,
  normalizeRequestConfig,
  readLocal,
  requestIssues,
  saveLocal,
} from '@/lib/service-requests';
import type {
  CatalogService,
  ContactRef,
  CustomerRef,
  InternalUser,
  ItemMaterial,
  ObjectRef,
  RequestConfig,
  RequestItem,
  ServiceRequest,
} from '@/lib/service-requests';

export const BusinessObjectProductsContext = createContext<string[]>([]);
type Props = {
  services: CatalogService[];
  customers: CustomerRef[];
  contacts: ContactRef[];
  businessObjects: ObjectRef[];
  users: InternalUser[];
  assets: RequestAsset[];
  currentRole: string;
  currentActor: OperationActor;
  identityDirectory: { id: string; name: string }[];
  currentCustomerId?: string;
  partnerCollaborators: {
    id: string;
    name: string;
    phone: string;
    email: string;
    status: string;
  }[];
  createToken: number;
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false });
const localError =
  '本地保存未完成。请检查浏览器存储空间或隐私设置后重试，当前填写内容仍保留在页面中。';

const isChoiceField = (field: RequestField) =>
  !field.referenceTarget &&
  (field.type === 'single' || field.type === 'multiple');

function configForEditing(
  config: RequestConfig,
  requestFields: RequestField[],
): RequestConfig {
  const normalized = normalizeRequestConfig(config);
  const fieldOptions = { ...normalized.fieldOptions };
  for (const field of requestFields) {
    if (!normalized.fields.includes(field.id) || !isChoiceField(field))
      continue;
    const enabledOptions = field.options
      .filter((option) => option.enabled)
      .map((option) => option.value);
    const storedOptions = normalized.fieldOptions[field.id];
    fieldOptions[field.id] =
      field.referenceTarget === 'partners' && !storedOptions?.length
        ? enabledOptions
        : (storedOptions?.filter((option) => enabledOptions.includes(option)) ??
          enabledOptions);
  }
  return {
    ...normalized,
    fieldNames: {
      ...normalized.fieldNames,
      ...Object.fromEntries(
        requestFields.map((field) => [field.id, field.name]),
      ),
    },
    fieldOptions,
  };
}

function RequestFormPage({ title, description, backLabel, busy, onClose, actions, children, sectioned = false }: {
  title: string;
  description?: string;
  backLabel: string;
  busy: boolean;
  onClose: () => void;
  actions: ReactNode;
  children: ReactNode;
  sectioned?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: 'start' });
  }, []);
  return (
    <section className="sr-form-page" aria-label={title}>
      <header className="detail-heading sr-form-page-heading">
        <div>
          <button type="button" className="detail-back" disabled={busy} onClick={onClose}>
            <ArrowLeft aria-hidden="true" />{backLabel}
          </button>
          <h2 ref={heading} tabIndex={-1}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div className="detail-actions">{actions}</div>
      </header>
      <div className={sectioned ? 'sr-form-page-sections' : 'sr-panel sr-form-page-content'}>{children}</div>
    </section>
  );
}

function RequestCustomerLabel({ required = false, hint = '创建后不可修改客户。' }: { required?: boolean; hint?: string }) {
  return <span className="sr-customer-label">
    客户{required && <em>*</em>}
    <TooltipProvider><Tooltip>
      <TooltipTrigger render={<span tabIndex={0} role="img" className="sr-description-hint" aria-label="客户说明" onClick={event => event.preventDefault()}><CircleAlert size={16} aria-hidden="true" /></span>} />
      <TooltipContent className="sr-description-tooltip" side="top">{hint}</TooltipContent>
    </Tooltip></TooltipProvider>
  </span>;
}

function RequestItemsPanel({ record, objects, actor, busy, readonly, showCompleteness, canAdd = true, onAdd, onEdit, onRemove, onMaterial }: {
  record: ServiceRequest;
  objects: ObjectRef[];
  actor: OperationActor;
  busy: boolean;
  readonly: boolean;
  showCompleteness: boolean;
  canAdd?: boolean;
  onAdd: () => void;
  onEdit: (item: RequestItem) => void;
  onRemove: (id: string) => void;
  onMaterial: (target: { itemId: string; requirementId: string }) => void;
}) {
  const fieldNames = Object.fromEntries(useContext(RequestFieldsContext).map(field => [field.id, field.name]));
  const internal = isInternal(actor.role);
  const audience = internal ? 'internal' : 'customer';
  return <section className={`sr-panel${internal ? ' sr-customer-visible-panel' : ''}`}>
    <div className="sr-panel-heading">
      <div>
        <div className="sr-panel-title-with-visibility">
          <h3>申请项 <span>{record.items.length}</span></h3>
          {internal && <CustomerVisibleBadge />}
        </div>
        <p>{!showCompleteness ? '申请内容只读，可查看基础信息。' : readonly ? '申请内容已锁定，可查看基础信息和已提交材料。' : '点击申请项中的材料入口，在弹窗中填写或上传。'}</p>
      </div>
      {!readonly && <Button variant="outline" disabled={busy || !canAdd} onClick={onAdd}><Plus size={15} />添加申请项</Button>}
    </div>
    {!record.items.length ? <div className="sr-empty">
      <FileText size={30} />
      <h3>还没有申请项</h3>
      <p>{canAdd ? '从服务目录添加所需服务。同一种服务可以分项申请。' : '请先选择客户，再从服务目录添加所需服务。'}</p>
    </div> : <div className="sr-item-list">
      {record.items.map((item, index) => {
        const missing = showCompleteness ? itemIssues(item, audience, actor.id) : [];
        const basicMissing = showCompleteness ? itemBasicIssues(item) : [];
        const summary = itemSummaryFields(item, fieldNames, objects);
        const inlineFields = summary.filter(field => !field.address);
        const addressFields = summary.filter(field => field.address);
        return <article key={item.id} className="sr-item-entry">
          <div className="sr-item-row">
            <span className="sr-item-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="sr-item-copy">
              <h4>{item.serviceName}{showCompleteness && <span className="sr-badge" data-tone={missing.length ? 'amber' : 'green'}>{missing.length ? '待完善' : '已完整'}</span>}</h4>
              {(summary.length > 0 || item.description.trim()) && <div className="sr-item-summary">
                <div className="sr-item-summary-fields">
                  {inlineFields.map(field => <span className="sr-summary-field" key={field.key}><span className="sr-summary-label">{field.label}</span><span className="sr-summary-value">{field.value}</span></span>)}
                  {item.description.trim() && <TooltipProvider><Tooltip><TooltipTrigger render={<button type="button" className="sr-description-hint" aria-label="查看需求说明"><CircleAlert size={16} /></button>} /><TooltipContent className="sr-description-tooltip" side="top"><div><strong className="sr-tooltip-heading">需求说明</strong><div>{item.description}</div></div></TooltipContent></Tooltip></TooltipProvider>}
                </div>
                {addressFields.map(field => <div className="sr-summary-address" key={field.key}><span className="sr-summary-label">{field.label}</span><span className="sr-summary-value">{field.value}</span></div>)}
              </div>}
              {basicMissing.length > 0 && <p className="sr-missing">待补充：{basicMissing.join('、')}</p>}
              {item.config.materials.map(requirement => {
                const material = item.materials.find(material => material.requirementId === requirement.id);
                const complete = visibleMaterialFiles(material, audience, actor.id).length > 0;
                if (!showCompleteness && !complete) return null;
                return <div key={requirement.id} className="sr-material-entry">
                  <span className={!showCompleteness ? 'sr-help' : complete ? 'sr-complete' : requirement.required ? 'sr-missing' : 'sr-help'}>
                    {showCompleteness && (complete ? '已完成：' : requirement.required ? '待补充：上传' : '选填：')}{requirement.name}
                  </span>
                  <button className="sr-material-link" disabled={busy} onClick={() => onMaterial({ itemId: item.id, requirementId: requirement.id })} aria-label={requirement.name + (readonly || complete ? '，查看材料' : '，补充材料')}>
                    {readonly || complete ? '查看材料' : '补充材料'}<ChevronRight size={13} />
                  </button>
                </div>;
              })}
            </div>
            <div className="sr-item-actions">
              <Button variant="outline" disabled={busy} onClick={() => onEdit(item)}>{readonly ? '查看基础信息' : '编辑基础信息'}</Button>
              {!readonly && <button className="sr-muted-button" disabled={busy} onClick={() => onRemove(item.id)}>移除</button>}
            </div>
          </div>
        </article>;
      })}
    </div>}
  </section>;
}

export function RequestWorkspace(props: Props) {
  const access = {
    actor: props.currentActor,
    directory: props.identityDirectory,
    customerId: props.currentCustomerId,
    contacts: props.contacts,
  };
  const customerPortal = props.currentActor.role === '客户';
  const audience = customerPortal ? 'customer' : 'internal';
  const availableServices = props.services.filter((service) =>
    serviceAvailableForRequest(service, audience),
  );
  const canCreate = canCreateRequest(access);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [draft, setDraft] = useState<ServiceRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creation, setCreation] = useState<ServiceRequest | null>(null);
  const [createMaterialTarget, setCreateMaterialTarget] = useState<{ itemId: string; requirementId: string } | null>(null);
  const createCustomer = creation?.customerId ?? '';
  const [addOpen, setAddOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [pendingItem, setPendingItem] = useState<RequestItem | null>(null);
  const itemParent = createOpen ? creation : draft;
  const pendingReadonly = !itemParent || !canEditRequestItems(itemParent, props.currentActor);
  const pendingService = props.services.find(
    (service) => service.id === pendingItem?.serviceId,
  );
  const pendingServiceContent = pendingService?.description?.trim();
  const [itemError, setItemError] = useState('');
  const [materialTarget, setMaterialTarget] = useState<{
    itemId: string;
    requirementId: string;
  } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [returnDraftOpen, setReturnDraftOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [returnDraftReason, setReturnDraftReason] = useState('');
  const [reservationRecords, setReservationRecords] = useState<
    ServiceRequest[]
  >([]);
  const [showIssues, setShowIssues] = useState(false);
  const handledToken = useRef(0);
  const saveLock = useRef(false);

  function beginCreate() {
    const customerId = customerPortal ? props.currentCustomerId ?? '' : '';
    setCreation(withRequestContact(newRequest('', customerId, props.currentActor.name || props.currentRole, '', props.currentActor.id, props.currentActor.role), props.contacts, props.customers, props.users));
    setAddOpen(false); setPendingItem(null); setCreateMaterialTarget(null);
    setCatalogQuery(''); setError(''); setCreateOpen(true);
  }
  function updateCreation(patch: Partial<ServiceRequest>) {
    setCreation(current => current ? { ...current, ...patch } : current);
    setError('');
  }
  function changeCreationCustomer(customerId: string) {
    if (!creation) return;
    const defaults = newRequest('', customerId, props.currentActor.name || props.currentRole, '', props.currentActor.id, props.currentActor.role);
    setCreation(withRequestContact({ ...creation, customerId, internalParticipants: defaults.internalParticipants, externalCollaborators: defaults.externalCollaborators, items: creation.items.map(item => ({ ...item, businessObjectIds: [], materials: [] })) }, props.contacts, props.customers, props.users));
    setCreateMaterialTarget(null); setError('');
  }
  function load() {
    return initializeRequestSamples(props)
      .catch((error) =>
        setNotice(
          error instanceof Error
            ? `样例初始化暂未完成：${error.message}`
            : '样例初始化暂未完成，请刷新后重试。',
        ),
      )
      .then(() => readLocal<ServiceRequest>('requests'))
      .then(async (records) => {
        records = records.map((record) =>
          withRequestContact(record, props.contacts, props.customers, props.users),
        );
        setReservationRecords(records);
        const repair = repairCustomerRequestApprover(records, props.users);
        if (repair && canAccessRequest(repair, access)) {
          await saveLocal('requests', repair, access);
          records = records.map((record) =>
            record.id === repair.id ? repair : record,
          );
          setDraft((current) => (current?.id === repair.id ? repair : current));
        }
        const visible = records.filter((record) =>
          canAccessRequest(record, access),
        );
        setRequests(
          visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
        );
        setDraft((current) => {
          if (!current) return current;
          const latest = visible.find((record) => record.id === current.id);
          if (!latest) return null;
          return current.status === '待评估' ? latest : current;
        });
        setReady(true);
        setError('');
      })
      .catch(() => {
        setError('无法读取本地资料。请允许此站点使用浏览器存储后重试。');
      });
  }
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) void load();
    };
    refresh();
    window.addEventListener('focus', refresh);
    window.addEventListener('catalog-version-saved', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('catalog-version-saved', refresh);
    };
  }, []);
  useEffect(() => {
    if (canCreate && props.createToken > handledToken.current) {
      handledToken.current = props.createToken;
      beginCreate();
    }
  }, [props.createToken]);

  async function persist(record: ServiceRequest, message = '草稿已保存到本机') {
    if (saveLock.current) return false;
    saveLock.current = true;
    setBusy(true);
    setError('');
    const next = withRequestContact(
      { ...record, updatedAt: new Date().toISOString() },
      props.contacts, props.customers, props.users,
    );
    try {
      await saveLocal('requests', next, access);
      setReservationRecords((previous) => [
        next,
        ...previous.filter((record) => record.id !== next.id),
      ]);
      setRequests((old) =>
        [next, ...old.filter((r) => r.id !== next.id)].filter((record) =>
          canAccessRequest(record, access),
        ),
      );
      setDraft(canAccessRequest(next, access) ? next : null);
      setNotice(message);
      return true;
    } catch (error) {
      setError(
        error instanceof RequestIdentityError ? error.message : localError,
      );
      return false;
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  async function createDraft() {
    if (!ready || busy || !canCreate || !creation) return;
    const record = { ...creation, title: creation.title.trim() };
    const issue =
      requestCreationAccessIssue(record, access) ??
      requestCreationIssue(record, props);
    if (issue) {
      setError(issue);
      return;
    }
    for (const item of record.items) {
      const missing = itemBasicIssues(item);
      if (missing.length) { setError(`${item.serviceName}：请补充${missing.join('、')}`); return; }
      if (!availableServices.some(service => service.id === item.serviceId)) { setError(`${item.serviceName}：目录已停用或不再允许申请，请移除后重新选择。`); return; }
      if (businessObjectsEnabled(item.config) && item.businessObjectIds.some(id => !props.businessObjects.some(object => object.id === id && object.customerId === record.customerId && object.status === '启用' && matchesObjectProduct(object, item.config)))) {
        setError(`${item.serviceName}：请重新选择当前客户有效且符合产品要求的业务对象。`); return;
      }
    }
    if (await persist(record, '服务请求草稿已创建，填写内容已一并保存')) {
      setCreateOpen(false);
      setCreation(null);
      setCreateMaterialTarget(null);
      setMaterialTarget(null);
      setShowIssues(false);
    }
  }
  async function selectItemService(service: CatalogService) {
    if (!ready || busy || !serviceAvailableForRequest(service, audience))
      return;
    setItemError('');
    setBusy(true);
    try {
      // Read at selection time as configuration may have changed in another tab.
      const latest = await readRequestConfigs(audience);
      setPendingItem(newItem(service, resolveRequestConfig(service, latest)));
    } catch {
      setItemError('无法读取申请配置，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function savePendingItem() {
    if (
      !itemParent ||
      !pendingItem ||
      !canEditRequestItems(itemParent, props.currentActor)
    )
      return;
    const missing = itemBasicIssues(pendingItem);
    if (missing.length) {
      setItemError(`请补充：${missing.join('、')}`);
      return;
    }
    if (
      !props.services.some(
        (s) =>
          s.id === pendingItem.serviceId &&
          serviceAvailableForRequest(s, audience),
      )
    ) {
      setItemError(
        '该服务目录已停用、不存在或未开放给当前申请站点，请重新选择。',
      );
      return;
    }
    if (
      businessObjectsEnabled(pendingItem.config) &&
      pendingItem.businessObjectIds.some(
        (id) =>
          !props.businessObjects.some(
            (o) =>
              o.id === id &&
              o.customerId === itemParent.customerId &&
              matchesObjectProduct(o, pendingItem.config) &&
              o.status === '启用',
          ),
      )
    ) {
      setItemError(
        '请取消关联已停用、不属于当前客户或不符合可搜索产品的业务对象。',
      );
      return;
    }
    const exists = itemParent.items.some((i) => i.id === pendingItem.id);
    const next = {
      ...itemParent,
      items: exists
        ? itemParent.items.map(item => item.id === pendingItem.id ? pendingItem : item)
        : [...itemParent.items, pendingItem],
    };
    if (createOpen) {
      updateCreation({ items: next.items });
      setAddOpen(false); setPendingItem(null); setItemError('');
      return;
    }
    if (
      await persistItemChanges(
        next,
        '申请项基础信息已保存，可在该申请项中补充材料',
      )
    ) {
      setAddOpen(false);
      setMaterialTarget(null);
      setPendingItem(null);
      setItemError('');
    }
  }
  async function persistItemChanges(record: ServiceRequest, message: string) {
    const next =
      record.status === '待评估'
        ? appendActivity(
            record,
            props.currentActor,
            '评估',
            '修改申请项',
            message,
          )
        : record;
    return persist(next, message);
  }
  async function saveItemMaterials(id: string, materials: ItemMaterial[]) {
    if (!draft || !canEditRequestItems(draft, props.currentActor)) return false;
    const ok = await persistItemChanges(
      {
        ...draft,
        items: draft.items.map((existing) =>
          existing.id === id ? { ...existing, materials } : existing,
        ),
      },
      '申请项材料已保存到本机',
    );
    return ok;
  }
  const showCompleteness =
    !!draft && canCheckRequestCompleteness(draft, props.currentActor);
  const readonly = draft?.status !== '草稿' || !showCompleteness;
  const itemsReadonly =
    !draft || !canEditRequestItems(draft, props.currentActor);
  const returnNotice = draft ? requestReturnNotice(draft) : null;
  const customerSalesManager = props.users.find(
    (user) => user.id === props.customers.find(
      (customer) => customer.id === draft?.customerId,
    )?.ownerUserId,
  );
  const issues =
    draft && showCompleteness
      ? requestIssues(draft, { ...props, audience })
      : [];
  const materialItem = draft?.items.find(
    (item) => item.id === materialTarget?.itemId,
  );
  const materialRequirement = materialItem?.config.materials.find(
    (m) => m.id === materialTarget?.requirementId,
  );
  const filtered = requests.filter((record) => {
    if (!canAccessRequest(record, access)) return false;
    const customer =
      props.customers.find((c) => c.id === record.customerId)?.name ?? '';
    return (
      (status === '全部状态' || record.status === status) &&
      `${record.id} ${record.title} ${customer}`
        .toLowerCase()
        .includes(query.toLowerCase().trim())
    );
  });
  function updateDraft(
    patch: Partial<
      Pick<
        ServiceRequest,
        | 'title'
        | 'description'
        | 'expectedServiceDate'
        | 'businessImpact'
        | 'externalCollaborators'
        | 'internalParticipants'
      >
    >,
  ) {
    setDraft((record) =>
      record
        ? withRequestContact({ ...record, ...patch }, props.contacts, props.customers, props.users)
        : record,
    );
    setNotice('有未保存的修改');
  }

  function updateCollaborators(
    patch: Partial<
      Pick<ServiceRequest, 'externalCollaborators' | 'internalParticipants'>
    >,
  ) {
    if (!draft || busy) return;
    const removalIssue =
      requestContactRemovalIssue({ ...draft, ...patch }, draft) ??
      customerOwnerRemovalIssue({ ...draft, ...patch }, draft, props.customers);
    if (removalIssue) {
      setError(removalIssue);
      return;
    }
    const customerAddition =
      props.currentRole === '客户' &&
      'externalCollaborators' in patch &&
      !('internalParticipants' in patch);
    if (customerAddition) {
      if (!canAddExternalCollaborators(draft, access)) return;
      const issue = customerCollaborationIssue(
        { ...draft, ...patch },
        draft,
        access,
      );
      if (issue) {
        setError(issue);
        return;
      }
    } else if (!isInternal(props.currentRole)) return;
    if ('externalCollaborators' in patch) {
      const issue = customerCollaborationIssue(
        { ...draft, ...patch },
        draft,
        access,
      );
      if (issue) {
        setError(issue);
        return;
      }
    }
    if (!props.currentActor.id) {
      setError('请先在右上角选择一个启用的内部用户。');
      return;
    }
    if (!readonly && !customerAddition) {
      updateDraft(patch);
      return;
    }
    const external = 'externalCollaborators' in patch;
    const before = external
      ? (draft.externalCollaborators ?? []).map((p) => p.name)
      : (draft.internalParticipants ?? []).map((p) => p.name);
    const after = external
      ? (patch.externalCollaborators ?? []).map((p) => p.name)
      : (patch.internalParticipants ?? []).map((p) => p.name);
    const detail = `变更前：${before.join('、') || '无'}；变更后：${after.join('、') || '无'}`;
    void persist(
      appendActivity(
        { ...draft, ...patch },
        props.currentActor,
        '协作',
        external ? '更新客户协作人' : '更新内部协作人',
        detail,
      ),
      '协作人已保存',
    );
  }

  const feedback = (
    <>
      {error && (
        <div className="sr-error" role="alert">
          {error}
          {!ready && (
            <Button variant="outline" onClick={() => void load()}>
              重试读取
            </Button>
          )}
        </div>
      )}
      {notice && <output className="sr-notice">{notice}</output>}
    </>
  );

  return (
    <div
      className={
        draft || createOpen || addOpen
          ? 'sr-workspace sr-workspace--detail catalog-detail'
          : 'sr-workspace'
      }
    >
      {!createOpen && (!draft ? (
        <>
          {feedback}
          <section className="sr-panel sr-request-list-panel">
            <div className="sr-toolbar app-list-toolbar">
              <div className="sr-filter-group">
                <div className="sr-search">
                  <Search size={16} />
                  <Input
                    aria-label="搜索服务请求"
                    placeholder="搜索申请主题、编号或客户"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <select
                  aria-label="筛选请求状态"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option>全部状态</option>
                  {requestStatuses.map((state) => (
                    <option key={state}>{state}</option>
                  ))}
                </select>
              </div>
              {canCreate && (
                <Button
                  className="ct-button ct-button--primary"
                  disabled={!ready || busy}
                  onClick={beginCreate}
                >
                  <Plus size={16} />
                  新建服务请求
                </Button>
              )}
            </div>
            <div className="sr-table-scroll">
              <table className="sr-table app-list-table">
                <thead>
                  <tr>
                    <th>申请主题 / 编号</th>
                    <th>客户</th>
                    <th>申请项</th>
                    <th>期望服务日期</th>
                    <th>状态</th>
                    <th>最近更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <button
                          className="sr-title-link app-list-link"
                          onClick={() => {
                            setDraft(structuredClone(record));
                            setMaterialTarget(null);
                            setShowIssues(false);
                            setNotice('');
                          }}
                        >
                          {record.title}
                        </button>
                        <small>{record.id}</small>
                      </td>
                      <td>
                        {props.customers.find((c) => c.id === record.customerId)
                          ?.name ?? '待选择'}
                      </td>
                      <td>{record.items.length} 项</td>
                      <td>{record.expectedServiceDate || '—'}</td>
                      <td>
                        <span
                          className="sr-badge"
                          data-tone={requestStatusTone(record.status)}
                        >
                          {record.status}
                        </span>
                      </td>
                      <td>
                        {dateLabel(record.updatedAt)}
                        <small>{migrateRoleLabel(record.owner)}</small>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          className="app-list-link"
                          onClick={() => {
                            setDraft(structuredClone(record));
                            setMaterialTarget(null);
                            setShowIssues(false);
                            setNotice('');
                          }}
                        >
                          查看
                          <ChevronRight size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="sr-empty">
                <FileText size={32} />
                <h3>
                  {!ready
                    ? '正在读取本地资料…'
                    : query || status !== '全部状态'
                      ? '没有匹配的请求'
                      : '从一份服务请求开始'}
                </h3>
                <p>先保存申请草稿，再添加服务和准备各项材料。</p>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <header
            className="detail-heading"
            data-assistant-status={draft.status}
          >
            <div>
              <button
                type="button"
                className="detail-back"
                disabled={busy}
                onClick={async () => {
                  if (readonly || (await persist(draft))) {
                    setDraft(null);
                    setNotice('');
                  }
                }}
              >
                <ArrowLeft aria-hidden="true" />
                返回服务请求
              </button>
              <div className="detail-title-row">
                <h2>{draft.title || '未命名服务请求'}</h2>
                <span
                  className="sr-badge"
                  data-tone={requestStatusTone(draft.status)}
                >
                  {draft.status}
                </span>
              </div>
              <p>
                {draft.id} ·{' '}
                {props.customers.find(
                  (customer) => customer.id === draft.customerId,
                )?.name ?? '未关联客户'}
              </p>
            </div>
            <div className="detail-actions">
              {isProjectCreationEligible(draft, props.currentActor) && (
                <Button
                  className="ct-button ct-button--primary"
                  disabled={busy}
                  onClick={() => setProjectOpen(true)}
                >
                  <Plus size={16} />
                  创建服务项目
                </Button>
              )}
              {draft.status === '待评估' &&
                isProjectManager(props.currentActor) &&
                (!draft.operations?.assessment?.managerId ||
                  draft.operations.assessment.managerId ===
                    props.currentActor.id) && (
                  <Button
                    variant="outline"
                    className="ct-button ct-button--ordinary"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setReturnDraftReason('');
                      setReturnDraftOpen(true);
                    }}
                  >
                    退回草稿
                  </Button>
                )}
              {!readonly && (
                <>
                  <Button
                    variant="outline"
                    className="ct-button ct-button--ordinary"
                    disabled={busy}
                    onClick={() => {
                      void persist(draft);
                    }}
                  >
                    <Save size={15} />
                    保存草稿
                  </Button>
                  {isRequestApplicant(draft, props.currentActor) && <Button
                    className="ct-button ct-button--primary"
                    disabled={busy}
                    onClick={() => {
                      setShowIssues(true);
                      if (!issues.length) setSubmitOpen(true);
                    }}
                  >
                    提交申请
                  </Button>}
                </>
              )}
            </div>
          </header>
          <RequestStatusProgress record={draft} />
          {feedback}
          {showIssues && !readonly && issues.length > 0 && (
            <section className="sr-error" role="alert">
              <strong>尚未提交，请补充以下内容</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={`${index}-${issue}`}>{issue}</li>
                ))}
              </ul>
              <p>
                基础字段请点击“编辑基础信息”；材料请点击对应申请项的“补充材料”。
              </p>
            </section>
          )}
          <RequestOperationsTabs
            customers={props.customers}
            services={props.services}
            key={draft.id}
            customerId={props.currentCustomerId}
            record={draft}
            users={props.users}
            assets={props.assets}
            actor={props.currentActor}
            busy={busy}
            save={persist}
            sidebar={
              <aside className="sr-collaboration-column" aria-label="协作人">
                {customerPortal && (
                  <section className="sr-panel sr-collaboration-card" aria-label="SmartX 联系人">
                    <div className="sr-panel-heading"><h3>SmartX 联系人</h3></div>
                    <div className="sr-internal-body sr-smartx-contact">
                      {customerSalesManager ? (
                        <ul className="sr-participants"><li>
                        <span className="sr-collaborator-copy">
                            <span className="sr-participant-name">{customerSalesManager.name}</span>

                          <small title={`${customerSalesManager.phone?.trim() || '未填写电话'} · ${customerSalesManager.email?.trim() || '未填写邮箱'}`}>
                            {customerSalesManager.phone?.trim() ? <a href={`tel:${customerSalesManager.phone.replace(/\s/g, '')}`}>{customerSalesManager.phone.trim()}</a> : '未填写电话'}
                            {' · '}
                            {customerSalesManager.email?.trim() || '未填写邮箱'}
                          </small>
                        </span>
                        <span className="sr-help">客户经理</span>
                        </li></ul>
                      ) : <span>暂未配置客户所属销售经理</span>}
                    </div>
                  </section>
                )}
                <RequestExternalCollaborators
                  showCustomerVisibility={isInternal(props.currentRole)}
                  applicantId={requestAudience(draft) === 'customer' ? draft.createdById : undefined}
                  contacts={props.contacts.filter(
                    (contact) => contact.customerId === draft.customerId,
                  )}
                  description="搜索当前客户联系人，勾选后确认添加。已停用联系人不可添加。"
                  value={draft.externalCollaborators ?? []}
                  readonly={!canAddExternalCollaborators(draft, access)}
                  allowRemove={true}
                  busy={busy}
                  onChange={(externalCollaborators) =>
                    updateCollaborators({ externalCollaborators })
                  }
                />
                {isInternal(props.currentRole) && (
                  <RequestInternalInfo
                    applicantId={requestAudience(draft) === 'internal' ? draft.createdById : undefined}
                    ownerUserId={
                      props.customers.find(
                        (customer) => customer.id === draft.customerId,
                      )?.ownerUserId
                    }
                    users={props.users}
                    value={draft.internalParticipants ?? []}
                    readonly={false}
                    busy={busy}
                    onChange={(internalParticipants) =>
                      updateCollaborators({ internalParticipants })
                    }
                  />
                )}
              </aside>
            }
          >
            {isInternal(props.currentActor.role) && (
              <RequestProjects record={draft} />
            )}
            {returnNotice && (
              <section className="sr-panel sr-ops-panel" role="status">
                <div className="sr-ops-heading">
                  <div>
                    <h3>{returnNotice.title}</h3>
                    <p className="whitespace-pre-wrap break-words">
                      {returnNotice.reason}
                    </p>
                  </div>
                </div>
              </section>
            )}
            <section
              className={`sr-panel${isInternal(props.currentRole) ? ' sr-customer-visible-panel' : ''}`}
            >
              <div className="sr-panel-heading">
                <div className="sr-panel-title-with-visibility">
                  <h3>基本信息</h3>
                  {isInternal(props.currentRole) && <CustomerVisibleBadge />}
                </div>
              </div>
              <fieldset disabled={readonly || busy} className="sr-form-grid">
                <label htmlFor="sr-title">
                  申请主题 <em>*</em>
                  <Input
                    id="sr-title"
                    value={draft.title}
                    onChange={(e) => updateDraft({ title: e.target.value })}
                    placeholder="例如：生产环境新装与巡检"
                  />
                </label>
                <label htmlFor="sr-customer-readonly">
                  <RequestCustomerLabel hint={draft.customerId ? '创建后不可修改客户。' : '此历史草稿未关联客户，请重新创建请求。'} />
                  <Input
                    id="sr-customer-readonly"
                    className="sr-readonly-customer"
                    readOnly
                    value={
                      props.customers.find((c) => c.id === draft.customerId)
                        ?.name ??
                      (draft.customerId || '历史草稿未选择客户')
                    }
                  />
                </label>
                <DateField
                  id="sr-expected-service-date"
                  label="期望服务日期"
                  value={draft.expectedServiceDate ?? ''}
                  readonly={readonly}
                  disabled={busy}
                  onChange={(expectedServiceDate) =>
                    updateDraft({ expectedServiceDate })
                  }
                />
                <label htmlFor="sr-business-impact">
                  业务影响 <em>*</em>
                  <select id="sr-business-impact" required value={draft.businessImpact ?? ''} onChange={event => updateDraft({ businessImpact: event.target.value as ServiceRequest['businessImpact'] })}>
                    <option value="">{readonly ? '未填写' : '请选择业务影响'}</option>
                    {businessImpactOptions.map(option => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="sr-span">
                  申请说明（选填）
                  <textarea
                    value={draft.description}
                    onChange={(e) =>
                      updateDraft({ description: e.target.value })
                    }
                    placeholder="说明本次整体目标、业务背景和期望时间。各服务的具体范围请在申请项中填写。"
                    rows={3}
                  />
                </label>
              </fieldset>
            </section>
            <RequestItemsPanel
              objects={props.businessObjects}
              record={draft} actor={props.currentActor} busy={busy} readonly={itemsReadonly} showCompleteness={showCompleteness}
              onAdd={() => { setCatalogQuery(''); setPendingItem(null); setItemError(''); setAddOpen(true); }}
              onEdit={item => { setPendingItem(structuredClone(item)); setItemError(''); setAddOpen(true); }}
              onRemove={setRemoveId} onMaterial={setMaterialTarget}
            />
            <section
              className={`sr-panel${isInternal(props.currentRole) ? ' sr-customer-visible-panel' : ''}`}
              aria-labelledby="sr-system-heading"
            >
              <div className="sr-panel-heading">
                <div className="sr-panel-title-with-visibility">
                  <h3 id="sr-system-heading">系统信息</h3>
                  {isInternal(props.currentRole) && <CustomerVisibleBadge />}
                </div>
              </div>
              <dl className="sr-system-info">
                <div>
                  <dt>创建时间</dt>
                  <dd>{dateLabel(draft.createdAt)}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{dateLabel(draft.updatedAt)}</dd>
                </div>
                <div>
                  <dt>提交时间</dt>
                  <dd>
                    {draft.submittedAt
                      ? dateLabel(draft.submittedAt)
                      : '未提交'}
                  </dd>
                </div>
                <div>
                  <dt>创建人</dt>
                  <dd>
                    {migrateRoleLabel(draft.createdBy ?? draft.owner ?? '—')}
                  </dd>
                </div>
              </dl>
            </section>
          </RequestOperationsTabs>
        </>
      ))}

      {materialItem &&
        materialRequirement &&
        (showCompleteness ||
          visibleMaterialFiles(
            materialItem.materials.find(
              (material) => material.requirementId === materialRequirement.id,
            ),
            audience,
            props.currentActor.id,
          ).length > 0) && (
          <RequestMaterialDialog
            key={materialItem.id + ':' + materialRequirement.id}
            item={materialItem}
            requirement={materialRequirement}
            actor={props.currentActor}
            readonly={itemsReadonly}
            busy={busy}
            error={error}
            onClose={() => setMaterialTarget(null)}
            onSave={(material) =>
              saveItemMaterials(materialItem.id, [
                ...materialItem.materials.filter(
                  (m) => m.requirementId !== material.requirementId,
                ),
                material,
              ])
            }
          />
        )}
      {canCreate && createOpen && creation && (
        <RequestFormPage
          title="新建服务请求"
          sectioned
          backLabel={draft ? "返回申请详情" : "返回服务请求"}
          busy={busy}
          onClose={() => { setCreateOpen(false); setCreateMaterialTarget(null); setError(''); }}
          actions={<>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => { setCreateOpen(false); setCreateMaterialTarget(null); setError(''); }}
            >
              取消
            </Button>
            <Button
              disabled={!ready || busy || !canCreate}
              onClick={() => void createDraft()}
            >
              {busy ? '正在保存…' : '创建草稿'}
            </Button>
          </>}
        >
          <RequestStatusProgress status="草稿" />
          {error && <p className="sr-error" role="alert">{error}</p>}
          <div className="sr-detail-layout">
          <div className="sr-detail-main">
          <section className={`sr-panel${!customerPortal ? ' sr-customer-visible-panel' : ''}`} aria-label="基本信息">
          <div className="sr-panel-heading">
            <div className="sr-panel-title-with-visibility"><h3>基本信息</h3>{!customerPortal && <CustomerVisibleBadge />}</div>
          </div>
          <fieldset className="sr-form-grid" disabled={busy}>
            <label htmlFor="sr-create-title">
              申请主题 <em>*</em>
              <Input
                id="sr-create-title"
                required
                disabled={busy}
                value={creation.title}
                onChange={(e) => {
                  updateCreation({ title: e.target.value });
                }}
                placeholder="例如：生产环境新装与巡检"
              />
            </label>
            {customerPortal ? <label htmlFor="sr-create-customer-readonly">
              <RequestCustomerLabel />
              <Input id="sr-create-customer-readonly" className="sr-readonly-customer" readOnly value={props.customers.find(customer => customer.id === createCustomer)?.name ?? createCustomer} />
            </label> : (
              <label>
                <RequestCustomerLabel required hint={`创建后不可修改客户。${creation.items.length ? '更换客户会清空已选业务对象、材料和协作人。' : ''}`} />
                <select
                  required
                  disabled={busy}
                  value={createCustomer}
                  onChange={(e) => {
                    changeCreationCustomer(e.target.value);
                  }}
                >
                  <option value="">请选择客户</option>
                  {props.customers
                    .filter((c) => c.status === '启用')
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <DateField id="sr-create-expected-date" label="期望服务日期" value={creation.expectedServiceDate ?? ''} disabled={busy} onChange={expectedServiceDate => updateCreation({ expectedServiceDate })} />
            <label htmlFor="sr-create-business-impact">
              业务影响 <em>*</em>
              <select id="sr-create-business-impact" required value={creation.businessImpact ?? ''} onChange={event => updateCreation({ businessImpact: event.target.value as ServiceRequest['businessImpact'] })}>
                <option value="">请选择业务影响</option>
                {businessImpactOptions.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
            <label className="sr-span">申请说明（选填）
              <textarea rows={3} value={creation.description} onChange={event => updateCreation({ description: event.target.value })} placeholder="说明本次整体目标、业务背景和期望时间。各服务的具体范围请在申请项中填写。" />
            </label>
          </fieldset>
          </section>
          <RequestItemsPanel
              objects={props.businessObjects}
            record={creation} actor={props.currentActor} busy={busy} readonly={false} showCompleteness={true} canAdd={ready && !!createCustomer}
            onAdd={() => { setPendingItem(null); setCatalogQuery(''); setItemError(''); setError(''); setAddOpen(true); }}
            onEdit={item => { setPendingItem(structuredClone(item)); setItemError(''); setError(''); setAddOpen(true); }}
            onRemove={id => updateCreation({ items: creation.items.filter(item => item.id !== id) })}
            onMaterial={setCreateMaterialTarget}
          />
          </div>
          <aside className="sr-collaboration-column" aria-label="协作人">
            <RequestExternalCollaborators showCustomerVisibility={!customerPortal} applicantId={customerPortal ? creation.createdById : undefined} contacts={props.contacts.filter(contact => contact.customerId === createCustomer)} description="搜索当前客户联系人，勾选后确认添加。已停用联系人不可添加。" value={creation.externalCollaborators ?? []} readonly={!createCustomer} allowRemove={true} busy={busy} onChange={externalCollaborators => updateCreation({ externalCollaborators })} />
            {!customerPortal && <RequestInternalInfo applicantId={creation.createdById} ownerUserId={props.customers.find(customer => customer.id === createCustomer)?.ownerUserId} users={props.users} value={creation.internalParticipants ?? []} readonly={!createCustomer} busy={busy} onChange={internalParticipants => updateCreation({ internalParticipants })} />}
          </aside>
          </div>
        </RequestFormPage>
      )}

      {createOpen && creation && createMaterialTarget && (() => {
        const item = creation.items.find(item => item.id === createMaterialTarget.itemId);
        const requirement = item?.config.materials.find(requirement => requirement.id === createMaterialTarget.requirementId);
        if (!item || !requirement) return null;
        return <RequestMaterialDialog key={`${item.id}:${requirement.id}`} item={item} requirement={requirement} actor={props.currentActor} readonly={false} busy={busy} error="" onClose={() => setCreateMaterialTarget(null)} onSave={async material => {
          updateCreation({ items: creation.items.map(existing => existing.id === item.id ? { ...existing, materials: [...existing.materials.filter(saved => saved.requirementId !== material.requirementId), material] } : existing) });
          setCreateMaterialTarget(null);
          return true;
        }} />;
      })()}

      {itemParent && (
        <Dialog open={addOpen} onOpenChange={open => {
          if (!open && !busy) { setAddOpen(false); setPendingItem(null); setItemError(''); setError(''); }
        }}>
          <DialogContent className="sr-dialog sr-catalog-dialog sr-item-basics-dialog" showCloseButton={!busy}>
            <DialogHeader>
              <DialogTitle>{pendingReadonly && pendingItem ? '申请项基础信息' : pendingItem && itemParent.items.some(item => item.id === pendingItem.id) ? '编辑申请项' : '添加申请项'}</DialogTitle>
              <DialogDescription>{pendingItem ? (createOpen ? '填写并保存基础信息，材料可返回请求表单补充。' : '填写并保存基础信息，材料可在申请详情页中补充。') : '选择本次申请的服务目录。'}</DialogDescription>
            </DialogHeader>
          <div className="sr-item-dialog-body">
            {pendingItem ? (
              <>
                <div className="sr-selected-service">
                  <div>
                    <strong>{pendingItem.serviceName}</strong>
                    <p>
                      {pendingItem.serviceId} · 目录版本{' '}
                      {pendingService ? `v${pendingService.version ?? 1}` : '—'}
                    </p>
                    {pendingServiceContent && (
                      <p className="sr-selected-service-content">
                        服务内容：{pendingServiceContent}
                      </p>
                    )}
                  </div>
                  {!itemParent.items.some((i) => i.id === pendingItem.id) && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setPendingItem(null);
                        setItemError('');
                      }}
                    >
                      重新选择目录
                    </Button>
                  )}
                </div>
                <ItemBasicFields
                  value={pendingItem}
                  reservationRecords={reservationRecords}
                  requestId={itemParent.id}
                  priceUnit={
                    props.services.find(
                      (service) => service.id === pendingItem.serviceId,
                    )?.priceUnit
                  }
                  objects={props.businessObjects.filter(
                    (o) => o.customerId === itemParent.customerId,
                  )}
                  customerId={itemParent.customerId ?? ''}
                  readonly={pendingReadonly}
                  busy={busy}
                  update={(patch) =>
                    setPendingItem((item) =>
                      item ? { ...item, ...patch } : item,
                    )
                  }
                />
              </>
            ) : (
              <>
                <Input
                  aria-label="搜索可申请服务"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="搜索服务名称或编码"
                />
                <div className="sr-catalog-options">
                  {availableServices
                    .filter(
                      (s) =>
                        s.status === '已启用' &&
                        (s.id + ' ' + s.name)
                          .toLowerCase()
                          .includes(catalogQuery.toLowerCase()),
                    )
                    .map((service) => (
                      <div key={service.id}>
                        <FileText size={20} />
                        <div>
                          <strong>{service.name}</strong>
                          <p>
                            {service.id} · {service.category}
                          </p>
                          {service.description?.trim() && (
                            <p className="sr-catalog-service-description">
                              {service.description}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy || !ready}
                          onClick={() => selectItemService(service)}
                        >
                          选择
                        </Button>
                      </div>
                    ))}
                  {!availableServices.some(
                    (s) =>
                      s.status === '已启用' &&
                      (s.id + ' ' + s.name)
                        .toLowerCase()
                        .includes(catalogQuery.toLowerCase()),
                  ) && <p className="sr-empty">没有匹配的已启用服务。</p>}
                </div>
              </>
            )}
            {(itemError || error) && (
              <p className="sr-error" role="alert">
                {itemError || error}
              </p>
            )}
          </div>
            <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAddOpen(false);
                setPendingItem(null);
                setItemError('');
              }}
            >
              {pendingReadonly ? '关闭' : '取消'}
            </Button>
            {pendingItem && !pendingReadonly && (
              <Button disabled={busy} onClick={() => void savePendingItem()}>
                <Save size={15} />
                {busy ? '正在保存…' : '保存申请项'}
              </Button>
            )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog
        open={!!removeId}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoveId(null);
        }}
      >
        <DialogContent className="sr-dialog">
          <DialogHeader>
            <DialogTitle>移除此申请项？</DialogTitle>
            <DialogDescription>
              该项的填写内容和已保存附件将一并从请求中移除，其他申请项不受影响。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="sr-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoveId(null)}
            >
              保留申请项
            </Button>
            <Button
              variant="destructive"
              disabled={busy || itemsReadonly}
              onClick={async () => {
                if (
                  draft &&
                  !itemsReadonly &&
                  (await persistItemChanges(
                    {
                      ...draft,
                      items: draft.items.filter((i) => i.id !== removeId),
                    },
                    '申请项已移除',
                  ))
                )
                  setRemoveId(null);
              }}
            >
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {projectOpen && draft && (
        <RequestProjectDialog
          objects={props.businessObjects}
          key={`${draft.id}:${props.currentActor.id}`}
          record={draft}
          actor={props.currentActor}
          busy={busy}
          save={persist}
          close={() => setProjectOpen(false)}
        />
      )}

      <Dialog
        open={returnDraftOpen}
        onOpenChange={(open) => {
          if (!busy) setReturnDraftOpen(open);
        }}
      >
        <DialogContent className="sr-ops-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>退回草稿</DialogTitle>
            <DialogDescription>
              退回后可修改申请信息和材料；已锁定资产将释放，相关特批失效，评估历史保留。
            </DialogDescription>
          </DialogHeader>
          <label className="sr-ops-field">
            <span>退回原因 *</span>
            <Textarea
              value={returnDraftReason}
              disabled={busy}
              onChange={(event) => setReturnDraftReason(event.target.value)}
              rows={3}
              placeholder="说明需要补充或修改的内容"
            />
          </label>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReturnDraftOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={busy || !returnDraftReason.trim()}
              onClick={async () => {
                if (!draft) return;
                setError('');
                try {
                  const next = applyAssessmentAction(
                    draft,
                    { type: 'return-draft', reason: returnDraftReason },
                    props.currentActor,
                    props.assets,
                    props.users,
                    [],
                  );
                  if (await persist(next, '已退回草稿，可补充申请后重新提交')) {
                    setReturnDraftOpen(false);
                    setShowIssues(false);
                  }
                } catch (issue) {
                  setError(
                    issue instanceof Error
                      ? issue.message
                      : '退回失败，请重试。',
                  );
                }
              }}
            >
              确认退回草稿
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={submitOpen}
        onOpenChange={(open) => {
          if (!busy) setSubmitOpen(open);
        }}
      >
        <DialogContent className="sr-dialog">
          <DialogHeader>
            <DialogTitle>确认提交服务请求</DialogTitle>
            <DialogDescription>
              共 {draft?.items.length}{' '}
              个申请项。提交后进入“待评估”，本版申请内容将锁定，由 SmartX
              核查材料、服务范围和依据。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="sr-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSubmitOpen(false)}
            >
              继续检查
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!draft || !isRequestApplicant(draft, props.currentActor)) return;
                if (issues.length) {
                  setSubmitOpen(false);
                  setShowIssues(true);
                  return;
                }
                const projectManager = operationIdentities(props.users).find(
                  (user) => user.role === 'SmartX 项目经理',
                );
                if (
                  await persist(
                    appendActivity(
                      {
                        ...draft,
                        status: '待评估',
                        operations: {
                          ...operationsOf(draft),
                          assessment: {
                            ...emptyAssessment(),
                            managerId: projectManager?.id ?? '',
                            manager: projectManager?.name ?? '',
                          },
                        },
                        submittedAt: new Date().toISOString(),
                      },
                      props.currentActor,
                      '提交',
                      '提交服务请求',
                      '请求进入待评估，基本信息和申请项已锁定',
                    ),
                    '已提交，等待项目经理评估',
                  )
                ) {
                  setSubmitOpen(false);
                  setShowIssues(false);
                }
              }}
            >
              确认提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemBasicFields({
  reservationRecords,
  requestId,
  priceUnit,
  value,
  objects,
  customerId,
  readonly,
  busy,
  update,
}: {
  reservationRecords: ServiceRequest[];
  requestId?: string;
  priceUnit?: string;
  value: RequestItem;
  objects: ObjectRef[];
  customerId: string;
  readonly: boolean;
  busy: boolean;
  update: (patch: Partial<RequestItem>) => void;
}) {
  const fields = useContext(RequestFieldsContext);
  const methodField = fields.find((field) => field.id === 'method');
  const formOrder = requestFormOrder(value.config);
  const designed = !!(value.config.fieldOrder || value.config.fieldWidths);
  const fieldStyle = (id: string) => designed ? {
    order: formOrder.indexOf(id),
    gridColumn: requestFieldWidth(value.config, id) === 'full' ? '1 / -1' : 'span 1',
    minWidth: 0,
  } : undefined;
  const methodOptions =
    methodField?.options
      .filter(
        (option) => option.enabled && value.methods.includes(option.value),
      )
      .map((option) => option.value) ?? value.methods;
  return (
    <div className={`sr-basic-fields${designed ? ' rf-live-form' : ''}`}>
      {' '}
      <section className="sr-sheet-section">
        <h3>服务需求</h3>
        <fieldset disabled={readonly || busy} className="sr-form-grid">
          <label style={fieldStyle('method')}>
            {methodField?.name ?? '服务方式'} <em>*</em>
            {methodField && methodField.type !== 'single' ? (
              <RequestFieldControl
                disabled={readonly || busy}
                field={methodField}
                availableOptions={value.methods}
                value={value.method}
                onChange={(method) =>
                  update({ method, methodFieldType: (methodField.type === 'lookup' || methodField.type === 'address') ? 'single' : methodField.type })
                }
              />
            ) : (
              <select
                value={value.method}
                onChange={(e) =>
                  update({ method: e.target.value, methodFieldType: 'single' })
                }
              >
                <option value="">请选择</option>
                {value.method && !methodOptions.includes(value.method) && (
                  <option disabled value={value.method}>
                    {value.method}（已停用）
                  </option>
                )}
                {methodOptions.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
          </label>
          {value.config.basicFields?.description?.enabled !== false && (
            <label className="sr-span" style={fieldStyle('description')}>
              需求说明{' '}
              {value.config.basicFields?.description?.required !== false ? (
                <em>*</em>
              ) : (
                <small>选填</small>
              )}
              <textarea
                rows={4}
                value={value.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="说明本项服务的目标、范围和期望结果，环境细节可在材料中补充。"
              />
            </label>
          )}
          {value.config.fields.map((key) => {
            if (key === 'businessObjects') return null;
            const field = fields.find((item) => item.id === key);
            const label =
              field?.name ??
              value.config.fieldNames?.[key] ??
              fieldLabels[key] ??
              key;
            return (
              <div className="request-field-input" key={key} style={fieldStyle(key)}>
                <span>
                  {label}{' '}
                  {!requestFieldIsRequired(value.config, key, value.method) ? (
                    <small>选填</small>
                  ) : (
                    <em>*</em>
                  )}
                </span>
                {key !== 'nodes' && field ? (
                  <RequestFieldControl
                    disabled={readonly || busy}
                    field={field}
                    value={value.values[key] ?? ''}
                    availableOptions={value.config.fieldOptions?.[key]}
                    onChange={(next) =>
                      update({ values: { ...value.values, [key]: next } })
                    }
                  />
                ) : (
                  <Input
                    type={key === 'nodes' ? 'number' : 'text'}
                    min={key === 'nodes' ? 1 : undefined}
                    step={key === 'nodes' ? 1 : undefined}
                    value={value.values[key] ?? ''}
                    onChange={(e) =>
                      update({
                        values: { ...value.values, [key]: e.target.value },
                      })
                    }
                    aria-label={label}
                    placeholder={
                      key === 'nodes' ? '填写本项涉及的节点数' : `填写${label}`
                    }
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      </section>
      {businessObjectsEnabled(value.config) && (
        <section className="sr-sheet-section" style={fieldStyle('businessObjects')}>
          <h3>
            业务对象{' '}
            <span>
              {value.config.basicFields?.businessObjects?.required
                ? '必填'
                : '选填'}{' '}
              · 可多选
            </span>
          </h3>
          {value.config.basicFields?.businessObjects?.required && (
            <p className="sr-help">请至少关联一个当前客户的业务对象。</p>
          )}
          <fieldset disabled={readonly || busy} className="sr-object-options">
            <ul aria-label="可关联的业务对象">
              {objects
                .filter(
                  (o) =>
                    (o.status === '启用' &&
                      matchesObjectProduct(o, value.config)) ||
                    value.businessObjectIds.includes(o.id),
                )
                .map((o) => {
                  const entitlement = objectEntitlementAvailability(
                    o,
                    priceUnit,
                    reservationRecords,
                    requestId,
                  );
                  return (
                    <li key={o.id}>
                      <label>
                        <input
                          type="checkbox"
                          disabled={
                            readonly ||
                            busy ||
                            ((o.status !== '启用' ||
                              !matchesObjectProduct(o, value.config)) &&
                              !value.businessObjectIds.includes(o.id))
                          }
                          checked={value.businessObjectIds.includes(o.id)}
                          onChange={(e) =>
                            update({
                              businessObjectIds: e.target.checked
                                ? [...value.businessObjectIds, o.id]
                                : value.businessObjectIds.filter(
                                    (id) => id !== o.id,
                                  ),
                            })
                          }
                        />
                        <span className="sr-object-copy">
                          <span className="sr-object-name">
                            {o.name}
                            <small>（{o.nodeCount} 节点）</small>
                          </span>
                          {entitlement && (
                            <span
                              className="sr-object-entitlement"
                              data-insufficient={
                                entitlement.insufficient || undefined
                              }
                            >
                              <span title="可用权益 / 集群节点数">
                                {entitlement.name}（
                                {entitlement.available ?? '未维护'}/
                                {entitlement.required}）
                              </span>
                              {entitlement.insufficient && (
                                <span className="sr-object-entitlement-warning">
                                  权益不足，可继续申请
                                </span>
                              )}
                              {entitlement.available === undefined && (
                                <span className="sr-help">
                                  权益数量未维护，可继续申请
                                </span>
                              )}
                            </span>
                          )}
                          <span className="sr-object-sn">
                            序列号：{o.sn?.trim() || '未填写'}
                          </span>
                          {o.status !== '启用' && (
                            <span className="sr-missing">
                              已停用，请取消关联
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
            </ul>
            {!objects.length && (
              <p className="sr-help">
                {customerId
                  ? '该客户暂时没有可关联的业务对象。'
                  : '请先在申请单中选择客户。'}
              </p>
            )}
          </fieldset>
        </section>
      )}
    </div>
  );
}

export function RequestCatalogSettings({
  service,
  audience = 'internal',
}: {
  service: CatalogService;
  audience?: 'internal' | 'customer';
}) {
  const configLabel = audience === 'internal' ? '内部申请' : '客户中心申请';
  const requestFields = useContext(RequestFieldsContext);
  const products = useContext(BusinessObjectProductsContext);
  const [config, setConfig] = useState<RequestConfig>(() =>
    defaultConfig(service),
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(config);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    readRequestConfigs(audience)
      .then((records) => {
        if (active) {
          setConfig(resolveRequestConfig(service, records));
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError('无法读取本地申请配置，请重新进入此目录后重试。');
      });
    return () => {
      active = false;
    };
  }, [service, audience]);
  return (
    <section className="detail-card detail-card--wide sr-config-card">
      <div className="sr-panel-heading">
        <div>
          <h3>{configLabel}配置</h3>
          <p>配置申请项所需参数与文档，不改变服务计价字段。</p>
        </div>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => {
            setEditing(configForEditing(config, requestFields));
            setSaved(false);
            setOpen(true);
          }}
        >
          <Settings2 size={15} />
          配置{configLabel}
        </Button>
      </div>
      <p>
        申请项字段：
        {config.fields
          .map(
            (fieldId) =>
              requestFields.find((field) => field.id === fieldId)?.name ??
              fieldLabels[fieldId] ??
              fieldId,
          )
          .join('、') || '无额外必填参数'}
      </p>
      <p>
        材料：
        {config.materials
          .map((m) => `${m.name}（${m.required ? '必填' : '选填'}）`)
          .join('、') || '无'}
      </p>
      {saved && <output className="sr-complete">申请配置已保存到本机</output>}
      {error && (
        <p role="alert" className="sr-error">
          {error}
        </p>
      )}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <SheetContent className="sr-item-sheet rf-fullscreen">
          <SheetHeader>
            <SheetTitle>配置{configLabel}</SheetTitle>
            <SheetDescription>
              {service.name} · 保存后用于新添加的申请项；不影响已创建项目。
            </SheetDescription>
          </SheetHeader>
          <RequestFormBuilder service={service} config={editing} fields={requestFields} products={products} busy={busy} update={setEditing} />
          {error && <p role="alert" className="sr-error" style={{ margin: '8px 24px' }}>{error}</p>}
          <SheetFooter className="sr-sheet-footer">
            <span>模板文件仅保存在本机</span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                const choiceWithoutOptions = requestFields.find(
                  (field) =>
                    editing.fields.includes(field.id) &&
                    isChoiceField(field) &&
                    !(editing.fieldOptions[field.id]?.length ?? 0),
                );
                if (choiceWithoutOptions) {
                  setError(
                    `请为“${choiceWithoutOptions.name}”至少选择一个当前目录可用选项。`,
                  );
                  return;
                }
                if (editing.materials.some((m) => !m.name.trim())) {
                  setError('请填写每份材料的名称。');
                  return;
                }
                if (
                  editing.materials.some((material) => {
                    const value = material.onlineTemplateUrl?.trim();
                    if (!value) return false;
                    try {
                      const url = new URL(value);
                      return !['http:', 'https:'].includes(url.protocol);
                    } catch {
                      return true;
                    }
                  })
                ) {
                  setError('在线文档模板链接须为有效的 http 或 https 地址。');
                  return;
                }
                setBusy(true);
                setError('');
                const selectedChoiceIds = new Set(
                  requestFields
                    .filter(
                      (field) =>
                        editing.fields.includes(field.id) &&
                        isChoiceField(field),
                    )
                    .map((field) => field.id),
                );
                const next = {
                  ...editing,
                  basicFields: {
                    ...editing.basicFields,
                    businessObjects: {
                      enabled: businessObjectsEnabled(editing),
                      required:
                        editing.basicFields?.businessObjects?.required ?? false,
                      products: [
                        ...(editing.basicFields?.businessObjects?.products ??
                          products),
                      ],
                    },
                  },
                  revision: config.revision + 1,
                  fieldNames: Object.fromEntries(
                    editing.fields.map((fieldId) => [
                      fieldId,
                      requestFields.find((field) => field.id === fieldId)
                        ?.name ??
                        editing.fieldNames[fieldId] ??
                        fieldLabels[fieldId] ??
                        fieldId,
                    ]),
                  ),
                  fieldOptions: Object.fromEntries(
                    Object.entries(editing.fieldOptions).filter(([fieldId]) =>
                      selectedChoiceIds.has(fieldId),
                    ),
                  ),
                };
                try {
                  const savedConfig = await commitCatalogVersion(service.id, {
                    config: next,
                    audience,
                    reason: `修改${configLabel}配置`,
                  });
                  setConfig(savedConfig ?? next);
                  setSaved(true);
                  setOpen(false);
                } catch {
                  setError(localError);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在保存…' : '保存配置'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
