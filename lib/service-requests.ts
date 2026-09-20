import { fixedIdentityRoles } from './internal-users.ts';
import { canSubmitRequest, requestCollaboratorsLocked } from './request-collaboration.ts';
import { isDemoAdministrator } from './demo-permissions.ts';
import { validateCustomValues } from './custom-field-mapping.ts';
import { normalizeApplicationFields, isSystemApplicationField } from './request-application-fields.ts';
import { isConvertedRequest, convertedRequestReadonlyMessage } from './request-readonly.ts';
import { mappedServiceProject, parseProjectMapping, requestProjectMappingId } from './request-project-mapping.ts';
import { fixedIdentityRoles as projectActorRoles } from './internal-users.ts';
import { specialApprovalSaveIssue } from './approval-execution.ts';
import { requestCancellationSaveIssue } from './request-cancellation.ts';
import { requestTypeOf, requestTypes, type RequestType } from './request-types.ts';
import { requestTypeSaveIssue, isDeliveryConversion, deliveryConversionItemsIssue, canSupplementDeliveryMaterials } from './request-type-workflow.ts';
import { materialRequiredFor } from './material-requirements.ts';
import { approvalRulesId, readApprovalRulesPayload } from './approval-rules.ts';
import { canPerformAssessmentRole, routeAssessmentOnSave, routingSaveIssue } from './assessment-routing.ts';
import { assessmentRoutingId } from './assessment-routing-schema.ts';
import { runValidationQueue, validationEventsForTransition, SubmissionValidationError } from './submission-validation.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import { addressLabel, isAddressValue, addressComplete } from './request-address.ts';
import { withRequestCollaborators, withAssessmentCollaborators, assessmentCollaboratorRemovalIssue, requestAudience, isRequestApplicant, applicantRemovalIssue } from './request-collaboration.ts';
import { entitlementAvailable } from './request-entitlement-reservations.ts';
import { workspaceDayQuantityIssue } from './day-quantity.ts';
import { preserveProjectReservations } from './project-reservations.ts';
import { effortPricingSaveIssue, entitlementPricingContext } from './request-pricing.ts';
import { projectCreationSaveIssue } from './request-projects.ts';
import { isInternal } from './request-operations.ts';
import { editionFeatureFields, isEditionRequirement, type FieldRequirement } from './request-field-requirements.ts';
import { supplementSaveIssue } from './request-supplements.ts';
import { customerDecisionIssue } from './request-customer-decision.ts';
import { assessmentLockIssue, assessmentBasisSaveIssue, currentPlan, planSalesOwnerIssue } from './request-assessment.ts';
import { hardwareAssessmentSaveIssue, invalidateHardwareReview, hardwareItems, isHardwareProductManager } from './request-hardware-assessment.ts';
import type { OperationActor, RequestOperations } from './request-operations';
export { requestIssues } from './request-validation-builtins.ts';

export type CatalogService = {
  id: string;
  certifications?: string[];
  version?: number;
  name: string;
  description?: string;
  category: string;
  deliveryMethods: string[];
  status: string;
  priceUnit: string;
  priceCoefficient?: number;
  // Retain the catalog storage key; this is the live minimum estimated man-days.
  defaultQuantity?: number;
  allowedInitiatorSites?: string[];
};
export type RequestAudience = 'internal' | 'customer';
export type CatalogFormAudience = RequestAudience | 'partner';

export function isEntitlementService(service: { priceUnit: string }) {
  return ['巡检权益', '升级权益'].includes(service.priceUnit);
}

export function applyCatalogConfigRules(service: CatalogService, config: RequestConfig): RequestConfig {
  if (!isEntitlementService(service)) return config;
  return { ...config, basicFields: { ...config.basicFields, businessObjects: {
    enabled: true, required: true, products: ['SMTX OS 系统'],
  } } };
}

export function serviceAvailableForRequest(
  service: CatalogService,
  audience: CatalogFormAudience,
): boolean {
  return (
    service.status === '已启用' &&
    (service.allowedInitiatorSites === undefined ||
      service.allowedInitiatorSites.includes(
        audience === 'customer' ? '客户中心' : audience === 'partner' ? '合作伙伴中心' : '内部系统',
      ))
  );
}

export function customerRequestConfigId(serviceId: string) {
  return `customer-request-config:${serviceId}`;
}

export function partnerRequestConfigId(serviceId: string) {
  return `partner-request-config:${serviceId}`;
}

export async function readRequestConfigs(
  audience: CatalogFormAudience,
): Promise<RequestConfig[]> {
  if (audience === 'internal') {
    return (await readLocal<RequestConfig>('configs')).map(
      normalizeRequestConfig,
    );
  }
  const references = await readLocal<{ id: string; payload?: RequestConfig }>(
    'references',
  );
  return references
    .filter(
      (record) => record.payload?.serviceId &&
        record.id === (audience === 'partner' ? partnerRequestConfigId : customerRequestConfigId)(record.payload.serviceId),
    )
    .map((record) => normalizeRequestConfig(record.payload!));
}

export function resolveRequestConfig(
  service: CatalogService,
  configs: RequestConfig[],
): RequestConfig {
  // The caller supplies only the selected audience's configs. Never fall back
  // from customer configuration to internal configuration, even for empty forms.
  return applyCatalogConfigRules(service, normalizeRequestConfig(
    configs.find((config) => config.serviceId === service.id) ?? defaultConfig(service),
  ));
}
export type CustomerRef = { id: string; name: string; status: string; ownerUserId?: string; team?: string };
export type ContactRef = CustomerRef & {
  customerId: string;
  phone?: string;
  email?: string;
};
export function contactDisplay(contact: ContactRef) {
  return {
    name: contact.name,
    phone: contact.phone?.trim() || '未填写',
    email: contact.email?.trim() || '未填写',
    inactive: contact.status !== '启用',
  };
}
export type ObjectRef = ContactRef & {
  projectReservations?: { projectId: string; kind: 'inspection' | 'upgrade'; quantity: number }[];
  projectConsumptions?: { projectId: string; kind: 'inspection' | 'upgrade'; quantity: number; at: string }[];
  nodeCount: number;
  upgradeEntitlement?: number;
  inspectionEntitlement?: number;
  product?: string;
  sn?: string;
};
export function objectEntitlementAvailability(object: ObjectRef, priceUnit?: string, records: ServiceRequest[] = [], exceptId = '') {
  if (priceUnit !== '巡检权益' && priceUnit !== '升级权益') return null;
  const quantity = entitlementAvailable(object, priceUnit === '巡检权益' ? 'inspection' : 'upgrade', records, exceptId);
  const available = typeof quantity === 'number' && Number.isInteger(quantity) && quantity >= 0 ? quantity : undefined;
  return { name: priceUnit, available, required: object.nodeCount,
    insufficient: available !== undefined && available < object.nodeCount };
}
export function matchesObjectProduct(object: ObjectRef, config: RequestConfig) {
  const products = config.basicFields?.businessObjects?.products;
  return products === undefined || products.includes(object.product ?? '');
}
export type StoredFile = {
  submittedBy?: string;
  submittedAt?: string;
  uploadedById?: string;
  uploaderAudience?: RequestAudience;
  id: string;
  name: string;
  size: number;
  uploadedAt: string;
  blob: Blob;
  onlineDocument?: {
    title: string;
    content: string;
    source: 'template' | 'blank';
    richText?: Record<string, unknown>;
    reportSource?: import('./report-templates').ReportSource;
  };
};
export type FieldKey = string;
export const fieldLabels: Record<string, string> = {
  ...Object.fromEntries(editionFeatureFields.map(field => [field.id, field.name])),
  edition: '授权版本',
  version: '版本号',
  nodes: '节点数',
  installObservability: '是否安装可观测性',
};
export type MaterialRequirement = {
  id: string;
  name: string;
  required: boolean;
  requiredByType?: Partial<Record<RequestType, boolean>>;
  instructions: string;
  template?: StoredFile;
  templateUrl?: string;
  onlineTemplateUrl?: string;
  deduplicate?: boolean;
  templateDigest?: string;
};
export function requestMaterialsCustomerVisible(record: ServiceRequest): boolean {
  return requestAudience(record) === 'customer';
}
export function requestMaterialFiles(record: ServiceRequest, material: ItemMaterial | undefined, audience: RequestAudience = 'internal'): StoredFile[] {
  return audience === 'internal' || requestMaterialsCustomerVisible(record) ? materialFiles(material) : [];
}
export function attributeMaterialFile(file: StoredFile, actor: OperationActor): StoredFile {
  return { ...file, uploadedById: actor.id, uploaderAudience: actor.role === '客户' ? 'customer' : 'internal' };
}
export function customerMaterialSaveIssue(record: ServiceRequest, previous: ServiceRequest | undefined, actor?: OperationActor): string | null {
  if (actor?.role !== '客户' || !previous) return null;
  for (const item of record.items) {
    const old = previous.items.find(entry => entry.id === item.id);
    for (const material of old?.materials ?? []) {
      const nextFiles = materialFiles(item.materials.find(entry => entry.requirementId === material.requirementId));
      for (const file of materialFiles(material)) {
        if (file.uploaderAudience === 'customer' && file.uploadedById === actor.id) continue;
        if (JSON.stringify(nextFiles.find(entry => entry.id === file.id)) !== JSON.stringify(file))
          return '客户只能修改自己上传的材料。';
      }
    }
  }
  return null;
}
export function attributeRequestMaterials(record: ServiceRequest, previous: ServiceRequest | undefined, actor?: OperationActor): ServiceRequest {
  if (!actor?.id) return record;
  const preserveAssessedFiles = isDeliveryConversion(record, previous) || !!previous && canSupplementDeliveryMaterials(previous, actor);
  const originals = new Map((previous?.items ?? []).flatMap(item => item.materials.flatMap(material => materialFiles(material).map(file => [file.id, file] as const))));
  return { ...record, items: record.items.map(item => ({ ...item, materials: item.materials.map(material => {
    const old = previous?.items.find(entry => entry.id === item.id)?.materials.find(entry => entry.requirementId === material.requirementId);
    return withMaterialFiles(material, materialFiles(material).map(file => {
      const before = materialFiles(old).find(entry => entry.id === file.id) ?? originals.get(file.id);
      // Preserve unseen originals, including their bytes, when a customer saves the request.
      if (before && (preserveAssessedFiles || (actor.role === '客户' && !(before.uploaderAudience === 'customer' && before.uploadedById === actor.id)))) return before;
      return before && JSON.stringify(before) === JSON.stringify(file) ? before : attributeMaterialFile(file, actor);
    }));
  }) })) };
}
export type RequestConfig = {
  fieldDefinitions?: Record<string, import('../components/request-field-settings').RequestField>;
  /** One-time default removal; later manual additions of version remain valid. */
  fieldOrder?: string[];
  fieldWidths?: Record<string, 'full' | 'half'>;
  fieldColumns?: Record<string, 'left' | 'right'>;
  fieldRowStarts?: string[];
  basicFields?: {
    description?: { enabled: boolean; required: boolean };
    businessObjects?: {
      enabled: boolean;
      required: boolean;
      products?: string[];
    };
  };
  serviceId: string;
  revision: number;
  fields: FieldKey[];
  fieldRequired?: Record<string, boolean>;
  fieldRequiredWhen?: Record<string, FieldRequirement>;
  fieldNames: Record<string, string>;
  fieldOptions: Record<string, string[]>;
  materials: MaterialRequirement[];
};
export type ItemMaterial = {
  requirementId: string;
  files?: StoredFile[];
  /** Read compatibility for materials saved before independent files. */
  versions?: StoredFile[];
};
export function materialFiles(material?: ItemMaterial): StoredFile[] {
  return material?.files ?? material?.versions ?? [];
}
export function withMaterialFiles(
  material: ItemMaterial,
  files: StoredFile[],
): ItemMaterial {
  return { requirementId: material.requirementId, files };
}
export function saveMaterialFile(
  material: ItemMaterial,
  file: StoredFile,
  editingId?: string | null,
): ItemMaterial {
  const files = materialFiles(material);
  if (editingId && !files.some((entry) => entry.id === editingId)) {
    throw new Error('待编辑的文件不存在，请重新打开材料。');
  }
  return withMaterialFiles(
    material,
    editingId
      ? files.map((entry) =>
          entry.id === editingId ? { ...file, id: editingId } : entry,
        )
      : [...files, file],
  );
}
export function removeMaterialFile(
  material: ItemMaterial,
  fileId: string,
): ItemMaterial {
  return withMaterialFiles(
    material,
    materialFiles(material).filter((file) => file.id !== fileId),
  );
}
export function businessObjectsEnabled(config: RequestConfig): boolean {
  return (
    config.basicFields?.businessObjects?.enabled ??
    config.fields.includes('businessObjects')
  );
}
export type RequestItem = {
  id: string;
  serviceId: string;
  serviceName: string;
  priceCoefficient?: number;
  methods: string[];
  method: string;
  methodFieldType?:
    | 'single'
    | 'multiple'
    | 'text'
    | 'textarea'
    | 'integer'
    | 'decimal'
    | 'date';
  description: string;
  businessObjectIds: string[];
  businessObjectSnapshot?: {
    savedAt: string;
    objects: { object: ObjectRef; entitlement: ReturnType<typeof objectEntitlementAvailability> }[];
  };
  values: Record<string, string>;
  config: RequestConfig;
  materials: ItemMaterial[];
};

// Capture only on an explicit application-item save. Pricing and reservations
// continue to use current workspace objects, never these display snapshots.
export function snapshotItemBusinessObjects(item: RequestItem, objects: ObjectRef[], priceUnit: string | undefined, records: ServiceRequest[], requestId: string, customerId: string, savedAt = new Date().toISOString()): RequestItem {
  item = clearHiddenItemFields(item);
  if (!businessObjectsEnabled(item.config)) return item;
  const selected = item.businessObjectIds.map(id => {
    const object = objects.find(object => object.id === id && object.customerId === customerId && object.status === '启用' && matchesObjectProduct(object, item.config));
    if (!object) throw new Error('请取消关联已停用、不属于当前客户或不符合可搜索产品的业务对象。');
    return { object: structuredClone(object), entitlement: objectEntitlementAvailability(object, priceUnit, records, requestId) };
  });
  return { ...item, businessObjectSnapshot: { savedAt, objects: selected } };
}

export function savedItemBusinessObjects(item: RequestItem) {
  return item.businessObjectIds.map(id => {
    const saved = item.businessObjectSnapshot?.objects.find(entry => entry.object.id === id);
    return saved ? { ...saved, recorded: true } : {
      object: { id, name: id, customerId: '', status: '', nodeCount: 0 } as ObjectRef,
      entitlement: null,
      recorded: false,
    };
  });
}

function itemObjectName(item: RequestItem, id: string, objects: Pick<ObjectRef, 'id' | 'name'>[]) {
  return item.businessObjectSnapshot?.objects.find(entry => entry.object.id === id)?.object.name
    ?? objects.find(object => object.id === id)?.name ?? id;
}
export type InternalUser = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  department: string;
  reportsToUserId?: string;
  status: string;
};
export type InternalParticipant = {
  userId: string;
  name: string;
};
export type ExternalCollaborator = {
  source?: 'request-contact';
  contactId: string;
  name: string;
  phone: string;
  email: string;
};
export function reconcileParticipants(
  users: InternalUser[],
): InternalParticipant[] {
  return Array.from(new Map(users.map((user) => [user.id, user])).values()).map(
    (user) => ({
      userId: user.id,
      name: user.name,
    }),
  );
}
export function requestParticipantsIssue(
  participants: InternalParticipant[] = [],
): string | null {
  if (
    new Set(participants.map((participant) => participant.userId)).size !==
    participants.length
  )
    return '内部协作人不能重复。';
  if (
    participants.some(
      (participant) => !participant.userId?.trim() || !participant.name?.trim(),
    )
  )
    return '请为内部协作人选择有效用户。';
  return null;
}
export function customerOwnerRemovalIssue(
  record: ServiceRequest,
  previous: ServiceRequest | undefined,
  customers: CustomerRef[],
): string | null {
  const ownerId = customers.find(customer => customer.id === (previous ?? record).customerId)?.ownerUserId;
  if (ownerId && previous?.internalParticipants?.some(person => person.userId === ownerId)
    && !record.internalParticipants?.some(person => person.userId === ownerId)) {
    return '客户所有人为固定内部协作人，不允许移除。';
  }
  return null;
}
export function reconcileExternalCollaborators(
  contacts: ContactRef[],
): ExternalCollaborator[] {
  return Array.from(
    new Map(contacts.map((contact) => [contact.id, contact])).values(),
  ).map((contact) => ({
    contactId: contact.id,
    name: contact.name,
    phone: contact.phone?.trim() ?? '',
    email: contact.email?.trim() ?? '',
  }));
}
export const requestStatuses = [
  '草稿',
  '待评估',
  '评估完成',
  '待确认',
  '待受理',
  '已转服务项目',
  '已取消',
] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export type RequestStage = Exclude<RequestStatus, '已取消'>;
export function requestStatusTone(status: RequestStatus) {
  if (status === '已取消') return 'cancelled';
  if (status === '已转服务项目' || status === '评估完成') return 'green';
  return status === '草稿' ? 'muted' : 'blue';
}
export function requestCancellationStage(record: ServiceRequest): RequestStage {
  if (record.cancelledFromStatus && requestStatuses.filter(stage => stage !== '已取消').includes(record.cancelledFromStatus)) return record.cancelledFromStatus;
  return '草稿';
}
export function requestProgressSteps(request: RequestStatus | ServiceRequest) {
  const status = typeof request === 'string' ? request : request.status;
  const stage = status === '已取消' ? (typeof request === 'string' ? '草稿' : requestCancellationStage(request)) : status;
  const presales = typeof request === 'string' ? request === '评估完成' : requestTypeOf(request) === '技术评估';
  const stages = requestStatuses.filter(step => step !== '已取消' && (presales ? !['待确认', '待受理', '已转服务项目'].includes(step) : step !== '评估完成'));
  const current = stages.indexOf(stage);
  return stages
    .map((label, index) => ({
      label: status === '已取消' && index === current ? '已取消' : label,
      state:
        current === index
          ? 'current'
          : current > index
            ? 'complete'
            : 'upcoming',
    }));
}
export type ServiceRequest = {
  projectReservationReleases?: import('./project-reservation-release').ProjectReservationRelease[];
  id: string;
  requestType?: RequestType | '';
  title: string;
  customerId: string;
  contactId: string;
  description: string;
  expectedServiceDate?: string;
  expectedServiceDateUncertain?: boolean;
  customValues?: Record<string, string>;
  /** Retained only for compatibility with historical records; no longer collected or validated. */
  businessImpact?: string;
  owner: string;
  createdBy?: string;
  createdViaAdmin?: { id: string; name: string };
  createdById?: string;
  createdByAudience?: RequestAudience;
  externalCollaborators?: ExternalCollaborator[];
  internalParticipants?: InternalParticipant[];
  partnerCollaborators?: InternalParticipant[];
  status: RequestStatus;
  cancelledFromStatus?: RequestStage;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  items: RequestItem[];
  operations?: RequestOperations;
};
export function itemDisplayFields(item: RequestItem, names: Record<string, string> = {}, objects: Pick<ObjectRef, 'id' | 'name'>[] = []): { key: string; label: string; value: string }[] {
  const display = (raw: string | undefined) => {
    const value = (raw ?? '').trim();
    if (isAddressValue(value)) return addressLabel(value) || '未填写';
    if (value.startsWith('[')) {
      try {
        const values: unknown = JSON.parse(value);
        if (Array.isArray(values)) return values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).join('、') || '未填写';
      } catch { /* Preserve legacy text. */ }
    }
    return value || '未填写';
  };
  const keys = [...new Set(['method', ...item.config.fields])].filter(key => key !== 'description' && key !== 'businessObjects' && requestFieldIsVisible(item.config, key, item.method, item.values));
  const fields = keys.map(key => ({ key, label: (names[key] || item.config.fieldNames?.[key] || fieldLabels[key] || (key === 'method' ? '服务方式' : key)), value: display(key === 'method' ? item.method : item.values[key]) }));
  if (businessObjectsEnabled(item.config)) fields.push({ key: 'businessObjects', label: names.businessObjects || '业务对象', value: item.businessObjectIds.map(id => itemObjectName(item, id, objects)).join('、') || '未关联' });
  return fields;
}
export function itemSummaryFields(item: RequestItem, names: Record<string, string> = {}, objects: Pick<ObjectRef, 'id' | 'name'>[] = []): { key: string; label: string; value: string; address: boolean }[] {
  const defaults: Record<string, string> = { ...fieldLabels, method: '服务方式', edition: '授权版本', businessObjects: '业务对象', productForm: '产品形态', address: '地址', tibCount: 'TiB 数', instanceCount: '实例数', clusterCount: '集群数' };
  const keys = [...new Set(['method', 'edition', 'nodes', 'version', ...item.config.fields, ...Object.keys(item.values), 'businessObjects'])].filter(key => key !== 'description');
  return keys.flatMap(key => {
    if (!requestFieldIsVisible(item.config, key, item.method, item.values)) return [];
    let value = (key === 'method' ? item.method : key === 'businessObjects' ? item.businessObjectIds.map(id => itemObjectName(item, id, objects)).join('、') : item.values[key] ?? '').trim();
    const address = key === 'address' || isAddressValue(value);
    if (isAddressValue(value)) value = addressLabel(value);
    else if (value.startsWith('[')) {
      try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) value = parsed.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim()).join('、'); } catch { /* Keep legacy text readable. */ }
    }
    return value ? [{ key, label: (names[key] || item.config.fieldNames?.[key] || defaults[key] || key), value, address }] : [];
  });
}
export function itemSummary(item: RequestItem): string {
  return itemSummaryFields(item, { edition: '授权版本' }).map(field => `${field.label}：${field.value}`).join(' · ');
}
export function newRequest(
  title: string,
  customerId: string,
  owner: string,
  createdById?: string,
  creatorRole?: string,
  customerOwner?: InternalUser,
): ServiceRequest {
  const now = new Date().toISOString();
  return {
    id: `SR-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    requestType: '服务交付',
    title: title.trim(),
    customerId,
    contactId: '',
    createdByAudience: creatorRole === '客户' ? 'customer' : 'internal',
    description: '',
    expectedServiceDate: '',
    owner,
    createdBy: owner,
    ...(createdById ? { createdById } : {}),
    externalCollaborators: creatorRole === '客户' && createdById ? [{ contactId: createdById, name: owner, phone: '', email: '' }] : [],
    internalParticipants: [...new Map([
      ...(customerOwner ? [{ userId: customerOwner.id, name: customerOwner.name }] : []),
      ...(createdById && creatorRole && isInternal(creatorRole) ? [{ userId: createdById, name: owner }] : []),
    ].map(person => [person.userId, person])).values()],
    status: '草稿',
    createdAt: now,
    updatedAt: now,
    items: [],
  };
}
export function canCheckRequestCompleteness(record: ServiceRequest, actor: OperationActor): boolean {
  return actor.role !== '客户' || (!!actor.id && record.createdById === actor.id);
}
export function canEditRequestItems(record: ServiceRequest, actor?: OperationActor): boolean {
  if (record.status === '草稿') return !actor || canCheckRequestCompleteness(record, actor);
  const assessment = record.operations?.assessment;
  return record.status === '待评估' && !!actor?.id && (actor.role === 'SmartX 项目经理' || isDemoAdministrator(actor))
    && canPerformAssessmentRole(record, actor, 'manager')
    && !assessment?.rounds.some(round => round.outcome === '评估通过');
}

export function requestIdentityIssue(
  record: ServiceRequest,
  existing?: ServiceRequest,
  actor?: OperationActor,
): string | null {
  if (!requestTypes.includes(requestTypeOf(record) as RequestType)) return '请选择申请类型。';
  if (existing) {
    if (existing.status !== '草稿' && requestTypeOf(existing) !== requestTypeOf(record)
      && !(requestTypeOf(existing) === '技术评估' && existing.status === '评估完成' && requestTypeOf(record) === '服务交付' && record.status === '待评估'))
      return '提交后申请类型不可直接修改，请通过“转为服务交付”操作变更。';
    if (existing.status === '草稿' && !['草稿', '已取消'].includes(record.status) && (record.status !== '待评估' || !canSubmitRequest(existing, actor))) return '仅创建人可以提交服务请求。';
    if (existing.customerId !== record.customerId)
      return '服务请求创建后不支持修改客户。';
    if (
      (existing.createdBy ?? existing.owner) !==
        (record.createdBy ?? record.owner) ||
      existing.createdAt !== record.createdAt
      || JSON.stringify(existing.createdViaAdmin) !== JSON.stringify(record.createdViaAdmin)
      || existing.createdById !== record.createdById
      || (record.createdByAudience !== undefined && requestAudience(existing) !== record.createdByAudience)
    )
      return '创建人和创建时间不支持修改。';
    if (existing.status === '草稿' && actor?.role === '客户' && !canCheckRequestCompleteness(existing, actor)) {
      const fields = ['title', 'requestType', 'contactId', 'description', 'expectedServiceDate', 'expectedServiceDateUncertain', 'items', 'status', 'submittedAt'] as const;
      if (fields.some(key => JSON.stringify(existing[key]) !== JSON.stringify(record[key])))
        return '非本人发起的服务申请仅支持只读查看，不允许修改或提交。';
    }
    if (existing.status !== '草稿') {
      if (record.status === '草稿') {
        const returned = record.operations?.draftReturns?.at(-1);
        const previousReturns = existing.operations?.draftReturns ?? [];
        const event = record.operations?.activities.at(-1);
        const managerId = existing.operations?.assessment?.managerId;
        const validReturn = existing.status === '待评估' && !!actor?.id && (isDemoAdministrator(actor) || actor.role === 'SmartX 项目经理' && (!managerId || managerId === actor.id))
          && returned?.actorId === actor.id && Boolean(returned.reason.trim())
          && record.operations?.draftReturns?.length === previousReturns.length + 1
          && previousReturns.every((item, index) => JSON.stringify(item) === JSON.stringify(record.operations?.draftReturns?.[index]))
          && event?.title === '退回草稿' && event.actorId === actor.id && event.detail === returned?.reason && event.at === returned?.at
          && (record.operations?.assessmentHistory?.length ?? 0) === (existing.operations?.assessmentHistory?.length ?? 0) + 1
          && !currentPlan(record) && record.operations?.assessment?.rounds.length === 0;
        if (!validReturn) return '仅待评估阶段的负责项目经理可以退回草稿。';
      }
      const frozen = ['title', 'contactId', 'description', 'expectedServiceDate', 'expectedServiceDateUncertain'] as const;
      if (frozen.some(key => JSON.stringify(existing[key]) !== JSON.stringify(record[key])))
        return '提交后基本信息只读，不支持修改。';
      if (JSON.stringify(existing.items) !== JSON.stringify(record.items)
        && !((isDeliveryConversion(record, existing)
          || canSupplementDeliveryMaterials(existing, actor) && canSupplementDeliveryMaterials(record, actor))
          && !deliveryConversionItemsIssue(record, existing))
        && (!canEditRequestItems(existing, actor) || !canEditRequestItems(record, actor)
          || existing.status !== record.status
          || JSON.stringify(existing.operations?.assessment) !== JSON.stringify(record.operations?.assessment)))
        return '仅负责项目经理可在材料评估通过前修改申请项；通过后申请项只读锁定。';
      const history = existing.operations?.activities ?? [];
      if (history.some((event, index) => JSON.stringify(event) !== JSON.stringify(record.operations?.activities[index])))
        return '已记录的活动不支持修改或删除。';
    }
    return requestParticipantsIssue(record.internalParticipants);
  }
  if (!record.title.trim()) return '请填写服务请求名称。';
  if (!record.customerId.trim()) return '请选择客户。';
  return requestParticipantsIssue(record.internalParticipants);
}
export type RequestAccessContext = {
  actor: OperationActor;
  directory: { id: string; name: string }[];
  customerId?: string;
  contacts?: ContactRef[];
};

export function canCreateRequest({ actor, customerId }: RequestAccessContext): boolean {
  if (!actor.id) return false;
  if (actor.role === '客户') return Boolean(customerId);
  return ['SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师', 'SmartX 硬件产品经理'].includes(actor.role);
}

export function requestCreationAccessIssue(record: ServiceRequest, access: RequestAccessContext): string | null {
  if (isDemoAdministrator(access.actor) && record.createdById !== access.actor.id) {
    if (record.status !== '草稿') return '请先创建草稿，再提交申请。';
    if (record.createdViaAdmin?.id !== access.actor.id || record.createdViaAdmin.name !== access.actor.name) return '管理员代发起信息无效。';
    const contact = access.contacts?.find(person => person.id === record.createdById && person.status === '启用' && person.customerId === record.customerId);
    if (record.createdByAudience === 'customer') return contact ? null : '代发起客户联系人不可用。';
    return record.createdByAudience === 'internal' && access.directory.some(person => person.id === record.createdById && !!fixedIdentityRoles[person.id]) ? null : '代发起内部用户不可用。';
  }
  if (record.createdViaAdmin) return '当前创建方式不允许指定代发起信息。';
  if (record.createdByAudience !== (access.actor.role === '客户' ? 'customer' : 'internal')) return '申请来源必须与创建人身份一致。';
  if (record.status !== '草稿') return '请先创建草稿，再提交申请。';
  if (!canCreateRequest(access)) return '当前身份不能创建服务请求。';
  if (record.createdById !== access.actor.id) return '创建人必须是当前身份。';
  if (access.actor.role === '客户' && record.customerId !== access.customerId) return '只能为当前所属客户创建服务请求。';
  return null;
}

export function canAccessRequest(record: ServiceRequest, { actor, directory, customerId, contacts }: RequestAccessContext): boolean {
  if (!actor.id || actor.role === '合作伙伴服务工程师') return false;
  if (actor.role === 'SmartX 系统管理员' || actor.role === 'SmartX 项目经理') return true;
  if (isRequestApplicant(record, actor) && (actor.role !== '客户' || (customerId === record.customerId && !!contacts?.some(c => c.id === actor.id && c.customerId === record.customerId && c.status === '启用')))) return true;
  if (actor.role === '客户') return customerId === record.customerId
    && !!contacts?.some(c => c.id === actor.id && c.customerId === record.customerId && c.status === '启用')
    && !!record.externalCollaborators?.some(p => p.contactId === actor.id);

  if (['SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师', 'SmartX 硬件产品经理'].includes(actor.role)) {
    const assessment = record.operations?.assessment;
    if (assessment?.plans.some(plan => plan.salesId === actor.id)
      || assessment?.approvals.some(approval => approval.approverId === actor.id || approval.workflow?.steps.some(step => step.approverId === actor.id))) return true;
  }
  if (record.status === '待评估' && hardwareItems(record).length && canPerformAssessmentRole(record, actor, 'hardware') && isHardwareProductManager(actor) && directory.some(person => person.id === actor.id)) return true;
  if (isInternal(actor.role) && record.internalParticipants?.some(person => person.userId === actor.id)) return true;
  if (record.createdById) return false;
  // Legacy records stored a display name. Ambiguous names and old role labels
  // cannot establish ownership; administrators and project managers can still see these records.
  const creator = record.createdBy ?? record.owner;
  const matches = new Set(directory.filter((person) => person.name === creator).map((person) => person.id));
  return matches.size === 1 && matches.has(actor.id);
}

export function canAddExternalCollaborators(record: ServiceRequest, access: RequestAccessContext): boolean {
  return ['草稿', '待评估'].includes(record.status) && canAccessRequest(record, access) && ['客户', 'SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师', 'SmartX 硬件产品经理'].includes(access.actor.role);
}

export function customerCollaborationIssue(record: ServiceRequest, existing: ServiceRequest, access: RequestAccessContext): string | null {
  const before = existing.externalCollaborators ?? [];
  const after = record.externalCollaborators ?? [];
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (!canAddExternalCollaborators(existing, access)) return '当前阶段或身份不允许修改客户协作人。';
  const removalIssue = applicantRemovalIssue(record);
  if (removalIssue) return removalIssue;
  if (new Set(after.map((person) => person.contactId)).size !== after.length) return '客户协作人不能重复。';
  if (after.some(person => !access.contacts?.some(contact => contact.id === person.contactId && contact.customerId === record.customerId && contact.status === '启用'))) return '只能添加当前客户已启用的联系人。';
  return null;
}
export function requestCollaborationSaveIssue(
  record: ServiceRequest,
  previous: ServiceRequest | undefined,
  refs: { contacts: ContactRef[]; customers: CustomerRef[]; users: InternalUser[]; partners?: import('./partner-directory').Partner[]; partnerUsers?: import('./partner-directory').PartnerUser[] },
  access?: RequestAccessContext,
): string | null {
  if (requestCollaboratorsLocked(previous) && (JSON.stringify(record.internalParticipants) !== JSON.stringify(previous?.internalParticipants)
    || JSON.stringify(record.externalCollaborators) !== JSON.stringify(previous?.externalCollaborators)
    || JSON.stringify(record.partnerCollaborators ?? []) !== JSON.stringify(previous?.partnerCollaborators ?? []))) return previous?.status === '已转服务项目' ? convertedRequestReadonlyMessage : '当前申请阶段不可维护协作人。';
  const { contacts, customers, users } = refs;
  const assessmentRemovalIssue = assessmentCollaboratorRemovalIssue(record, previous);
  record = withAssessmentCollaborators(record, users);
  const old = previous ? withRequestCollaborators(previous, contacts, customers, users) : undefined;
  if (access && !canAccessRequest(old ?? record, { ...access, contacts }))
    return '无权访问此服务请求，当前身份可能已停用。';
  const fixedIssue = applicantRemovalIssue(record) ?? customerOwnerRemovalIssue(record, old, customers);
  if (fixedIssue) return fixedIssue;
  if (access) {
    const customerIssue = customerCollaborationIssue(record, old ?? { ...record, externalCollaborators: [] }, { ...access, contacts });
    if (customerIssue) return customerIssue;
  }
  const partnersChanged = JSON.stringify(previous?.partnerCollaborators ?? []) !== JSON.stringify(record.partnerCollaborators ?? []);
  if (partnersChanged) {
    if (!access || !isInternal(access.actor.role) || !['草稿', '待评估'].includes(previous?.status ?? record.status)) return '当前身份或阶段不允许修改合作伙伴协作人。';
    const people = record.partnerCollaborators ?? [];
    if (new Set(people.map(person => person.userId)).size !== people.length) return '合作伙伴协作人不能重复。';
    if (people.some(person => !refs.partnerUsers?.some(user => user.id === person.userId && user.status === '启用'
      && refs.partners?.some(partner => partner.id === user.partnerId && partner.status === '启用')))) return '只能选择已启用合作伙伴中的启用用户。';
  }
  const participantsChanged = JSON.stringify(old?.internalParticipants) !== JSON.stringify(record.internalParticipants);
  if (access?.actor.role === '客户') {
    const ownerId = customers.find(customer => customer.id === record.customerId)?.ownerUserId;
    if (!previous && record.internalParticipants?.some(person => person.userId !== ownerId)) return '客户不能指定内部协作人。';
    if (previous && participantsChanged) return '客户不能修改内部协作人。';
  }
  if (participantsChanged && record.internalParticipants?.some(person =>
    !users.some(user => user.id === person.userId && user.status === '启用')
    && !old?.internalParticipants?.some(previousPerson => previousPerson.userId === person.userId)))
    return '只能添加已启用的内部用户。';
  return assessmentRemovalIssue;
}
export function requestCreationIssue(
  record: ServiceRequest,
  refs: { customers: CustomerRef[]; contacts: ContactRef[] },
): string | null {
  const identityIssue = requestIdentityIssue(record);
  if (identityIssue) return identityIssue;
  if (
    !refs.customers.some(
      (customer) =>
        customer.id === record.customerId && customer.status === '启用',
    )
  ) {
    return '请选择有效且已启用的客户。';
  }
  return null;
}
export class RequestIdentityError extends Error {}
export function defaultConfig(service: CatalogService): RequestConfig {
  const installation = service.category === '产品实施交付';
  return {
    serviceId: service.id,
    revision: 1,
    basicFields: {
      description: { enabled: true, required: true },
      businessObjects: isEntitlementService(service)
        ? { enabled: true, required: true, products: ['SMTX OS 系统'] }
        : { enabled: false, required: false },
    },
    fields: installation ? ['edition', 'nodes'] : [],
    fieldNames: { ...fieldLabels },
    fieldOptions: {},
    materials: [
      {
        id: 'requirements',
        name: installation ? '售前向交付移交材料' : '服务需求与环境说明',
        required: true,
        instructions: installation
          ? '按模板说明硬件、网络、部署范围和准备情况；不适用章节请说明原因。'
          : '说明服务目标、环境现状、涉及范围和已知限制。不适用内容请说明原因。',
        templateUrl: installation
          ? '/templates/handover-template.docx'
          : '/templates/service-requirements.md',
      },
    ],
  };
}
export function newItem(
  service: CatalogService,
  config: RequestConfig,
): RequestItem {
  const snapshot = structuredClone(applyCatalogConfigRules(service, normalizeRequestConfig(config)));
  return {
    id: crypto.randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    priceCoefficient: isEntitlementService(service) ? undefined : service.priceCoefficient,
    methods: [...service.deliveryMethods],
    method: service.deliveryMethods[0] ?? '',
    description: '',
    businessObjectIds: [],
    values: Object.fromEntries(snapshot.fields.map((fieldId) => [fieldId, ''])),
    config: snapshot,
    materials: [],
  };
}
export function copyRequestItem(source: RequestItem): RequestItem {
  const copy = structuredClone(source);
  copy.id = crypto.randomUUID();
  copy.materials = [];
  delete copy.businessObjectSnapshot;
  return copy;
}

export function requestFieldIsRequired(config: RequestConfig, fieldId: string, method: string, values: Record<string, string> = {}): boolean {
  const requirement = config.fieldRequiredWhen?.[fieldId];
  if (isEditionRequirement(requirement))
    return config.fields.includes('edition') && (values.edition === '企业版' || (requirement === 'standard-or-enterprise' && values.edition === '标准版'));
  if (config.fieldRequiredWhen?.[fieldId] === 'onsite') {
    if (method.trim() === '现场') return true;
    try { const values: unknown = JSON.parse(method); return Array.isArray(values) && values.includes('现场'); } catch { return false; }
  }
  return config.fieldRequired?.[fieldId] !== false;
}

export function requestFieldIsVisible(config: RequestConfig, fieldId: string, method: string, values: Record<string, string> = {}): boolean {
  return !config.fieldRequiredWhen?.[fieldId] || requestFieldIsRequired(config, fieldId, method, values);
}

// Save-time cleanup only: never call while changing a controlling field or reading
// stored records. The editor keeps its original values until a save succeeds.
export function clearHiddenItemFields(item: RequestItem): RequestItem {
  const next = {
    ...item,
    values: Object.fromEntries(Object.entries(item.values).filter(([id]) =>
      !['method', 'description', 'businessObjects'].includes(id)
      && item.config.fields.includes(id) && requestFieldIsVisible(item.config, id, item.method, item.values),
    )),
    description: item.config.basicFields?.description?.enabled === false ? '' : item.description,
  };
  if (!businessObjectsEnabled(item.config)) {
    next.businessObjectIds = [];
    delete next.businessObjectSnapshot;
  }
  return next;
}

export function clearHiddenRequestFields(record: ServiceRequest): ServiceRequest {
  const next = { ...record, items: record.items.map(clearHiddenItemFields) };
  return next;
}

export function itemBasicIssues(item: RequestItem): string[] {
  const issues: string[] = [];
  if (
    item.config.basicFields?.description?.enabled !== false &&
    item.config.basicFields?.description?.required !== false &&
    !item.description.trim()
  )
    issues.push('需求说明');
  if (
    businessObjectsEnabled(item.config) &&
    item.config.basicFields?.businessObjects?.required === true &&
    !item.businessObjectIds.length
  )
    issues.push('业务对象');
  const methodType = item.methodFieldType ?? 'single';
  let methodValid = Boolean(item.method.trim());
  if (methodType === 'single')
    methodValid = methodValid && item.methods.includes(item.method);
  if (methodType === 'multiple') {
    try {
      const values: unknown = JSON.parse(item.method);
      methodValid =
        Array.isArray(values) &&
        values.length > 0 &&
        values.every(
          (value) => typeof value === 'string' && item.methods.includes(value),
        );
    } catch {
      methodValid = item.methods.includes(item.method);
    }
  }
  if (methodType === 'integer')
    methodValid =
      methodValid &&
      /^-?\d+$/.test(item.method) &&
      Number.isSafeInteger(Number(item.method));
  if (methodType === 'decimal')
    methodValid = methodValid && Number.isFinite(Number(item.method));
  if (methodType === 'date')
    methodValid =
      methodValid &&
      /^\d{4}-\d{2}-\d{2}$/.test(item.method) &&
      !Number.isNaN(Date.parse(item.method));
  if (!methodValid) issues.push('服务方式');
  for (const key of item.config.fields) {
    if (key === 'businessObjects' || !requestFieldIsVisible(item.config, key, item.method, item.values)) continue;
    const value = (item.values[key] ?? '').trim();
    const empty = !value || value === '[]';
    if (empty && !requestFieldIsRequired(item.config, key, item.method, item.values)) continue;
    if (isAddressValue(value) && !addressComplete(value)) {
      issues.push(`${item.config.fieldNames?.[key] ?? '地址'}（请填写详细地址）`);
      continue;
    }
    if (
      key === 'nodes'
        ? !/^\d+$/.test(value) ||
          !Number.isSafeInteger(Number(value)) ||
          Number(value) <= 0
        : empty
    )
      issues.push(
        key === 'nodes'
          ? '节点数（正整数）'
          : (item.config.fieldNames?.[key] ??
              fieldLabels[key] ??
              `申请字段 ${key}`),
      );
  }
  return issues;
}

export function normalizeRequestConfig(
  config: RequestConfig & {
    fieldNames?: Record<string, string>;
    fieldOptions?: Record<string, string[]>;
  },
): RequestConfig {
  return {
    ...config,
    fields: config.fields.filter((id) => id !== 'businessObjects'),
    basicFields: {
      ...config.basicFields,
      businessObjects: {
        ...config.basicFields?.businessObjects,
        enabled: businessObjectsEnabled(config),
        required: config.basicFields?.businessObjects?.required ?? false,
      },
    },
    fieldNames: Object.fromEntries(Object.entries({ ...fieldLabels, ...config.fieldNames }).map(([id, name]) => [id, (name)])),
    fieldOptions: Object.fromEntries(
      Object.entries(config.fieldOptions ?? {}).map(([fieldId, options]) => [
        fieldId,
        [...options],
      ]),
    ),
  };
}
export function itemIssues(item: RequestItem, requestType: RequestType | '' = '服务交付'): string[] {
  const issues = itemBasicIssues(item);
  for (const requirement of item.config.materials.filter(m => materialRequiredFor(m, requestType))) {
    const material = item.materials.find(
      (m) => m.requirementId === requirement.id,
    );
    if (!materialFiles(material).length) issues.push(`上传${requirement.name}`);
  }
  return issues;
}
export const fileAccept =
  '.doc,.docx,.pdf,.xls,.xlsx,.csv,.txt,.md,.png,.jpg,.jpeg';
export function checkFile(file: File): string | null {
  if (!file.size) return '不能上传空文件。';
  if (file.size > 20 * 1024 * 1024) return '单个文件不能超过 20 MB。';
  const extension = '.' + file.name.split('.').at(-1)?.toLowerCase();
  if (!fileAccept.split(',').includes(extension))
    return '请上传支持的文档、表格或图片格式。';
  return null;
}
export function storedFile(file: File): StoredFile {
  return {
    id: crypto.randomUUID(),
    name: file.name,
    size: file.size,
    uploadedAt: new Date().toISOString(),
    blob: file,
  };
}
export function downloadFile(file: StoredFile) {
  const url = URL.createObjectURL(file.blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Device-local prototype storage. Blobs and metadata commit in the same transaction.
export async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('smartx-service-request-local-v1', 2);
    request.onupgradeneeded = () => {
      for (const [name, keyPath] of [
        ['requests', 'id'],
        ['configs', 'serviceId'],
        ['references', 'id'],
      ]) {
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('请关闭其他站点标签页后重试。'));
  });
}
export async function readLocal<T>(
  store: 'requests' | 'configs' | 'references',
): Promise<T[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(store, 'readonly');
      const request = transaction.objectStore(store).getAll();
      transaction.oncomplete = () => resolve(request.result as T[]);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
// Read and append a reference history in one transaction so concurrent tabs cannot overwrite versions.
export async function updateLocalReference<T>(id: string, update: (previous: T | undefined) => T): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction('references', 'readwrite');
      const records = transaction.objectStore('references');
      const request = records.get(id);
      let result: T;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('保存已中止'));
      transaction.onerror = () => reject(transaction.error);
      request.onsuccess = () => {
        try {
          result = update(request.result?.payload as T | undefined);
          if (id === 'workspace') {
            result = preserveProjectReservations(result as Parameters<typeof preserveProjectReservations>[0], request.result?.payload) as T;
            const issue = workspaceDayQuantityIssue(result as Parameters<typeof workspaceDayQuantityIssue>[0], request.result?.payload);
            if (issue) throw new Error(issue);
          }
          records.put({ id, payload: result });
        } catch (error) {
          reject(error);
          transaction.abort();
        }
      };
    });
  } finally { db.close(); }
}

export function requestBasicInfo(record: ServiceRequest) {
  return {
    title: record.title.trim(),
    requestType: requestTypeOf(record),
    description: record.description,
    expectedServiceDate: record.expectedServiceDate ?? '',
    expectedServiceDateUncertain: record.expectedServiceDateUncertain === true,
    customValues: structuredClone(record.customValues ?? {}),
  };
}
export type RequestSaveOptions = { basicInfo?: { expectedUpdatedAt: string } };

export function applyRequestBasicInfo(previous: ServiceRequest | undefined, submitted: ServiceRequest, actor: OperationActor | undefined, expectedUpdatedAt: string): ServiceRequest {
  if (!previous) throw new RequestIdentityError('服务请求不存在，请重新打开列表。');
  if (!actor?.id || (!isInternal(actor.role) && actor.role !== '客户') || previous.status !== '草稿' || !canCheckRequestCompleteness(previous, actor))
    throw new RequestIdentityError('当前身份或状态不允许编辑基本信息。');
  if (previous.updatedAt !== expectedUpdatedAt) throw new RequestIdentityError('服务请求已被更新，请重新打开详情后编辑；当前填写内容已保留。');
  const next = { ...previous, ...requestBasicInfo(submitted), updatedAt: new Date().toISOString() };
  const issue = requestIdentityIssue(next) ?? requestIdentityIssue(next, previous, actor);
  if (issue) throw new RequestIdentityError(issue);
  return next;
}

export async function saveLocal(
  store: 'requests' | 'configs' | 'references',
  record: ServiceRequest | RequestConfig | { id: string; payload: unknown },
  access?: RequestAccessContext,
  options?: RequestSaveOptions,
): Promise<void> {
  if (store === 'references' && 'id' in record && record.id === requestProjectMappingId) throw new Error('请通过请求转项目映射管理保存配置。');
  if (store === 'references' && 'id' in record && record.id === assessmentRoutingId) throw new Error('请通过服务请求流程配置保存分配规则。');
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store === 'requests' ? ['requests', 'references', 'configs'] : store, 'readwrite');
      const records = transaction.objectStore(store);
      if (store === 'requests') {
        const itemConfigsRead = transaction.objectStore('configs').getAll();
        let serviceRequest = record as ServiceRequest;
        // Keep the submitted list so automatic additions cannot hide an explicit removal.
        let incomingParticipants = serviceRequest.internalParticipants;
        const current = records.get(serviceRequest.id);
        current.onsuccess = () => {
          // Use the persisted state before any normalization or automatic collaborator updates.
          // This also rejects stale tabs, status rollback attempts and attachment-only writes.
          if (current.result && isConvertedRequest(current.result)) {
            reject(new RequestIdentityError(convertedRequestReadonlyMessage));
            transaction.abort();
            return;
          }
          if (options?.basicInfo) {
            try {
              serviceRequest = applyRequestBasicInfo(current.result ? current.result : undefined, serviceRequest, access?.actor, options.basicInfo.expectedUpdatedAt);
              incomingParticipants = serviceRequest.internalParticipants;
            } catch (error) { reject(error); transaction.abort(); return; }
          }
          const referenceRead = transaction.objectStore('references').getAll();
          referenceRead.onsuccess = () => {
            const savedWorkspace = referenceRead.result.find((entry: { id: string }) => entry.id === 'workspace')?.payload;
            // Apply system additions symmetrically before immutable-field comparisons.
            serviceRequest = withAssessmentCollaborators(serviceRequest, savedWorkspace?.users ?? []);
            const storedPrevious = current.result ? current.result : undefined;
            const previous = storedPrevious ? withRequestCollaborators(storedPrevious, savedWorkspace?.contacts ?? [], savedWorkspace?.customers ?? [], savedWorkspace?.users ?? []) : undefined;
            try { validateCustomValues(serviceRequest.customValues, normalizeApplicationFields(savedWorkspace?.applicationFields).filter(field => !isSystemApplicationField(field.id)), previous?.customValues); }
            catch (error) { reject(error); transaction.abort(); return; }
            const creationIssue = access && !previous ? requestCreationAccessIssue(serviceRequest, { ...access, contacts: savedWorkspace?.contacts ?? [], directory: (savedWorkspace?.users ?? []).filter((user: InternalUser) => user.status === '启用') }) : null;
            if (creationIssue) {
              reject(new RequestIdentityError(creationIssue));
              transaction.abort();
              return;
            }
            if (access && (!canAccessRequest(previous ?? serviceRequest, access)
              || (!previous && serviceRequest.createdById !== access.actor.id && !isDemoAdministrator(access.actor, savedWorkspace?.users ?? [])))) {
              reject(new RequestIdentityError('无权访问此服务请求。'));
              transaction.abort();
              return;
            }
            const decisionIssue = previous ? customerDecisionIssue(serviceRequest, previous, access?.actor, access?.customerId) : null;
            const supplementIssue = supplementSaveIssue(serviceRequest, previous ?? { ...serviceRequest, operations: undefined }, access?.actor, access?.customerId, savedWorkspace?.users ?? [], savedWorkspace?.contacts ?? [], savedWorkspace);
            let projectIssue: string | null = null;
            try {
              projectIssue = projectCreationSaveIssue(serviceRequest, previous, access?.actor,
                serviceRequest.operations?.projectCreation && !previous?.operations?.projectCreation
                  ? parseProjectMapping(referenceRead.result.find((entry: { id: string }) => entry.id === requestProjectMappingId)?.payload)
                  : undefined);
            } catch (error) { projectIssue = error instanceof Error ? error.message : '映射配置读取失败。'; }
            const issue = (JSON.stringify(serviceRequest.projectReservationReleases) !== JSON.stringify(previous?.projectReservationReleases) ? '项目额度释放记录只能通过取消服务项目更新。' : null)
              ?? requestCancellationSaveIssue(serviceRequest, previous, access?.actor, savedWorkspace?.users ?? [])
              ?? requestTypeSaveIssue(serviceRequest, previous, access?.actor, savedWorkspace?.users ?? [])
              ?? routingSaveIssue(serviceRequest, previous, access?.actor, savedWorkspace?.users ?? []) ?? customerMaterialSaveIssue(serviceRequest, previous, access?.actor) ?? projectIssue ?? supplementIssue ?? decisionIssue
              ?? requestIdentityIssue(serviceRequest, previous, access?.actor)
              ?? hardwareAssessmentSaveIssue(serviceRequest, previous, access?.actor, savedWorkspace?.users ?? [])
              ?? assessmentBasisSaveIssue(serviceRequest, previous, access?.actor, savedWorkspace?.customers ?? [], savedWorkspace?.users ?? []);
            if (issue) {
              reject(new RequestIdentityError(issue));
              transaction.abort();
            } else {
              if (serviceRequest.status === '已取消') {
                serviceRequest = { ...serviceRequest, cancelledFromStatus: previous && previous.status !== '已取消' ? previous.status : requestCancellationStage(previous ?? serviceRequest) };
              }
              // Check access and immutable fields against the original input first;
              // canonical cleanup must not grant permission to edit a locked item.
              serviceRequest = clearHiddenRequestFields(serviceRequest);
              serviceRequest = attributeRequestMaterials(serviceRequest, previous, access?.actor);
              serviceRequest = invalidateHardwareReview(serviceRequest, previous);
              const changedPlan = JSON.stringify(currentPlan(serviceRequest)) !== JSON.stringify(previous ? currentPlan(previous) : undefined);
              const startingConfirmation = serviceRequest.operations?.assessment?.confirmation && !previous?.operations?.assessment?.confirmation;
              const changedEffort = JSON.stringify(serviceRequest.operations?.assessment?.effort) !== JSON.stringify(previous?.operations?.assessment?.effort);
              const checkAssessment = changedPlan || startingConfirmation || changedEffort;

              const all = records.getAll();
              all.onsuccess = () => {
                  const workspace = referenceRead;
                  const workspacePayload = savedWorkspace;
                  const contacts = workspacePayload?.contacts ?? [];
                  const users = workspacePayload?.users ?? [];
                  const customers = workspacePayload?.customers ?? [];
                  const policyIssue = requestCollaborationSaveIssue({ ...serviceRequest, internalParticipants: incomingParticipants }, storedPrevious, { contacts, users, customers, partners: workspacePayload?.partners, partnerUsers: workspacePayload?.partnerUsers }, access);
                  if (policyIssue) { reject(new RequestIdentityError(policyIssue)); transaction.abort(); return; }
                  try { serviceRequest = routeAssessmentOnSave(serviceRequest, previous, referenceRead.result.find((entry: { id: string }) => entry.id === assessmentRoutingId)?.payload, users, undefined, customers); }
                  catch (error) { reject(error); transaction.abort(); return; }
                  try {
                    const approvalIssue = specialApprovalSaveIssue(serviceRequest, previous, access?.actor, users, customers, readApprovalRulesPayload(referenceRead.result.find((entry: { id: string }) => entry.id === approvalRulesId)?.payload));
                    if (approvalIssue) { reject(new RequestIdentityError(approvalIssue)); transaction.abort(); return; }
                  } catch (error) { reject(error); transaction.abort(); return; }
                  const validationEvents = validationEventsForTransition(serviceRequest, previous);
                  try {
                    const failures = runValidationQueue(serviceRequest, { contacts, users, customers, businessObjects: workspacePayload?.businessObjects ?? [], services: workspacePayload?.services ?? [], currentActor: access?.actor }, validationEvents, referenceRead.result.find((entry: { id: string }) => entry.id === submissionRulesId)?.payload);
                    if (failures.length) throw new SubmissionValidationError(failures, validationEvents);
                  } catch (error) {
                    reject(error instanceof SubmissionValidationError ? error : new SubmissionValidationError([{ ruleId: 'queue', requirement: '校验队列', message: '校验队列执行失败，请刷新后重试。' }], validationEvents));
                    transaction.abort(); return;
                  }
                  if (serviceRequest.operations?.projectCreation && !previous?.operations?.projectCreation) {
                    try {
                      const actor = access?.actor;
                      if (!actor || projectActorRoles[actor.id] !== 'SmartX 项目经理' || !users.some((user: InternalUser) => user.id === actor.id && user.status === '启用')) throw new Error('仅已启用的负责项目经理可以创建项目。');
                      const creation = serviceRequest.operations.projectCreation;
                      const mapping = parseProjectMapping(referenceRead.result.find((entry: { id: string }) => entry.id === requestProjectMappingId)?.payload);
                      const projects = creation.projects.map(project => mappedServiceProject(previous!, project, creation, mapping, workspacePayload?.partners ?? [], { ...workspacePayload, itemConfigs: itemConfigsRead.result }));
                      for (const project of projects) {
                        const key = `service-project:${project.id}`;
                        if (referenceRead.result.some((entry: { id: string }) => entry.id === key)) throw new Error('项目编号已存在，请重新打开创建弹窗。');
                        transaction.objectStore('references').add({ id: key, payload: project });
                      }
                    } catch (error) { reject(new RequestIdentityError(error instanceof Error ? error.message : '项目创建失败。')); transaction.abort(); return; }
                  }
                  if (!checkAssessment) { records.put(withRequestCollaborators(serviceRequest, contacts, customers, users)); return; }
                  const ownerIssue = changedPlan ? planSalesOwnerIssue(serviceRequest, workspacePayload?.customers ?? [], workspacePayload?.users ?? []) : null;
                  const lockIssue = ownerIssue ?? effortPricingSaveIssue(serviceRequest, previous, workspacePayload?.services ?? [], entitlementPricingContext(workspace.result, all.result))
                    ?? assessmentLockIssue(serviceRequest, all.result, workspacePayload?.assets ?? [], workspacePayload?.businessObjects ?? []);
                  if (lockIssue) { reject(new RequestIdentityError(lockIssue)); transaction.abort(); }
                  else records.put(withRequestCollaborators(serviceRequest, contacts, customers, users));
              };
            }
          };
        };
      } else if (
        store === 'references' &&
        'id' in record &&
        record.id === 'workspace'
      ) {
        // A delayed workspace autosave must not overwrite a newer catalog commit.
        const incoming = record as {
          id: string;
          payload: {
            services: (CatalogService & {
              version?: number;
              updatedAt?: string;
            })[];
          };
        };
        const current = records.get('workspace');
        current.onsuccess = () => {
          try {
            incoming.payload = preserveProjectReservations(incoming.payload as Parameters<typeof preserveProjectReservations>[0], current.result?.payload) as typeof incoming.payload;
          } catch (error) { reject(error); transaction.abort(); return; }
          const precisionIssue = workspaceDayQuantityIssue(incoming.payload, current.result?.payload);
          if (precisionIssue) { reject(new Error(precisionIssue)); transaction.abort(); return; }
          const latest = current.result?.payload?.services as
            | (CatalogService & { version?: number; updatedAt?: string })[]
            | undefined;
          records.put({
            ...incoming,
            payload: {
              ...incoming.payload,
              services: incoming.payload.services.map((service) => {
                const saved = latest?.find((item) => item.id === service.id);
                return saved &&
                  ((saved.version ?? 1) > (service.version ?? 1) ||
                    ((saved.version ?? 1) === (service.version ?? 1) &&
                      (Date.parse(saved.updatedAt ?? '') || 0) >
                        (Date.parse(service.updatedAt ?? '') || 0)))
                  ? saved
                  : service;
              }),
            },
          });
        };
      } else records.put(record);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}
