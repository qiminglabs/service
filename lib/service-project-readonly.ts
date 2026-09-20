import type { RequestItem } from './service-requests';
import type { ServiceProjectRecord, ServiceProjectInput } from './service-projects';
import { mappingRules, type MappingTarget } from './request-project-mapping.ts';
import { projectCustomerConfirmationLocked } from './service-project-work-order-policy.ts';

export function projectFieldReadonly(project: ServiceProjectRecord | null | undefined, target: MappingTarget): boolean {
  if (target === 'name' && projectCustomerConfirmationLocked(project)) return true;
  if (target === 'customerId' && project && project.status !== '待启动') return true;
  if (target === 'customerId' && (project?.sourceServiceRequestId || project?.requestConversion)) return true;
  const mapping = project?.requestConversion?.mapping;
  return !!mapping?.fields[target] && mapping.readonly?.[target] === true;
}
export function projectCustomFieldReadonly(project: ServiceProjectRecord | null | undefined, target: string) {
  return project?.requestConversion?.mapping.customFields?.some(mapping => mapping.target.id === target && mapping.readonly) === true;
}
export function projectItemReadonly(project: ServiceProjectRecord | null | undefined, itemId: string, target: MappingTarget): boolean {
  return !!project?.requestConversion?.workOrders.some(order => order.sourceItemId === itemId) && projectFieldReadonly(project, target);
}
export function projectItemReadonlyTargets(project: ServiceProjectRecord | null | undefined, itemId: string): MappingTarget[] {
  return [...mappingRules.filter(rule => rule.section !== '请求字段' && projectItemReadonly(project, itemId, rule.target)).map(rule => rule.target), ...(projectItemReadonly(project, itemId, 'values') ? ['values' as const] : [])];
}
export function projectCustomerReadonly(project: ServiceProjectRecord | null | undefined): boolean {
  return projectFieldReadonly(project, 'customerId') || !!project?.items?.some(item =>
    (projectItemReadonly(project, item.id, 'businessObjectIds') && item.businessObjectIds.length > 0)
    || (projectItemReadonly(project, item.id, 'materials') && item.materials.length > 0));
}
export function assertProjectFieldsWritable(previous: ServiceProjectRecord, input: ServiceProjectInput) {
  if (projectCustomerConfirmationLocked(previous) && input.name !== previous.name)
    throw new Error('客户已确认项目，项目名称已锁定，不能修改。');
  for (const target of ['name', 'expectedServiceDate', 'customerId', 'note', 'serviceProviderId'] as const) {
    const value = target === 'serviceProviderId' ? input[target] ?? previous[target] ?? '' : input[target];
    if (projectFieldReadonly(previous, target) && value !== (previous[target] ?? ''))
      throw new Error(`${mappingRules.find(rule => rule.target === target)!.label}已按转换映射设为只读，不能修改。`);
  }
  for (const mapping of previous.requestConversion?.mapping.customFields ?? []) {
    if (mapping.readonly && input.customValues !== undefined && (input.customValues[mapping.target.id] ?? '') !== (previous.customValues?.[mapping.target.id] ?? '')) throw new Error(`${mapping.target.name}已按转换映射设为只读，不能修改。`);
  }
  if (previous.customerId !== input.customerId && projectCustomerReadonly(previous))
    throw new Error('客户关联的业务对象或材料已设为只读，不能通过更换客户清空。');
}
const itemKeys: Partial<Record<MappingTarget, (keyof RequestItem)[]>> = {
  serviceId: ['serviceId', 'serviceName'], method: ['method', 'methodFieldType'], description: ['description'],
  values: ['values'], businessObjectIds: ['businessObjectIds'], materials: ['materials'],
};
export function assertProjectItemsWritable(project: ServiceProjectRecord, items: RequestItem[]) {
  for (const previous of project.items ?? []) {
    const targets = projectItemReadonlyTargets(project, previous.id);
    if (!targets.length) continue;
    const next = items.find(item => item.id === previous.id);
    if (!next) throw new Error('由请求带入的服务项包含只读字段，不能移除。');
    for (const target of targets) {
      if (itemKeys[target]?.some(key => JSON.stringify(previous[key]) !== JSON.stringify(next[key])))
        throw new Error(`${mappingRules.find(rule => rule.target === target)?.label ?? '服务项字段'}已按转换映射设为只读，不能修改。`);
    }
    // Form definitions can hide or replace the locked values and material requirements.
    if (JSON.stringify(previous.config) !== JSON.stringify(next.config)) throw new Error('服务项包含只读字段，不能更换其字段或材料定义。');
  }
}
// Keep canonical snapshots and file bytes when editing another, unlocked field.
export function preserveProjectReadonlySnapshots(project: ServiceProjectRecord, items: RequestItem[]): RequestItem[] {
  return items.map(item => {
    const previous = project.items?.find(source => source.id === item.id);
    if (!previous) return item;
    return { ...item,
      ...(projectItemReadonly(project, item.id, 'businessObjectIds') ? { businessObjectSnapshot: structuredClone(previous.businessObjectSnapshot) } : {}),
      ...(projectItemReadonly(project, item.id, 'materials') ? { materials: structuredClone(previous.materials) } : {}),
    };
  });
}
