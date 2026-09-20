import type { StoredFile, InternalUser, ContactRef } from './service-requests';
import { canViewCustomerProject, customerProjectMentionUsers, type CustomerProjectDirectory } from './customer-service-projects.ts';
import {
  meetingAttachmentIssue,
  isInternal,
  type OperationActor,
} from './request-operations.ts';
import {
  supplementMentionsIssue,
  customerCollaboratorMentionUsers,
  type SupplementMention,
} from './supplement-mentions.ts';
import {
  canViewServiceProject,
  projectItemAudience,
  type ServiceProjectRecord,
} from './service-projects.ts';

export type ProjectSupplementInput = {
  comment: string;
  mentions: SupplementMention[];
  files: StoredFile[];
  externalVisible: boolean;
};
export type ProjectSupplement = ProjectSupplementInput & {
  id: string;
  authorId: string;
  author: string;
  at: string;
};

export function projectCustomerMentionUsers(record: Pick<ServiceProjectRecord, 'customerId' | 'collaborators'>, actor: OperationActor, contacts: ContactRef[] = []) {
  return isInternal(actor.role) || actor.role === '合作伙伴服务工程师' || actor.role === '客户'
    ? customerCollaboratorMentionUsers(record.customerId, (record.collaborators?.customer ?? []).map(person => person.id), contacts)
    : [];
}

export function projectSupplementMentionUsers(record: Pick<ServiceProjectRecord, 'customerId' | 'collaborators' | 'serviceProviderId'>, actor: OperationActor, users: InternalUser[], contacts: ContactRef[] = [], directory?: CustomerProjectDirectory): (InternalUser & { companyName?: string })[] {
  if (actor.role === '客户') return customerProjectMentionUsers(record, directory).map(user => ({ ...user, status: '启用', department: '' }));
  const partners = directory?.partners.filter(partner => partner.status === '启用') ?? [];
  const partnerUsers = (directory?.partnerUsers ?? []).filter(user => user.status === '启用'
    && partners.some(partner => partner.id === user.partnerId && record.serviceProviderId === `partner:${partner.id}`)
    && record.collaborators?.partner?.some(person => person.id === user.id))
    .map(user => ({ ...user, department: '', companyName: partners.find(partner => partner.id === user.partnerId)?.name }));
  const internal = users.filter(user => user.status === '启用' && record.collaborators?.internal?.some(person => person.id === user.id));
  return [...internal, ...partnerUsers, ...projectCustomerMentionUsers(record, actor, contacts)];
}

export function canAddProjectSupplement(
  record: ServiceProjectRecord,
  actor: OperationActor,
  directory?: CustomerProjectDirectory,
) {
  return (
    (canViewServiceProject(actor, record) ||
      (!!directory && canViewCustomerProject(record, actor, directory))) &&
    !['已完成', '已取消'].includes(record.status)
  );
}

export function addProjectSupplement(
  previous: ServiceProjectRecord,
  actor: OperationActor,
  input: ProjectSupplementInput,
  users: InternalUser[],
  directory?: CustomerProjectDirectory,
): ServiceProjectRecord {
  if (!canAddProjectSupplement(previous, actor, directory))
    throw new Error('当前身份或项目阶段不可发布补充信息。');
  if (!input.comment.trim() && !input.files.length)
    throw new Error('请填写评论或上传附件。');
  if (typeof input.externalVisible !== 'boolean')
    throw new Error('请选择有效的可见范围。');
  if (new Set(input.files.map((file) => file.id)).size !== input.files.length)
    throw new Error('附件不能重复。');
  for (const file of input.files) {
    const issue = meetingAttachmentIssue(file);
    if (issue) throw new Error(issue);
  }
  const recipients: InternalUser[] = actor.role === '客户'
    ? customerProjectMentionUsers(previous, directory).map(user => ({ id: user.id, name: user.name, status: '启用', email: '', department: '' }))
    : projectSupplementMentionUsers(previous, actor, users, directory?.contacts, directory);
  const mentionIssue = supplementMentionsIssue(
    input.comment,
    input.mentions,
    recipients,
  );
  if (mentionIssue) throw new Error(mentionIssue);
  const now = new Date().toISOString();
  const supplement: ProjectSupplement = {
    id: crypto.randomUUID(),
    authorId: actor.id,
    author: actor.name,
    at: now,
    comment: input.comment,
    mentions: structuredClone(input.mentions),
    files: structuredClone(input.files),
    externalVisible:
      projectItemAudience(actor) === 'internal' ? input.externalVisible : true,
  };
  return {
    ...previous,
    supplements: [...(previous.supplements ?? []), supplement],
    revision: previous.revision + 1,
    updatedAt: now,
  };
}
