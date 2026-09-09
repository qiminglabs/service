import { effortPricingSaveIssue } from './request-pricing.ts';
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
  return normalizeRequestConfig(
    configs.find((config) => config.serviceId === service.id) ?? defaultConfig(service),
  );
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
  product?: string;
  sn?: string;
};
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
  values: Record<string, string>;
  config: RequestConfig;
  materials: ItemMaterial[];
};
export type InternalUser = {
  id: string;
  name: string;
  email: string;
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
export function withRequestContact(record: ServiceRequest, contacts: ContactRef[]): ServiceRequest {
  if (!record.contactId || record.externalCollaborators?.some(person => person.contactId === record.contactId)) return record;
  const contact = contacts.find(person => person.id === record.contactId && person.customerId === record.customerId);
  if (!contact) return record;
  return { ...record, externalCollaborators: [
    ...reconcileExternalCollaborators([contact]).map(person => ({ ...person, source: 'request-contact' as const })),
    ...(record.externalCollaborators ?? []),
  ] };
}
export function requestContactRemovalIssue(record: ServiceRequest, previous?: ServiceRequest): string | null {
  if (record.contactId && previous?.contactId === record.contactId
    && previous.externalCollaborators?.some(person => person.contactId === record.contactId)
    && !record.externalCollaborators?.some(person => person.contactId === record.contactId))
    return '客户联系人为固定客户协作人，不允许移除。';
  return null;
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
export function requestProgressSteps(status: RequestStatus) {
  if (status === '已取消') return [{ label: '已取消', state: 'current' }];
  const current = requestStatuses.indexOf(status);
  return requestStatuses
    .filter((step) => step !== '已取消')
    .map((label, index) => ({
      label,
      state:
        current === index
          ? 'current'
          : current > index
            ? 'complete'
            : 'upcoming',
    }));
}
export type ServiceRequest = {
  id: string;
  title: string;
  customerId: string;
  contactId: string;
  description: string;
  expectedServiceDate?: string;
  owner: string;
  createdBy?: string;
  createdById?: string;
  externalCollaborators?: ExternalCollaborator[];
  internalParticipants?: InternalParticipant[];
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  items: RequestItem[];
  operations?: RequestOperations;
};
export function itemDisplayFields(item: RequestItem, names: Record<string, string> = {}, objects: Pick<ObjectRef, 'id' | 'name'>[] = []): { key: string; label: string; value: string }[] {
  const display = (raw: string | undefined) => {
    const value = (raw ?? '').trim();
    if (value.startsWith('[')) {
      try {
        const values: unknown = JSON.parse(value);
        if (Array.isArray(values)) return values.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim()).join('、') || '未填写';
      } catch { /* Preserve legacy text. */ }
    }
    return value || '未填写';
  };
  const keys = [...new Set(['method', ...item.config.fields])].filter(key => key !== 'description' && key !== 'businessObjects');
  const fields = keys.map(key => ({ key, label: names[key] || item.config.fieldNames?.[key] || fieldLabels[key] || (key === 'method' ? '服务方式' : key), value: display(key === 'method' ? item.method : item.values[key]) }));
  if (businessObjectsEnabled(item.config)) fields.push({ key: 'businessObjects', label: names.businessObjects || '业务对象', value: item.businessObjectIds.map(id => objects.find(object => object.id === id)?.name || id).join('、') || '未关联' });
  return fields;
}
export function itemSummary(item: RequestItem): string {
  const fields = [
    ['服务方式', item.method],
    ['产品版本', item.values.edition],
    ['节点数', item.values.nodes],
    ['产品版本号', item.values.version],
  ];
  return fields
    .flatMap(([label, raw]) => {
      let value = (raw ?? '').trim();
      if (value.startsWith('[')) {
        try {
          const options: unknown = JSON.parse(value);
          if (Array.isArray(options))
            value = options
              .filter((option) => typeof option === 'string' && option.trim())
              .map((option) => option.trim())
              .join('、');
        } catch {
          /* Keep legacy text values readable. */
        }
      }
      return value ? [`${label}：${value}`] : [];
    })
    .join(' · ');
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
    contactId,
    description: '',
    expectedServiceDate: '',
    owner,
    createdBy: owner,
    ...(createdById ? { createdById } : {}),
    externalCollaborators: [],
    internalParticipants: createdById && creatorRole && isInternal(creatorRole)
      ? [{ userId: createdById, name: owner }]
      : creatorRole === '客户' && customerOwner?.status === '启用'
        ? [{ userId: customerOwner.id, name: customerOwner.name }]
        : [],
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
  if (existing) {
    if (existing.customerId !== record.customerId)
      return '服务请求创建后不支持修改客户。';
    if (
      (existing.createdBy ?? existing.owner) !==
        (record.createdBy ?? record.owner) ||
      existing.createdAt !== record.createdAt
      || existing.createdById !== record.createdById
    )
      return '创建人和创建时间不支持修改。';
    if (existing.status === '草稿' && actor?.role === '客户' && !canCheckRequestCompleteness(existing, actor)) {
      const fields = ['title', 'contactId', 'description', 'expectedServiceDate', 'items', 'status', 'submittedAt'] as const;
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
      const frozen = ['title', 'contactId', 'description', 'expectedServiceDate'] as const;
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
  if (!record.contactId?.trim()) return '请选择客户联系人。';
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
  return ['SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师'].includes(actor.role);
}

export function requestCreationAccessIssue(record: ServiceRequest, access: RequestAccessContext): string | null {
  if (!canCreateRequest(access)) return '当前身份不能创建服务请求。';
  if (record.createdById !== access.actor.id) return '创建人必须是当前身份。';
  if (access.actor.role === '客户' && record.customerId !== access.customerId) return '只能为当前所属客户创建服务请求。';
  return null;
}

export function canAccessRequest(record: ServiceRequest, { actor, directory, customerId, contacts }: RequestAccessContext): boolean {
  if (!actor.id) return false;
  if (actor.role === 'SmartX 系统管理员' || actor.role === 'SmartX 项目经理') return true;
  if (record.createdById === actor.id) return true;
  const reachedCustomerConfirmation = ['待确认', '待受理', '已转服务项目'].includes(record.status)
    || Boolean(record.operations?.assessment?.confirmation)
    || Boolean(record.operations?.customerDecisions?.length)
    || Boolean(record.operations?.assessmentHistory?.some(assessment => assessment.confirmation))
    || Boolean(record.operations?.activities?.some(event => event.title === '发起客户确认'));
  if (actor.role === '客户' && actor.id === record.contactId
    && customerId === record.customerId && reachedCustomerConfirmation
    && contacts?.some(contact => contact.id === actor.id && contact.customerId === record.customerId && contact.status === '启用')) return true;

  if (['SmartX 销售经理', 'SmartX 服务工程师'].includes(actor.role)) {
    const assessment = record.operations?.assessment;
    if (assessment?.plans.some(plan => plan.salesId === actor.id)
      || assessment?.approvals.some(approval => approval.approverId === actor.id)) return true;
  }
  if (record.internalParticipants?.some((person) => person.userId === actor.id)
    || record.externalCollaborators?.some((person) => person.contactId === actor.id
      && (person.source !== 'request-contact' || (reachedCustomerConfirmation && actor.role === '客户'
        && customerId === record.customerId && contacts?.some(contact => contact.id === actor.id && contact.customerId === record.customerId && contact.status === '启用'))))) return true;
  if (record.createdById) return false;
  // Legacy records stored a display name. Ambiguous names and old role labels
  // cannot establish ownership; administrators and project managers can still see these records.
  const creator = record.createdBy ?? record.owner;
  const matches = new Set(directory.filter((person) => person.name === creator).map((person) => person.id));
  return matches.size === 1 && matches.has(actor.id);
}

export function canAddExternalCollaborators(record: ServiceRequest, access: RequestAccessContext): boolean {
  return canAccessRequest(record, access) && ['客户', 'SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师'].includes(access.actor.role);
}

export function customerCollaborationIssue(record: ServiceRequest, existing: ServiceRequest, access: RequestAccessContext): string | null {
  const removalIssue = requestContactRemovalIssue(record, existing);
  if (removalIssue) return removalIssue;
  const before = existing.externalCollaborators ?? [];
  const after = record.externalCollaborators ?? [];
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (!canAddExternalCollaborators(existing, access)) return '无权添加客户协作人。';
  if (access.actor.role === '客户' && before.some((person) => !after.some((next) => JSON.stringify(next) === JSON.stringify(person)))) return '客户只能添加客户协作人，不能移除或修改已有协作人。';
  if (new Set(after.map((person) => person.contactId)).size !== after.length) return '客户协作人不能重复。';
  const additions = after.filter((person) => !before.some((old) => old.contactId === person.contactId));
  if (additions.some((person) => !access.contacts?.some((contact) => contact.id === person.contactId && contact.customerId === record.customerId && (access.actor.role !== '客户' || contact.customerId === access.customerId) && (contact.status === '启用' || (person.source === 'request-contact' && person.contactId === record.contactId))))) return '只能添加当前客户已启用的联系人。';
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
  if (
    !refs.contacts.some(
      (contact) =>
        contact.id === record.contactId &&
        contact.customerId === record.customerId &&
        contact.status === '启用',
    )
  ) {
    return '请选择该客户下有效且已启用的联系人。';
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
      businessObjects: { enabled: false, required: false },
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
  const snapshot = structuredClone(normalizeRequestConfig(config));
  return {
    id: crypto.randomUUID(),
    serviceId: service.id,
    serviceName: service.name,
    priceCoefficient: service.priceCoefficient,
    methods: [...service.deliveryMethods],
    method: service.deliveryMethods[0] ?? '',
    description: '',
    businessObjectIds: [],
    values: Object.fromEntries(snapshot.fields.map((fieldId) => [fieldId, ''])),
    config: snapshot,
    materials: [],
  };
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
    if (key === 'businessObjects') continue;
    const value = (item.values[key] ?? '').trim();
    const empty = !value || value === '[]';
    if (empty && item.config.fieldRequired?.[key] === false) continue;
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
export function requestIssues(
  request: ServiceRequest,
  refs: {
    customers: CustomerRef[];
    contacts: ContactRef[];
    businessObjects: ObjectRef[];
    services: CatalogService[];
    audience?: RequestAudience;
    currentActor?: OperationActor;
  },
): string[] {
  const issues: string[] = [];
  if (!request.title.trim()) issues.push('填写申请主题');
  if (
    !refs.customers.some(
      (c) => c.id === request.customerId && c.status === '启用',
    )
  )
    issues.push('选择有效客户');
  if (
    !refs.contacts.some(
      (c) =>
        c.id === request.contactId &&
        c.customerId === request.customerId &&
        c.status === '启用',
    )
  )
    issues.push('选择该客户的有效联系人');
  if (!request.items.length) issues.push('至少添加一个申请项');
  request.items.forEach((item, index) => {
    const prefix = `申请项 ${index + 1}：`;
    issues.push(...itemIssues(item, refs.audience, refs.currentActor?.id).map((issue) => prefix + issue));
    const service = refs.services.find((s) => s.id === item.serviceId);
    if (!service || service.status !== '已启用')
      issues.push(prefix + '服务目录已停用或不存在');
    else if (refs.audience && !serviceAvailableForRequest(service, refs.audience))
      issues.push(prefix + '服务目录未开放给当前申请站点');
    if (
      businessObjectsEnabled(item.config) &&
      item.businessObjectIds.some(
        (id) =>
          !refs.businessObjects.some(
            (o) =>
              o.id === id &&
              o.customerId === request.customerId &&
              matchesObjectProduct(o, item.config) &&
              o.status === '启用',
          ),
      )
    )
      issues.push(
        prefix + '业务对象不属于当前客户、已停用、不符合可搜索产品或不存在',
      );
  });
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
          const previous = current.result ? normalizeStoredRequest(current.result) : undefined;
          const creationIssue = access && !previous ? requestCreationAccessIssue(serviceRequest, access) : null;
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
          const supplementIssue = supplementSaveIssue(serviceRequest, previous ?? { ...serviceRequest, operations: undefined }, access?.actor, access?.customerId);
          const projectIssue = projectCreationSaveIssue(serviceRequest, previous, access?.actor);
          const issue = customerMaterialSaveIssue(serviceRequest, previous, access?.actor) ?? requestContactRemovalIssue(serviceRequest, previous) ?? projectIssue ?? supplementIssue ?? decisionIssue ?? (access ? customerCollaborationIssue(serviceRequest, previous ?? { ...serviceRequest, externalCollaborators: [] }, access) : null)
            ?? requestIdentityIssue(serviceRequest, previous, access?.actor);
          if (issue) {
            reject(new RequestIdentityError(issue));
            transaction.abort();
          } else {
            serviceRequest = attributeRequestMaterials(serviceRequest, previous, access?.actor);
            const changedPlan = JSON.stringify(currentPlan(serviceRequest)) !== JSON.stringify(previous ? currentPlan(previous) : undefined);
            const startingConfirmation = serviceRequest.operations?.assessment?.confirmation && !previous?.operations?.assessment?.confirmation;
            const changedEffort = JSON.stringify(serviceRequest.operations?.assessment?.effort) !== JSON.stringify(previous?.operations?.assessment?.effort);
            const checkAssessment = changedPlan || startingConfirmation || changedEffort;

            const all = records.getAll();
            all.onsuccess = () => {
              const workspace = transaction.objectStore('references').get('workspace');
              workspace.onsuccess = () => {
                const removalIssue = customerOwnerRemovalIssue(serviceRequest, previous, workspace.result?.payload?.customers ?? []);
                if (removalIssue) { reject(new RequestIdentityError(removalIssue)); transaction.abort(); return; }
                if (!checkAssessment) { records.put(withRequestContact(serviceRequest, workspace.result?.payload?.contacts ?? [])); return; }
                const ownerIssue = changedPlan ? planSalesOwnerIssue(serviceRequest, workspace.result?.payload?.customers ?? [], workspace.result?.payload?.users ?? []) : null;
                const lockIssue = ownerIssue ?? effortPricingSaveIssue(serviceRequest, previous, workspace.result?.payload?.services ?? [])
                  ?? assessmentLockIssue(serviceRequest, all.result.map(normalizeStoredRequest), workspace.result?.payload?.assets ?? []);
                if (lockIssue) { reject(new RequestIdentityError(lockIssue)); transaction.abort(); }
                else records.put(withRequestContact(serviceRequest, workspace.result?.payload?.contacts ?? []));
              };
            };
          }
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
