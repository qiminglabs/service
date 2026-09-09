import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureLocalInternalUsers,
  localInternalUsers,
  operationIdentities,
  roleSwitchIdentities,
  resolveOperationActor,
} from './internal-users.ts';
import {
  ensurePartnerSamples,
  samplePartners,
  samplePartnerUsers,
} from './partner-directory.ts';
const sources = {
  customers: [{ id: 'CUS-001', name: '测试客户', status: '启用' }],
  contacts: [
    { id: 'CON-001', customerId: 'CUS-001', name: '周宁', status: '启用' },
  ],
  partners: samplePartners,
  partnerUsers: samplePartnerUsers,
};
import {
  canApprove,
  canEvaluate,
  isInternal,
  migrateRoleLabel,
  applyRequestAction,
} from './request-operations.ts';

test('固定身份覆盖全部六种角色，不接受独立角色参数', () => {
  const identities = operationIdentities(localInternalUsers, sources);
  assert.deepEqual(
    [...new Set(identities.map((u) => u.role))].sort(),
    [
      'SmartX 系统管理员',
      'SmartX 销售经理',
      'SmartX 项目经理',
      'SmartX 服务工程师',
      '合作伙伴服务工程师',
      '客户',
    ].sort(),
  );
  assert.equal(
    resolveOperationActor(localInternalUsers, 'USR-001', sources).role,
    'SmartX 销售经理',
  );
  assert.equal(resolveOperationActor(localInternalUsers, '').id, 'USR-006');
  assert.equal(resolveOperationActor(localInternalUsers, 'missing').id, '');
  assert.equal(
    resolveOperationActor(
      localInternalUsers.map((u) => ({ ...u, status: '停用' })),
      'USR-001',
    ).id,
    '',
  );
  assert.equal(resolveOperationActor([], '').id, '');
});

test('升级旧目录只补齐缺失用户，保留原有姓名、状态、用户编号且不会重复', () => {
  const original = [
    { ...localInternalUsers[0], name: '已修改姓名', status: '停用' },
    { id: 'custom-1', name: '自建用户', status: '启用' },
  ];
  const updated = ensureLocalInternalUsers(original);
  assert.deepEqual(updated.slice(0, 2), original);
  assert.deepEqual(ensureLocalInternalUsers(updated), updated);
  assert.ok(updated.some((u) => u.id === 'USR-006'));
  assert.ok(updated.some((u) => u.id === 'USR-007'));
  assert.ok(
    updated.every((u) => !['demo-partner-1', 'demo-customer-1'].includes(u.id)),
  );
  assert.ok(!operationIdentities(updated).some((u) => u.id === 'custom-1'));
});

test('旧角色显示迁移不改写真实人名，迁移重复执行结果一致', () => {
  const roles = {
    'SmartX 员工': 'SmartX 销售经理',
    销售经理: 'SmartX 销售经理',
    系统管理员: 'SmartX 系统管理员',
    销售: 'SmartX 销售经理',
    售前: 'SmartX 销售经理',
    PMO: 'SmartX 销售经理',
    审批人: 'SmartX 销售经理',
    项目经理: 'SmartX 项目经理',
    服务工程师: 'SmartX 服务工程师',
  };
  for (const [oldRole, newRole] of Object.entries(roles)) {
    assert.equal(migrateRoleLabel(oldRole), newRole);
    assert.equal(migrateRoleLabel(newRole), newRole);
  }
  assert.equal(migrateRoleLabel('王琪'), '王琪');
});

test('旧管理员迁移保留编号状态，外部身份严格来自主数据', () => {
  const previous = {
    ...localInternalUsers.find((user) => user.id === 'USR-006'),
    name: '系统管理员',
    status: '停用',
  };
  const migrated = ensureLocalInternalUsers([previous]);
  assert.deepEqual(migrated[0], { ...previous, name: '陆明' });
  assert.equal(previous.name, '系统管理员');
  assert.deepEqual(ensureLocalInternalUsers(migrated), migrated);
  assert.equal(
    ensureLocalInternalUsers([{ ...previous, name: '自定义姓名' }])[0].name,
    '自定义姓名',
  );
  const identities = operationIdentities(localInternalUsers, sources);
  assert.equal(identities.find((user) => user.id === 'USR-006').name, '陆明');
  assert.equal(
    identities.find((user) => user.id === samplePartnerUsers[0].id).name,
    samplePartnerUsers[0].name,
  );
  assert.equal(identities.find((user) => user.id === 'CON-001').name, '周宁');
  assert.ok(!identities.some((user) => user.id.startsWith('demo-')));
  assert.deepEqual(operationIdentities([]), []);
});

test('SmartX 销售经理只保留两名启用身份，其他历史用户停用但不删除', () => {
  const previous = localInternalUsers.map((user) => ({
    ...user,
    status: '启用',
  }));
  const migrated = ensureLocalInternalUsers(previous);
  assert.deepEqual(
    operationIdentities(migrated)
      .filter((actor) => actor.role === 'SmartX 销售经理')
      .map((actor) => actor.id),
    ['USR-001', 'USR-002'],
  );
  assert.equal(migrated.length, previous.length);
  for (const id of ['USR-005', 'USR-007'])
    assert.equal(migrated.find((user) => user.id === id).status, '停用');
  assert.deepEqual(ensureLocalInternalUsers(migrated), migrated);
});

test('主数据改名立即反映到身份列表，停用用户或所属组织后不可选择', () => {
  const changed = {
    ...sources,
    contacts: [{ ...sources.contacts[0], name: '已修改联系人' }],
    partnerUsers: [{ ...samplePartnerUsers[0], name: '已修改伙伴用户' }],
  };
  assert.equal(
    resolveOperationActor(localInternalUsers, 'CON-001', changed).name,
    '已修改联系人',
  );
  assert.equal(
    resolveOperationActor(localInternalUsers, samplePartnerUsers[0].id, changed)
      .name,
    '已修改伙伴用户',
  );
  const inactive = {
    ...changed,
    contacts: changed.contacts.map((record) => ({ ...record, status: '停用' })),
    partnerUsers: changed.partnerUsers.map((record) => ({
      ...record,
      status: '停用',
    })),
  };
  assert.deepEqual(operationIdentities([], inactive), []);
  assert.deepEqual(
    operationIdentities([], { ...changed, customers: [], partners: [] }),
    [],
  );
  assert.deepEqual(
    operationIdentities([], {
      ...changed,
      customers: changed.customers.map((record) => ({
        ...record,
        status: '停用',
      })),
      partners: changed.partners.map((record) => ({
        ...record,
        status: '停用',
      })),
    }),
    [],
  );
  assert.equal(resolveOperationActor([], 'CON-001', inactive).id, '');
});

test('补充三家合作伙伴和五名用户，重复加载不覆盖或重新启用已有记录', () => {
  const seeded = ensurePartnerSamples([], []);
  assert.equal(seeded.partners.length, 3);
  assert.equal(seeded.partnerUsers.length, 5);
  for (const user of seeded.partnerUsers)
    assert.ok(seeded.partners.some((partner) => partner.id === user.partnerId));
  const modifiedPartners = seeded.partners.map((partner) => ({
    ...partner,
    name: `${partner.name}已修改`,
    status: '停用',
  }));
  const modifiedUsers = seeded.partnerUsers.map((user) => ({
    ...user,
    name: `${user.name}已修改`,
    status: '停用',
  }));
  assert.deepEqual(ensurePartnerSamples(modifiedPartners, modifiedUsers), {
    partners: modifiedPartners,
    partnerUsers: modifiedUsers,
  });
  const existing = [{ id: 'PAR-001', name: '用户自建伙伴', status: '启用' }];
  assert.deepEqual(ensurePartnerSamples(existing, []).partners[0], existing[0]);
  const sameNamePartner = [{ ...samplePartners[0], id: 'PAR-002' }];
  const merged = ensurePartnerSamples(sameNamePartner, []);
  assert.equal(merged.partners.length, 3);
  assert.equal(merged.partnerUsers[0].partnerId, 'PAR-002');
});

test('切换菜单每种角色仅一人，姓名来自目录，不缩减原始人员名单', () => {
  const identities = operationIdentities(localInternalUsers, sources);
  const before = structuredClone(identities);
  const choices = roleSwitchIdentities(identities, 'USR-006');
  assert.equal(choices.length, 6);
  assert.equal(new Set(choices.map((actor) => actor.role)).size, 6);
  assert.equal(
    choices.find((actor) => actor.role === 'SmartX 销售经理').id,
    'USR-001',
  );
  assert.ok(choices.every((actor) => identities.includes(actor)));
  assert.deepEqual(identities, before);
  assert.equal(
    identities.filter((actor) => actor.role === 'SmartX 销售经理').length,
    2,
  );
});

test('菜单去重保留当前同角色人员，停用后从有效目录取替代人员', () => {
  const identities = operationIdentities(localInternalUsers, sources);
  for (const selectedId of ['USR-002', samplePartnerUsers[1].id]) {
    const choices = roleSwitchIdentities(identities, selectedId);
    assert.ok(choices.some((actor) => actor.id === selectedId));
    assert.equal(
      new Set(choices.map((actor) => actor.role)).size,
      choices.length,
    );
  }
  const remaining = identities.filter((actor) => actor.id !== 'USR-001');
  assert.equal(
    roleSwitchIdentities(remaining, 'USR-001').find(
      (actor) => actor.role === 'SmartX 销售经理',
    ).id,
    'USR-002',
  );
  assert.deepEqual(roleSwitchIdentities([], 'missing'), []);
});

test('员工与管理员承接评估审批，外部身份不可操作内部模块', () => {
  for (const role of ['SmartX 销售经理', 'SmartX 系统管理员']) {
    assert.equal(canEvaluate(role), true);
    assert.equal(canApprove(role), true);
  }
  for (const role of ['SmartX 项目经理', 'SmartX 服务工程师']) {
    assert.equal(isInternal(role), true);
    assert.equal(canApprove(role), false);
  }
  for (const role of ['合作伙伴服务工程师', '客户', '销售', 'PMO', 'unknown']) {
    assert.equal(isInternal(role), false);
    assert.equal(canApprove(role), false);
    assert.throws(
      () =>
        applyRequestAction(
          { status: '待评估' },
          { type: 'meeting-create', title: '会议', participantNames: [] },
          { id: 'x', name: 'x', role },
          [],
        ),
      /内部操作人/,
    );
  }
});
