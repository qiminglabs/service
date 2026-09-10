import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionQuery, editMentions, insertMention, supplementMentionUsers, supplementMentionsIssue } from './supplement-mentions.ts';
import { addSupplement, supplementSaveIssue, visibleSupplements } from './request-supplements.ts';
const users = [{ id: 'a', name: '赵言', status: '启用' }, { id: 'b', name: '王琪', status: '启用' }, { id: 'c', name: '王琪', status: '启用' }, { id: 'd', name: '停用', status: '停用' }];
const internal = { id: 'a', name: '赵言', role: 'SmartX 项目经理' };
const customer = { id: 'contact', name: '客户', role: '客户' };
const record = { id: 'r', customerId: 'customer', status: '草稿', internalParticipants: [{ userId: 'b', name: '王琪' }], operations: { assessment: { managerId: 'a' } } };
const payload = { id: 's', authorId: internal.id, author: internal.name, at: '2026-09-10T10:00:00Z', comment: '@王琪 请补充', mentions: [{ userId: 'b', name: '王琪', start: 0, end: 3 }], files: [], externalVisible: false };

test('@查询识别正文与光标位置，不将邮箱识别为用户选择', () => {
  assert.deepEqual(mentionQuery('请帮忙 @王', 6), { start: 4, query: '王' });
  assert.deepEqual(mentionQuery('@', 1), { start: 0, query: '' });
  assert.equal(mentionQuery('a@example.com', 13), null);
  assert.equal(mentionQuery('@王琪 已完成', 7), null);
});
test('选人保存编号和范围，同名可区分，编辑文字移动范围，修改姓名则取消关联', () => {
  const first = insertMention('请 @王 核对', [], 2, 4, users[1]);
  assert.equal(first.comment, '请 @王琪  核对');
  assert.equal(first.mentions[0].userId, 'b');
  assert.equal(first.caret, 6);
  const shifted = editMentions(first.comment, '您好，' + first.comment, first.mentions);
  assert.equal(shifted[0].start, 5);
  assert.equal(shifted[0].end, 8);
  assert.deepEqual(editMentions(first.comment, first.comment.replace('王琪', '王'), first.mentions), []);
  assert.deepEqual(editMentions(first.comment, '请  核对', first.mentions), []);
  const sameName = insertMention('@', [], 0, 1, users[2]);
  assert.equal(sameName.mentions[0].userId, 'c');
  assert.equal(supplementMentionsIssue(sameName.comment, sameName.mentions, users), null);
});
test('内部可选择所有启用用户，客户仅可选当前协作人和负责项目经理', () => {
  assert.deepEqual(supplementMentionUsers(record, internal, users).map(u => u.id), ['a', 'b', 'c']);
  assert.deepEqual(supplementMentionUsers(record, customer, users).map(u => u.id), ['a', 'b']);
  assert.deepEqual(supplementMentionUsers(record, { ...customer, role: '合作伙伴服务工程师' }, users), []);
});
test('发布和保存校验当前有效成员、姓名及正文，不能伪造或重叠关联', () => {
  const next = addSupplement(record, internal, undefined, payload, users);
  assert.equal(supplementSaveIssue(next, record, internal, undefined, users), null);
  assert.equal(visibleSupplements(next, customer).length, 0);
  assert.match(supplementSaveIssue(next, record, internal, undefined, users.filter(u => u.id !== 'b')), /停用/);
  assert.throws(() => addSupplement(record, internal, undefined, { ...payload, mentions: [{ ...payload.mentions[0], name: '伪造姓名' }] }, users), /变更/);
  assert.throws(() => addSupplement(record, internal, undefined, { ...payload, mentions: [...payload.mentions, ...payload.mentions] }, users), /内容已变更/);
  assert.throws(() => addSupplement(record, internal, undefined, { ...payload, comment: '已删除提及' }, users), /内容已变更/);
  const publicPayload = { ...payload, authorId: customer.id, author: customer.name, externalVisible: true };
  assert.doesNotThrow(() => addSupplement(record, customer, 'customer', publicPayload, users));
  assert.throws(() => addSupplement(record, customer, 'customer', { ...publicPayload, mentions: [{ ...payload.mentions[0], userId: 'c' }] }, users), /可选范围/);
});

test('内部员工提及非协作人必须先确认加入，拒绝不修改成员或留言', async () => {
  const { addMentionCollaborator, supplementMentionRecipients } = await import('./supplement-mentions.ts');
  const original = structuredClone(record);
  const outsider = users[2];
  const outsiderPayload = { ...payload, mentions: [{ ...payload.mentions[0], userId: outsider.id }] };
  assert.throws(() => addMentionCollaborator(record, internal, outsider, false), /需确认/);
  assert.deepEqual(record, original);
  assert.throws(() => addSupplement(record, internal, undefined, outsiderPayload, users), /可选范围/);
  const joined = addMentionCollaborator(record, internal, outsider, true);
  assert.equal(joined.internalParticipants.filter(person => person.userId === outsider.id).length, 1);
  assert.equal(joined.operations.activities.at(-1).category, '协作');
  assert.equal(addMentionCollaborator(joined, internal, outsider, true), joined);
  assert.doesNotThrow(() => addSupplement(joined, internal, undefined, outsiderPayload, users));
  assert.deepEqual(supplementMentionRecipients(record, internal, users).map(user => user.id), ['b']);
  // 项目经理若不在协作名单中，内部员工也需先确认加入；客户仍可提及负责项目经理。
  assert.deepEqual(supplementMentionRecipients(record, customer, users).map(user => user.id), ['a', 'b']);
  assert.throws(() => addMentionCollaborator(record, customer, outsider, true), /仅内部员工/);
  assert.throws(() => addMentionCollaborator(record, internal, users[3], true), /停用/);
  assert.throws(() => addMentionCollaborator({ ...record, status: '待确认' }, internal, outsider, true), /当前阶段/);
});

test('保存层不能在发留言时伪造新增协作人绕过确认；成员被移除后不得继续提及', async () => {
  const { addMentionCollaborator } = await import('./supplement-mentions.ts');
  const joined = addMentionCollaborator(record, internal, users[2], true);
  const input = { ...payload, mentions: [{ ...payload.mentions[0], userId: 'c' }] };
  const posted = addSupplement(joined, internal, undefined, input, users);
  assert.match(supplementSaveIssue(posted, record, internal, undefined, users), /可选范围/);
  assert.equal(supplementSaveIssue(posted, joined, internal, undefined, users), null);
  const removed = { ...joined, internalParticipants: joined.internalParticipants.filter(person => person.userId !== 'c') };
  assert.match(supplementSaveIssue(posted, removed, internal, undefined, users), /可选范围/);
});
