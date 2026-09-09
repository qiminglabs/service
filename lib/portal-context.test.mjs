import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePortalContext,
  portalSwitchIdentities,
} from './portal-context.ts';
import { localInternalUsers, operationIdentities } from './internal-users.ts';

const sources = {
  customers: [
    { id: 'c1', name: '客户甲', status: '启用' },
    { id: 'c2', name: '客户乙', status: '启用' },
  ],
  contacts: [
    { id: 'u1', name: '联系人甲', customerId: 'c1', status: '启用' },
    { id: 'u2', name: '联系人乙', customerId: 'c2', status: '启用' },
  ],
  partners: [{ id: 'p1', name: '伙伴甲', status: '启用' }],
  partnerUsers: [
    { id: 'pu1', name: '伙伴工程师', partnerId: 'p1', status: '启用' },
  ],
};

test('菜单按公司和角色合并，保留当前身份且不修改完整目录', () => {
  const directory = {
    ...sources,
    contacts: [
      ...sources.contacts,
      { id: 'u3', name: '联系人丙', customerId: 'c1', status: '启用' },
    ],
  };
  const identities = operationIdentities(localInternalUsers, directory);
  const before = structuredClone(identities);
  const choices = portalSwitchIdentities(identities, 'u3', directory);
  assert.ok(choices.some((actor) => actor.id === 'u3'));
  assert.ok(!choices.some((actor) => actor.id === 'u1'));
  assert.ok(choices.some((actor) => actor.id === 'u2'));
  assert.equal(
    choices.filter((actor) => actor.role === 'SmartX 销售经理').length,
    1,
  );
  assert.ok(choices.some((actor) => actor.role === 'SmartX 系统管理员'));
  assert.ok(
    portalSwitchIdentities(identities, 'USR-002', directory).some(
      (actor) => actor.id === 'USR-002',
    ),
  );
  assert.ok(
    portalSwitchIdentities(identities, '', directory).some(
      (actor) => actor.id === 'u1',
    ),
  );
  assert.deepEqual(identities, before);
});

test('同角色不同组织的身份分别解析，名称从当前目录读取', () => {
  const identities = operationIdentities(localInternalUsers, sources);
  const first = identities.find((actor) => actor.id === 'u1');
  const second = identities.find((actor) => actor.id === 'u2');
  assert.equal(resolvePortalContext(first, sources).organizationName, '客户甲');
  assert.equal(
    resolvePortalContext(second, sources).organizationName,
    '客户乙',
  );
  assert.equal(resolvePortalContext(first, sources).title, '客户中心');
  assert.equal(
    resolvePortalContext(first, {
      ...sources,
      customers: [{ ...sources.customers[0], name: '客户甲新名称' }],
    }).organizationName,
    '客户甲新名称',
  );
  const partner = resolvePortalContext(
    identities.find((actor) => actor.id === 'pu1'),
    sources,
  );
  assert.equal(partner.title, '合作伙伴中心');
  assert.equal(partner.organizationName, '伙伴甲');
  assert.deepEqual(partner.views, ['requests']);
});

test('员工所有职责使用公司全称，外部身份没有内部维护入口', () => {
  for (const actor of operationIdentities(localInternalUsers, sources)) {
    const portal = resolvePortalContext(actor, sources);
    if (actor.role === 'SmartX 销售经理' || actor.role.startsWith('SmartX ')) {
      assert.equal(portal.title, '服务管理中心');
      assert.equal(portal.organizationName, '北京志凌海纳科技有限公司');
      assert.deepEqual(
        portal.views,
        actor.role === 'SmartX 系统管理员'
          ? ['requests', 'catalog', 'reference-data', 'field-settings']
          : actor.role === 'SmartX 项目经理'
            ? ['requests', 'catalog']
            : ['requests'],
      );
    } else {
      assert.ok(!portal.views.includes('reference-data'));
      assert.ok(!portal.views.includes('field-settings'));
      assert.ok(!portal.views.includes('catalog'));
    }
  }
});

test('无身份、所属组织缺失或停用不会回退成员工门户', () => {
  const actor = { id: 'u1', name: '联系人甲', role: '客户' };
  for (const portal of [
    resolvePortalContext({ id: '', name: '', role: '客户' }, sources),
    resolvePortalContext(actor, { ...sources, customers: [] }),
    resolvePortalContext(actor, {
      ...sources,
      customers: [{ ...sources.customers[0], status: '停用' }],
    }),
  ]) {
    assert.equal(portal.type, null);
    assert.equal(portal.organizationName, '请选择身份');
    assert.deepEqual(portal.views, []);
  }
});
