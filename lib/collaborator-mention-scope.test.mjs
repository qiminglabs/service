import test from 'node:test';
import assert from 'node:assert/strict';
import { supplementMentionUsers, insertMention } from './supplement-mentions.ts';
import { addSupplement } from './request-supplements.ts';
import { fixedInternalCollaboratorLabel } from './request-collaboration.ts';
import { projectCollaboratorRoleLabels } from './service-project-collaborators.ts';
import { customerServiceProject } from './customer-service-projects.ts';
import { projectSupplementMentionUsers, addProjectSupplement } from './service-project-supplements.ts';

const users = ['manager', 'applicant', 'owner', 'engineer', 'outsider'].map(id => ({ id, name: id, status: '启用', email: `${id}@smartx.com`, department: '' }));
const contacts = ['customer', 'other-contact'].map(id => ({ id, name: id, customerId: 'c', status: '启用', email: `${id}@customer.com` }));
const directory = { users, contacts, customers: [{ id: 'c', name: '客户公司', status: '启用', ownerUserId: 'owner' }], partners: [{ id: 'partner', name: '合作伙伴公司', status: '启用' }], partnerUsers: ['partner-user', 'unrelated-partner'].map(id => ({ id, name: id, partnerId: 'partner', status: '启用', email: `${id}@partner.com`, phone: '' })) };
const internal = { id: 'manager', name: 'manager', role: 'SmartX 项目经理' };
const engineer = { id: 'engineer', name: 'engineer', role: 'SmartX 服务工程师' };
const customer = { id: 'customer', name: 'customer', role: '客户' };
const partner = { id: 'partner-user', name: 'partner-user', role: '合作伙伴服务工程师' };
const request = { id: 'r', customerId: 'c', status: '草稿', createdById: 'applicant', createdByAudience: 'internal',
  internalParticipants: users.filter(user => user.id !== 'outsider').map(user => ({ userId: user.id, name: user.name })),
  externalCollaborators: [{ contactId: 'customer', name: 'customer' }], partnerCollaborators: [{ userId: partner.id, name: partner.name }],
  operations: { assessment: { managerId: 'manager' } } };
const project = { id: 'p', customerId: 'c', serviceProviderId: 'partner:partner', status: '进行中', revision: 1,
  collaborators: { internal: users.filter(user => user.id !== 'outsider').map(user => ({ id: user.id, name: user.name, assignmentRoles: user.id === 'manager' ? ['项目经理'] : user.id === 'applicant' ? ['申请人'] : [] })), customer: [{ id: 'customer', name: 'customer' }], partner: [{ id: partner.id, name: partner.name }] } };
const ids = values => values.map(user => user.id).sort();
const allIds = ['manager', 'applicant', 'owner', 'engineer', 'partner-user', 'customer'].sort();
const customerIds = allIds;

test('请求三类身份的候选对应其可见区域，客户与内部均可提及已加入的 SmartX 协作人', () => {
  for (const actor of [internal, engineer, partner, customer]) {
    const candidates = supplementMentionUsers(request, actor, users, contacts, directory);
    assert.deepEqual(ids(candidates), actor === customer ? customerIds : allIds);
    assert.equal(candidates.find(user => user.id === partner.id).companyName, '合作伙伴公司');
    assert.equal(candidates.find(user => user.id === customer.id).companyName, '客户公司');
  }
  for (const actor of [internal, customer]) {
    for (const user of supplementMentionUsers(request, actor, users, contacts, directory)) {
      const mention = insertMention('', [], 0, 0, user);
      assert.doesNotThrow(() => addSupplement(request, actor, 'c', { ...mention, id: 'message', authorId: actor.id, author: actor.name, at: new Date().toISOString(), files: [], externalVisible: true }, users, contacts, directory));
    }
  }
  const mention = insertMention('', [], 0, 0, users.find(user => user.id === 'outsider'));
  assert.throws(() => addSupplement(request, customer, 'c', { ...mention, id: 'message', authorId: customer.id, author: customer.name, at: new Date().toISOString(), files: [], externalVisible: true }, users, contacts, directory), /可选范围/);
});

test('项目三类身份可发布给可见协作人，客户候选与 SmartX 协作人投影一致', () => {
  for (const actor of [internal, engineer, partner, customer]) {
    const candidates = projectSupplementMentionUsers(project, actor, users, contacts, directory);
    assert.deepEqual(ids(candidates), actor === customer ? customerIds : allIds);
    for (const user of candidates) {
      const mention = insertMention('', [], 0, 0, user);
      assert.doesNotThrow(() => addProjectSupplement(project, actor, { ...mention, files: [], externalVisible: true }, users, directory));
    }
  }
  const visible = customerServiceProject(project, directory);
  assert.deepEqual(ids(visible.supplementMentionUsers), customerIds);
  assert.deepEqual(ids(visible.internalCollaborators), ids(visible.supplementMentionUsers.filter(user => user.group === 'internal')));
  assert.equal(JSON.stringify(visible).includes('engineer@smartx.com'), true);
});

test('候选与发布均排除停用、未关联和跨客户成员，不会自动添加协作人', () => {
  const originalRequest = structuredClone(request), originalProject = structuredClone(project);
  for (const invalidDirectory of [
    { ...directory, partnerUsers: directory.partnerUsers.map(user => ({ ...user, status: '停用' })) },
    { ...directory, partners: directory.partners.map(company => ({ ...company, status: '停用' })) },
  ]) {
    const mention = insertMention('', [], 0, 0, directory.partnerUsers[0]);
    assert.equal(supplementMentionUsers(request, internal, users, contacts, invalidDirectory).some(user => user.id === partner.id), false);
    assert.equal(projectSupplementMentionUsers(project, internal, users, contacts, invalidDirectory).some(user => user.id === partner.id), false);
    assert.throws(() => addProjectSupplement(project, internal, { ...mention, files: [], externalVisible: true }, users, invalidDirectory), /可选范围/);
  }
  const foreignContacts = contacts.map(person => ({ ...person, customerId: 'other-company' }));
  assert.equal(supplementMentionUsers(request, internal, users, foreignContacts, directory).some(user => user.id === customer.id), false);
  assert.equal(projectSupplementMentionUsers(project, internal, users, foreignContacts, directory).some(user => user.id === customer.id), false);
  assert.deepEqual(request, originalRequest);
  assert.deepEqual(project, originalProject);
});

test('内外部协作人身份统一显示客户经理，历史角色数据保持有效', () => {
  const roles = ['客户所有人', '项目经理', '申请人'];
  assert.deepEqual(projectCollaboratorRoleLabels(roles), ['客户经理', '项目经理', '申请人']);
  assert.equal(fixedInternalCollaboratorLabel('owner', 'owner', 'owner'), '客户经理 · 申请人');
  const source = { ...project, collaborators: { ...project.collaborators, internal: [{ id: 'owner', name: 'owner', assignmentRoles: roles }] } };
  assert.deepEqual(customerServiceProject(source, directory).internalCollaborators[0].roles, projectCollaboratorRoleLabels(roles));
  assert.deepEqual(roles, ['客户所有人', '项目经理', '申请人']);
});
