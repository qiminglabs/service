import type { ContactRef, CustomerRef, InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';
import { fixedIdentityRoles } from './internal-users.ts';

export function requestAudience(record: ServiceRequest): 'internal' | 'customer' {
  if (record.createdByAudience) return record.createdByAudience;
  // Legacy records have no audience: known internal identity or participant identifies an internal creator.
  return record.createdById && (fixedIdentityRoles[record.createdById] || record.internalParticipants?.some(p => p.userId === record.createdById)) ? 'internal' : 'customer';
}
export function isRequestApplicant(record: ServiceRequest, actor?: OperationActor): boolean {
  return !!actor?.id && actor.id === record.createdById && (requestAudience(record) === 'customer'
    ? actor.role === '客户'
    : ['SmartX 系统管理员', 'SmartX 项目经理', 'SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 售前工程师'].includes(actor.role));
}
export function withRequestCollaborators(record: ServiceRequest, contacts: ContactRef[], customers: CustomerRef[] = [], users: InternalUser[] = []): ServiceRequest {
  const audience = record.createdByAudience ?? (users.some(user => user.id === record.createdById) ? 'internal' : requestAudience(record));
  const next = { ...record, createdByAudience: audience, externalCollaborators: [...(record.externalCollaborators ?? [])], internalParticipants: [...(record.internalParticipants ?? [])] };
  if (record.createdById) {
    if (audience === 'internal' && !next.internalParticipants.some(p => p.userId === record.createdById))
      next.internalParticipants.unshift({ userId: record.createdById, name: record.createdBy ?? record.owner });
    if (audience === 'customer' && !next.externalCollaborators.some(p => p.contactId === record.createdById)) {
      const contact = contacts.find(c => c.id === record.createdById && c.customerId === record.customerId);
      next.externalCollaborators.unshift({ contactId: record.createdById, name: contact?.name ?? record.createdBy ?? record.owner, phone: contact?.phone ?? '', email: contact?.email ?? '' });
    }
  }
  const ownerId = customers.find(c => c.id === record.customerId)?.ownerUserId;
  const owner = users.find(u => u.id === ownerId);
  if (owner && !next.internalParticipants.some(p => p.userId === owner.id)) next.internalParticipants.unshift({ userId: owner.id, name: owner.name });
  return next;
}
export function applicantRemovalIssue(record: ServiceRequest): string | null {
  if (!record.createdById) return null;
  const present = requestAudience(record) === 'internal'
    ? record.internalParticipants?.some(p => p.userId === record.createdById)
    : record.externalCollaborators?.some(p => p.contactId === record.createdById);
  return present ? null : '申请人为固定协作人，不允许移除。';
}
export function customerCollaboratorsIssue(record: ServiceRequest, contacts: ContactRef[]): string | null {
  const people = record.externalCollaborators ?? [];
  if (!people.length) return '请至少添加一位客户协作人。';
  if (people.some(p => !contacts.some(c => c.id === p.contactId && c.customerId === record.customerId && c.status === '启用')))
    return '客户协作人必须是当前客户已启用的联系人，请更新协作人。';
  return null;
}
export function submissionCollaboratorsIssue(record: ServiceRequest, contacts: ContactRef[], users: InternalUser[]): string | null {
  const fixedIssue = applicantRemovalIssue(record);
  if (fixedIssue) return fixedIssue;
  const customerIssue = customerCollaboratorsIssue(record, contacts);
  if (customerIssue) return customerIssue;
  if (requestAudience(record) === 'internal' && !record.internalParticipants?.some(p => users.some(u => u.id === p.userId && u.status === '启用' && fixedIdentityRoles[u.id] === 'SmartX 售前工程师')))
    return '内部申请提交前，请至少添加一位已启用的 SmartX 售前工程师为内部协作人。';
  return null;
}
