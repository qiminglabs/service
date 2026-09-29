'use client';

import { RequiredMark } from '@/components/required-mark';
import { withRequestCollaborators, applicantRemovalIssue } from '@/lib/request-collaboration';

import { canSubmitRequest, requestCollaboratorsLocked } from '@/lib/request-collaboration';
import { isSystemApplicationField } from '@/lib/request-application-fields';
import { isConvertedRequest, convertedRequestReadonlyMessage } from '@/lib/request-readonly';
import { requestTypeOf, requestTypes, type RequestType } from '@/lib/request-types';

import { canPerformAssessmentRole } from '@/lib/assessment-routing';
import { canCancelRequest, cancelRequest } from '@/lib/request-cancellation';
import { deliveryConversionIssue, deliveryConversionMaterialIssues, convertAssessmentToDelivery } from '@/lib/request-type-workflow';
import { RequestDeliveryConversion } from '@/components/request-delivery-conversion';

import { checkSubmissionQueue, SubmissionValidationError, submissionEvent, validationHeading } from '@/lib/submission-validation';
import type { ValidationFailure } from '@/lib/submission-validation';
import type { RuleEvent } from '@/lib/submission-rule-schema';
import { requestAudience,managerCollaboratorId,hardwareCollaboratorId,assessmentCollaboratorRemovalIssue } from '@/lib/request-collaboration';
import { commitCatalogVersion, canManageCatalog } from '@/lib/catalog-versions';
import { RequestFormBuilder } from '@/components/request-form-builder';
import { requestFormOrder } from '@/lib/request-form-layout';
import { RequestFormLayout } from '@/components/request-form-layout';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
CircleAlert,
ArrowLeft,FileText,
Plus,
Save,
Search,
Settings2
} from 'lucide-react';
import {
RequestFieldControl,
RequestFieldsContext,
ApplicationFieldsContext
} from '@/components/request-field-settings';
import type { RequestField } from '@/components/request-field-settings';
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { RequestMaterialDialog } from '@/components/request-material-dialog';
import { RequestMaterialsPanel } from '@/components/request-materials-panel';
import { materialFiles } from '@/lib/service-requests';
import { prepareMaterialDeduplication, requestMaterialGroup, materialDialogItem, synchronizeRequestMaterials, saveRequestMaterialGroup } from '@/lib/request-materials';
import { RequestStatusProgress } from '@/components/request-status-progress';
import { RequestNextStepBanner } from '@/components/request-next-step';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { ServiceProjectBasicInfo as RequestBasicInfo, projectFieldText } from '@/components/service-project-basic-info';
import { requestBasicInfo, requestIdentityIssue, type RequestSaveOptions } from '@/lib/service-requests';
import { DateField } from '@/components/date-field';
import {
  RequestProjectDialog,
  RequestProjects,
} from '@/components/request-projects';
import { isProjectCreationEligible } from '@/lib/request-projects';
import { RequestOperationsTabs } from '@/components/request-operations';
import {
emptyAssessment,
applyAssessmentAction
} from '@/lib/request-assessment';
import {
requestReturnNotice,
appendActivity,
operationsOf,
isInternal
} from '@/lib/request-operations';
import type { OperationActor, RequestAsset } from '@/lib/request-operations';
import {
  RequestExternalCollaborators,
  RequestInternalInfo,
  RequestPartnerCollaborators,
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
canCreateRequest,
requestCreationAccessIssue,
requestCreationIssue,
requestStatuses,
requestStatusTone,
RequestIdentityError,
businessObjectsEnabled,
matchesObjectProduct,
objectEntitlementAvailability,
snapshotItemBusinessObjects,
clearHiddenRequestFields,
savedItemBusinessObjects,
defaultConfig,
readRequestConfigs,
resolveRequestConfig,
serviceAvailableForRequest,
fieldLabels,
requestMaterialsCustomerVisible,
itemSummaryFields,
itemBasicIssues,
requestFieldIsRequired,
requestFieldIsVisible,
newItem,
copyRequestItem,
newRequest,
normalizeRequestConfig,
readLocal,
saveLocal,
} from '@/lib/service-requests';
import type {
  CatalogService,
  CatalogFormAudience,
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
  partnerCollaborators: import('@/lib/partner-directory').PartnerUser[];
  partners: import('@/lib/partner-directory').Partner[];
  initialRequestId?: string;
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

function RequestCustomerLabel({ required = false, hint = '' }: { required?: boolean; hint?: string }) {
  const label = useContext(ApplicationFieldsContext).find(field => field.id === 'customerId')?.name ?? '客户';
  return <span className="sr-customer-label">
    {label}{required && <em>*</em>}
    {hint && <TooltipProvider><Tooltip>
      <TooltipTrigger render={<span tabIndex={0} role="img" className="sr-description-hint" aria-label="客户说明" onClick={event => event.preventDefault()}><CircleAlert size={16} aria-hidden="true" /></span>} />
      <TooltipContent className="sr-description-tooltip" side="top">{hint}</TooltipContent>
    </Tooltip></TooltipProvider>}
  </span>;
}

function RequestItemsPanel({ record, objects, actor, busy, readonly, showCompleteness, canAdd = true, onAdd, onEdit, onRemove, onCopy }: {
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
  onCopy: (id: string) => void;
}) {
  const fieldNames = Object.fromEntries(useContext(RequestFieldsContext).map(field => [field.id, field.name]));
  const internal = isInternal(actor.role);
  return <section className={`sr-panel${internal ? ' sr-customer-visible-panel' : ''}`}>
    <div className="sr-panel-heading">
      <div>
        <div className="sr-panel-title-with-visibility">
          <h3>服务项</h3>
          {internal && <CustomerVisibleBadge />}
        </div>
      </div>
      {!readonly && <Button variant="outline" disabled={busy || !canAdd} onClick={onAdd}><Plus size={15} />添加服务项</Button>}
    </div>
    {!record.items.length ? <div className="sr-empty">
      <FileText size={30} />
      <h3>还没有服务项</h3>
    </div> : <div className="sr-item-list">
      {record.items.map((item, index) => {
        const basicMissing = showCompleteness ? itemBasicIssues(item) : [];
        const summary = itemSummaryFields(item, fieldNames, objects);
        const inlineFields = summary.filter(field => !field.address);
        const addressFields = summary.filter(field => field.address);
        return <article key={item.id} id={`sr-service-${record.id}-${item.id}`} className="sr-item-entry">
          <div className="sr-item-row">
            <span className="sr-item-number">{String(index + 1).padStart(2, '0')}</span>
            <div className="sr-item-copy">
              <h4>{item.serviceName}{basicMissing.length > 0 && <span className="sr-badge" data-tone="amber">待完善</span>}</h4>
              {(summary.length > 0 || item.description.trim()) && <div className="sr-item-summary">
                <div className="sr-item-summary-fields">
                  {inlineFields.map(field => <span className="sr-summary-field" key={field.key}><span className="sr-summary-label">{field.label}</span><span className="sr-summary-value">{field.value}</span></span>)}
                  {item.description.trim() && <TooltipProvider><Tooltip><TooltipTrigger render={<button type="button" className="sr-description-hint" aria-label={`查看${fieldNames.description ?? '需求说明'}`}><CircleAlert size={16} /></button>} /><TooltipContent className="sr-description-tooltip" side="top"><div><strong className="sr-tooltip-heading">{fieldNames.description ?? '需求说明'}</strong><div>{item.description}</div></div></TooltipContent></Tooltip></TooltipProvider>}
                </div>
                {addressFields.map(field => <div className="sr-summary-address" key={field.key}><span className="sr-summary-label">{field.label}</span><span className="sr-summary-value">{field.value}</span></div>)}
              </div>}
              {basicMissing.length > 0 && <p className="sr-missing">待补充：{basicMissing.join('、')}</p>}
            </div>
            <div className="sr-item-actions">
              <Button variant="outline" disabled={busy} onClick={() => onEdit(item)}>{readonly ? '查看详细信息' : '编辑详细信息'}</Button>
              {!readonly && <div className="sr-item-secondary-actions"><button type="button" className="sr-copy-item" disabled={busy || !canAdd} onClick={() => onCopy(item.id)}>复制</button><button type="button" className="sr-muted-button" disabled={busy} onClick={() => onRemove(item.id)}>移除</button></div>}
            </div>
          </div>
        </article>;
      })}
    </div>}
  </section>;
}

export function RequestWorkspace(props: Props) {
  const applicationFields = useContext(ApplicationFieldsContext);
  const applicationLabel = (id: string, fallback: string) => applicationFields.find(field => field.id === id)?.name ?? fallback;
  const access = {
    actor: props.currentActor,
    directory: props.identityDirectory,
    customerId: props.currentCustomerId,
    contacts: props.contacts,
  };
  const customerPortal = props.currentActor.role === '客户';

  const canCreate = canCreateRequest(access);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [ready, setReady] = useState(false);
  const [savingBusy, setBusy] = useState(false);
  const [validating, setValidating] = useState(false);
  const busy = savingBusy || validating;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [draft, setDraft] = useState<ServiceRequest | null>(null);
  const [conversion, setConversion] = useState<ServiceRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creation, setCreation] = useState<ServiceRequest | null>(null);
  const audience = draft ? requestAudience(draft) : customerPortal ? 'customer' : 'internal';
  const availableServices = props.services.filter(service => serviceAvailableForRequest(service, audience));
  const [basicEditing, setBasicEditing] = useState<ServiceRequest | null>(null);
  const basicOriginal = useRef<ServiceRequest | null>(null);
  const creationOriginal = useRef<ServiceRequest | null>(null);
  const createCustomer = creation?.customerId ?? '';
  const [addOpen, setAddOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [pendingItem, setPendingItem] = useState<RequestItem | null>(null);
  const itemParent = draft;
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
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [projectOpen, setProjectOpen] = useState(false);
  const [returnDraftReason, setReturnDraftReason] = useState('');
  const [reservationRecords, setReservationRecords] = useState<
    ServiceRequest[]
  >([]);
  const [showIssues, setShowIssues] = useState(false);
  const [validationResult, setValidationResult] = useState<{ requestId: string; failures: ValidationFailure[]; events: RuleEvent[]; heading?: string } | null>(null);
  const validationAlert = useRef<HTMLElement>(null);
  const validationLock = useRef(false);
  useEffect(() => {
    if (showIssues && validationResult?.failures.length) {
      validationAlert.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      validationAlert.current?.focus({ preventScroll: true });
    }
  }, [showIssues, validationResult]);
  async function checkBeforeSubmission(record: ServiceRequest) {
    if (validationLock.current || saveLock.current) return false;
    validationLock.current = true; setValidating(true); setError('');
    const events = [submissionEvent(record)];
    try {
      const failures = await checkSubmissionQueue(record, props.currentActor, events);
      setValidationResult({ requestId: record.id, failures, events });
      setShowIssues(failures.length > 0);
      return failures.length === 0;
    } catch {
      setValidationResult({ requestId: record.id, events, failures: [{ ruleId: 'queue', requirement: '校验队列', message: '无法完成校验，请检查本机存储并重试。' }] });
      setShowIssues(true); return false;
    } finally { validationLock.current = false; setValidating(false); }
  }
  const handledToken = useRef(0);
  const openedRequestLink = useRef('');
  const saveLock = useRef(false);

  function beginCreate() {
    const customerId = customerPortal ? props.currentCustomerId ?? '' : '';
    const initial = withRequestCollaborators({ ...newRequest('', customerId, props.currentActor.name || props.currentRole, props.currentActor.id, props.currentActor.role), requestType: '' }, props.contacts, props.customers, props.users);
    setCreation(initial); creationOriginal.current = structuredClone(initial);
    setAddOpen(false); setPendingItem(null);
    setCatalogQuery(''); setError(''); setCreateOpen(true);
  }
  function updateCreation(patch: Partial<ServiceRequest>) {
    setCreation(current => current ? { ...current, ...patch } : current);
    setError('');
  }
  function changeCreationCustomer(customerId: string) {
    if (!creation) return;
    const creator = props.currentActor;
    const defaults = newRequest('', customerId, creator.name, creator.id, creator.role);
    setCreation(withRequestCollaborators({ ...creation, customerId, internalParticipants: defaults.internalParticipants, externalCollaborators: defaults.externalCollaborators, items: [] }, props.contacts, props.customers, props.users));
    setError('');
  }
  function load() {
    return readLocal<ServiceRequest>('requests')
      .then(async (records) => {
        records = records.map((record) =>
          withRequestCollaborators(record, props.contacts, props.customers, props.users),
        );
        setReservationRecords(records);
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
          return isConvertedRequest(latest) || ['待评估', '评估完成'].includes(current.status) ? latest : current;
        });
        setReady(true);
        setError('');
        if (props.initialRequestId && openedRequestLink.current !== props.initialRequestId) {
          openedRequestLink.current = props.initialRequestId;
          const linked = visible.find(record => record.id === props.initialRequestId);
          if (linked) { setDraft(structuredClone(linked)); setMaterialTarget(null); setShowIssues(false); setNotice(''); }
          else setError('来源服务请求不存在或当前身份无权访问。');
        }
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
    window.addEventListener('assessment-routing-updated', refresh);
    return () => {
      active = false;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('catalog-version-saved', refresh);
      window.removeEventListener('assessment-routing-updated', refresh);
    };
  }, [props.initialRequestId]);
  useEffect(() => {
    if (canCreate && props.createToken > handledToken.current) {
      handledToken.current = props.createToken;
      beginCreate();
    }
  }, [props.createToken]);

  async function persist(record: ServiceRequest, message = '草稿已保存到本机', failureHeading?: string, options?: RequestSaveOptions) {
    if (saveLock.current) return false;
    if (draft?.id === record.id && isConvertedRequest(draft)) { setError(convertedRequestReadonlyMessage); return false; }
    saveLock.current = true;
    setBusy(true);
    setError('');
    let next = withRequestCollaborators(
      { ...record, updatedAt: new Date().toISOString() },
      props.contacts, props.customers, props.users,
    );
    try {
      await saveLocal('requests', next, access, options);
      next = (await readLocal<ServiceRequest>('requests')).find(record => record.id === next.id) ?? clearHiddenRequestFields(next);
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
      setValidationResult(null);
      setShowIssues(false);
      return true;
    } catch (error) {
      if (error instanceof SubmissionValidationError) {
        setSubmitOpen(false);
        setValidationResult({ requestId: record.id, failures: error.failures, events: error.events, heading: failureHeading });
        setShowIssues(true);
      } else if (failureHeading) {
        setValidationResult({ requestId: record.id, events: [], heading: failureHeading,
          failures: [{ ruleId: 'delivery-conversion', requirement: '转为服务交付', message: error instanceof RequestIdentityError ? error.message : localError }] });
        setShowIssues(true);
      } else setError(error instanceof RequestIdentityError ? error.message : localError);
      return false;
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  function checkBeforeDeliveryConversion(record: ServiceRequest) {
    const issue = deliveryConversionIssue(record, props.currentActor, props.users);
    const missing = issue ? [issue] : deliveryConversionMaterialIssues(record);
    setValidationResult({ requestId: record.id, events: [], heading: '尚未转为服务交付，请补充以下内容',
      failures: missing.map(message => ({ ruleId: 'delivery-conversion', requirement: '服务交付齐套要求', message })) });
    setShowIssues(missing.length > 0);
    return missing.length === 0;
  }
  async function confirmDeliveryConversion() {
    if (!conversion || busy || saveLock.current) return;
    const record = draft?.id === conversion.id ? draft : conversion;
    setConversion(null);
    setError('');
    const heading = '尚未转为服务交付，请补充以下内容';
    try {
      if (!checkBeforeDeliveryConversion(record)) return;
      await persist(convertAssessmentToDelivery(record, props.currentActor, props.users), '已转为服务交付，请继续关联服务依据。', heading);
    } catch (issue) {
      setValidationResult({ requestId: record.id, events: [], heading,
        failures: [{ ruleId: 'delivery-conversion', requirement: '转为服务交付', message: issue instanceof Error ? issue.message : '转换失败，请重试。' }] });
      setShowIssues(true);
    }
  }
  async function duplicateItem(record: ServiceRequest, id: string) {
    if (!ready || busy || saveLock.current || !canEditRequestItems(record, props.currentActor)) return;
    const source = record.items.find(item => item.id === id);
    if (!source) return;
    if (!availableServices.some(service => service.id === source.serviceId)) {
      setError('该目录已停用或未开放给当前站点，不能复制申请项。'); return;
    }
    const items = [...synchronizeRequestMaterials(record).items];
    items.splice(items.findIndex(item => item.id === id) + 1, 0, copyRequestItem(source));
    const copied = synchronizeRequestMaterials({ ...record, items });
    await persist(copied, '已复制服务项，请按需修改内容并补充材料');
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
    if (await persist(record, '服务请求草稿已创建')) {
      setCreateOpen(false);
      setCreation(null);

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
      setPendingItem(newItem(service, await prepareMaterialDeduplication(resolveRequestConfig(service, latest))));
    } catch {
      setItemError('无法读取申请配置，请重试。');
    } finally {
      setBusy(false);
    }
  }
  async function savePendingItem() {
    if (
      busy ||
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
    setBusy(true);
    try {
      const results = await Promise.allSettled([
        readLocal<{ id: string; payload?: { businessObjects?: ObjectRef[]; services?: CatalogService[] } }>('references'),
        readLocal<ServiceRequest>('requests'),
      ]);
      const [references, requests] = results;
      if (references.status === 'rejected' || requests.status === 'rejected') throw new Error('无法读取当前业务对象和权益数量，请重试。');
      const workspace = references.value.find(entry => entry.id === 'workspace')?.payload;
      if (!workspace) throw new Error('无法读取当前业务对象，请重试。');
      const service = workspace.services?.find(entry => entry.id === pendingItem.serviceId);
      if (!service || !serviceAvailableForRequest(service, audience)) throw new Error('该服务目录已停用、不存在或未开放给当前申请站点，请重新选择。');
      const savedItem = snapshotItemBusinessObjects(pendingItem, workspace.businessObjects ?? [], service.priceUnit, requests.value, itemParent.id, itemParent.customerId);
      const exists = itemParent.items.some((i) => i.id === savedItem.id);
      const next = synchronizeRequestMaterials({
        ...itemParent,
        items: exists
          ? itemParent.items.map(item => item.id === savedItem.id ? savedItem : item)
          : [...itemParent.items, savedItem],
      });
      if (
        await persistItemChanges(
          next,
          '服务项详细信息已保存，可在申请材料区域补充材料',
        )
      ) {
        setAddOpen(false);
        setMaterialTarget(null);
        setPendingItem(null);
        setItemError('');
      }
    } catch (error) {
      setItemError(error instanceof Error ? error.message : '申请项保存失败，请重试。');
    } finally {
      setBusy(false);
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
  async function saveItemMaterials(id: string, material: ItemMaterial) {
    if (!draft || (!canEditRequestItems(draft, props.currentActor) && deliveryConversionIssue(draft, props.currentActor, props.users))) return false;
    const ok = await persistItemChanges(
      saveRequestMaterialGroup(draft, id, material.requirementId, material, props.currentActor),
      '申请材料已保存到本机',
    );
    return ok;
  }
  const showCompleteness =
    !!draft && canCheckRequestCompleteness(draft, props.currentActor);
  const readonly = draft?.status !== '草稿' || !showCompleteness;
  const itemsReadonly =
    !draft || !canEditRequestItems(draft, props.currentActor);
  const preparingDeliveryMaterials = !!draft && !deliveryConversionIssue(draft, props.currentActor, props.users);
  const materialsReadonly = itemsReadonly && !preparingDeliveryMaterials;
  const materialsRecord = draft && preparingDeliveryMaterials ? { ...draft, requestType: '服务交付' as const } : draft;
  const lockedMaterialFileIds = preparingDeliveryMaterials && draft
    ? draft.items.flatMap(item => item.materials.flatMap(material => materialFiles(material).map(file => file.id))) : [];
  const returnNotice = draft ? requestReturnNotice(draft) : null;
  const selectedMaterialGroup = materialsRecord && materialTarget ? requestMaterialGroup(materialsRecord, materialTarget.itemId, materialTarget.requirementId) : undefined;
  const materialItem = selectedMaterialGroup ? materialDialogItem(selectedMaterialGroup) : undefined;
  const materialRequirement = selectedMaterialGroup?.requirement;
  const filtered = requests.filter((record) => {
    if (!canAccessRequest(record, access)) return false;
    const customer = customerPortal ? '' :
      props.customers.find((c) => c.id === record.customerId)?.name ?? '';
    return (
      (status === '全部状态' || record.status === status) &&
      `${record.id} ${record.title} ${customer}`
        .toLowerCase()
        .includes(query.toLowerCase().trim())
    );
  });
  function updateBasic(patch: Partial<ServiceRequest>) {
    setBasicEditing(current => current ? { ...current, ...patch } : null);
    setError('');
  }
  function closeBasicDialog() {
    if (busy) return;
    if (basicEditing && basicOriginal.current && JSON.stringify(requestBasicInfo(basicEditing)) !== JSON.stringify(requestBasicInfo(basicOriginal.current)) && !window.confirm('基本信息有未保存的修改，是否放弃？')) return;
    setBasicEditing(null); basicOriginal.current = null; setError('');
  }
  function closeCreateDialog() {
    if (busy) return;
    if (creation && JSON.stringify({ ...requestBasicInfo(creation), customerId: creation.customerId }) !== JSON.stringify({ ...requestBasicInfo(creationOriginal.current!), customerId: creationOriginal.current?.customerId }) && !window.confirm('基本信息有未保存的修改，是否放弃？')) return;
    setCreateOpen(false); setCreation(null); setError('');
  }
  async function saveBasicInfo() {
    if (!basicEditing || !basicOriginal.current || !draft || readonly || busy) return;
    const issue = requestIdentityIssue(basicEditing) ?? requestIdentityIssue(basicEditing, draft, props.currentActor);
    if (issue) { setError(issue); return; }
    if (await persist(basicEditing, '基本信息已保存', undefined, { basicInfo: { expectedUpdatedAt: basicOriginal.current.updatedAt } })) {
      setBasicEditing(null); basicOriginal.current = null;
    }
  }

  function updateCollaborators(
    patch: Partial<
      Pick<ServiceRequest, 'externalCollaborators' | 'internalParticipants' | 'partnerCollaborators'>
    >,
  ) {
    if (!draft || busy) return;
    if (requestCollaboratorsLocked(draft)) { setError('当前申请阶段不可维护协作人。'); return; }
    const removalIssue =
      applicantRemovalIssue({ ...draft, ...patch }) ??
      customerOwnerRemovalIssue({ ...draft, ...patch }, draft, props.customers) ??
      assessmentCollaboratorRemovalIssue({ ...draft, ...patch }, draft);
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
    const partner = 'partnerCollaborators' in patch;
    const external = 'externalCollaborators' in patch;
    const before = partner ? (draft.partnerCollaborators ?? []).map(person => person.name) : external
      ? (draft.externalCollaborators ?? []).map((p) => p.name)
      : (draft.internalParticipants ?? []).map((p) => p.name);
    const after = partner ? (patch.partnerCollaborators ?? []).map(person => person.name) : external
      ? (patch.externalCollaborators ?? []).map((p) => p.name)
      : (patch.internalParticipants ?? []).map((p) => p.name);
    const detail = `变更前：${before.join('、') || '无'}；变更后：${after.join('、') || '无'}`;
    void persist(
      appendActivity(
        { ...draft, ...patch },
        props.currentActor,
        '协作',
        partner ? '更新合作伙伴协作人' : external ? '更新客户协作人' : '更新SmartX协作人',
        detail,
      ),
      '协作人已保存',
    );
  }

  const feedback = (
    <>
      {error && !createOpen && !basicEditing && (
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

      data-request-detail={!!draft || undefined}
      className={
        draft || addOpen
          ? 'sr-workspace sr-workspace--detail catalog-detail'
          : 'sr-workspace'
      }
    >
      {!draft ? (
        <>
          {feedback}
          <section className="sr-panel sr-request-list-panel">
            <div className="sr-toolbar app-list-toolbar">
              <div className="sr-filter-group">
                <div className="sr-search">
                  <Search size={16} />
                  <Input
                    aria-label="搜索服务请求"
                    placeholder={customerPortal ? `搜索${applicationLabel('title', '申请主题')}或编号` : `搜索${applicationLabel('title', '申请主题')}、编号或${applicationLabel('customerId', '客户')}`}
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
                    <th>{applicationLabel('title', '申请主题')}</th>
                    {!customerPortal && <th>客户</th>}
                    <th>申请类型</th>
                    <th>申请项</th>
                    <th>{applicationLabel('expectedServiceDate', '期望服务日期')}</th>
                    <th>状态</th>
                    {isInternal(props.currentActor.role) && <th>创建站点</th>}
                    <th>创建时间/创建人</th>
                    <th data-list-actions>操作</th>
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
                      {!customerPortal && <td>
                        {props.customers.find((c) => c.id === record.customerId)
                          ?.name ?? '待选择'}
                      </td>}
                      <td>{requestTypeOf(record) || '未选择类型'}</td>
                      <td>{record.items.length} 项</td>
                      <td>{record.expectedServiceDateUncertain ? '暂不确定' : record.expectedServiceDate || '—'}</td>
                      <td>
                        <span
                          className="sr-badge"
                          data-tone={requestStatusTone(record.status)}
                        >
                          {record.status}
                        </span>
                      </td>
                      {isInternal(props.currentActor.role) && <td>{requestAudience(record) === 'customer' ? '客户中心' : '内部系统'}</td>}
                      <td>
                        {dateLabel(record.createdAt)}
                        <small>{record.createdBy ?? record.owner ?? '—'}</small>
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
                onClick={() => { setDraft(null); setNotice(''); setError(''); }}
              >
                <ArrowLeft aria-hidden="true" />
                返回服务请求列表
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
              {canCancelRequest(draft, props.currentActor, props.users) && <Button variant="outline" disabled={busy}
                onClick={() => { setError(''); setCancelReason(''); setCancelOpen(true); }}>取消服务请求</Button>}
              {draft.status === '评估完成' && requestTypeOf(draft) === '技术评估'
                && !deliveryConversionIssue(draft, props.currentActor, props.users) && (
                <Button disabled={busy} onClick={() => { if (busy || saveLock.current) return; setError(''); if (checkBeforeDeliveryConversion(draft)) setConversion(structuredClone(draft)); }}>转为服务交付</Button>
              )}
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
                canPerformAssessmentRole(draft, props.currentActor, 'manager', props.users) && (
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
                  {canSubmitRequest(draft, props.currentActor) && <Button
                    className="ct-button ct-button--primary"
                    disabled={busy}
                    onClick={async () => {
                      if (await checkBeforeSubmission(draft)) setSubmitOpen(true);
                    }}
                  >
                    {validating ? '正在校验…' : '提交申请'}
                  </Button>}
                </>
              )}
            </div>
          </header>
          <RequestStatusProgress record={draft} />
          <RequestNextStepBanner key={draft.id} record={draft} users={props.users} customers={props.customers} contacts={props.contacts} />
          {feedback}
          {showIssues && validationResult?.requestId === draft.id && validationResult.failures.length > 0 && (
            <section className="sr-error sr-validation-alert" role="alert" ref={validationAlert} tabIndex={-1}>
              <strong>{validationResult.heading ?? validationHeading(validationResult.events)}</strong>
              <ul>
                {validationResult.failures.map((failure, index) => (
                  <li key={`${index}-${failure.ruleId}`} title={failure.requirement}>{failure.message}</li>
                ))}
              </ul>
            </section>
          )}
          <RequestOperationsTabs
            contacts={props.contacts}
            validationFailures={validationResult?.requestId === draft.id ? validationResult.failures : undefined}
            customers={props.customers}
            mentionDirectory={{ customers: props.customers, partners: props.partners, partnerUsers: props.partnerCollaborators }}
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
                <RequestExternalCollaborators
                  showCustomerVisibility={isInternal(props.currentRole)}
                  applicantId={requestAudience(draft) === 'customer' ? draft.createdById : undefined}
                  contacts={props.contacts.filter(
                    (contact) => contact.customerId === draft.customerId,
                  )}
                  value={draft.externalCollaborators ?? []}
                  readonly={isConvertedRequest(draft) || !canAddExternalCollaborators(draft, access)}
                  allowRemove={true}
                  busy={busy}
                  onChange={(externalCollaborators) =>
                    updateCollaborators({ externalCollaborators })
                  }
                />
                  <RequestInternalInfo
                    hardwareReviewerId={hardwareCollaboratorId(draft)}
                    projectManagerId={managerCollaboratorId(draft)}
                    applicantId={requestAudience(draft) === 'internal' ? draft.createdById : undefined}
                    ownerUserId={
                      props.customers.find(
                        (customer) => customer.id === draft.customerId,
                      )?.ownerUserId
                    }
                    users={props.users}
                    value={draft.internalParticipants ?? []}
                    readonly={!isInternal(props.currentRole) || requestCollaboratorsLocked(draft)}
                    busy={busy}
                    onChange={(internalParticipants) =>
                      updateCollaborators({ internalParticipants })
                    }
                  />
                <RequestPartnerCollaborators
                  users={props.partnerCollaborators}
                  value={draft.partnerCollaborators ?? []}
                  readonly={!isInternal(props.currentRole) || !['草稿', '待评估'].includes(draft.status)}
                  busy={busy}
                  showCustomerVisibility={isInternal(props.currentRole)}
                  onChange={partnerCollaborators => updateCollaborators({ partnerCollaborators })}
                />
              </aside>
            }
          >
            <RequestProjects record={draft} actor={props.currentActor} />
            {returnNotice && (
              <section className={`sr-panel sr-ops-panel${draft.status === '已取消' && isInternal(props.currentActor.role) ? ' sr-customer-visible-panel' : ''}`} role="status">
                <div className="sr-ops-heading">
                  <div>
                    <div className="sr-panel-title-with-visibility">
                      <h3>{returnNotice.title}</h3>
                      {draft.status === '已取消' && isInternal(props.currentActor.role) && <CustomerVisibleBadge />}
                    </div>
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
                {!readonly && <Button type="button" disabled={busy} onClick={() => {
                  basicOriginal.current = structuredClone(draft); setBasicEditing(structuredClone(draft)); setError('');
                }}>编辑基本信息</Button>}
              </div>
              <RequestBasicInfo fields={[
                { id: 'title', label: applicationLabel('title', '申请主题'), value: draft.title },
                { id: 'requestType', label: applicationLabel('requestType', '申请类型'), value: requestTypeOf(draft) },
                { id: 'customer', label: applicationLabel('customerId', '客户'), value: props.customers.find(customer => customer.id === draft.customerId)?.name ?? draft.customerId },
                { id: 'date', label: applicationLabel('expectedServiceDate', '期望服务日期'), value: draft.expectedServiceDateUncertain ? '暂不确定' : draft.expectedServiceDate },
                { id: 'description', label: applicationLabel('description', '申请说明'), value: draft.description, fullWidth: true },
                ...applicationFields.filter(field => !isSystemApplicationField(field.id)).map(field => ({ id: field.id, label: field.name, value: projectFieldText(field, draft.customValues?.[field.id] ?? '') })),
              ]} />
            </section>
            <RequestItemsPanel
              objects={props.businessObjects}
              record={draft} actor={props.currentActor} busy={busy} readonly={itemsReadonly} showCompleteness={showCompleteness}
              onAdd={() => { setCatalogQuery(''); setPendingItem(null); setItemError(''); setAddOpen(true); }}
              onEdit={item => { setPendingItem(structuredClone(item)); setItemError(''); setAddOpen(true); }}
              onRemove={setRemoveId}
              onCopy={id => { void duplicateItem(draft, id); }}
            />
            <RequestMaterialsPanel record={materialsRecord!} actor={props.currentActor} readonly={materialsReadonly} busy={busy} onMaterial={setMaterialTarget} />
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
                  <dt>创建站点</dt>
                  <dd>{requestAudience(draft) === 'customer' ? '客户中心' : '内部系统'}</dd>
                </div>
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
                    {draft.createdBy ?? draft.owner ?? '—'}
                  </dd>
                </div>
              </dl>
            </section>
          </RequestOperationsTabs>
        </>
      )}

      {conversion && <RequestDeliveryConversion busy={busy} onConfirm={() => void confirmDeliveryConversion()} onClose={() => setConversion(null)} />}
      {draft && materialItem &&
        materialRequirement &&
        (isInternal(props.currentRole) || requestMaterialsCustomerVisible(draft)) && (
          <RequestMaterialDialog
            key={materialItem.id + ':' + materialRequirement.id}
            record={materialsRecord!}
            item={materialItem}
            requirement={materialRequirement}
            actor={props.currentActor}
            readonly={materialsReadonly}
            lockedFileIds={lockedMaterialFileIds}
            busy={busy}
            error={error}
            onClose={() => setMaterialTarget(null)}
            onSave={(material) => saveItemMaterials(materialItem.id, material)}
          />
        )}
      {canCreate && createOpen && creation && <Dialog open onOpenChange={open => { if (!open) closeCreateDialog(); }}>
        <DialogContent className="request-basic-dialog" showCloseButton={!busy} aria-describedby={undefined}>
          <DialogHeader><DialogTitle>新建服务请求</DialogTitle></DialogHeader>
          <form id="request-create-basic-form" onSubmit={event => { event.preventDefault(); void createDraft(); }}>
          <fieldset className="sr-form-grid" disabled={busy}>
            <label htmlFor="sr-create-title">
              {applicationLabel('title', '申请主题')} <em>*</em>
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
            <label htmlFor="sr-create-request-type">
              {applicationLabel('requestType', '申请类型')} <em>*</em>
              <select id="sr-create-request-type" required value={creation.requestType ?? ''} onChange={event => updateCreation({ requestType: event.target.value as RequestType })}>
                <option value="" disabled>请选择申请类型</option>
                {requestTypes.map(type => <option key={type} value={type}>{type}</option>)}
              </select>
            </label>
            {requestAudience(creation) === 'customer' ? <label htmlFor="sr-create-customer-readonly">
              <RequestCustomerLabel />
              <Input id="sr-create-customer-readonly" className="sr-readonly-customer" readOnly value={props.customers.find(customer => customer.id === createCustomer)?.name ?? createCustomer} />
            </label> : (
              <label>
                <RequestCustomerLabel required  />
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
            <DateField id="sr-create-expected-date" label={applicationLabel('expectedServiceDate', '期望服务日期')} required value={creation.expectedServiceDate ?? ''} uncertain={creation.expectedServiceDateUncertain === true} onUncertain={() => updateCreation({ expectedServiceDate: '', expectedServiceDateUncertain: true })} disabled={busy} onChange={expectedServiceDate => updateCreation({ expectedServiceDate, expectedServiceDateUncertain: false })} />
            <label className="sr-span">{applicationLabel('description', '申请说明')}（选填）
              <textarea rows={3} value={creation.description} onChange={event => updateCreation({ description: event.target.value })} placeholder="说明本次整体目标、业务背景和期望时间。各服务的具体范围请在申请项中填写。" />
            </label>
            {applicationFields.filter(field => !isSystemApplicationField(field.id)).map(field => <div key={field.id}><div className="sr-help">{field.name}</div><RequestFieldControl field={field} value={creation.customValues?.[field.id] ?? ''} disabled={busy} onChange={value => updateCreation({ customValues: { ...creation.customValues, [field.id]: value } })} /></div>)}
          </fieldset>
            {error && <p className="sr-error" role="alert">{error}</p>}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={closeCreateDialog}>取消</Button>
            <Button type="submit" form="request-create-basic-form" disabled={!ready || busy || !canCreate}>{busy ? '正在保存…' : '创建草稿'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {basicEditing && <Dialog open onOpenChange={open => { if (!open) closeBasicDialog(); }}>
        <DialogContent className="request-basic-dialog" showCloseButton={!busy} aria-describedby={undefined}>
          <DialogHeader><DialogTitle>编辑基本信息</DialogTitle></DialogHeader>
          <form id="request-edit-basic-form" onSubmit={event => { event.preventDefault(); void saveBasicInfo(); }}>
              <fieldset disabled={readonly || busy} className="sr-form-grid">
                <label htmlFor="sr-title">
                  {applicationLabel('title', '申请主题')} <em>*</em>
                  <Input
                    id="sr-title"
                    required
                    value={basicEditing.title}
                    onChange={(e) => updateBasic({ title: e.target.value })}
                    placeholder="例如：生产环境新装与巡检"
                  />
                </label>
                <label htmlFor="sr-request-type">
                  {applicationLabel('requestType', '申请类型')} <em>*</em>
                  <select id="sr-request-type" required value={requestTypeOf(basicEditing)} onChange={event => updateBasic({ requestType: event.target.value as RequestType })}>
                    <option value="" disabled>请选择申请类型</option>
                    {requestTypes.map(type => <option key={type} value={type}>{type}</option>)}
                  </select>
                </label>
                <label htmlFor="sr-customer-readonly">
                  <RequestCustomerLabel hint={basicEditing.customerId ? '' : '此历史草稿未关联客户，请重新创建请求。'} />
                  <Input
                    id="sr-customer-readonly"
                    className="sr-readonly-customer"
                    readOnly
                    value={
                      props.customers.find((c) => c.id === basicEditing.customerId)
                        ?.name ??
                      (basicEditing.customerId || '历史草稿未选择客户')
                    }
                  />
                </label>
                <DateField
                  id="sr-expected-service-date"
                  label={applicationLabel('expectedServiceDate', '期望服务日期')} required
                  value={basicEditing.expectedServiceDate ?? ''}
                  uncertain={basicEditing.expectedServiceDateUncertain === true}
                  onUncertain={() => updateBasic({ expectedServiceDate: '', expectedServiceDateUncertain: true })}
                  readonly={readonly}
                  disabled={busy}
                  onChange={(expectedServiceDate) =>
                    updateBasic({ expectedServiceDate, expectedServiceDateUncertain: false })
                  }
                />
                <label className="sr-span">
                  {applicationLabel('description', '申请说明')}（选填）
                  <textarea
                    value={basicEditing.description}
                    onChange={(e) =>
                      updateBasic({ description: e.target.value })
                    }
                    placeholder="说明本次整体目标、业务背景和期望时间。各服务的具体范围请在申请项中填写。"
                    rows={3}
                  />
                </label>
                {applicationFields.filter(field => !isSystemApplicationField(field.id)).map(field => <div key={field.id}><div className="sr-help">{field.name}</div><RequestFieldControl field={field} value={basicEditing.customValues?.[field.id] ?? ''} disabled={readonly || busy} onChange={value => updateBasic({ customValues: { ...basicEditing.customValues, [field.id]: value } })} /></div>)}
              </fieldset>
            {error && <p className="sr-error" role="alert">{error}</p>}
          </form>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={closeBasicDialog}>取消</Button>
            <Button type="submit" form="request-edit-basic-form" disabled={busy || readonly}>{busy ? '正在保存…' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {itemParent && (
        <Dialog open={addOpen} onOpenChange={open => {
          if (!open && !busy) { setAddOpen(false); setPendingItem(null); setItemError(''); setError(''); }
        }}>
          <DialogContent className="sr-dialog sr-catalog-dialog sr-item-basics-dialog" {...(pendingReadonly && pendingItem ? { 'aria-describedby': undefined } : {})} showCloseButton={!busy}>
            <DialogHeader>
              <DialogTitle>{pendingReadonly && pendingItem ? '服务项详细信息' : pendingItem && itemParent.items.some(item => item.id === pendingItem.id) ? '编辑服务项' : '添加服务项'}</DialogTitle>
              {!(pendingReadonly && pendingItem) && <DialogDescription>{pendingItem ? '填写并保存服务项信息，材料可在申请材料区域补充。' : '选择本次申请的服务目录。'}</DialogDescription>}
            </DialogHeader>
          <div className="sr-item-dialog-body">
            {pendingItem ? (
              <>
                <div className="sr-selected-service">
                  <div>
                    <div className="sr-selected-service-heading">
                    <strong>{pendingItem.serviceName}</strong>
                    <p>
                      {pendingItem.serviceId} · 版本{' '}
                      {pendingService ? `v${pendingService.version ?? 1}` : '—'}
                    </p>
                    </div>
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
                {busy ? '正在保存…' : '保存服务项'}
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
            <DialogTitle>移除此服务项？</DialogTitle>
            <DialogDescription>
              该服务项及其独立材料将从请求中移除，其他服务项和仍被使用的共用材料将保留。
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
              保留服务项
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
                      items: synchronizeRequestMaterials(draft).items.filter((i) => i.id !== removeId),
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
          saveError={error}
          key={`${draft.id}:${props.currentActor.id}`}
          record={draft}
          actor={props.currentActor}
          busy={busy}
          save={persist}
          close={() => setProjectOpen(false)}
        />
      )}

      <Dialog open={cancelOpen} onOpenChange={open => { if (!busy) setCancelOpen(open); }}>
        <DialogContent className="sr-ops-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>取消服务请求</DialogTitle>
            <DialogDescription>取消后将释放已冻结额度，相关特殊审批失效，保留申请、评估及操作历史。此请求将结束，如需继续服务请新建请求。</DialogDescription>
          </DialogHeader>
          <div className="sr-confirmation-preview">
            <section className="sr-customer-visible-panel">
              <div className="sr-confirmation-note-label">
                <label htmlFor="request-cancellation-reason" className="sr-ops-field"><span>取消原因 <em aria-hidden="true">*</em></span></label>
                <CustomerVisibleBadge id="request-cancellation-reason-hint" />
              </div>
              <Textarea id="request-cancellation-reason" required aria-describedby="request-cancellation-reason-hint" value={cancelReason} disabled={busy} onChange={event => setCancelReason(event.target.value)} rows={3} placeholder="请说明取消原因" />
            </section>
          </div>
          {error && <p className="sr-error" role="alert">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCancelOpen(false)}>暂不取消</Button>
            <Button variant="destructive" disabled={busy || !cancelReason.trim()} onClick={async () => {
              if (!draft || busy || saveLock.current) return;
              setError('');
              try {
                if (await persist(cancelRequest(draft, props.currentActor, props.users, cancelReason), '服务请求已取消')) setCancelOpen(false);
              } catch (issue) { setError(issue instanceof Error ? issue.message : '取消失败，请重试。'); }
            }}>{busy ? '正在取消…' : '确认取消'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
              退回后可修改申请信息和材料；已冻结资产将释放，相关特批失效，评估历史保留。
            </DialogDescription>
          </DialogHeader>
          <label className="sr-ops-field">
            <span>退回原因 <RequiredMark /></span>
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
                if (!draft || !canSubmitRequest(draft, props.currentActor)) return;
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
  const methodOptions =
    methodField?.options
      .filter(
        (option) => option.enabled && value.methods.includes(option.value),
      )
      .map((option) => option.value) ?? value.methods;
  return (
    <div className="sr-basic-fields">
      <section className="sr-sheet-section">
        <h3>服务需求</h3>
        <fieldset
          disabled={readonly || busy}
          className="sr-form-grid sr-live-fields"
        >
          <RequestFormLayout
            config={value.config}
            visibleIds={formOrder.filter(
              (id) =>
                ['method', 'description', 'businessObjects'].includes(id) ||
                requestFieldIsVisible(
                  value.config,
                  id,
                  value.method,
                  value.values,
                ),
            )}
            renderField={(key) => {
              if (key === 'method')
                return (
                  <label>
                    {methodField?.name ?? '服务方式'} <em>*</em>
                    {methodField && methodField.type !== 'single' ? (
                      <RequestFieldControl
                        disabled={readonly || busy}
                        field={methodField}
                        availableOptions={value.methods}
                        value={value.method}
                        onChange={(method) =>
                          update({
                            method,
                            methodFieldType:
                              methodField.type === 'lookup' ||
                              methodField.type === 'address'
                                ? 'single'
                                : methodField.type,
                          })
                        }
                      />
                    ) : (
                      <select
                        value={value.method}
                        onChange={(e) =>
                          update({
                            method: e.target.value,
                            methodFieldType: 'single',
                          })
                        }
                      >
                        <option value="">请选择</option>
                        {value.method &&
                          !methodOptions.includes(value.method) && (
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
                );
              if (key === 'description')
                return (
                  <label>
                    {fields.find((field) => field.id === 'description')?.name ??
                      '需求说明'}{' '}
                    {value.config.basicFields?.description?.required !==
                    false ? (
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
                );
              if (key === 'businessObjects')
                return (
                  <section className="sr-sheet-section">
                    <h3>
                      {fields.find((field) => field.id === 'businessObjects')
                        ?.name ?? '业务对象'}{' '}
                      <span>
                        {value.config.basicFields?.businessObjects?.required
                          ? '必填'
                          : '选填'}{' '}
                        · 可多选
                      </span>
                    </h3>
                    {value.config.basicFields?.businessObjects?.required && (
                      <p className="sr-help">
                        请至少关联一个当前客户的业务对象。
                      </p>
                    )}
                    <fieldset
                      disabled={readonly || busy}
                      className="sr-object-options"
                    >
                      <ul aria-label="可关联的业务对象">
                        {(readonly
                          ? savedItemBusinessObjects(value)
                          : objects
                              .filter(
                                (o) =>
                                  (o.status === '启用' &&
                                    matchesObjectProduct(o, value.config)) ||
                                  value.businessObjectIds.includes(o.id),
                              )
                              .map((object) => ({
                                object,
                                entitlement: objectEntitlementAvailability(
                                  object,
                                  priceUnit,
                                  reservationRecords,
                                  requestId,
                                ),
                                recorded: true,
                              }))
                        ).map(({ object: o, entitlement, recorded }) => {
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
                                  checked={value.businessObjectIds.includes(
                                    o.id,
                                  )}
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
                                    <small>
                                      （
                                      {recorded
                                        ? `${o.nodeCount} 节点`
                                        : '申请时数量未记录'}
                                      ）
                                    </small>
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
                                  {!readonly && o.status !== '启用' && (
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
                );

              if (key === 'businessObjects') return null;
              const visible = requestFieldIsVisible(
                value.config,
                key,
                value.method,
                value.values,
              );
              if (!visible) return null;
              const field = fields.find((item) => item.id === key);
              const label =
                field?.name ??
                value.config.fieldNames?.[key] ??
                fieldLabels[key] ??
                key;
              return (
                <div className="request-field-input" key={key}>
                  <span>
                    {label}{' '}
                    {!requestFieldIsRequired(
                      value.config,
                      key,
                      value.method,
                      value.values,
                    ) ? (
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
                        key === 'nodes'
                          ? '填写本项涉及的节点数'
                          : `填写${label}`
                      }
                    />
                  )}
                </div>
              );
            }}
          />
        </fieldset>
      </section>
    </div>
  );
}

export function RequestCatalogSettings({
  service,
  actor,
  readonly = false,
  audience = 'internal',
}: {
  service: CatalogService;
  actor: OperationActor;
  readonly?: boolean;
  audience?: CatalogFormAudience;
}) {
  const writable = !readonly && canManageCatalog(actor);
  const configLabel = audience === 'internal' ? '内部申请' : audience === 'partner' ? '合作伙伴中心申请' : '客户中心申请';
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
        <h3>{configLabel}表单</h3>
        <Button
          variant="outline"
          aria-label={`${writable ? '配置' : '查看'}${configLabel}表单`}
          disabled={!ready}
          onClick={() => {
            setEditing(configForEditing(config, requestFields));
            setSaved(false);
            setOpen(true);
          }}
        >
          <Settings2 size={15} />
          {writable ? '配置表单' : '查看表单'}
        </Button>
      </div>
      <p>
        服务项字段：
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
            <SheetTitle>{writable ? '配置' : '查看'}{configLabel}</SheetTitle>
            <SheetDescription>
              {service.name}{writable ? ' · 保存后用于新添加的申请项；不影响已创建项目。' : ''}
            </SheetDescription>
          </SheetHeader>
          <RequestFormBuilder service={service} config={editing} fields={requestFields} products={products} busy={busy} readonly={!writable} update={next => { if (writable) setEditing(next); }} />
          {error && <p role="alert" className="sr-error" style={{ margin: '8px 24px' }}>{error}</p>}
          <SheetFooter className="sr-sheet-footer">
            {writable && <span>模板文件仅保存在本机</span>}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              {writable ? '取消' : '关闭'}
            </Button>
            {writable && <Button
              disabled={busy}
              onClick={async () => {
                if (!writable) return;
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
                  }, actor);
                  setConfig(savedConfig ?? next);
                  setSaved(true);
                  setOpen(false);
                } catch (error) {
                  setError(error instanceof Error ? error.message : localError);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在保存…' : '保存配置'}
            </Button>}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
