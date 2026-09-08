import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessRequest,
  canCreateRequest,
  requestCreationAccessIssue,
  newRequest,
  requestIdentityIssue,
} from './service-requests.ts';

const actor = { id: 'u1', name: '王琪', role: 'SmartX 员工' };
const directory = [actor, { id: 'u2', name: '林澈' }];
const access = { actor, directory };
const record = newRequest('请求', 'c1', '林澈', 'contact1', 'u2');

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
    'SmartX 员工',
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
      role === '客户',
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


test('客户联系人按本人编号授权，更换联系人后原联系人不再可见', () => {
  const context = { ...access, actor: { ...actor, id: 'contact1', role: '客户' } };
  assert.equal(canAccessRequest(record, context), true);
  assert.equal(canAccessRequest({ ...record, contactId: 'contact2' }, context), false);
  assert.equal(canAccessRequest(record, { ...context, actor: { ...context.actor, id: 'contact2' } }), false);
  assert.equal(canAccessRequest({ ...record, contactId: '' }, { ...context, actor: { ...context.actor, id: '' } }), false);
});
