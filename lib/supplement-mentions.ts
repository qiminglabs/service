import type { ContactRef, CustomerRef, InternalUser, ServiceRequest } from './service-requests';
import { isInternal, type OperationActor } from './request-operations.ts';

import type { Partner, PartnerUser } from './partner-directory';
import { internalProjectProvider } from './service-project-providers.ts';
export type RequestMentionDirectory = { customers?: CustomerRef[]; partners?: Partner[]; partnerUsers?: PartnerUser[] };
export type MentionUser = InternalUser & { companyName?: string };

export type SupplementMention = { userId: string; name: string; start: number; end: number };
export function customerCollaboratorMentionUsers(customerId: string, ids: string[], contacts: ContactRef[]): InternalUser[] {
  return contacts.filter(contact => contact.status === '启用' && contact.customerId === customerId && ids.includes(contact.id))
    .map(contact => ({ id: contact.id, name: contact.name, status: contact.status, email: contact.email ?? '', department: '' }));
}
export function supplementMentionUsers(record: ServiceRequest, actor: OperationActor, users: InternalUser[], contacts: ContactRef[] = [], directory: RequestMentionDirectory = {}): MentionUser[] {
  if (!isInternal(actor.role) && actor.role !== '客户' && actor.role !== '合作伙伴服务工程师') return [];
  const internal = users.filter(user => user.status === '启用' && record.internalParticipants?.some(person => person.userId === user.id));
  const partners = (directory.partnerUsers ?? []).filter(user => user.status === '启用'
    && directory.partners?.some(partner => partner.id === user.partnerId && partner.status === '启用')
    && record.partnerCollaborators?.some(person => person.userId === user.id));
  return [
    ...internal.map(user => ({ ...user, companyName: internalProjectProvider.name })),
    ...partners.map(user => ({ ...user, department: '', companyName: directory.partners?.find(partner => partner.id === user.partnerId)?.name })),
    ...customerCollaboratorMentionUsers(record.customerId, (record.externalCollaborators ?? []).map(person => person.contactId), contacts)
      .map(user => ({ ...user, companyName: directory.customers?.find(customer => customer.id === record.customerId)?.name })),
  ];
}
export function supplementMentionRecipients(record: ServiceRequest, actor: OperationActor, users: InternalUser[], contacts: ContactRef[] = [], directory: RequestMentionDirectory = {}): MentionUser[] {
  return supplementMentionUsers(record, actor, users, contacts, directory);
}
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const prefix = text.slice(0, caret);
  const match = /(?:^|[\s（(，,。；;])@([^@\s]*)$/.exec(prefix);
  return match ? { start: caret - match[1].length - 1, query: match[1] } : null;
}
// Keep ranges aligned when text is inserted/deleted. Editing a mention turns it back into ordinary text.
export function editMentions(before: string, after: string, mentions: SupplementMention[]): SupplementMention[] {
  if (before === after) return mentions;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return mentions.flatMap(mention => {
    if (mention.end <= start) return [mention];
    if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
    return [];
  }).filter(mention => after.slice(mention.start, mention.end) === `@${mention.name}`);
}
export function insertMention(text: string, mentions: SupplementMention[], start: number, end: number, user: Pick<InternalUser, 'id' | 'name'>) {
  const label = `@${user.name}`;
  const comment = text.slice(0, start) + label + ' ' + text.slice(end);
  const nextMentions = [...editMentions(text, comment, mentions), { userId: user.id, name: user.name, start, end: start + label.length }].sort((a, b) => a.start - b.start);
  return { comment, mentions: nextMentions, caret: start + label.length + 1 };
}
export function supplementMentionsIssue(comment: string, mentions: SupplementMention[] | undefined, allowed: InternalUser[]): string | null {
  if (mentions === undefined) return null;
  if (!Array.isArray(mentions)) return '@用户信息无效。';
  let end = 0;
  for (const mention of mentions) {
    const user = allowed.find(user => user.id === mention.userId && user.status === '启用');
    if (!user || user.name !== mention.name) return '被 @ 的用户已停用、变更或不在可选范围，请重新选择。';
    if (!Number.isInteger(mention.start) || !Number.isInteger(mention.end) || mention.start < end || mention.end <= mention.start || comment.slice(mention.start, mention.end) !== `@${mention.name}`) return '@用户内容已变更，请重新选择。';
    end = mention.end;
  }
  return null;
}
