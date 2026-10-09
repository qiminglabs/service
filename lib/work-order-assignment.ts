import { activityMessage, activityList, activityLabel } from './activity-events.ts';
import { withWorkOrderCollaboratorRoles } from './project-work-order-collaborators.ts';
import type { CatalogService } from './service-requests';
import type { ServiceProjectRecord } from './service-projects';
import type { ProjectCollaboratorDirectory } from './service-project-collaborators';
import type { OperationActor } from './request-operations';
import type { ServiceCertification } from './service-certifications';
import type { ServiceProviderConfig } from './service-provider-settings';
import { operationIdentities } from './internal-users.ts';
import { internalProjectProvider } from './service-project-providers.ts';
import { canManageWorkOrders, assignedEngineers, type WorkOrderAssignee, type ServiceWorkOrder } from './service-work-orders.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { isPartnerCreatedProject } from './service-project-work-order-policy.ts';

export type AssignmentDirectory = ProjectCollaboratorDirectory & {
  services: CatalogService[];
  serviceCertifications: ServiceCertification[];
  providers: ServiceProviderConfig;
};
export type AssignmentCandidate = WorkOrderAssignee & { companyId: string; companyName: string; role: string; email: string; certifications: ServiceCertification[] };
export type WorkOrderAssignmentInput = { orderIds: string[]; assignees: Pick<WorkOrderAssignee, 'id' | 'group'>[] };
export const engineerKey = (person: Pick<WorkOrderAssignee, 'id' | 'group'>) => `${person.group}:${person.id}`;
export const dispatchableWorkOrders = (project: ServiceProjectRecord) =>
  (project.workOrders ?? []).filter(order => !['已完成', '已取消'].includes(order.status));
export function canAssignWorkOrders(project: ServiceProjectRecord, actor: OperationActor) {
  return canManageWorkOrders(project, actor) || (project.status === '进行中' && isPartnerCreatedProject(project)
    && actor.role === '合作伙伴服务工程师' && !!actor.id && project.createdById === actor.id);
}
export function assignmentToday(now = new Date().toISOString()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(now));
}
export function assignmentCandidates(project: ServiceProjectRecord, directory: AssignmentDirectory, today = assignmentToday()): AssignmentCandidate[] {
  const identities = operationIdentities(directory.users, { partners: directory.partners, partnerUsers: directory.partnerUsers });
  const smartx = project.serviceProviderId === internalProjectProvider.id;
  const ownCompany = directory.partners.find(company => `partner:${company.id}` === project.serviceProviderId && company.status === '启用');
  const vendors = new Set(directory.providers.entries.filter(entry => entry.enabled).map(entry => entry.partnerId));
  const people: Omit<AssignmentCandidate, 'certifications'>[] = [];
  if (smartx) for (const user of directory.users) {
    if (user.status === '启用' && identities.some(identity => identity.id === user.id && identity.role === 'SmartX 服务工程师'))
      people.push({ id: user.id, name: user.name, group: 'internal', companyId: internalProjectProvider.id, companyName: internalProjectProvider.name, role: 'SmartX 服务工程师', email: user.email });
  }
  for (const user of directory.partnerUsers) {
    const company = directory.partners.find(company => company.id === user.partnerId && company.status === '启用');
    if (!company || user.status !== '启用') continue;
    const isEngineer = identities.some(identity => identity.id === user.id && identity.role === '合作伙伴服务工程师');
    const eligible = smartx ? vendors.has(company.id) && isEngineer : ownCompany?.id === company.id && (!vendors.has(company.id) || isEngineer);
    if (eligible) people.push({ id: user.id, name: user.name, group: 'partner', companyId: company.id, companyName: company.name, role: isEngineer ? '服务工程师' : '合作伙伴用户', email: user.email });
  }
  return people.map(person => ({ ...person, certifications: directory.serviceCertifications.filter(cert => cert.userId === person.id && cert.holderType === person.group && cert.status === '启用' && /^\d{4}-\d{2}-\d{2}$/.test(cert.expiresOn) && cert.expiresOn >= today) }));
}
export function orderCertificationRequirements(order: ServiceWorkOrder, directory: AssignmentDirectory): string[] {
  const service = directory.services.find(service => service.id === order.item.serviceId);
  if (!service) throw new Error(`「${order.item.serviceName}」的服务目录不存在，无法确认认证要求。`);
  if (service.certifications !== undefined && (!Array.isArray(service.certifications) || service.certifications.some(value => typeof value !== 'string' || !value.trim()))) throw new Error(`「${service.name}」的认证要求配置异常。`);
  return [...new Set((service.certifications ?? []).filter(value => value !== '无认证要求'))];
}
export function missingAssignmentCertifications(requirements: string[], candidates: AssignmentCandidate[]) {
  const held = new Set(candidates.flatMap(person => person.certifications.map(cert => cert.certification)));
  return requirements.filter(certification => !held.has(certification as ServiceCertification['certification']));
}
export function assignWorkOrders(project: ServiceProjectRecord, actor: OperationActor, input: WorkOrderAssignmentInput, directory: AssignmentDirectory, now = new Date().toISOString()): ServiceProjectRecord {
  if (!canAssignWorkOrders(project, actor)) throw new Error('当前身份或项目状态不允许指派工单。');
  if (!input.orderIds.length || new Set(input.orderIds).size !== input.orderIds.length) throw new Error('请选择工单，且不能重复选择。');
  if (!input.assignees.length) throw new Error('请至少选择一名工程师。');
  if (new Set(input.assignees.map(engineerKey)).size !== input.assignees.length) throw new Error('不能重复选择同一工程师。');
  const candidates = assignmentCandidates(project, directory, assignmentToday(now));
  const selected = input.assignees.map(person => {
    const candidate = candidates.find(candidate => engineerKey(candidate) === engineerKey(person));
    if (!candidate) throw new Error('所选工程师已停用、角色不符或不在项目服务方的可派范围内，请重新选择。');
    return candidate;
  });
  const targets = input.orderIds.map(id => {
    const order = project.workOrders?.find(order => order.id === id);
    if (!order) throw new Error('所选工单不存在。');
    if (['已完成', '已取消'].includes(order.status)) throw new Error(`${order.status}工单不能指派或改派。`);
    const missing = missingAssignmentCertifications(orderCertificationRequirements(order, directory), selected);
    if (missing.length) throw new Error(`「${order.item.serviceName}」缺少有效认证：${missing.join('、')}。`);
    return order;
  });
  const assignees = selected.map(({ id, name, group }) => ({ id, name, group }));
  const changed = targets.filter(order => {
    const previous = assignedEngineers(order);
    return previous.length !== assignees.length || previous.some(person => !assignees.some(next => engineerKey(next) === engineerKey(person) && next.name === person.name));
  });
  const collaborators = structuredClone(withWorkOrderCollaboratorRoles(project).collaborators ?? {});
  for (const person of selected) {
    const people = collaborators[person.group] ??= [];
    const existing = people.find(entry => entry.id === person.id);
    if (existing) {
      existing.assignmentRoles = [...new Set([...(existing.assignmentRoles ?? []), '服务工程师'])];
    } else {
      const partner = person.group === 'partner' ? directory.partnerUsers.find(entry => entry.id === person.id) : undefined;
      people.push({ id: person.id, name: person.name,
        details: [partner?.phone, person.email].filter(Boolean).join(' · '),
        assignmentRoles: ['服务工程师'], workOrderAssignmentOnly: true });
    }
  }
  const collaboratorsChanged = JSON.stringify(collaborators) !== JSON.stringify(project.collaborators ?? {});
  if (!changed.length && !collaboratorsChanged) return project;
  const changedIds = new Set(changed.map(order => order.id));
  return appendProjectActivity({
    ...project, collaborators, revision: project.revision + 1, updatedAt: now,
    workOrders: project.workOrders!.map(order => changedIds.has(order.id) ? { ...order, assignee: undefined, assignees: structuredClone(assignees), updatedAt: now } : order),
  }, actor, '工单', (targets.length > 1 ? activityMessage("批量指派工单") : (assignedEngineers(targets[0]).length ? activityMessage("改派工单") : activityMessage("指派工单"))),
  activityList((changed.length ? changed : targets).map(order => activityMessage("{0} · {1}：{2} → {3}", [order.id, activityLabel(order.item.serviceName), assignedEngineers(order).length ? activityList(assignedEngineers(order).map(person => person.name)) : activityMessage('未指派'), activityList(assignees.map(person => person.name), '、')])), '；'), now, false);
}
