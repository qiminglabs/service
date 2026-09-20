import test from 'node:test';
import assert from 'node:assert/strict';
import { newServiceProject, editServiceProject } from './service-projects.ts';
import { addProjectSupplement } from './service-project-supplements.ts';
import { insertMention } from './supplement-mentions.ts';
import { customerServiceProject } from './customer-service-projects.ts';

const actor = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const users = [{ id: 'u', name: '张三', status: '启用' }];
const customers = [{ id: 'c', name: '客户', status: '启用' }];
const project = () =>
  newServiceProject(
    {
      name: '项目',
      customerId: 'c',
      expectedServiceDate: '2026-09-20',
      note: '',
    },
    actor,
    customers,
  );
const input = {
  comment: '补充现场要求',
  mentions: [],
  files: [],
  externalVisible: false,
};
const file = (name = '方案.pdf') => ({
  id: 'f1',
  name,
  size: 3,
  uploadedAt: new Date().toISOString(),
  blob: new Blob(['pdf']),
});

test('补充信息追加保存作者、时间与附件快照，不覆盖项目字段或历史', () => {
  const before = project();
  const first = addProjectSupplement(
    before,
    actor,
    { ...input, author: '伪造人', status: '已完成' },
    users,
  );
  const uploaded = file();
  const second = addProjectSupplement(
    first,
    actor,
    { ...input, comment: '', files: [uploaded], externalVisible: true },
    users,
  );
  assert.equal(before.supplements, undefined);
  assert.equal(second.supplements.length, 2);
  assert.equal(second.supplements[0].author, actor.name);
  assert.equal(second.supplements[0].authorId, actor.id);
  assert.ok(Date.now() - Date.parse(second.supplements[0].at) < 5000);
  assert.equal(second.updatedAt, second.supplements[1].at);
  assert.equal(second.revision, 3);
  assert.equal(second.status, before.status);
  assert.equal(second.createdAt, before.createdAt);
  assert.equal(second.supplements[1].externalVisible, true);
  uploaded.name = '修改文件名';
  assert.equal(second.supplements[1].files[0].name, '方案.pdf');
  const edited = editServiceProject(
    second,
    { ...second, note: '修改项目说明' },
    actor,
    customers,
  );
  assert.deepEqual(edited.supplements, second.supplements);
});

test('拒绝空内容、重复附件、超限附件和不支持的文件类型', () => {
  assert.throws(
    () =>
      addProjectSupplement(
        project(),
        actor,
        { ...input, comment: '  ' },
        users,
      ),
    /评论或上传附件/,
  );
  assert.throws(
    () =>
      addProjectSupplement(
        project(),
        actor,
        { ...input, files: [file(), file()] },
        users,
      ),
    /重复/,
  );
  assert.throws(
    () =>
      addProjectSupplement(
        project(),
        actor,
        { ...input, files: [file('程序.exe')] },
        users,
      ),
    /请上传/,
  );
  const blob = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]);
  assert.throws(
    () =>
      addProjectSupplement(
        project(),
        actor,
        { ...input, files: [{ ...file(), blob, size: blob.size }] },
        users,
      ),
    /20 MB/,
  );
});

test('@用户须为已启用内部协作人，并校验文本范围和姓名', () => {
  const mention = insertMention('', [], 0, 0, users[0]);
  const submission = {
    ...input,
    comment: mention.comment,
    mentions: mention.mentions,
  };
  assert.throws(
    () => addProjectSupplement(project(), actor, submission, users),
    /可选范围/,
  );
  const record = {
    ...project(),
    collaborators: { internal: [{ id: 'u', name: '张三', details: '' }] },
  };
  assert.equal(
    addProjectSupplement(record, actor, submission, users).supplements[0]
      .mentions[0].userId,
    'u',
  );
  assert.throws(
    () =>
      addProjectSupplement(record, actor, submission, [
        { ...users[0], status: '停用' },
      ]),
    /停用/,
  );
  assert.throws(
    () =>
      addProjectSupplement(
        record,
        actor,
        { ...submission, comment: '@李四 ' },
        users,
      ),
    /内容已变更/,
  );
});

test('未结束阶段可补充，已结束项目及未授权身份不能发布', () => {
  for (const status of ['待启动', '进行中', '待复核', '待确认'])
    assert.equal(
      addProjectSupplement({ ...project(), status }, actor, input, users)
        .supplements.length,
      1,
    );
  for (const status of ['已完成', '已取消'])
    assert.throws(
      () => addProjectSupplement({ ...project(), status }, actor, input, users),
      /不可发布/,
    );
  for (const role of ['客户', '合作伙伴服务工程师', 'SmartX 销售经理'])
    assert.throws(
      () => addProjectSupplement(project(), { ...actor, role }, input, users),
      /不可发布/,
    );
});

test('客户可 @ 当前服务方的有效合作伙伴协作人，候选与发布校验保持一致', () => {
  const customer = { id: 'contact', name: '客户联系人', role: '客户' };
  const partnerUser = { id: 'partner-user', name: '伙伴工程师', partnerId: 'p1', status: '启用' };
  const directory = {
    customers, contacts: [{ id: customer.id, customerId: 'c', status: '启用' }], users,
    partners: [{ id: 'p1', status: '启用' }, { id: 'p2', status: '启用' }],
    partnerUsers: [partnerUser, { ...partnerUser, id: 'unrelated' }],
  };
  const record = { ...project(), serviceProviderId: 'partner:p1', collaborators: {
    customer: [{ id: customer.id, name: customer.name }],
    internal: [{ id: 'u', name: '张三' }],
    partner: [{ id: partnerUser.id, name: partnerUser.name }],
  } };
  const mention = insertMention('', [], 0, 0, partnerUser);
  const submission = { ...input, comment: mention.comment, mentions: mention.mentions };
  assert.deepEqual(customerServiceProject(record, directory).supplementMentionUsers.map(user => [user.id, user.group]), [['u', 'internal'], ['partner-user', 'partner'], ['contact', 'customer']]);
  const saved = addProjectSupplement(record, customer, submission, users, directory);
  assert.deepEqual(saved.supplements[0].mentions, mention.mentions);
  assert.equal(saved.supplements[0].externalVisible, true);
  assert.equal(customerServiceProject(saved, directory).supplements[0].mentions[0].userId, partnerUser.id);
  const invalidCases = [
    [{ ...record, serviceProviderId: 'provider:smartx' }, directory],
    [{ ...record, serviceProviderId: '' }, directory],
    [{ ...record, serviceProviderId: 'partner:p2' }, directory],
    [{ ...record, collaborators: { ...record.collaborators, partner: [] } }, directory],
    [record, { ...directory, partnerUsers: [{ ...partnerUser, status: '停用' }] }],
    [record, { ...directory, partnerUsers: [{ ...partnerUser, partnerId: 'p2' }] }],
    [record, { ...directory, partners: [{ id: 'p1', status: '停用' }] }],
  ];
  for (const [current, refs] of invalidCases) {
    assert.deepEqual(customerServiceProject(current, refs).supplementMentionUsers.map(user => user.id), ['u', 'contact']);
    assert.throws(() => addProjectSupplement(current, customer, submission, users, refs), /可选范围/);
  }
});
