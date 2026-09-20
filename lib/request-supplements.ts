import { supplementMentionRecipients, supplementMentionsIssue, type SupplementMention, type RequestMentionDirectory } from './supplement-mentions.ts';
import type { ServiceRequest, StoredFile, InternalUser, ContactRef } from './service-requests';
import { isInternal, meetingAttachmentIssue, operationsOf, type OperationActor } from './request-operations.ts';

export type RequestSupplement = {
  id: string; authorId: string; author: string; at: string;
  mentions?: SupplementMention[];
  comment: string; files: StoredFile[]; externalVisible: boolean;
};
export function visibleSupplements(record: ServiceRequest, actor: OperationActor) {
  return (record.operations?.supplements ?? []).filter(item => isInternal(actor.role) || item.externalVisible);
}
export function canAddSupplement(record: ServiceRequest, actor: OperationActor, customerId?: string) {
  return Boolean(actor.id) && ['草稿', '待评估'].includes(record.status)
    && (isInternal(actor.role) || (actor.role === '客户' && customerId === record.customerId));
}
export function addSupplement(record: ServiceRequest, actor: OperationActor, customerId: string | undefined, input: RequestSupplement, users: InternalUser[] = [], contacts: ContactRef[] = [], directory: RequestMentionDirectory = {}): ServiceRequest {
  if (!canAddSupplement(record, actor, customerId)) throw new Error('仅草稿、待评估阶段可提交补充资料。');
  if (input.authorId !== actor.id || input.author !== actor.name) throw new Error('提交人必须是当前用户。');
  if (!input.comment.trim() && !input.files.length) throw new Error('请填写评论或上传附件。');
  if (!input.id || !Number.isFinite(Date.parse(input.at))) throw new Error('补充资料信息无效。');
  if (typeof input.externalVisible !== 'boolean' || (!isInternal(actor.role) && !input.externalVisible)) throw new Error('客户提交的资料必须对客户可见。');
  const mentionIssue = supplementMentionsIssue(input.comment, input.mentions, supplementMentionRecipients(record, actor, users, contacts, directory));
  if (mentionIssue) throw new Error(mentionIssue);
  const ops = operationsOf(record);
  if (ops.supplements?.some(item => item.id === input.id)) throw new Error('请勿重复提交。');
  if (new Set(input.files.map(file => file.id)).size !== input.files.length) throw new Error('附件不能重复。');
  for (const file of input.files) { const issue = meetingAttachmentIssue(file); if (issue) throw new Error(issue); }
  return { ...record, operations: { ...ops, supplements: [...(ops.supplements ?? []), structuredClone(input)] } };
}
export function supplementSaveIssue(next: ServiceRequest, previous: ServiceRequest, actor?: OperationActor, customerId?: string, users: InternalUser[] = [], contacts: ContactRef[] = [], directory: RequestMentionDirectory = {}): string | null {
  const before = previous.operations?.supplements ?? [], after = next.operations?.supplements ?? [];
  if (JSON.stringify(before) === JSON.stringify(after)) return null;
  if (!actor) return '请先选择提交人。';
  if (after.length !== before.length + 1 || before.some((item, i) => JSON.stringify(item) !== JSON.stringify(after[i]))) return '已发布的补充资料不可修改或删除，请新增补充记录。';
  try { addSupplement(previous, actor, customerId, after.at(-1)!, users, contacts, directory); return null; }
  catch (error) { return error instanceof Error ? error.message : '补充资料保存失败。'; }
}
