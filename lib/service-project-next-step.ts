import type { ServiceProjectRecord } from './service-projects';
import type { CustomerServiceProject } from './customer-service-projects';
import type { ProjectCollaboratorDirectory } from './service-project-collaborators';
import type { CustomerRef } from './service-requests';
import { fixedIdentityRoles } from './internal-users.ts';
import { canSubmitProjectReview, isPartnerCreatedProject, isResponsibleProjectManager } from './service-project-work-order-policy.ts';
import { assignedEngineers, canExecuteSpecificWorkOrder } from './service-work-orders.ts';
import { currentProjectReviewApproval, pendingProjectWorklogs, projectReviewStale } from './service-project-review.ts';

export type ProjectNextStep = {
  site?: '服务管理中心' | '合作伙伴中心' | '客户中心';
  actor?: string;
  action: string;
};
const staff = (actor: string, action: string): ProjectNextStep => ({ site: '服务管理中心', actor, action });
const named = (name: string | undefined, role: string) => name ? `${name}（${role}）` : role;
function terminal(status: string): ProjectNextStep | undefined {
  if (status === '已完成') return { action: '项目已完成，可查看交付物及项目报告。' };
  if (status === '已取消') return { action: '项目及工单已取消，不可恢复，无需继续操作。' };
}

export function serviceProjectNextStep(project: ServiceProjectRecord, directory: ProjectCollaboratorDirectory, customers: CustomerRef[], external = false): ProjectNextStep {
  const end = terminal(project.status); if (end) return end;
  const users = directory.users.filter(user => user.status === '启用');
  const actorOf = (user: { id: string; name: string }) => ({ id: user.id, name: user.name, role: fixedIdentityRoles[user.id] ?? '' });
  const manager = users.find(user => isResponsibleProjectManager(project, actorOf(user)));
  const pm = (action: string) => staff(named(manager?.name, '负责项目经理'), action);
  const admin = (action: string) => staff('系统管理员', action);
  const partnerCreated = isPartnerCreatedProject(project);
  const activePartners = directory.partnerUsers.filter(user => user.status === '启用' && directory.partners.some(company => company.id === user.partnerId && company.status === '启用'));
  const creator = activePartners.find(user => user.id === project.createdById && project.serviceProviderId === `partner:${user.partnerId}`);
  const deliveryOwner = (action: string): ProjectNextStep => partnerCreated && creator
    ? { site: '合作伙伴中心', actor: named(creator.name, '项目创建人'), action } : pm(action);
  if (project.status === '已暂停') return deliveryOwner('查看暂停原因，具备继续执行条件后点击「恢复项目」。');
  if (project.status === '待启动') return deliveryOwner('完善项目信息与服务项后，点击「启动项目」。');
  const confirmation = project.review?.confirmations.at(-1);
  if (project.status === '待确认') {
    if (confirmation?.state === '已确认' && !confirmation.invalidatedAt)
      return { action: '客户已确认，系统自动完成项目。' };
    if (!confirmation || confirmation.invalidatedAt || confirmation.state === '已拒绝') return deliveryOwner('检查最新客户确认记录，处理交付内容后继续推进确认。');
    const contacts = directory.contacts.filter(contact => contact.status === '启用' && contact.customerId === project.customerId && project.collaborators?.customer?.some(person => person.id === contact.id));
    if (!contacts.length) return pm('恢复或补充有效的客户协作人后，继续客户确认。');
    return { site: '客户中心', actor: `${contacts[0].name}${contacts.length > 1 ? '等任一客户协作人' : '（客户协作人）'}`, action: '在「项目信息」中查看交付物及确认内容，确认或拒绝本次服务项目。' };
  }
  const orders = project.workOrders?.filter(order => order.status !== '已取消') ?? [];
  const engineers = [
    ...users.map(actorOf).filter(actor => actor.role === 'SmartX 服务工程师'),
    ...activePartners.map(user => ({ id: user.id, name: user.name, role: '合作伙伴服务工程师' })),
  ];
  const engineerHint = (actor: typeof engineers[number], action: string): ProjectNextStep => ({ site: actor.role === '合作伙伴服务工程师' ? '合作伙伴中心' : '服务管理中心', actor: named(actor.name, '执行工程师'), action });
  if (project.status === '进行中') {
    if (!orders.length) return deliveryOwner('在「工单概览」中新建工单并安排执行。');
    const unfinished = orders.filter(order => order.status !== '已完成');
    if (unfinished.length) {
      const executable = unfinished.filter(order => order.status !== '已暂停');
      if (!executable.length) return pm('未完成工单均已暂停，请在「工单概览」中恢复工单后继续执行。');
      if (executable.some(order => !assignedEngineers(order).length)) return deliveryOwner('在「工单概览」中为未指派工单选择执行工程师。');
      const engineer = engineers.find(actor => executable.some(order => canExecuteSpecificWorkOrder(project, order, actor)));
      return engineer ? engineerHint(engineer, '在「工单执行」中完成已指派工单的服务步骤。') : deliveryOwner('检查工单执行工程师是否有效，按资质规则重新指派后继续执行。');
    }
    if (partnerCreated) return deliveryOwner('工单已全部完成，在「客户确认」中点击「发送报告并发起确认」。');
    const engineer = engineers.find(actor => canSubmitProjectReview(project, actor));
    return engineer ? engineerHint(engineer, '工单已全部完成，由任意已指派的执行工程师点击「提交复核」。') : admin('恢复项目已指派执行工程师的有效账号后，由工程师提交复核。');
  }
  if (partnerCreated) return deliveryOwner('在「客户确认」中核对交付内容，发送报告并发起客户确认。');
  if (external) return pm('完成交付核对及内部审核后，发起客户确认。');
  if (pendingProjectWorklogs(project).length) return pm('在「工时」中确认待确认工时，再进行人天核定。');
  if (!project.review?.effort || projectReviewStale(project) || project.review.effort.stage === '过程')
    return pm('在「复核」中点击「核定人天」，核对各工单的最终计价人天。');
  const approval = currentProjectReviewApproval(project);
  if (approval?.state === '待审批') {
    const step = approval.workflow?.steps.find(step => step.state === '待审批');
    const approver = users.find(user => user.id === (step?.approverId ?? approval.approverId));
    return approver ? staff(named(approver.name, '当前审批人'), '在「复核」中处理项目额度审批。') : admin('恢复当前审批人的有效账号后继续处理项目额度审批。');
  }
  const owner = users.find(user => user.id === customers.find(customer => customer.id === project.customerId)?.ownerUserId);
  return staff(named(owner?.name, owner ? '客户所有人' : '内部申请人或客户所有人'), '在「复核」中核对服务依据；额度不足时补充依据或发起额度审批，足额后发送报告并发起客户确认。');
}

// Customer guidance uses only the public projection; no internal assessments or approvals are exposed.
export function customerProjectNextStep(project: CustomerServiceProject): ProjectNextStep {
  const end = terminal(project.status); if (end) return end;
  const manager = project.internalCollaborators.find(person => person.roles.includes('项目经理'));
  const pm = (action: string) => staff(named(manager?.name, '负责项目经理'), action);
  if (project.status === '已暂停') return pm('查看暂停原因，具备继续执行条件后恢复项目。');
  if (project.status === '待启动') return pm('完善项目安排并启动服务项目。');
  if (project.status === '待确认') {
    if (project.confirmation?.state === '已确认' && !project.confirmation.invalidatedAt) return { action: '客户已确认，系统自动完成项目。' };
    if (!project.confirmation || project.confirmation.invalidatedAt || project.confirmationStale) return { action: '等待服务方核对最新交付内容并处理客户确认。' };
    if (project.confirmation.state === '待确认') return { site: '客户中心', actor: project.collaborators.length ? `${project.collaborators[0].name}${project.collaborators.length > 1 ? '等任一客户协作人' : '（客户协作人）'}` : '客户协作人', action: '在「项目信息」中查看交付物及确认内容，确认或拒绝本次服务项目。' };
  }
  if (project.confirmation?.state === '已拒绝') return { action: '已反馈拒绝原因，等待服务方处理后重新发起客户确认。' };
  return project.status === '待复核' ? { action: '等待服务方完成交付核对，随后发起客户确认。' } : { action: '服务方正在推进工单执行，交付完成后将发起客户确认。' };
}
