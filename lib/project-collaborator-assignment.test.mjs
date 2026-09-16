import test from 'node:test';
import assert from 'node:assert/strict';
import { assignInitialProjectCollaborators } from './project-collaborator-assignment.ts';
const actor = { id: 'manager', name: '经理', role: 'SmartX 项目经理' };
function directory() {
  return {
    customers: [{ id: 'c', ownerUserId: 'owner' }],
    users: ['owner', 'manager', 'applicant'].map(id => ({ id, name: `人员-${id}`, email: `${id}@example.com`, status: '启用' })),
    contacts: [{ id: 'contact', customerId: 'c', name: '客户联系人', status: '启用', email: 'contact@example.com' }, { id: 'other', customerId: 'other-customer', name: '其他客户', status: '启用' }],
    partners: [], partnerUsers: [],
  };
}
const request = { customerId: 'c', createdById: 'applicant', createdByAudience: 'internal', operations: { assessment: { managerId: 'manager' } }, externalCollaborators: [{ contactId: 'contact', name: '旧姓名', phone: '', email: '' }] };
test('转项目带入客户所有人、负责项目经理、内部申请人及原客户协作人，按编号去重并独立保存', () => {
  const dir = directory();
  const before = structuredClone(request);
  const result = assignInitialProjectCollaborators('c', actor, dir, {}, request);
  assert.deepEqual(result.internal.map(person => person.id), ['owner', 'manager', 'applicant']);
  assert.deepEqual(result.internal.map(person => person.assignmentRoles), [['客户所有人'], ['项目经理'], ['请求申请人']]);
  assert.deepEqual(result.customer[0].assignmentRoles, ['原客户协作人']);
  assert.equal(result.customer[0].name, '客户联系人');
  assert.equal(result.customer[0].details, 'contact@example.com');
  result.customer[0].name = '项目独立修改';
  assert.deepEqual(request, before);
  const duplicate = assignInitialProjectCollaborators('c', actor, { ...dir, customers: [{ id: 'c', ownerUserId: 'manager' }] }, {}, { ...request, createdById: 'manager' });
  assert.deepEqual(duplicate.internal.map(person => person.id), ['manager']);
  assert.deepEqual(duplicate.internal[0].assignmentRoles, ['客户所有人', '项目经理', '请求申请人']);
});
test('客户申请人归客户组，路由后的项目经理优先，不带入其他客户联系人', () => {
  const result = assignInitialProjectCollaborators('c', actor, directory(), {}, {
    ...request, createdByAudience: 'customer', createdById: 'contact',
    operations: { assessment: { managerId: 'applicant', routing: { manager: { userId: 'manager' } } } },
    externalCollaborators: [{ contactId: 'other', name: '其他客户' }],
  });
  assert.deepEqual(result.internal.map(person => person.id), ['owner', 'manager']);
  assert.deepEqual(result.customer.map(person => person.id), ['contact']);
  assert.deepEqual(result.customer[0].assignmentRoles, ['原客户协作人', '请求申请人']);
  assert.throws(() => assignInitialProjectCollaborators('other-customer', actor, directory(), {}, request), /客户不一致/);
});
test('直接创建加入客户所有人和当前项目经理，保留已选人员；停用内部人员不自动加入', () => {
  const dir = directory();
  const selected = { internal: [{ id: 'manager', name: '经理', details: '' }], customer: [{ id: 'contact', name: '客户', details: '' }] };
  const result = assignInitialProjectCollaborators('c', actor, dir, selected);
  assert.deepEqual(result.internal.map(person => person.id), ['manager', 'owner']);
  assert.deepEqual(result.internal[0].assignmentRoles, ['项目经理', '申请人']);
  assert.deepEqual(result.customer, selected.customer);
  assert.equal(selected.internal.length, 1);
  dir.users.find(person => person.id === 'owner').status = '停用';
  assert.deepEqual(assignInitialProjectCollaborators('c', actor, dir).internal.map(person => person.id), ['manager']);
  assert.equal(assignInitialProjectCollaborators('c', { id: 'partner', role: '合作伙伴服务工程师' }, dir).internal, undefined);
});
test('内部直接创建自动加入内部申请人并合并身份，外部创建不加入内部组', () => {
  const dir = directory();
  const creator = { id: 'applicant', name: '申请人', role: 'SmartX 系统管理员' };
  const result = assignInitialProjectCollaborators('c', creator, dir);
  assert.deepEqual(result.internal.map(person => person.id), ['owner', 'applicant']);
  assert.deepEqual(result.internal[1].assignmentRoles, ['申请人']);
  const ownerCreator = assignInitialProjectCollaborators('c', { ...creator, id: 'owner' }, dir);
  assert.equal(ownerCreator.internal.length, 1);
  assert.deepEqual(ownerCreator.internal[0].assignmentRoles, ['客户所有人', '申请人']);
  for (const roles of ['合作伙伴服务工程师', '客户']) {
    const external = assignInitialProjectCollaborators('c', { ...creator, role: roles }, dir);
    assert.deepEqual(external.internal.map(person => person.id), ['owner']);
  }
  const converted = assignInitialProjectCollaborators('c', creator, dir, {}, request);
  assert.ok(converted.internal.every(person => !person.assignmentRoles.includes('申请人')));
});

test('合作伙伴中心创建时自动加入伙伴申请人，已选创建人去重，停用身份不新增', () => {
  const dir = { ...directory(), partners: [{ id: 'p', name: '伙伴', status: '启用' }],
    partnerUsers: [{ id: 'creator', name: '创建人', partnerId: 'p', status: '启用', phone: '13800000000', email: 'creator@example.com' }] };
  const actor = { id: 'creator', name: '旧姓名', role: '合作伙伴服务工程师' };
  const result = assignInitialProjectCollaborators('c', actor, dir);
  assert.deepEqual(result.partner, [{ id: 'creator', name: '创建人', details: '13800000000 · creator@example.com', assignmentRoles: ['申请人'] }]);
  const selected = { partner: [{ id: 'creator', name: '创建人', details: '', assignmentRoles: ['其他身份'] }] };
  const duplicate = assignInitialProjectCollaborators('c', actor, dir, selected);
  assert.equal(duplicate.partner.length, 1);
  assert.deepEqual(duplicate.partner[0].assignmentRoles, ['其他身份', '申请人']);
  assert.deepEqual(selected.partner[0].assignmentRoles, ['其他身份']);
  assert.equal(assignInitialProjectCollaborators('c', actor, { ...dir, partners: [{ ...dir.partners[0], status: '停用' }] }).partner, undefined);
});
test('原客户协作人停用或已删除时仍保留历史快照，避免转项目丢失原成员', () => {
  const dir = directory(); dir.contacts[0].status = '停用';
  assert.equal(assignInitialProjectCollaborators('c', actor, dir, {}, request).customer[0].id, 'contact');
  dir.contacts = [];
  assert.equal(assignInitialProjectCollaborators('c', actor, dir, {}, request).customer[0].name, '旧姓名');
});
