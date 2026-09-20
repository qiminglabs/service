import { requestApprovalRemainingDays } from './request-approval-quota.ts';
import type { ContactRef, CustomerRef, InternalUser, ServiceRequest } from './service-requests';
import { assessedEffort, assessmentOf, canSubmitGapApproval, currentPlan, customerOwner } from './request-assessment.ts';
import { canPerformAssessmentRole } from './assessment-routing.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import { requestAudience } from './request-collaboration.ts';
import { currentHardwareReview, hardwareItems, hardwarePassIssue } from './request-hardware-assessment.ts';
import { serviceProjectCreationEnabled } from './request-projects.ts';
import { requestTypeOf } from './request-types.ts';

export type RequestNextStep = {
  site?: '服务管理中心' | '客户中心';
  actor?: string;
  action: string;
};

// Derive guidance from the same saved assessment and permission rules as the actions.
export function requestNextStep(record: ServiceRequest, users: InternalUser[], customers: CustomerRef[], contacts: ContactRef[]): RequestNextStep {
  if (record.status === '已取消') return { action: '请求已取消，无需继续操作。' };
  if (record.status === '已转服务项目') return { action: '请求已转为服务项目，服务请求流程已完成。' };
  const activeUsers = users.filter(user => user.status === '启用');
  const activeContacts = contacts.filter(contact => contact.status === '启用' && contact.customerId === record.customerId);
  const actorOf = (user: InternalUser) => ({ id: user.id, name: user.name, role: fixedIdentityRoles[user.id] ?? '' });
  const staff = (user: InternalUser | undefined, role: string, action: string): RequestNextStep => ({
    site: '服务管理中心', actor: user ? `${user.name}（${role}）` : role, action,
  });
  const admin = (action: string) => staff(activeUsers.find(user => fixedIdentityRoles[user.id] === 'SmartX 系统管理员'), '系统管理员', action);
  const applicant = activeUsers.find(user => user.id === record.createdById);
  const internal = requestAudience(record) === 'internal';
  const owner = customerOwner(record, customers, users);
  const basis = (action: string) => {
    const user = internal ? applicant : owner;
    return user ? staff(user, internal ? '申请人' : '客户所有人', action)
      : admin(internal ? '恢复申请人的有效账号后继续处理。' : '在客户资料中配置有效的客户所有人。');
  };
  if (record.status === '草稿') {
    if (internal) return basis('完善申请信息和材料后，点击「提交申请」。');
    const contact = activeContacts.find(contact => contact.id === record.createdById);
    return contact ? { site: '客户中心', actor: `${contact.name}（申请人）`, action: '完善申请信息和材料后，点击「提交申请」。' }
      : admin('完善客户申请人的联系人资料并启用账号后继续提交。');
  }
  if (record.status === '待确认') {
    const candidates = activeContacts.filter(contact => record.externalCollaborators?.some(person => person.contactId === contact.id));
    const contact = candidates.find(contact => contact.id === record.createdById) ?? candidates[0];
    return contact ? { site: '客户中心', actor: `${contact.name}${candidates.length > 1 ? '等任一客户协作人' : '（客户协作人）'}`, action: '查看服务方案，完成客户确认（确认或拒绝）。' }
      : admin('恢复客户协作人的有效账号后，前往客户中心完成确认。');
  }
  const manager = activeUsers.find(user => fixedIdentityRoles[user.id] === 'SmartX 项目经理' && canPerformAssessmentRole(record, actorOf(user), 'manager', users));
  if (record.status === '评估完成' && requestTypeOf(record) === '技术评估') return manager
    ? staff(manager, '负责项目经理', '技术评估已完成；如需继续交付，点击「转为服务交付」。')
    : { action: '技术评估已完成。如需转为服务交付，请先恢复负责项目经理的有效账号。' };
  if (record.status === '待受理') return staff(manager, '负责项目经理', serviceProjectCreationEnabled
    ? '点击「创建服务项目」，完成服务项分配。'
    : '待服务项目功能开放后创建服务项目（当前暂不可操作）。');
  const assessment = assessmentOf(record);
  const passed = assessment.rounds.some(round => round.outcome === '评估通过');
  if (!passed && hardwareItems(record).length && hardwarePassIssue(record, users)) {
    const reviewer = activeUsers.find(user => fixedIdentityRoles[user.id] === 'SmartX 硬件产品经理' && canPerformAssessmentRole(record, actorOf(user), 'hardware', users));
    if (!reviewer) return admin('为本请求分配有效的硬件产品经理，再进行硬件评估。');
    return staff(reviewer, '硬件产品经理', currentHardwareReview(record)?.outcome === '需补充'
      ? '按评估意见检查补充材料，在「评估」中重新提交硬件评估。'
      : '在「评估」中完成硬件产品经理评估。');
  }
  if (!passed || assessedEffort(record) === undefined) {
    if (!manager) return admin('为本请求分配有效的项目经理，再继续评估。');
    return staff(manager, '项目经理', passed ? '在「评估」中完成人天核定。'
      : assessment.rounds.at(-1)?.outcome === '需补充'
        ? '按评估意见检查补充材料，在「评估」中重新提交材料评估。'
        : '在「评估」中完成材料评估。');
  }
  const plan = currentPlan(record);
  if (!plan) return basis('在「评估」中完成服务依据关联。');
  const pending = assessment.approvals.find(approval => approval.planId === plan.id && approval.state === '待审批');
  if (pending) {
    const step = pending.workflow?.steps.find(step => step.state === '待审批');
    const approver = activeUsers.find(user => user.id === (step?.approverId ?? pending.approverId));
    return approver ? staff(approver, '当前审批人', `在「评估」中处理特殊审批${step ? `的「${step.nodeName}」环节` : ''}。`)
      : admin('恢复当前指定审批人的有效账号后继续特殊审批。');
  }
  if (requestApprovalRemainingDays(record) > 1e-8) {
    const submitters = activeUsers.filter(user => canSubmitGapApproval(record, actorOf(user), users));
    const submitter = submitters.find(user => user.id === record.createdById) ?? submitters[0];
    const rejected = assessment.approvals.some(approval => approval.planId === plan.id && approval.state === '已拒绝');
    return submitter ? staff(submitter, submitter.id === record.createdById && internal ? '申请人' : '负责销售', rejected
      ? '查看驳回意见，在「评估」中重新发起特殊审批。'
      : '在「评估」中发起特殊审批，处理服务额度缺口。') : admin('恢复内部申请人或负责销售的有效账号后发起特殊审批。');
  }
  return basis('在「评估」中发起客户确认。');
}
