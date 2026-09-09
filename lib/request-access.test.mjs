import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessRequest,
  canAddExternalCollaborators,
  customerCollaborationIssue,
  requestStatuses,
  canCreateRequest,
  requestCreationAccessIssue,
  newRequest,
  requestIdentityIssue,
} from './service-requests.ts';

const actor = { id: 'u1', name: '王琪', role: 'SmartX 销售经理' };
const directory = [actor, { id: 'u2', name: '林澈' }];
const access = { actor, directory };
const record = newRequest('请求', 'c1', '林澈', 'contact1', 'u2');

test('客户在全部状态可为可见请求添加本组织协作人，新增人员获得访问权', () => {
  const context = { actor: { ...actor, role: '客户' }, directory, customerId: 'c1', contacts: [{ id: 'new-contact', name: '同事', customerId: 'c1', status: '启用' }] };
  const person = { contactId: 'new-contact', name: '同事', phone: '', email: '' };
  for (const status of requestStatuses) {
    const existing = { ...record, status, createdById: actor.id };
    const next = { ...existing, externalCollaborators: [person] };
    assert.equal(canAddExternalCollaborators(existing, context), true);
    assert.equal(customerCollaborationIssue(next, existing, context), null);
    assert.equal(requestIdentityIssue(next, existing), null);
    assert.equal(canAccessRequest(next, { ...context, actor: { id: person.contactId, name: person.name, role: '客户' } }), true);
  }
});

test('不可见请求不能自行加人，客户不能删除已有协作人或添加其他组织及停用联系人', () => {
  const context = { actor: { ...actor, role: '客户' }, directory, customerId: 'c1', contacts: [{ id: 'p1', name: '同事', customerId: 'c1', status: '启用' }] };
  const person = { contactId: 'p1', name: '同事', phone: '', email: '' };
  const own = { ...record, createdById: actor.id, externalCollaborators: [person] };
  assert.equal(canAddExternalCollaborators(record, context), false);
  assert.match(customerCollaborationIssue({ ...record, externalCollaborators: [person] }, record, context), /无权/);
  assert.match(customerCollaborationIssue({ ...own, externalCollaborators: [] }, own, context), /不能移除/);
  const empty = { ...own, externalCollaborators: [] };
  for (const contact of [{ ...context.contacts[0], customerId: 'c2' }, { ...context.contacts[0], status: '停用' }]) {
    assert.match(customerCollaborationIssue(own, empty, { ...context, contacts: [contact] }), /当前客户已启用/);
  }
  assert.equal(canAddExternalCollaborators(own, { ...context, actor: { ...actor, role: '合作伙伴服务工程师' } }), false);
});

test('合作伙伴不能创建请求，已有协作记录仍可访问', () => {
  const context = { ...access, actor: { ...actor, role: '合作伙伴服务工程师' } };
  const own = { ...record, createdById: actor.id };
  assert.equal(canCreateRequest(context), false);
  assert.match(requestCreationAccessIssue(own, context), /不能创建/);
  assert.equal(canAccessRequest({ ...record, externalCollaborators: [{ contactId: actor.id }] }, context), true);
});

test('客户只能为当前组织创建请求，缺失组织或伪造创建人被拒绝', () => {
  const context = { ...access, actor: { ...actor, role: '客户' }, customerId: 'c1' };
  const own = { ...record, createdById: actor.id };
  assert.equal(canCreateRequest(context), true);
  assert.equal(requestCreationAccessIssue(own, context), null);
  assert.match(requestCreationAccessIssue({ ...own, customerId: 'c2' }, context), /所属客户/);
  assert.equal(canCreateRequest({ ...context, customerId: undefined }), false);
  assert.match(requestCreationAccessIssue(record, context), /创建人/);
  assert.equal(requestCreationAccessIssue({ ...own, customerId: 'c2' }, access), null);
});

test('管理员看全部，其他身份仅看本人创建或按编号加入协作的记录', () => {
  assert.equal(
    canAccessRequest(record, {
      ...access,
      actor: { ...actor, role: 'SmartX 系统管理员' },
    }),
    true,
  );
  for (const role of [
    'SmartX 销售经理',
    'SmartX 服务工程师',
    '客户',
    '合作伙伴服务工程师',
  ]) {
    const context = { ...access, actor: { ...actor, role } };
    assert.equal(canAccessRequest(record, context), false);
    assert.equal(
      canAccessRequest({ ...record, createdById: actor.id }, context),
      true,
    );
    assert.equal(
      canAccessRequest(
        {
          ...record,
          internalParticipants: [{ userId: actor.id, name: '旧姓名' }],
        },
        context,
      ),
      true,
    );
    assert.equal(
      canAccessRequest(
        {
          ...record,
          externalCollaborators: [
            { contactId: actor.id, name: '旧姓名', phone: '', email: '' },
          ],
        },
        context,
      ),
      true,
    );
    assert.equal(
      canAccessRequest({ ...record, contactId: actor.id }, context),
      false,
    );
    assert.equal(
      canAccessRequest({ ...record, createdBy: actor.name }, context),
      false,
    );
  }
});

test('去掉协作后不可见，同名人员和空身份不能获得记录权限', () => {
  const shared = {
    ...record,
    internalParticipants: [{ userId: actor.id, name: actor.name }],
  };
  assert.equal(canAccessRequest(shared, access), true);
  assert.equal(
    canAccessRequest({ ...shared, internalParticipants: [] }, access),
    false,
  );
  assert.equal(
    canAccessRequest(shared, {
      ...access,
      actor: { ...actor, id: 'same-name' },
    }),
    false,
  );
  assert.equal(
    canAccessRequest(shared, {
      ...access,
      actor: { ...actor, id: '', role: 'SmartX 系统管理员' },
    }),
    false,
  );
});

test('旧记录仅唯一姓名可识别创建者，角色占位和重名不授权', () => {
  const legacy = newRequest('旧请求', 'c1', actor.name, 'contact1');
  assert.equal(canAccessRequest(legacy, access), true);
  assert.equal(
    canAccessRequest(legacy, {
      ...access,
      directory: [...directory, { id: 'duplicate', name: actor.name }],
    }),
    false,
  );
  assert.equal(
    canAccessRequest({ ...legacy, createdBy: '销售', owner: '销售' }, access),
    false,
  );
});

test('新记录保存创建人编号，创建后不允许改写或清除编号', () => {
  assert.equal(record.createdById, 'u2');
  assert.equal(requestIdentityIssue({ ...record }, record), null);
  assert.match(
    requestIdentityIssue({ ...record, createdById: 'u1' }, record),
    /创建人/,
  );
  assert.match(
    requestIdentityIssue({ ...record, createdById: undefined }, record),
    /创建人/,
  );
});


test('项目经理查看全部请求，包括其他人创建且未参与协作的历史记录', () => {
  const context = { ...access, actor: { ...actor, role: 'SmartX 项目经理' } };
  assert.equal(canAccessRequest(record, context), true);
  assert.equal(canAccessRequest({ ...record, createdById: undefined, createdBy: '未知历史人员' }, context), true);
  assert.equal(canAccessRequest(record, { ...context, actor: { ...context.actor, id: '' } }), false);
});


test('客户仅作为联系人不可见，成为创建人或协作人后可见', () => {
  const context = { ...access, actor: { ...actor, id: 'contact1', role: '客户' } };
  assert.equal(canAccessRequest(record, context), false);
  assert.equal(canAccessRequest({ ...record, createdById: 'contact1' }, context), true);
  assert.equal(canAccessRequest({ ...record, externalCollaborators: [{ contactId: 'contact1' }] }, context), true);
  assert.equal(canAccessRequest({ ...record, contactId: 'contact2' }, context), false);
  assert.equal(canAccessRequest(record, { ...context, actor: { ...context.actor, id: 'contact2' } }), false);
  assert.equal(canAccessRequest({ ...record, contactId: '' }, { ...context, actor: { ...context.actor, id: '' } }), false);
});

test('评估方案指定销售和上级可访问请求，无关员工无权访问', () => {
  const record = { ...newRequest('服务申请', 'c1', '客户', 'c'), createdById: 'customer', status: '待评估', operations: { assessment: { tasks: [], plans: [{salesId:'sales'}], approvals: [{approverId:'boss'}] } } };
  const access = id => ({actor:{id,name:id,role:'SmartX 销售经理'},directory:[]});
  assert.equal(canAccessRequest(record,access('sales')),true);
  assert.equal(canAccessRequest(record,access('boss')),true);
  assert.equal(canAccessRequest(record,access('unrelated')),false);
});

test('内部人员也只能添加当前客户启用联系人，不接受合作伙伴或其他客户联系人', () => {
  const existing = { ...record, createdById: actor.id };
  const contacts = [
    { id: 'valid', name: '当前客户', customerId: 'c1', status: '启用' },
    { id: 'other', name: '其他客户', customerId: 'c2', status: '启用' },
    { id: 'inactive', name: '停用联系人', customerId: 'c1', status: '停用' },
  ];
  for (const role of ['SmartX 销售经理', 'SmartX 项目经理', 'SmartX 系统管理员', 'SmartX 服务工程师']) {
    const context = { ...access, actor: { ...actor, role }, contacts };
    const next = id => ({ ...existing, externalCollaborators: [{ contactId: id, name: '协作人', phone: '', email: '' }] });
    assert.equal(customerCollaborationIssue(next('valid'), existing, context), null);
    for (const id of ['other', 'inactive', 'partner-user']) {
      assert.match(customerCollaborationIssue(next(id), existing, context), /当前客户已启用/);
    }
    assert.equal(customerCollaborationIssue(existing, next('partner-user'), context), null);
  }
});

test('内部发起请求自动将创建人加入内部协作人，客户发起不添加', () => {
  for (const role of ['SmartX 系统管理员', 'SmartX 销售经理', 'SmartX 项目经理', 'SmartX 服务工程师']) {
    const created = newRequest('新请求', 'c1', '创建人姓名', 'contact', 'creator', role);
    assert.deepEqual(created.internalParticipants, [{ userId: 'creator', name: '创建人姓名' }]);
    assert.equal(created.createdById, 'creator');
  }
  assert.deepEqual(newRequest('客户请求', 'c1', '客户', 'contact', 'customer', '客户').internalParticipants, []);
  assert.deepEqual(newRequest('旧调用', 'c1', '用户', 'contact', 'creator').internalParticipants, []);
});

test('客户发起请求自动加入启用的客户所有人，内部发起仍加入本人', () => {
  const owner = { id: 'owner', name: '客户负责人', status: '启用', department: '销售部', email: 'owner@example.com' };
  const created = newRequest('客户申请', 'c1', '客户姓名', 'contact', 'customer', '客户', owner);
  assert.deepEqual(created.internalParticipants, [{ userId: 'owner', name: '客户负责人' }]);
  assert.equal(created.createdById, 'customer');
  assert.deepEqual(newRequest('未设置', 'c1', '客户', 'contact', 'customer', '客户').internalParticipants, []);
  assert.deepEqual(newRequest('已停用', 'c1', '客户', 'contact', 'customer', '客户', { ...owner, status: '停用' }).internalParticipants, []);
  assert.deepEqual(newRequest('内部申请', 'c1', '销售', 'contact', 'sales', 'SmartX 销售经理', owner).internalParticipants, [{ userId: 'sales', name: '销售' }]);
});

test('进入客户确认后当前客户联系人可见，拒绝退回后保留；前期及无关联系人不可见', () => {
  const context = { ...access, actor: { id: 'contact1', name: '客户联系人', role: '客户' }, customerId: 'c1', contacts: [{ id: 'contact1', name: '客户联系人', customerId: 'c1', status: '启用' }] };
  for (const status of ['草稿', '待评估', '已取消']) assert.equal(canAccessRequest({ ...record, status }, context), false);
  for (const status of ['待确认', '待受理', '已转服务项目']) {
    const next = { ...record, status };
    assert.equal(canAccessRequest(next, context), true);
    assert.equal(canAccessRequest(next, { ...context, customerId: 'c2' }), false);
    assert.equal(canAccessRequest(next, { ...context, actor: { ...context.actor, id: 'other' } }), false);
    assert.equal(canAccessRequest(next, { ...context, contacts: [{ ...context.contacts[0], status: '停用' }] }), false);
  }
  const rejected = { ...record, status: '待评估', operations: { customerDecisions: [{ accepted: false }] } };
  assert.equal(canAccessRequest(rejected, context), true);
  assert.equal(canAccessRequest({ ...rejected, status: '已取消' }, context), true);
});
