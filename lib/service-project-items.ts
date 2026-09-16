import { assertProjectItemsWritable, preserveProjectReadonlySnapshots, projectItemReadonly } from './service-project-readonly.ts';
import {
  clearHiddenItemFields,
  copyRequestItem,
  itemBasicIssues,
  serviceAvailableForRequest,
  snapshotItemBusinessObjects,
  type CatalogService,
  type ObjectRef,
  type RequestItem,
  type ServiceRequest,
  type CatalogFormAudience,
  type ItemMaterial,
  attributeRequestMaterials,
} from './service-requests.ts';
import { projectMaterialRecord } from './service-project-materials.ts';
import { requestMaterialGroup, saveRequestMaterialGroup, synchronizeRequestMaterials } from './request-materials.ts';
import {
  canManageServiceProjects,
  projectItemAudience,
  type ServiceProjectRecord,
} from './service-projects.ts';
import type { OperationActor } from './request-operations';

export type ProjectItemContext = {
  services: CatalogService[];
  businessObjects: ObjectRef[];
  requests: ServiceRequest[];
};
export type ProjectItemChange =
  | { type: 'save'; item: RequestItem }
  | { type: 'materials'; id: string; material: ItemMaterial }
  | { type: 'copy' | 'remove'; id: string };

export function prepareProjectItem(
  item: RequestItem,
  customerId: string,
  context: ProjectItemContext,
  audience: CatalogFormAudience = 'internal',
): RequestItem {
  const clean = clearHiddenItemFields(item);
  const missing = itemBasicIssues(clean);
  if (missing.length)
    throw new Error(`${item.serviceName}：请补充${missing.join('、')}`);
  const service = context.services.find(
    (service) => service.id === item.serviceId,
  );
  if (!service || !serviceAvailableForRequest(service, audience))
    throw new Error('该服务目录已停用、不存在或未开放给当前站点，请重新选择。');
  return snapshotItemBusinessObjects(
    clean,
    context.businessObjects,
    service.priceUnit,
    context.requests,
    '',
    customerId,
  );
}

export function changeProjectItems(
  items: RequestItem[],
  change: ProjectItemChange,
  customerId: string,
  context: ProjectItemContext,
  audience: CatalogFormAudience = 'internal',
  actor?: OperationActor,
): RequestItem[] {
  const materialRecord = projectMaterialRecord({ id: '', customerId, items });
  const synchronize = (next: RequestItem[]) => synchronizeRequestMaterials({ ...materialRecord, items: next }).items;
  if (change.type === 'materials') {
    if (!actor?.id) throw new Error('请先选择材料操作人。');
    return attributeRequestMaterials(
      saveRequestMaterialGroup(materialRecord, change.id, change.material.requirementId, change.material, actor),
      materialRecord, actor,
    ).items;
  }
  if (change.type === 'save') {
    const item = prepareProjectItem(change.item, customerId, context, audience);
    return synchronize(items.some((previous) => previous.id === item.id)
      ? items.map((previous) => (previous.id === item.id ? item : previous))
      : [...items, item]);
  }
  const index = items.findIndex((item) => item.id === change.id);
  if (index < 0) throw new Error('服务项不存在，请刷新后重试。');
  if (change.type === 'remove')
    return synchronize(items).filter((item) => item.id !== change.id);
  if (
    !context.services.some(
      (service) =>
        service.id === items[index].serviceId &&
        serviceAvailableForRequest(service, audience),
    )
  )
    throw new Error('该目录已停用或未开放给当前站点，不能复制服务项。');
  const copy = copyRequestItem(items[index]);
  return synchronize([...items.slice(0, index + 1), copy, ...items.slice(index + 1)]);
}

export function editProjectItems(
  previous: ServiceProjectRecord,
  change: ProjectItemChange,
  actor: OperationActor,
  context: ProjectItemContext,
): ServiceProjectRecord {
  if (!canManageServiceProjects(actor, previous))
    throw new Error('当前身份无权维护此服务项目的服务项。');
  if (['已完成', '已取消'].includes(previous.status))
    throw new Error('已结束的项目不可编辑。');
  if (change.type === 'materials') {
    const group = requestMaterialGroup(projectMaterialRecord(previous), change.id, change.material.requirementId);
    if (group?.members.some(member => projectItemReadonly(previous, member.item.id, 'materials')))
      throw new Error('项目材料已按转换映射设为只读，不能修改。');
  }
  if (change.type === 'save') assertProjectItemsWritable(previous, (previous.items ?? []).map(item => item.id === change.item.id ? change.item : item));
  const items = changeProjectItems(previous.items ?? [], change, previous.customerId, context, projectItemAudience(actor), actor);
  assertProjectItemsWritable(previous, items);
  return {
    ...previous,
    items: preserveProjectReadonlySnapshots(previous, items),
    revision: previous.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function resetProjectItemCustomer(items: RequestItem[]): RequestItem[] {
  return items.map((item) => ({
    ...item,
    businessObjectIds: [],
    businessObjectSnapshot: undefined,
    materials: [],
  }));
}
