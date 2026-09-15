import { materialFiles, requestMaterialFiles, requestMaterialsCustomerVisible, withMaterialFiles } from './service-requests.ts';
import type { ItemMaterial, MaterialRequirement, RequestConfig, RequestItem, ServiceRequest, StoredFile, RequestAudience } from './service-requests';
import type { OperationActor } from './request-operations';
import { materialRequiredFor } from './material-requirements.ts';
import { requestTypeOf } from './request-types.ts';

export async function prepareMaterialDeduplication(config: RequestConfig): Promise<RequestConfig> {
  const materials = await Promise.all(config.materials.map(async requirement => {
    if (!requirement.deduplicate) return requirement;
    let templateDigest: string | undefined;
    if (requirement.template?.blob) {
      const bytes = await requirement.template.blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      templateDigest = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    }
    const next = { ...requirement, templateDigest };
    if (!materialTemplateKeys(next).length) throw new Error(`${requirement.name}：启用去重前，请上传文件模板或填写在线文档模板链接。`);
    return next;
  }));
  return { ...config, materials };
}

function templateUrlKey(value?: string) {
  if (!value?.trim()) return undefined;
  try {
    const url = new URL(value.trim(), 'https://request-template.local');
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.hash = '';
    return `url:${url.href}`;
  } catch { return undefined; }
}
export function materialTemplateKeys(requirement: MaterialRequirement): string[] {
  if (!requirement.deduplicate) return [];
  return [requirement.templateDigest ? `file:${requirement.templateDigest}` : undefined,
    templateUrlKey(requirement.templateUrl), templateUrlKey(requirement.onlineTemplateUrl)]
    .filter((value): value is string => !!value);
}

export type RequestMaterialMember = { item: RequestItem; index: number; requirement: MaterialRequirement };
export type RequestMaterialGroup = { key: string; members: RequestMaterialMember[]; requirement: MaterialRequirement; material: ItemMaterial; shared: boolean };

export function requestMaterialGroups(record: Pick<ServiceRequest, 'items' | 'requestType'>): RequestMaterialGroup[] {
  const entries = record.items.flatMap((item, index) => item.config.materials.map(requirement => ({ item, index, requirement })));
  const parents = entries.map((_, index) => index);
  const find = (index: number): number => parents[index] === index ? index : (parents[index] = find(parents[index]));
  const identities = new Map<string, number>();
  entries.forEach((entry, index) => materialTemplateKeys(entry.requirement).forEach(key => {
    const match = identities.get(key);
    if (match !== undefined) parents[find(index)] = find(match);
    else identities.set(key, index);
  }));
  const grouped = new Map<number, RequestMaterialMember[]>();
  entries.forEach((entry, index) => { const root = find(index); grouped.set(root, [...(grouped.get(root) ?? []), entry]); });
  return [...grouped.values()].map(members => {
    const first = members[0];
    const files = new Map<string, StoredFile>();
    for (const member of members) for (const file of materialFiles(member.item.materials.find(material => material.requirementId === member.requirement.id))) {
      const old = files.get(file.id);
      if (!old || old.uploadedAt < file.uploadedAt) files.set(file.id, file);
    }
    return { key: `${first.item.id}:${first.requirement.id}`, members, shared: members.length > 1,
      requirement: { ...first.requirement,
        required: members.some(member => materialRequiredFor(member.requirement, requestTypeOf(record))),
        requiredByType: {
          '售前评估': members.some(member => materialRequiredFor(member.requirement, '售前评估')),
          '服务交付': members.some(member => materialRequiredFor(member.requirement, '服务交付')),
        } },
      material: { requirementId: first.requirement.id, files: [...files.values()] } };
  }).sort((a, b) => Number(b.shared) - Number(a.shared));
}

export function requestMaterialGroup(record: Pick<ServiceRequest, 'items' | 'requestType'>, itemId: string, requirementId: string) {
  return requestMaterialGroups(record).find(group => group.members.some(member => member.item.id === itemId && member.requirement.id === requirementId));
}

export function materialDialogItem(group: RequestMaterialGroup): RequestItem {
  const item = group.members[0].item;
  return { ...item, serviceName: group.shared ? `共用材料 · ${new Set(group.members.map(member => member.item.id)).size} 个服务项` : item.serviceName,
    materials: [group.material] };
}

// Retain the existing item-material storage shape, sharing file IDs and bytes.
// Synchronization makes removing one service item safe for the remaining items.
export function synchronizeRequestMaterials(record: ServiceRequest): ServiceRequest {
  const entries = new Map<string, ItemMaterial>();
  for (const group of requestMaterialGroups(record).filter(group => group.shared)) {
    for (const member of group.members) entries.set(`${member.item.id}:${member.requirement.id}`, { ...group.material, requirementId: member.requirement.id });
  }
  if (!entries.size) return record;
  return { ...record, items: record.items.map(item => ({ ...item, materials: [
    ...item.materials.filter(material => !entries.has(`${item.id}:${material.requirementId}`)),
    ...item.config.materials.flatMap(requirement => { const material = entries.get(`${item.id}:${requirement.id}`); return material ? [material] : []; }),
  ] })) };
}

export function saveRequestMaterialGroup(record: ServiceRequest, itemId: string, requirementId: string, material: ItemMaterial, actor: OperationActor): ServiceRequest {
  if (actor.role === '客户' && !requestMaterialsCustomerVisible(record)) throw new Error('内部发起的申请材料仅内部人员可操作。');
  const group = requestMaterialGroup(record, itemId, requirementId);
  if (!group) throw new Error('材料要求已变化，请重新打开材料。');
  const oldFiles = materialFiles(group.material);
  let files = materialFiles(material);
  if (actor.role === '客户') {
    const own = (file: StoredFile) => file.uploaderAudience === 'customer' && file.uploadedById === actor.id;
    // Hidden files cannot be removed, replaced, or exposed by a customer's save.
    files = [...oldFiles.filter(file => !own(file)), ...files.filter(own).filter(file => !oldFiles.some(old => old.id === file.id && !own(old)))];
  }
  const members = new Set(group.members.map(member => `${member.item.id}:${member.requirement.id}`));
  return { ...record, items: record.items.map(item => ({ ...item, materials: [
    ...item.materials.filter(entry => !members.has(`${item.id}:${entry.requirementId}`)),
    ...item.config.materials.filter(requirement => members.has(`${item.id}:${requirement.id}`)).map(requirement => withMaterialFiles({ requirementId: requirement.id }, files)),
  ] })) };
}

export function requestMaterialIssues(record: ServiceRequest, audience: RequestAudience = 'internal'): string[] {
  if (audience === 'customer' && !requestMaterialsCustomerVisible(record)) return [];
  return requestMaterialGroups(record).filter(group => group.requirement.required && !requestMaterialFiles(record, group.material, audience).length)
    .map(group => `${group.shared ? '共用材料' : `服务项 ${group.members[0].index + 1}`}：上传${group.requirement.name}`);
}
