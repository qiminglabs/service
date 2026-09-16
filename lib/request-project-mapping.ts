import { assignInitialProjectCollaborators } from './project-collaborator-assignment.ts';
import { projectRequestSnapshots } from './project-request-snapshot.ts';
import type { ProjectCollaboratorDirectory } from './service-project-collaborators';
import type { CustomerRef } from './service-requests';
import { parseCustomFieldMappings, mappedCustomValues, validateCustomFieldMappings, type CustomFieldMapping, type MappingFieldDirectory } from './custom-field-mapping.ts';
import type { ServiceRequest, RequestItem } from './service-requests';
import type { ProjectCreation, ServiceProject } from './request-projects';
import type { ServiceProjectRecord } from './service-projects';
import type { Partner } from './partner-directory';
import { projectServiceProviders } from './service-project-providers.ts';

export const requestProjectMappingId = 'request-project-mapping';
export const mappingRules = [
  { target: 'name', label: '项目名称', section: '请求字段', sources: [['title', '申请主题'], ['description', '申请说明']], initial: 'title' },
  { target: 'customerId', label: '客户', section: '请求字段', sources: [['customerId', '请求所属客户']], initial: 'customerId' },
  { target: 'expectedServiceDate', label: '期望服务时间', section: '请求字段', sources: [['expectedServiceDate', '期望服务时间']], initial: 'expectedServiceDate' },
  { target: 'note', label: '项目说明', section: '请求字段', sources: [['description', '申请说明'], ['title', '申请主题'], ['id', '请求编号'], ['', '不映射']], initial: 'description' },
  { target: 'serviceProviderId', label: '服务方', section: '请求字段', sources: [['smartx', '北京志凌海纳科技有限公司'], ['', '暂不指定']], initial: 'smartx' },
  { target: 'serviceId', label: '服务目录', section: '服务项', sources: [['serviceId', '申请项的服务目录']], initial: 'serviceId' },
  { target: 'method', label: '服务方式', section: '服务项', sources: [['method', '申请项的服务方式']], initial: 'method' },
  { target: 'description', label: '服务项说明', section: '服务项', sources: [['description', '申请项说明'], ['serviceName', '服务目录名称'], ['', '不映射']], initial: 'description' },
  { target: 'values', label: '服务项字段', section: '服务项', sources: [['values', '全部申请项字段（保留字段编号）']], initial: 'values' },
  { target: 'businessObjectIds', label: '业务对象', section: '服务项', sources: [['businessObjectIds', '申请项的业务对象及快照']], initial: 'businessObjectIds' },
  { target: 'materials', label: '项目材料', section: '材料', sources: [['materials', '对应申请项的全部附件、在线文档及材料要求']], initial: 'materials' },
] as const;
export type MappingSection = typeof mappingRules[number]['section'];
export type MappingTarget = typeof mappingRules[number]['target'];
export type RequestProjectMapping = {
  revision: number;
  customFields?: CustomFieldMapping[];
  fields: Record<MappingTarget, string>;
  readonly?: Partial<Record<MappingTarget, boolean>>;
  updatedAt?: string;
  updatedBy?: string;
};
export function defaultProjectMapping(): RequestProjectMapping {
  return { revision: 0, fields: Object.fromEntries(mappingRules.map(rule => [rule.target, rule.initial])) as RequestProjectMapping['fields'] };
}
export function parseProjectMapping(raw?: unknown): RequestProjectMapping {
  if (raw === undefined) return defaultProjectMapping();
  if (!raw || typeof raw !== 'object') throw new Error('请求转项目映射配置无效。');
  const config = raw as RequestProjectMapping;
  if (!Number.isSafeInteger(config.revision) || config.revision < 0 || !config.fields) throw new Error('请求转项目映射配置无效。');
  for (const rule of mappingRules) {
    if (!rule.sources.some(([source]) => source === config.fields[rule.target])) throw new Error(`${rule.label}的映射来源无效，请在配置后台修正。`);
  }
  if (Object.keys(config.fields).some(key => !mappingRules.some(rule => rule.target === key))) throw new Error('映射中包含不支持的目标字段。');
  if (config.readonly !== undefined && (!config.readonly || typeof config.readonly !== 'object' || Array.isArray(config.readonly)
    || Object.entries(config.readonly).some(([target, value]) => !mappingRules.some(rule => rule.target === target) || typeof value !== 'boolean')))
    throw new Error('转换后只读配置无效。');
  parseCustomFieldMappings(config.customFields);
  return structuredClone(config);
}
export function mappedProjectName(record: ServiceRequest, mapping: RequestProjectMapping) {
  return (mapping.fields.name === 'description' ? record.description : record.title)?.trim().slice(0, 100) || record.title;
}
export function mappedProjectItem(item: RequestItem, mapping: RequestProjectMapping): RequestItem {
  const result = structuredClone(item);
  result.description = mapping.fields.description === 'serviceName' ? item.serviceName : mapping.fields.description === '' ? '' : item.description;
  return result;
}
export function mappedServiceProject(record: ServiceRequest, project: ServiceProject, creation: ProjectCreation, raw: RequestProjectMapping, partners: Partner[] = [], directory?: MappingFieldDirectory & Partial<ProjectCollaboratorDirectory> & { customers?: CustomerRef[] }): ServiceProjectRecord {
  const mapping = parseProjectMapping(raw);
  if (directory) validateCustomFieldMappings(mapping.customFields, directory);
  const providerSource = mapping.fields.serviceProviderId === 'smartx' ? 'provider:smartx' : '';
  const providers = projectServiceProviders(partners).filter(provider => provider.id === providerSource || provider.name === providerSource);
  if (providerSource && providers.length !== 1) throw new Error('服务方配置无效，请重新配置映射。');
  const expectedServiceDate = project.expectedServiceDate || record.expectedServiceDate || '';
  const date = new Date(`${expectedServiceDate}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedServiceDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== expectedServiceDate) throw new Error(`请为“${project.name}”补充有效的期望服务时间。`);
  if (!record.customerId) throw new Error('请求缺少所属客户，无法创建项目。');
  const noteSource = mapping.fields.note as 'description' | 'title' | 'id' | '';
  return {
    id: project.id, name: project.name, note: project.note || (noteSource ? record[noteSource] || '' : ''),
    customerId: record.customerId, expectedServiceDate,
    ...(mapping.customFields?.length ? { customValues: mappedCustomValues(record, mapping.customFields) } : {}),
    serviceProviderId: providers[0]?.id ?? '', serviceProviderName: providers[0]?.name ?? '',
    status: '待启动', revision: 1, createdById: creation.actorId, createdBy: creation.actor,
    createdAt: creation.at, updatedAt: creation.at, createdSite: '内部系统', sourceServiceRequestId: record.id,
    items: project.workOrders.map(order => {
      const source = record.items.find(item => item.id === order.sourceItemId);
      if (!source) throw new Error('来源服务项已变化，请重新创建。');
      return mappedProjectItem(source, mapping);
    }),
    collaboratorAssignmentsVersion: 1,
    collaborators: directory ? assignInitialProjectCollaborators(record.customerId, { id: creation.actorId, name: creation.actor, role: 'SmartX 项目经理' }, { customers: directory.customers ?? [], users: directory.users ?? [], contacts: directory.contacts ?? [], partners: directory.partners ?? [], partnerUsers: directory.partnerUsers ?? [] }, {}, record) : { internal: [{ id: creation.actorId, name: creation.actor, details: '负责项目经理', assignmentRoles: ['项目经理'] }] },
    requestConversion: { mapping, assessmentSnapshot: projectRequestSnapshots(record, creation).get(project.id), workOrders: project.workOrders.map(({ id, sourceItemId, pricing }) => ({ id, sourceItemId, ...(pricing ? { pricing: structuredClone(pricing) } : {}) })) },
    operations: { meetings: [], worklogs: [], activities: [{ id: `request-conversion:${creation.id}:${project.id}`, at: creation.at, actorId: creation.actorId, actor: creation.actor, category: '项目', title: '由服务请求创建项目', detail: `来源请求：${record.id} · ${record.title}` }] },
  };
}
