import type { InternalUser, ServiceRequest } from './service-requests';
import { appendActivity, isInternal, type OperationActor } from './request-operations.ts';

export type SupplementMention = { userId: string; name: string; start: number; end: number };
export function supplementMentionUsers(record: ServiceRequest, actor: OperationActor, users: InternalUser[]): InternalUser[] {
  const related = new Set([...(record.internalParticipants ?? []).map(person => person.userId), record.operations?.assessment?.managerId]);
  return users.filter(user => user.status === '启用' && (isInternal(actor.role) || (actor.role === '客户' && related.has(user.id))));
}
export function supplementMentionRecipients(record: ServiceRequest, actor: OperationActor, users: InternalUser[]): InternalUser[] {
  const candidates = supplementMentionUsers(record, actor, users);
  return isInternal(actor.role) ? candidates.filter(user => record.internalParticipants?.some(person => person.userId === user.id)) : candidates;
}
export function addMentionCollaborator(record: ServiceRequest, actor: OperationActor, user: InternalUser, confirmed: boolean): ServiceRequest {
  if (!actor.id || !isInternal(actor.role)) throw new Error('仅内部员工可以添加内部协作人。');
  if (!['草稿', '待评估'].includes(record.status)) throw new Error('当前阶段不能通过留言添加协作人。');
  if (user.status !== '启用') throw new Error('该用户已停用，请重新选择。');
  if (record.internalParticipants?.some(person => person.userId === user.id)) return record;
  if (!confirmed) throw new Error('需确认加入内部协作人后才能 @该用户。');
  return appendActivity({ ...record, internalParticipants: [...(record.internalParticipants ?? []), { userId: user.id, name: user.name }] }, actor, '协作', '添加内部协作人', `通过留言 @ 添加 ${user.name} 为内部协作人。`);
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
