import { withRequestCollaborators } from './request-collaboration.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { canAccessRequest, canAddExternalCollaborators, customerCollaborationIssue, requestStatuses, canCreateRequest, requestCreationAccessIssue, newRequest, requestIdentityIssue } from './service-requests.ts';
import { applicantRemovalIssue, isRequestApplicant, submissionCollaboratorsIssue, customerCollaboratorsIssue } from './request-collaboration.ts';
import { localInternalUsers } from './internal-users.ts';
const sales = { id: 'USR-001', name: '销售', role: 'SmartX 销售经理' };
const pm = { id: 'USR-003', name: '经理', role: 'SmartX 项目经理' };
const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
const customer = { id: 'p1', name: '客户', role: '客户' };
const contacts = [{ id: 'p1', name: '客户', customerId: 'c1', status: '启用' }, { id: 'p2', name: '同事', customerId: 'c1', status: '启用' }, { id: 'other', customerId: 'c2', status: '启用' }, { id: 'inactive', customerId: 'c1', status: '停用' }];
const users = localInternalUsers;
const owner = users.find(u => u.id === 'USR-003');
const customers = [{ id: 'c1', ownerUserId: owner.id }];
const access = actor => ({ actor, directory: users, customerId: 'c1', contacts });
const internal = () => newRequest('请求', 'c1', sales.name, sales.id, sales.role, owner);
const external = () => newRequest('客户请求', 'c1', customer.name, customer.id, customer.role, owner);
const person = id => ({ contactId: id, name: id, phone: '', email: '' });

test('内部申请默认所有人和申请人，客户协作人为空；身份重合去重', () => {
  const record = internal();
  assert.deepEqual(record.externalCollaborators, []);
  assert.equal(record.contactId, '');
  assert.deepEqual(record.internalParticipants.map(p => p.userId), [owner.id, sales.id]);
  assert.equal(applicantRemovalIssue(record), null);
  assert.match(applicantRemovalIssue({ ...record, internalParticipants: [record.internalParticipants[0]] }), /申请人/);
  assert.equal(newRequest('请求', 'c1', owner.name, owner.id, pm.role, owner).internalParticipants.length, 1);
});
test('客户申请固定本人，内部保留所有人；旧联系人不再补入且不丢失已添加协作人', () => {
  const record = external();
  assert.equal(record.externalCollaborators[0].contactId, customer.id);
  assert.match(applicantRemovalIssue({ ...record, externalCollaborators: [] }), /申请人/);
  const legacy = { ...internal(), createdByAudience: undefined, contactId: 'p1', externalCollaborators: [person('p2')] };
  assert.deepEqual(withRequestCollaborators(legacy, contacts, customers, users).externalCollaborators, [person('p2')]);
  const oldCustomer = { ...external(), createdByAudience: undefined, externalCollaborators: [] };
  assert.equal(withRequestCollaborators(oldCustomer, contacts, customers, users).externalCollaborators[0].contactId, 'p1');
});
test('创建人和管理员可提交，项目经理和其他客户协作人不可代提交', () => {
  for (const record of [internal(), external()]) {
    const actor = record.createdByAudience === 'customer' ? customer : sales;
    assert.equal(requestIdentityIssue({ ...record, status: '待评估' }, record, actor), null);
    for (const other of [undefined, pm, { id: 'p2', role: '客户' }])
      assert.match(requestIdentityIssue({ ...record, status: '待评估' }, record, other), /仅创建人/);
    assert.equal(requestIdentityIssue({ ...record, status: '待评估' }, record, { id: 'USR-006', role: 'SmartX 系统管理员' }), null);
    assert.match(requestIdentityIssue({ ...record, status: '待确认' }, record, actor), /仅创建人/);
    assert.match(requestIdentityIssue({ ...record, createdById: 'other' }, record, actor), /创建人/);
    assert.match(requestIdentityIssue({ ...record, createdByAudience: record.createdByAudience === 'customer' ? 'internal' : 'customer' }, record, actor), /创建人/);
  }
});
test('内部提交需要当前启用售前和客户联系人，客户申请不要求售前', () => {
  const record = internal();
  assert.match(submissionCollaboratorsIssue(record, contacts, users), /客户协作人/);
  record.externalCollaborators = [person('p1')];
  assert.match(submissionCollaboratorsIssue(record, contacts, users), /售前工程师/);
  record.internalParticipants.push({ userId: 'USR-002', name: '售前' });
  assert.equal(submissionCollaboratorsIssue(record, contacts, users), null);
  assert.match(submissionCollaboratorsIssue(record, contacts, users.map(u => u.id === 'USR-002' ? { ...u, status: '停用' } : u)), /售前/);
  record.internalParticipants.at(-1).userId = 'fake';
  record.internalParticipants.at(-1).role = 'SmartX 售前工程师';
  assert.match(submissionCollaboratorsIssue(record, contacts, users), /售前/);
  assert.equal(submissionCollaboratorsIssue(external(), contacts, []), null);
  for (const id of ['other', 'inactive', 'missing']) assert.match(customerCollaboratorsIssue({ ...external(), externalCollaborators: [person(id)] }, contacts), /已启用/);
});
test('客户协作人在草稿和待评估可增删，待确认及后续锁定，固定申请人除外', () => {
  for (const actor of [sales, pm, customer, hardware]) {
    for (const status of requestStatuses) {
      const record = { ...external(), status };
      if (actor === sales || actor === hardware) record.internalParticipants.push({ userId: actor.id, name: actor.name });
      const next = { ...record, externalCollaborators: [...record.externalCollaborators, person('p2')] };
      const allowed = ['草稿', '待评估'].includes(status);
      assert.equal(canAddExternalCollaborators(record, access(actor)), allowed);
      assert.equal(customerCollaborationIssue(next, record, access(actor)) === null, allowed);
      if (allowed) {
        assert.equal(customerCollaborationIssue(record, next, access(actor)), null);
        assert.match(customerCollaborationIssue({ ...next, externalCollaborators: [person('p2')] }, next, access(actor)), /申请人/);
        for (const id of ['other', 'inactive', 'partner']) assert.match(customerCollaborationIssue({ ...next, externalCollaborators: [...record.externalCollaborators, person(id)] }, record, access(actor)), /当前客户/);
      }
    }
  }
});
test('联系人字段不授予访问权，客户只通过本客户有效协作身份访问，伙伴不能冒用', () => {
  const record = internal();
  for (const status of requestStatuses) {
    assert.equal(canAccessRequest({ ...record, status, contactId: customer.id }, access(customer)), false);
    const shared = { ...record, status, externalCollaborators: [person(customer.id)] };
    assert.equal(canAccessRequest(shared, access(customer)), true);
    assert.equal(canAccessRequest(shared, { ...access(customer), customerId: 'c2' }), false);
    assert.equal(canAccessRequest(shared, { ...access(customer), contacts: contacts.map(c => ({ ...c, status: '停用' })) }), false);
    assert.equal(canAccessRequest(shared, access({ ...customer, role: '合作伙伴服务工程师' })), false);
    assert.equal(canAccessRequest({ ...shared, externalCollaborators: [] }, access(customer)), false);
  }
});
test('管理员与项目经理可查看全部，售前可创建且只查看本人或协作请求', () => {
  const presales = { id: 'USR-002', role: 'SmartX 售前工程师', name: '售前' };
  assert.equal(canCreateRequest(access(presales)), true);
  assert.equal(canAccessRequest(internal(), access(presales)), false);
  const shared = internal(); shared.internalParticipants.push({ userId: presales.id, name: '售前' });
  assert.equal(canAccessRequest(shared, access(presales)), true);
  for (const actor of [pm, { id: 'USR-006', role: 'SmartX 系统管理员' }]) assert.equal(canAccessRequest(internal(), access(actor)), true);
  assert.equal(canAccessRequest(internal(), access({ id: '', role: 'SmartX 系统管理员' })), false);
});
test('硬件产品经理可创建自己的申请，仅访问本人或参与协作的申请', () => {
  assert.equal(canCreateRequest(access(hardware)), true);
  const own = newRequest('硬件申请', 'c1', hardware.name, hardware.id, hardware.role, owner);
  assert.equal(isRequestApplicant(own, hardware), true);
  assert.equal(requestCreationAccessIssue(own, access(hardware)), null);
  assert.equal(canAccessRequest(own, access(hardware)), true);
  assert.equal(canAccessRequest(internal(), access(hardware)), false);
  const shared = internal();
  shared.internalParticipants.push({ userId: hardware.id, name: hardware.name });
  assert.equal(canAccessRequest(shared, access(hardware)), true);
  assert.equal(isRequestApplicant(shared, hardware), false);
});
test('创建必须由当前用户、所属客户和正确来源创建草稿，不能伪造跳过提交', () => {
  const record = external();
  assert.equal(requestCreationAccessIssue(record, access(customer)), null);
  for (const patch of [{ createdById: 'p2' }, { customerId: 'c2' }, { createdByAudience: 'internal' }, { status: '待评估' }]) assert.ok(requestCreationAccessIssue({ ...record, ...patch }, access(customer)));
  assert.equal(isRequestApplicant(record, { ...customer, role: 'SmartX 销售经理' }), false);
  assert.equal(isRequestApplicant(internal(), { ...sales, role: '合作伙伴服务工程师' }), false);
  assert.equal(canCreateRequest(access({ ...customer, role: '合作伙伴服务工程师' })), false);
});
test('旧请求仍按唯一姓名识别内部访问，角色占位与重名不授权提交', () => {
  const legacy = newRequest('旧请求', 'c1', sales.name);
  assert.equal(canAccessRequest(legacy, { ...access(sales), directory: [sales] }), true);
  assert.equal(canAccessRequest(legacy, { ...access(sales), directory: [sales, { id: 'same', name: sales.name }] }), false);
  assert.equal(isRequestApplicant(legacy, sales), false);
});
