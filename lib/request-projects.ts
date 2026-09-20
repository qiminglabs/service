import { isDemoAdministrator } from './demo-permissions.ts';
import { defaultProjectMapping, parseProjectMapping, type RequestProjectMapping } from './request-project-mapping.ts';
import type { EffortPricingLine } from './request-pricing';
import type { ServiceRequest, RequestItem } from './service-requests';
import { operationsOf, type OperationActor } from './request-operations.ts';

export type ProjectGroup = { id: string; name: string; note: string; expectedServiceDate?: string; itemIds: string[] };
export type ServiceWorkOrder = {
  id: string; projectId: string; requestId: string; sourceItemId: string;
  serviceId: string; serviceName: string; status: '待排期'; item: RequestItem; pricing?: EffortPricingLine;
};
export type ServiceProject = {
  id: string; name: string; note: string; requestId: string; customerId: string;
  managerId: string; manager: string; expectedServiceDate?: string; createdAt: string; status: '待启动'; workOrders: ServiceWorkOrder[];
};
export type ProjectCreation = { id: string; at: string; actorId: string; actor: string; projects: ServiceProject[]; mapping?: RequestProjectMapping };
export const serviceProjectCreationEnabled: boolean = true;
export const serviceProjectPendingMessage = '服务项目待开发，暂不可创建。';
export function isProjectCreationEligible(record: ServiceRequest, actor: OperationActor) {
  return record.status === '待受理' && Boolean(actor.id)
    && (isDemoAdministrator(actor) || actor.role === 'SmartX 项目经理' && (!record.operations?.assessment?.managerId || record.operations.assessment.managerId === actor.id))
    && !record.operations?.projectCreation;
}
export function canCreateServiceProjects(record: ServiceRequest, actor: OperationActor) {
  return serviceProjectCreationEnabled && isProjectCreationEligible(record, actor);
}
export function projectSplitIssue(record: ServiceRequest, groups: ProjectGroup[]): string | null {
  if (!record.items.length) return '请求没有申请项，无法创建项目。';
  if (!groups.length) return '请至少创建一个项目。';
  if (new Set(groups.map(group => group.id)).size !== groups.length || groups.some(group => !group.id)) return '项目编号重复或无效。';
  const seen = new Set<string>();
  for (const [index, group] of groups.entries()) {
    if (!group.name.trim()) return `请填写项目 ${index + 1} 的名称。`;
    if (group.name.trim().length > 100) return `项目 ${index + 1} 的名称不能超过 100 字。`;
    if (!group.itemIds.length) return `“${group.name}”尚未分配申请项，请分配或移除空项目。`;
    for (const id of group.itemIds) {
      if (!record.items.some(item => item.id === id)) return '分组中有不属于当前请求的申请项。';
      if (seen.has(id)) return '同一申请项只能分配到一个项目。';
      seen.add(id);
    }
  }
  if (seen.size !== record.items.length) return '请将全部申请项分配到项目。';
  return null;
}
export function createServiceProjects(record: ServiceRequest, actor: OperationActor, groups: ProjectGroup[], id = crypto.randomUUID(), at = new Date().toISOString(), mapping = defaultProjectMapping()): ServiceRequest {
  if (!serviceProjectCreationEnabled) throw new Error(serviceProjectPendingMessage);
  if (!canCreateServiceProjects(record, actor)) throw new Error('仅待受理请求的负责项目经理可以创建服务项目，且不可重复创建。');
  const issue = projectSplitIssue(record, groups);
  if (issue) throw new Error(issue);
  if (!id || !Number.isFinite(Date.parse(at))) throw new Error('创建信息无效。');
  mapping = parseProjectMapping(mapping);
  let orderNumber = 0;
  const projects: ServiceProject[] = groups.map(group => ({
    id: group.id, name: group.name.trim(), note: group.note.trim(), requestId: record.id, customerId: record.customerId,
    managerId: record.operations?.assessment?.managerId || actor.id, manager: record.operations?.assessment?.manager || actor.name, ...(group.expectedServiceDate ? { expectedServiceDate: group.expectedServiceDate } : {}), createdAt: at, status: '待启动',
    workOrders: group.itemIds.map(itemId => {
      const item = record.items.find(item => item.id === itemId)!;
      const pricing = record.operations?.assessment?.effort?.lines?.find(line => line.itemId === itemId);
      return { id: `WO-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}-${String(++orderNumber).padStart(3, '0')}`, projectId: group.id,
        requestId: record.id, sourceItemId: item.id, serviceId: item.serviceId, serviceName: item.serviceName, status: '待排期', item: structuredClone(item), ...(pricing ? { pricing: structuredClone(pricing) } : {}) };
    }),
  }));
  const ops = operationsOf(record);
  return { ...record, status: '已转服务项目', updatedAt: at, operations: { ...ops,
    projectCreation: { id, at, actorId: actor.id, actor: actor.name, projects, mapping },
    activities: [...ops.activities, { id: `project-creation:${id}`, at, actorId: actor.id, actor: actor.name, category: '受理', title: '创建服务项目', detail: `创建 ${projects.length} 个项目、${orderNumber} 个工单。\n${projects.map(project => `${project.name}：${project.workOrders.map(order => order.serviceName).join('、')}`).join('\n')}` }],
  } };
}
export function projectCreationSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, actor?: OperationActor, mapping = defaultProjectMapping()): string | null {
  const creation = next.operations?.projectCreation, existing = previous?.operations?.projectCreation;
  if (JSON.stringify(creation) === JSON.stringify(existing)) {
    if (previous?.status === '待受理' && next.status === '已转服务项目') return serviceProjectCreationEnabled ? '请通过创建服务项目完成受理。' : serviceProjectPendingMessage;
    return null;
  }
  if (!serviceProjectCreationEnabled) return serviceProjectPendingMessage;
  if (!previous || !actor || !creation || existing) return '已生成的项目和工单不能在请求中覆盖或重复创建。';
  try {
    const expected = createServiceProjects(previous, actor, creation.projects.map(project => ({ id: project.id, name: project.name, note: project.note, expectedServiceDate: project.expectedServiceDate, itemIds: project.workOrders.map(order => order.sourceItemId) })), creation.id, creation.at, mapping);
    if (JSON.stringify({ ...expected, updatedAt: next.updatedAt }) !== JSON.stringify(next)) return '请求或拆分方案已变化，请刷新后重新创建。';
    return null;
  } catch (error) { return error instanceof Error ? error.message : '项目创建失败。'; }
}

export function moveProjectItem(groups: ProjectGroup[], itemId: string, targetId: string): ProjectGroup[] {
  if (!groups.some(group => group.id === targetId) || !groups.some(group => group.itemIds.includes(itemId))) return groups;
  if (groups.find(group => group.id === targetId)!.itemIds.includes(itemId)) return groups;
  return groups.map(group => ({ ...group, itemIds: group.id === targetId
    ? [...group.itemIds, itemId]
    : group.itemIds.filter(id => id !== itemId) }));
}
