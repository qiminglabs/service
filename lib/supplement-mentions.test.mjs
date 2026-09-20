import test from 'node:test';
import assert from 'node:assert/strict';
import { mentionQuery, editMentions, insertMention, supplementMentionUsers, supplementMentionsIssue } from './supplement-mentions.ts';
import { addSupplement, supplementSaveIssue, visibleSupplements } from './request-supplements.ts';
const users = [{ id: 'a', name: '赵言', status: '启用' }, { id: 'b', name: '王琪', status: '启用' }, { id: 'c', name: '王琪', status: '启用' }, { id: 'd', name: '停用', status: '停用' }];
const internal = { id: 'a', name: '赵言', role: 'SmartX 项目经理' };
const customer = { id: 'contact', name: '客户', role: '客户' };
const record = { id: 'r', customerId: 'customer', status: '草稿', internalParticipants: [{ userId: 'b', name: '王琪' }], operations: { assessment: { managerId: 'a' } } };
const payload = { id: 's', authorId: internal.id, author: internal.name, at: '2026-09-10T10:00:00Z', comment: '@王琪 请补充', mentions: [{ userId: 'b', name: '王琪', start: 0, end: 3 }], files: [], externalVisible: false };

test('内部可提及请求中启用且同客户的客户协作人，保存重新校验人员范围', () => {
  const contact = { id: 'contact', name: '客户甲', customerId: record.customerId, status: '启用' };
  const contacts = [contact, { ...contact, id: 'unrelated' }];
  const current = { ...record, externalCollaborators: [{ contactId: contact.id, name: '旧名' }] };
  const mention = insertMention('', [], 0, 0, contact);
  const input = { ...payload, comment: mention.comment, mentions: mention.mentions, externalVisible: true };
  assert.deepEqual(supplementMentionUsers(current, internal, users, contacts).map(user => user.id), ['b', 'contact']);
  assert.deepEqual(supplementMentionUsers(current, customer, users, contacts).map(user => user.id), ['b', 'contact']);
  const next = addSupplement(current, internal, undefined, input, users, contacts);
  assert.equal(supplementSaveIssue(next, current, internal, undefined, users, contacts), null);
  assert.deepEqual(next.operations.supplements[0].mentions, mention.mentions);
  for (const refs of [[{ ...contact, status: '停用' }], [{ ...contact, customerId: 'other' }], []]) {
    assert.equal(supplementMentionUsers(current, internal, users, refs).some(user => user.id === contact.id), false);
    assert.match(supplementSaveIssue(next, current, internal, undefined, users, refs), /可选范围/);
  }
  assert.match(supplementSaveIssue(next, { ...current, externalCollaborators: [] }, internal, undefined, users, contacts), /可选范围/);
  assert.doesNotThrow(() => addSupplement(current, customer, record.customerId, { ...input, authorId: customer.id, author: customer.name }, users, contacts));
});

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
test('内部仅可选择启用的内部协作人，客户与内部均仅可选已加入的协作人', () => {
  assert.deepEqual(supplementMentionUsers(record, internal, users).map(u => u.id), ['b']);
  assert.deepEqual(supplementMentionUsers(record, customer, users).map(u => u.id), ['b']);
  assert.deepEqual(supplementMentionUsers(record, { ...customer, role: '合作伙伴服务工程师' }, users).map(user => user.id), ['b']);
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
  const managerMention = insertMention('', [], 0, 0, users[0]);
  assert.throws(() => addSupplement(record, customer, 'customer', { ...publicPayload, ...managerMention }, users), /可选范围/);
  assert.throws(() => addSupplement(record, customer, 'customer', { ...publicPayload, mentions: [{ ...payload.mentions[0], userId: 'c' }] }, users), /可选范围/);
});

test('非协作人的组织用户不可提及，选择范围与保存范围一致', async () => {
  const { supplementMentionRecipients } = await import('./supplement-mentions.ts');
  const original = structuredClone(record);
  const outsiderPayload = { ...payload, mentions: [{ ...payload.mentions[0], userId: 'c' }] };
  assert.deepEqual(supplementMentionUsers(record, internal, users), supplementMentionRecipients(record, internal, users));
  assert.throws(() => addSupplement(record, internal, undefined, outsiderPayload, users), /可选范围/);
  assert.deepEqual(record, original);
  assert.deepEqual(supplementMentionRecipients(record, customer, users).map(user => user.id), ['b']);
});

test('保存层不能在发留言时伪造新增协作人；成员被移除后不得继续提及', async () => {
  const joined = { ...record, internalParticipants: [...record.internalParticipants, { userId: 'c', name: users[2].name }] };
  const input = { ...payload, mentions: [{ ...payload.mentions[0], userId: 'c' }] };
  const posted = addSupplement(joined, internal, undefined, input, users);
  assert.match(supplementSaveIssue(posted, record, internal, undefined, users), /可选范围/);
  assert.equal(supplementSaveIssue(posted, joined, internal, undefined, users), null);
  const removed = { ...joined, internalParticipants: joined.internalParticipants.filter(person => person.userId !== 'c') };
  assert.match(supplementSaveIssue(posted, removed, internal, undefined, users), /可选范围/);
});

test('项目候选需依据成员目录，客户缺少目录数据时不回退到未经验证的协作人', async () => {
  const { projectSupplementMentionUsers, addProjectSupplement } = await import('./service-project-supplements.ts');
  const contact = { id: 'contact', name: '客户甲', customerId: 'customer', status: '启用' };
  const project = { id: 'p', createdById: internal.id, customerId: 'customer', status: '进行中', revision: 1,
    collaborators: { internal: [{ id: 'b', name: '王琪' }], customer: [{ id: 'contact', name: '客户甲' }], partner: [{ id: 'partner', name: '伙伴' }] } };
  const directoryUsers = [...users, { id: 'partner', name: '伙伴', status: '启用' }];
  assert.deepEqual(projectSupplementMentionUsers(project, internal, directoryUsers, [contact]).map(user => user.id), ['b', 'contact']);
  assert.deepEqual(projectSupplementMentionUsers(project, customer, directoryUsers, [contact]).map(user => user.id), []);
  assert.deepEqual(projectSupplementMentionUsers(project, { ...internal, role: '合作伙伴服务工程师' }, directoryUsers, [contact]).map(user => user.id), ['b', 'contact']);
  const input = { comment: payload.comment, mentions: payload.mentions, files: [], externalVisible: false };
  assert.doesNotThrow(() => addProjectSupplement(project, internal, input, users));
  assert.throws(() => addProjectSupplement(project, internal, { ...input, mentions: [{ ...payload.mentions[0], userId: 'c' }] }, users), /可选范围/);
  assert.deepEqual(projectSupplementMentionUsers({ ...project, collaborators: {} }, internal, users, [contact]), []);
});
