import type { StoredFile, InternalUser } from './service-requests';
import { canViewCustomerProject, type CustomerProjectDirectory } from './customer-service-projects.ts';
import {
  meetingAttachmentIssue,
  type OperationActor,
} from './request-operations.ts';
import {
  supplementMentionsIssue,
  type SupplementMention,
} from './supplement-mentions.ts';
import {
  canManageServiceProjects,
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

export function canAddProjectSupplement(
  record: ServiceProjectRecord,
  actor: OperationActor,
  directory?: CustomerProjectDirectory,
) {
  return (
    (canManageServiceProjects(actor, record) ||
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
  const recipients = users.filter(
    (user) =>
      user.status === '启用' &&
      previous.collaborators?.internal?.some((person) => person.id === user.id),
  );
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
