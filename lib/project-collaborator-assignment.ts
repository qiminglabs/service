import type { CustomerRef, ServiceRequest } from './service-requests';
import { fixedIdentityRoles } from './internal-users.ts';
import type { ServiceProjectRecord } from './service-projects';
import { projectItemAudience } from './service-projects.ts';
import type { OperationActor } from './request-operations';
import type { ProjectCollaborator, ProjectCollaborators, ProjectCollaboratorDirectory } from './service-project-collaborators';
import { managerCollaboratorId, requestAudience } from './request-collaboration.ts';

export const projectCollaboratorAssignmentRules = [
  { id: 'customer-owner', scope: '全部项目', timing: '创建项目时', source: '客户所有人', target: '内部协作人', identity: '客户所有人' },
  { id: 'project-manager', scope: '全部项目', timing: '创建项目时', source: '请求负责项目经理；直接创建时为当前项目经理', target: '内部协作人', identity: '项目经理' },
  { id: 'project-applicant', scope: '内部直接创建的项目', timing: '创建项目时', source: '项目申请人（创建人）', target: '内部协作人', identity: '申请人' },
  { id: 'request-applicant', scope: '由内部服务请求转换的项目', timing: '请求转项目时', source: '请求申请人', target: '内部协作人', identity: '请求申请人' },
  { id: 'customer-collaborators', scope: '由服务请求转换的项目', timing: '请求转项目时', source: '原客户协作人（含客户申请人）', target: '客户协作人', identity: '—' },
] as const;

// Applied once at creation; reading/editing a project never re-adds removed people.
export function assignInitialProjectCollaborators(customerId: string, actor: OperationActor,
  directory: ProjectCollaboratorDirectory & { customers: CustomerRef[] },
  selected: ProjectCollaborators = {}, request?: ServiceRequest): ProjectCollaborators {
  const next = structuredClone(selected);
  const add = (group: 'internal' | 'customer', person: ProjectCollaborator) => {
    const people = next[group] ??= [];
    const existing = people.find(entry => entry.id === person.id);
    if (existing) existing.assignmentRoles = [...new Set([...(existing.assignmentRoles ?? []), ...(person.assignmentRoles ?? [])])];
    else people.push(person);
  };
  const addUser = (id: string | undefined, identity: string) => {
    const user = directory.users.find(person => person.id === id && person.status === '启用');
    if (user) add('internal', { id: user.id, name: user.name, details: user.email ?? '', assignmentRoles: [identity] });
  };
  addUser(directory.customers.find(customer => customer.id === customerId)?.ownerUserId, '客户所有人');
  addUser(request ? managerCollaboratorId(request) : actor.role === 'SmartX 项目经理' ? actor.id : undefined, '项目经理');
  if (!request) {
    if (projectItemAudience(actor) === 'internal') addUser(actor.id, '申请人');
    return next;
  }
  if (request.customerId !== customerId) throw new Error('来源请求与项目客户不一致，不能带入协作人。');
  if (requestAudience(request) === 'internal') addUser(request.createdById, '请求申请人');
  const customerPeople = [...(request.externalCollaborators ?? [])];
  if (requestAudience(request) === 'customer' && request.createdById && !customerPeople.some(person => person.contactId === request.createdById)) {
    const applicant = directory.contacts.find(person => person.id === request.createdById && person.customerId === customerId);
    if (applicant) customerPeople.push({ contactId: applicant.id, name: applicant.name, phone: applicant.phone ?? '', email: applicant.email ?? '' });
  }
  for (const person of customerPeople) {
    const contact = directory.contacts.find(entry => entry.id === person.contactId);
    if (contact && contact.customerId !== customerId) continue;
    // Existing request membership remains a historical selection even if its contact was disabled/deleted.
    add('customer', { id: person.contactId, name: contact?.name ?? person.name, details: [contact?.phone ?? person.phone, contact?.email ?? person.email].filter(Boolean).join(' · '), assignmentRoles: ['原客户协作人', ...(requestAudience(request) === 'customer' && request.createdById === person.contactId ? ['请求申请人'] : [])] });
  }
  return next;
}

// Mark existing automatically assigned members without adding new people during a read.
export function withProjectAssignmentRoles(project: ServiceProjectRecord,
  directory: ProjectCollaboratorDirectory & { customers: CustomerRef[] }, request?: ServiceRequest): ServiceProjectRecord {
  if (project.collaboratorAssignmentsVersion === 1) return project;
  const assigned = assignInitialProjectCollaborators(project.customerId, { id: project.createdById, name: project.createdBy,
    role: project.createdSite === '合作伙伴中心' ? '合作伙伴服务工程师' : fixedIdentityRoles[project.createdById] ?? '' }, directory, {}, request);
  const collaborators = structuredClone(project.collaborators ?? {});
  for (const group of ['internal', 'customer'] as const) {
    for (const person of collaborators[group] ?? []) {
      const roles = assigned[group]?.find(entry => entry.id === person.id)?.assignmentRoles;
      if (roles?.length) person.assignmentRoles = [...new Set([...(person.assignmentRoles ?? []), ...roles])];
    }
  }
  return { ...project, collaborators, collaboratorAssignmentsVersion: 1 };
}
