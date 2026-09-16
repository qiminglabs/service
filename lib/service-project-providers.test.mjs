import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectServiceProviders,
  internalProjectProvider,
} from './service-project-providers.ts';
import {
  newServiceProject,
  editServiceProject,
  serviceProjectIssue,
} from './service-projects.ts';
import { normalizeProjectFields } from './service-project-fields.ts';

const actor = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const customers = [{ id: 'c', name: '客户', status: '启用' }];
const partners = [
  { id: 'p1', name: '合作伙伴甲', status: '启用' },
  { id: 'p2', name: '合作伙伴乙', status: '停用' },
];
const input = {
  name: '项目',
  customerId: 'c',
  expectedServiceDate: '2026-09-20',
  note: '',
};

test('服务方包含固定公司及全部合作伙伴，包含停用记录且身份互不冲突', () => {
  const options = projectServiceProviders(partners);
  assert.deepEqual(
    options.map((option) => option.name),
    ['北京志凌海纳科技有限公司', '合作伙伴甲', '合作伙伴乙'],
  );
  assert.equal(new Set(options.map((option) => option.id)).size, 3);
  const collision = projectServiceProviders([
    {
      id: 'provider:smartx',
      name: internalProjectProvider.name,
      status: '启用',
    },
  ]);
  assert.equal(new Set(collision.map((option) => option.id)).size, 2);
  assert.deepEqual(projectServiceProviders([]), [internalProjectProvider]);
});

test('创建、更新和清空服务方均保存引用，拒绝不存在的选项及伪造名称', () => {
  for (const provider of projectServiceProviders(partners)) {
    const record = newServiceProject(
      {
        ...input,
        serviceProviderId: provider.id,
        serviceProviderName: '伪造名称',
      },
      actor,
      customers,
      partners,
    );
    assert.equal(record.serviceProviderId, provider.id);
    assert.equal(record.serviceProviderName, provider.name);
    const updated = editServiceProject(
      record,
      {
        ...input,
        status: '待启动',
        serviceProviderId: internalProjectProvider.id,
      },
      actor,
      customers,
      partners,
    );
    assert.equal(updated.serviceProviderName, internalProjectProvider.name);
    const cleared = editServiceProject(
      updated,
      { ...input, status: '待启动', serviceProviderId: '' },
      actor,
      customers,
      partners,
    );
    assert.equal(cleared.serviceProviderId, '');
    assert.equal(cleared.serviceProviderName, '');
  }
  assert.ok(
    serviceProjectIssue(
      { ...input, serviceProviderId: 'unknown' },
      customers,
      undefined,
      partners,
    ),
  );
  assert.throws(
    () =>
      newServiceProject(
        { ...input, serviceProviderId: 'unknown' },
        actor,
        customers,
        partners,
      ),
    /合作伙伴/,
  );
});

test('保留历史服务方，伙伴改名更新名称，删除后不会丢失原关联', () => {
  const record = newServiceProject(
    { ...input, serviceProviderId: 'partner:p1' },
    actor,
    customers,
    partners,
  );
  const renamed = editServiceProject(
    record,
    { ...input, status: '待启动' },
    actor,
    customers,
    [{ ...partners[0], name: '合作伙伴新名称' }],
  );
  assert.equal(renamed.serviceProviderName, '合作伙伴新名称');
  const removed = editServiceProject(
    renamed,
    { ...input, status: '待启动' },
    actor,
    customers,
    [],
  );
  assert.equal(removed.serviceProviderId, 'partner:p1');
  assert.equal(removed.serviceProviderName, '合作伙伴新名称');
  assert.equal(
    newServiceProject(input, actor, customers).serviceProviderId,
    '',
  );
  const fields = normalizeProjectFields([
    { id: 'name', name: '定制名称', type: 'text', options: [] },
  ]);
  assert.equal(fields.find((field) => field.id === 'name').name, '定制名称');
  assert.equal(
    fields.find((field) => field.id === 'serviceProviderId').referenceTarget,
    'partners',
  );
});
