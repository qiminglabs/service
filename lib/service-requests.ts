import { runValidationQueue, validationEventsForTransition, SubmissionValidationError } from './submission-validation.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
export { requestIssues } from './request-validation-builtins.ts';
import { addressLabel, isAddressValue, addressComplete } from './request-address.ts';
import { withRequestCollaborators, requestAudience, isRequestApplicant, applicantRemovalIssue } from './request-collaboration.ts';
import { entitlementAvailable } from './request-entitlement-reservations.ts';
import { workspaceDayQuantityIssue } from './day-quantity.ts';
import { effortPricingSaveIssue, entitlementPricingContext } from './request-pricing.ts';
import { projectCreationSaveIssue } from './request-projects.ts';
import { isInternal } from './request-operations.ts';
import { supplementSaveIssue } from './request-supplements.ts';
import { customerDecisionIssue } from './request-customer-decision.ts';
import { assessmentLockIssue, currentPlan, planSalesOwnerIssue } from './request-assessment.ts';
import type { OperationActor, RequestOperations } from './request-operations';

export type CatalogService = {
  id: string;
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
  audience: RequestAudience,
): boolean {
  return (
    service.status === '已启用' &&
    (service.allowedInitiatorSites === undefined ||
      service.allowedInitiatorSites.includes(
        audience === 'customer' ? '客户中心' : '内部系统',
      ))
  );
}

export function customerRequestConfigId(serviceId: string) {
  return `customer-request-config:${serviceId}`;
}

export async function readRequestConfigs(
  audience: RequestAudience,
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
        record.id === customerRequestConfigId(record.payload.serviceId),
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
export type CustomerRef = { id: string; name: string; status: string; ownerUserId?: string };
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
  };
};
export type FieldKey = string;
export const fieldLabels: Record<string, string> = {
  edition: '产品版本类型',
  version: '产品版本号',
  nodes: '节点数',
};
export type MaterialRequirement = {
  id: string;
  name: string;
  required: boolean;
  instructions: string;
  template?: StoredFile;
  templateUrl?: string;
  onlineTemplateUrl?: string;
};
export function visibleMaterialFiles(material: ItemMaterial | undefined, audience: RequestAudience = 'internal', actorId?: string): StoredFile[] {
  return materialFiles(material).filter(file => audience === 'internal'
    || (!!actorId && file.uploaderAudience === 'customer' && file.uploadedById === actorId));
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
  return { ...record, items: record.items.map(item => ({ ...item, materials: item.materials.map(material => {
    const old = previous?.items.find(entry => entry.id === item.id)?.materials.find(entry => entry.requirementId === material.requirementId);
    return withMaterialFiles(material, materialFiles(material).map(file => {
      const before = materialFiles(old).find(entry => entry.id === file.id);
      // Preserve unseen originals, including their bytes, when a customer saves the request.
      if (before && actor.role === '客户' && !(before.uploaderAudience === 'customer' && before.uploadedById === actor.id)) return before;
      return before && JSON.stringify(before) === JSON.stringify(file) ? before : attributeMaterialFile(file, actor);
    }));
  }) })) };
}
export type RequestConfig = {
  fieldOrder?: string[];
  fieldWidths?: Record<string, 'full' | 'half'>;
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
  fieldRequiredWhen?: Record<string, 'onsite'>;
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
// Compatibility export: the former contact field no longer creates collaborators.
export const withRequestContact = withRequestCollaborators;
export function requestContactRemovalIssue(record: ServiceRequest, previous?: ServiceRequest): string | null {
  return applicantRemovalIssue(record);
}
export const requestStatuses = [
  '草稿',
  '待评估',
  '待确认',
  '待受理',
  '已转服务项目',
  '已取消',
] as const;
export type RequestStatus = (typeof requestStatuses)[number];
export type RequestStage = Exclude<RequestStatus, '已取消'>;
// Normalize legacy local records at the storage boundary without changing their data.
export function normalizeStoredRequest(
  record: ServiceRequest | (Omit<ServiceRequest, 'status'> & { status: '已转工单' }),
): ServiceRequest {
  return record.status === '已转工单' ? { ...record, status: '已转服务项目' } : record;
}
export function requestStatusTone(status: RequestStatus) {
  if (status === '已取消') return 'cancelled';
  if (status === '已转服务项目') return 'green';
  return status === '草稿' ? 'muted' : 'blue';
}
export function requestCancellationStage(record: ServiceRequest): RequestStage {
  if (record.cancelledFromStatus && requestStatuses.filter(stage => stage !== '已取消').includes(record.cancelledFromStatus)) return record.cancelledFromStatus;
  // Reconstruct legacy cancellations from transitions, including returns and resubmissions.
  const transitions: { at: number; stage: RequestStage }[] = [];
  const add = (at: string | undefined, stage: RequestStage) => {
    if (at && Number.isFinite(Date.parse(at))) transitions.push({ at: Date.parse(at), stage });
  };
  const ops = record.operations;
  add(record.submittedAt, '待评估');
  for (const returned of ops?.draftReturns ?? []) add(returned.at, '草稿');
  add(ops?.assessment?.confirmation?.at, '待确认');
  for (const decision of ops?.customerDecisions ?? []) add(decision.at, decision.accepted ? '待受理' : '待评估');
  add(ops?.projectCreation?.at, '已转服务项目');
  const activityStages: Record<string, RequestStage> = {
    '提交服务请求': '待评估', '提交服务申请': '待评估', '退回草稿': '草稿',
    '发起客户确认': '待确认', '客户确认通过': '待受理', '客户拒绝确认': '待评估', '创建服务项目': '已转服务项目',
  };
  for (const event of ops?.activities ?? []) {
    const stage = activityStages[event.title];
    if (stage) add(event.at, stage);
  }
  if (transitions.length) return transitions.sort((a, b) => a.at - b.at).at(-1)!.stage;
  if (ops?.projectCreation) return '已转服务项目';
  if (ops?.assessment?.confirmation) return '待确认';
  if (ops?.assessment?.rounds?.length || ops?.assessment?.effort) return '待评估';
  // Missing history must not imply that later stages were completed.
  return '草稿';
}
export function requestProgressSteps(request: RequestStatus | ServiceRequest) {
  const status = typeof request === 'string' ? request : request.status;
  const stage = status === '已取消' ? (typeof request === 'string' ? '草稿' : requestCancellationStage(request)) : status;
  const current = requestStatuses.indexOf(stage);
  return requestStatuses
    .filter((step) => step !== '已取消')
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
export const businessImpactOptions = ['生产环境', '测试环境', '不涉及业务'] as const;
export type BusinessImpact = (typeof businessImpactOptions)[number];
function businessImpactIssue(value: unknown): string | null {
  return businessImpactOptions.includes(value as BusinessImpact) ? null : '请选择业务影响：生产环境、测试环境或不涉及业务。';
}
export type ServiceRequest = {
  id: string;
  title: string;
  customerId: string;
  contactId: string;
  description: string;
  expectedServiceDate?: string;
  businessImpact?: BusinessImpact | '';
  owner: string;
  createdBy?: string;
  createdById?: string;
  createdByAudience?: RequestAudience;
  externalCollaborators?: ExternalCollaborator[];
  internalParticipants?: InternalParticipant[];
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
  const keys = [...new Set(['method', ...item.config.fields])].filter(key => key !== 'description' && key !== 'businessObjects' && requestFieldIsVisible(item.config, key, item.method));
  const fields = keys.map(key => ({ key, label: names[key] || item.config.fieldNames?.[key] || fieldLabels[key] || (key === 'method' ? '服务方式' : key), value: display(key === 'method' ? item.method : item.values[key]) }));
  if (businessObjectsEnabled(item.config)) fields.push({ key: 'businessObjects', label: names.businessObjects || '业务对象', value: item.businessObjectIds.map(id => itemObjectName(item, id, objects)).join('、') || '未关联' });
  return fields;
}
export function itemSummaryFields(item: RequestItem, names: Record<string, string> = {}, objects: Pick<ObjectRef, 'id' | 'name'>[] = []): { key: string; label: string; value: string; address: boolean }[] {
  const defaults: Record<string, string> = { ...fieldLabels, method: '服务方式', edition: '产品版本', businessObjects: '业务对象', productForm: '产品形态', address: '地址', tibCount: 'TiB 数', instanceCount: '实例数', clusterCount: '集群数', expectedProvider: '期望服务商' };
  const keys = [...new Set(['method', 'edition', 'nodes', 'version', ...item.config.fields, ...Object.keys(item.values), 'businessObjects'])].filter(key => key !== 'description');
  return keys.flatMap(key => {
    if (!requestFieldIsVisible(item.config, key, item.method)) return [];
    let value = (key === 'method' ? item.method : key === 'businessObjects' ? item.businessObjectIds.map(id => itemObjectName(item, id, objects)).join('、') : item.values[key] ?? '').trim();
    const address = key === 'address' || isAddressValue(value);
    if (isAddressValue(value)) value = addressLabel(value);
    else if (value.startsWith('[')) {
      try { const parsed: unknown = JSON.parse(value); if (Array.isArray(parsed)) value = parsed.filter(entry => typeof entry === 'string' && entry.trim()).map(entry => entry.trim()).join('、'); } catch { /* Keep legacy text readable. */ }
    }
    return value ? [{ key, label: names[key] || item.config.fieldNames?.[key] || defaults[key] || key, value, address }] : [];
  });
}
export function itemSummary(item: RequestItem): string {
  return itemSummaryFields(item, { edition: '产品版本' }).map(field => `${field.label}：${field.value}`).join(' · ');
}
export function newRequest(
  title: string,
  customerId: string,
  owner: string,
  contactId = '',
  createdById?: string,
  creatorRole?: string,
  customerOwner?: InternalUser,
): ServiceRequest {
  const now = new Date().toISOString();
  return {
    id: `SR-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    title: title.trim(),
    customerId,
    contactId: '',
    createdByAudience: creatorRole === '客户' ? 'customer' : 'internal',
    description: '',
    expectedServiceDate: '',
    businessImpact: '',
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
  return record.status === '待评估' && !!actor?.id && actor.role === 'SmartX 项目经理'
    && (!assessment?.managerId || assessment.managerId === actor.id)
    && !assessment?.rounds.some(round => round.outcome === '评估通过');
}

export function requestIdentityIssue(
  record: ServiceRequest,
  existing?: ServiceRequest,
  actor?: OperationActor,
): string | null {
  if (record.businessImpact !== undefined && record.businessImpact !== '' && businessImpactIssue(record.businessImpact)) return businessImpactIssue(record.businessImpact);
  if (existing) {
    if (existing.status === '草稿' && !['草稿', '已取消'].includes(record.status) && (record.status !== '待评估' || !isRequestApplicant(existing, actor))) return '仅创建人可以提交服务请求。';
    if (existing.customerId !== record.customerId)
      return '服务请求创建后不支持修改客户。';
    if (
      (existing.createdBy ?? existing.owner) !==
        (record.createdBy ?? record.owner) ||
      existing.createdAt !== record.createdAt
      || existing.createdById !== record.createdById
      || (record.createdByAudience !== undefined && requestAudience(existing) !== record.createdByAudience)
    )
      return '创建人和创建时间不支持修改。';
    if (existing.status === '草稿' && actor?.role === '客户' && !canCheckRequestCompleteness(existing, actor)) {
      const fields = ['title', 'contactId', 'description', 'expectedServiceDate', 'businessImpact', 'items', 'status', 'submittedAt'] as const;
      if (fields.some(key => JSON.stringify(existing[key]) !== JSON.stringify(record[key])))
        return '非本人发起的服务申请仅支持只读查看，不允许修改或提交。';
    }
    if (existing.status !== '草稿') {
      if (record.status === '草稿') {
        const returned = record.operations?.draftReturns?.at(-1);
        const previousReturns = existing.operations?.draftReturns ?? [];
        const event = record.operations?.activities.at(-1);
        const managerId = existing.operations?.assessment?.managerId;
        const validReturn = existing.status === '待评估' && actor?.role === 'SmartX 项目经理'
          && (!managerId || managerId === actor.id)
          && returned?.actorId === actor.id && Boolean(returned.reason.trim())
          && record.operations?.draftReturns?.length === previousReturns.length + 1
          && previousReturns.every((item, index) => JSON.stringify(item) === JSON.stringify(record.operations?.draftReturns?.[index]))
          && event?.title === '退回草稿' && event.actorId === actor.id && event.detail === returned?.reason && event.at === returned?.at
          && (record.operations?.assessmentHistory?.length ?? 0) === (existing.operations?.assessmentHistory?.length ?? 0) + 1
          && !currentPlan(record) && record.operations?.assessment?.rounds.length === 0;
        if (!validReturn) return '仅待评估阶段的负责项目经理可以退回草稿。';
      }
      const frozen = ['title', 'contactId', 'description', 'expectedServiceDate', 'businessImpact'] as const;
      if (frozen.some(key => JSON.stringify(existing[key]) !== JSON.stringify(record[key])))
        return '提交后基本信息只读，不支持修改。';
      if (JSON.stringify(existing.items) !== JSON.stringify(record.items)
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
  return ['SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师'].includes(actor.role);
}

export function requestCreationAccessIssue(record: ServiceRequest, access: RequestAccessContext): string | null {
  if (record.createdByAudience !== (access.actor.role === '客户' ? 'customer' : 'internal')) return '申请来源必须与创建人身份一致。';
  if (record.status !== '草稿') return '请先创建草稿，再提交申请。';
  if (!canCreateRequest(access)) return '当前身份不能创建服务请求。';
  if (record.createdById !== access.actor.id) return '创建人必须是当前身份。';
  if (access.actor.role === '客户' && record.customerId !== access.customerId) return '只能为当前所属客户创建服务请求。';
  return null;
}

export function canAccessRequest(record: ServiceRequest, { actor, directory, customerId, contacts }: RequestAccessContext): boolean {
  if (!actor.id) return false;
  if (actor.role === 'SmartX 系统管理员' || actor.role === 'SmartX 项目经理') return true;
  if (isRequestApplicant(record, actor) && (actor.role !== '客户' || (customerId === record.customerId && !!contacts?.some(c => c.id === actor.id && c.customerId === record.customerId && c.status === '启用')))) return true;
  if (actor.role === '客户') return customerId === record.customerId
    && !!contacts?.some(c => c.id === actor.id && c.customerId === record.customerId && c.status === '启用')
    && !!record.externalCollaborators?.some(p => p.contactId === actor.id);

  if (['SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师'].includes(actor.role)) {
    const assessment = record.operations?.assessment;
    if (assessment?.plans.some(plan => plan.salesId === actor.id)
      || assessment?.approvals.some(approval => approval.approverId === actor.id)) return true;
  }
  if (isInternal(actor.role) && record.internalParticipants?.some(person => person.userId === actor.id)) return true;
  if (record.createdById) return false;
  // Legacy records stored a display name. Ambiguous names and old role labels
  // cannot establish ownership; administrators and project managers can still see these records.
  const creator = record.createdBy ?? record.owner;
  const matches = new Set(directory.filter((person) => person.name === creator).map((person) => person.id));
  return matches.size === 1 && matches.has(actor.id);
}

export function canAddExternalCollaborators(record: ServiceRequest, access: RequestAccessContext): boolean {
  return ['草稿', '待评估'].includes(record.status) && canAccessRequest(record, access) && ['客户', 'SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师'].includes(access.actor.role);
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
  refs: { contacts: ContactRef[]; customers: CustomerRef[]; users: InternalUser[] },
  access?: RequestAccessContext,
): string | null {
  const { contacts, customers, users } = refs;
  const old = previous ? withRequestCollaborators(previous, contacts, customers, users) : undefined;
  if (access && !canAccessRequest(old ?? record, { ...access, contacts }))
    return '无权访问此服务请求，当前身份可能已停用。';
  const fixedIssue = applicantRemovalIssue(record) ?? customerOwnerRemovalIssue(record, old, customers);
  if (fixedIssue) return fixedIssue;
  if (access) {
    const customerIssue = customerCollaborationIssue(record, old ?? { ...record, externalCollaborators: [] }, { ...access, contacts });
    if (customerIssue) return customerIssue;
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
  return null;
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
  return businessImpactIssue(record.businessImpact);
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
    fields: installation ? ['edition', 'version', 'nodes'] : [],
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

export function requestFieldIsRequired(config: RequestConfig, fieldId: string, method: string): boolean {
  if (config.fieldRequiredWhen?.[fieldId] === 'onsite') {
    if (method.trim() === '现场') return true;
    try { const values: unknown = JSON.parse(method); return Array.isArray(values) && values.includes('现场'); } catch { return false; }
  }
  return config.fieldRequired?.[fieldId] !== false;
}

export function requestFieldIsVisible(config: RequestConfig, fieldId: string, method: string): boolean {
  return config.fieldRequiredWhen?.[fieldId] !== 'onsite' || requestFieldIsRequired(config, fieldId, method);
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
    if (key === 'businessObjects' || !requestFieldIsVisible(item.config, key, item.method)) continue;
    const value = (item.values[key] ?? '').trim();
    const empty = !value || value === '[]';
    if (empty && !requestFieldIsRequired(item.config, key, item.method)) continue;
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
    fieldNames: { ...fieldLabels, ...config.fieldNames },
    fieldOptions: Object.fromEntries(
      Object.entries(config.fieldOptions ?? {}).map(([fieldId, options]) => [
        fieldId,
        [...options],
      ]),
    ),
  };
}
export function itemIssues(item: RequestItem, audience: RequestAudience = 'internal', actorId?: string): string[] {
  const issues = itemBasicIssues(item);
  for (const requirement of item.config.materials.filter((m) => m.required)) {
    const material = item.materials.find(
      (m) => m.requirementId === requirement.id,
    );
    if (!visibleMaterialFiles(material, audience, actorId).length) issues.push(`上传${requirement.name}`);
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
      transaction.oncomplete = () => resolve((store === 'requests' ? request.result.map(normalizeStoredRequest) : request.result) as T[]);
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

export async function saveLocal(
  store: 'requests' | 'configs' | 'references',
  record: ServiceRequest | RequestConfig | { id: string; payload: unknown },
  access?: RequestAccessContext,
): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store === 'requests' ? ['requests', 'references'] : store, 'readwrite');
      const records = transaction.objectStore(store);
      if (store === 'requests') {
        let serviceRequest = normalizeStoredRequest(record as ServiceRequest);
        const current = records.get(serviceRequest.id);
        current.onsuccess = () => {
          const referenceRead = transaction.objectStore('references').getAll();
          referenceRead.onsuccess = () => {
            const savedWorkspace = referenceRead.result.find((entry: { id: string }) => entry.id === 'workspace')?.payload;
            const previous = current.result ? withRequestCollaborators(normalizeStoredRequest(current.result), savedWorkspace?.contacts ?? [], savedWorkspace?.customers ?? [], savedWorkspace?.users ?? []) : undefined;
            const creationIssue = access && !previous ? requestCreationAccessIssue(serviceRequest, access) ?? businessImpactIssue(serviceRequest.businessImpact) : null;
            if (creationIssue) {
              reject(new RequestIdentityError(creationIssue));
              transaction.abort();
              return;
            }
            if (access && (!canAccessRequest(previous ?? serviceRequest, access)
              || (!previous && serviceRequest.createdById !== access.actor.id))) {
              reject(new RequestIdentityError('无权访问此服务请求。'));
              transaction.abort();
              return;
            }
            const decisionIssue = previous ? customerDecisionIssue(serviceRequest, previous, access?.actor, access?.customerId) : null;
            const supplementIssue = supplementSaveIssue(serviceRequest, previous ?? { ...serviceRequest, operations: undefined }, access?.actor, access?.customerId, savedWorkspace?.users ?? []);
            const projectIssue = projectCreationSaveIssue(serviceRequest, previous, access?.actor);
            const issue = customerMaterialSaveIssue(serviceRequest, previous, access?.actor) ?? projectIssue ?? supplementIssue ?? decisionIssue
              ?? requestIdentityIssue(serviceRequest, previous, access?.actor);
            if (issue) {
              reject(new RequestIdentityError(issue));
              transaction.abort();
            } else {
              if (serviceRequest.status === '已取消') {
                serviceRequest = { ...serviceRequest, cancelledFromStatus: previous && previous.status !== '已取消' ? previous.status : requestCancellationStage(previous ?? serviceRequest) };
              }
              serviceRequest = attributeRequestMaterials(serviceRequest, previous, access?.actor);
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
                  const policyIssue = requestCollaborationSaveIssue(serviceRequest, previous, { contacts, users, customers }, access);
                  if (policyIssue) { reject(new RequestIdentityError(policyIssue)); transaction.abort(); return; }
                  const validationEvents = validationEventsForTransition(serviceRequest, previous);
                  try {
                    const failures = runValidationQueue(serviceRequest, { contacts, users, customers, businessObjects: workspacePayload?.businessObjects ?? [], services: workspacePayload?.services ?? [], currentActor: access?.actor }, validationEvents, referenceRead.result.find((entry: { id: string }) => entry.id === submissionRulesId)?.payload);
                    if (failures.length) throw new SubmissionValidationError(failures, validationEvents);
                  } catch (error) {
                    reject(error instanceof SubmissionValidationError ? error : new SubmissionValidationError([{ ruleId: 'queue', requirement: '校验队列', message: '校验队列执行失败，请刷新后重试。' }], validationEvents));
                    transaction.abort(); return;
                  }
                  if (!checkAssessment) { records.put(withRequestCollaborators(serviceRequest, contacts, customers, users)); return; }
                  const ownerIssue = changedPlan ? planSalesOwnerIssue(serviceRequest, workspacePayload?.customers ?? [], workspacePayload?.users ?? []) : null;
                  const lockIssue = ownerIssue ?? effortPricingSaveIssue(serviceRequest, previous, workspacePayload?.services ?? [], entitlementPricingContext(workspace.result, all.result.map(normalizeStoredRequest)))
                    ?? assessmentLockIssue(serviceRequest, all.result.map(normalizeStoredRequest), workspacePayload?.assets ?? [], workspacePayload?.businessObjects ?? []);
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
