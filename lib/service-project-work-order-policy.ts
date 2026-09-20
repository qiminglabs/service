import type { ServiceProjectRecord } from './service-projects';
import type { OperationActor } from './request-operations';
import { isDemoAdministrator } from './demo-permissions.ts';

export function projectCustomerConfirmationLocked(project: ServiceProjectRecord | null | undefined) {
  return project?.customerConfirmationLocked === true || project?.review?.confirmations.at(-1)?.state === '已确认';
}

export function projectWorklogsLocked(project: ServiceProjectRecord) {
  const confirmation = project.review?.confirmations.at(-1);
  return project.worklogsLocked === true || isPartnerCreatedProject(project) || projectCustomerConfirmationLocked(project)
    || (confirmation?.state === '待确认' && !confirmation.invalidatedAt);
}

export function isPartnerProjectCreator(project: ServiceProjectRecord, actor: OperationActor) {
  return !!actor.id && actor.role === '合作伙伴服务工程师' && isPartnerCreatedProject(project) && project.createdById === actor.id;
}

export function isResponsibleProjectManager(
  project: ServiceProjectRecord,
  actor: OperationActor,
) {
  return (
    actor.role === 'SmartX 项目经理' &&
    !!actor.id &&
    (!!project.collaborators?.internal?.some(
      (person) =>
        person.id === actor.id && person.assignmentRoles?.includes('项目经理'),
    ) || (project.createdById === actor.id && !project.collaborators?.internal?.some(person => person.assignmentRoles?.includes('项目经理'))))
  );
}
export function canManageProjectAsManager(project: ServiceProjectRecord, actor: OperationActor) {
  return isDemoAdministrator(actor) || isResponsibleProjectManager(project, actor);
}
export function canChangeProjectWorkOrders(project: ServiceProjectRecord, actor: OperationActor) {
  const partnerCreator = actor.role === '合作伙伴服务工程师' && !!actor.id && project.createdSite === '合作伙伴中心' && project.createdById === actor.id;
  return !projectCustomerConfirmationLocked(project) && project.status === '进行中' && (canManageProjectAsManager(project, actor) || partnerCreator);
}
export function canSubmitProjectReview(project: ServiceProjectRecord, actor: OperationActor) {
  if (isPartnerCreatedProject(project) || project.status !== '进行中' || !actor.id) return false;
  if (isDemoAdministrator(actor)) return true;
  const group = actor.role === 'SmartX 服务工程师' ? 'internal' : actor.role === '合作伙伴服务工程师' ? 'partner' : undefined;
  return !!group && !!project.collaborators?.[group]?.some(person => person.id === actor.id)
    && !!project.workOrders?.some(order => order.status !== '已取消'
      && (order.assignees ?? (order.assignee ? [order.assignee] : [])).some(person => person.id === actor.id && person.group === group));
}
export function canReturnProjectReview(project: ServiceProjectRecord, actor: OperationActor) {
  return !isPartnerCreatedProject(project) && project.status === '待复核' && canManageProjectAsManager(project, actor)
    && !project.review?.settlement && project.review?.confirmations.at(-1)?.state !== '已确认';
}
export function projectReviewIssue(
  project: ServiceProjectRecord,
): string | null {
  const active = (project.workOrders ?? []).filter(
    (order) => order.status !== '已取消',
  );
  if (!active.length) return '至少保留一张未取消的工单，才能提交复核。';
  if (active.some((order) => order.status !== '已完成'))
    return '所有未取消工单完成后，才能提交复核。';
  return null;
}

export const isPartnerCreatedProject = (project: Pick<ServiceProjectRecord, 'createdSite'>) => project.createdSite === '合作伙伴中心';
export function isAssignedProjectEngineer(project: ServiceProjectRecord, actor: OperationActor) {
  const group = actor.role === 'SmartX 服务工程师' ? 'internal' : actor.role === '合作伙伴服务工程师' ? 'partner' : undefined;
  return !!actor.id && !!group && !!project.collaborators?.[group]?.some(person => person.id === actor.id)
    && !!project.workOrders?.some(order => order.status !== '已取消'
      && (order.assignees ?? (order.assignee ? [order.assignee] : [])).some(person => person.id === actor.id && person.group === group));
}
export function canManagePartnerProjectConfirmation(project: ServiceProjectRecord, actor: OperationActor) {
  return isPartnerCreatedProject(project) && (isAssignedProjectEngineer(project, actor) || canManageProjectAsManager(project, actor) ||
    actor.role === '合作伙伴服务工程师' && !!actor.id && actor.id === project.createdById);
}
export function partnerProjectConfirmationIssue(project: ServiceProjectRecord) {
  return projectReviewIssue(project)?.replaceAll('提交复核', '发起客户确认') ?? null;
}
