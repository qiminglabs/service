import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultConfig, newItem } from './service-requests.ts';
import { newServiceProject, editServiceProject } from './service-projects.ts';
import {
  prepareProjectItem,
  changeProjectItems,
  editProjectItems,
  resetProjectItemCustomer,
} from './service-project-items.ts';
const actor = { id: 'pm', name: '经理', role: 'SmartX 项目经理' };
const customers = [
  { id: 'c1', name: '客户甲', status: '启用' },
  { id: 'c2', name: '客户乙', status: '启用' },
];
const service = {
  id: 's1',
  name: '服务甲',
  category: '其他',
  deliveryMethods: ['远程', '现场'],
  status: '已启用',
  priceUnit: '人天',
};
const config = {
  ...defaultConfig(service),
  fields: ['nodes'],
  fieldRequired: { nodes: true },
  basicFields: {
    description: { enabled: true, required: true },
    businessObjects: { enabled: true, required: true },
  },
};
const item = {
  ...newItem(service, config),
  description: '服务目标',
  values: { nodes: '3' },
  businessObjectIds: ['o1'],
};
const context = {
  services: [service],
  businessObjects: [
    {
      id: 'o1',
      name: '集群甲',
      customerId: 'c1',
      status: '启用',
      nodeCount: 3,
    },
  ],
  requests: [],
};
const project = newServiceProject(
  {
    name: '项目',
    expectedServiceDate: '2026-09-20',
    customerId: 'c1',
    note: '',
  },
  actor,
  customers,
);

test('项目服务项复用必填规则和当前客户业务对象校验，保存对象快照', () => {
  const saved = prepareProjectItem(item, 'c1', context);
  assert.equal(saved.businessObjectSnapshot.objects[0].object.name, '集群甲');
  assert.equal(item.businessObjectSnapshot, undefined);
  assert.throws(
    () =>
      prepareProjectItem(
        { ...item, description: '', values: {} },
        'c1',
        context,
      ),
    /请补充/,
  );
  assert.throws(
    () => prepareProjectItem(item, 'c2', context),
    /不属于当前客户/,
  );
  assert.throws(
    () =>
      prepareProjectItem(item, 'c1', {
        ...context,
        businessObjects: [{ ...context.businessObjects[0], status: '停用' }],
      }),
    /已停用/,
  );
  assert.throws(
    () =>
      prepareProjectItem(item, 'c1', {
        ...context,
        services: [{ ...service, status: '已停用' }],
      }),
    /目录已停用/,
  );
  assert.throws(
    () =>
      prepareProjectItem(item, 'c1', {
        ...context,
        services: [{ ...service, allowedInitiatorSites: ['客户中心'] }],
      }),
    /未开放/,
  );
});

test('创建期间添加、编辑、复制、移除服务项，复制独立编号且不复用材料和快照', () => {
  let items = changeProjectItems([], { type: 'save', item }, 'c1', context);
  items = changeProjectItems(
    items,
    { type: 'save', item: { ...items[0], description: '更新目标' } },
    'c1',
    context,
  );
  assert.equal(items.length, 1);
  items[0].materials = [{ requirementId: 'r1', note: '旧材料' }];
  const copied = changeProjectItems(
    items,
    { type: 'copy', id: item.id },
    'c1',
    context,
  );
  assert.equal(copied.length, 2);
  assert.notEqual(copied[1].id, item.id);
  assert.equal(copied[1].description, '更新目标');
  assert.deepEqual(copied[1].materials, []);
  assert.equal(copied[1].businessObjectSnapshot, undefined);
  assert.equal(items.length, 1);
  assert.deepEqual(
    changeProjectItems(copied, { type: 'remove', id: item.id }, 'c1', context),
    [copied[1]],
  );
  assert.throws(
    () =>
      changeProjectItems(items, { type: 'copy', id: item.id }, 'c1', {
        ...context,
        services: [],
      }),
    /不能复制/,
  );
});

test('详情服务项保存保留项目基本信息和协作人，结束项目及无权限身份不可变更', () => {
  const before = {
    ...project,
    collaborators: { internal: [{ id: 'u1', name: '员工', details: '' }] },
    supplements: [],
  };
  const result = editProjectItems(
    before,
    { type: 'save', item },
    actor,
    context,
  );
  assert.equal(result.revision, before.revision + 1);
  assert.equal(result.items.length, 1);
  assert.equal(result.name, before.name);
  assert.deepEqual(result.collaborators, before.collaborators);
  assert.deepEqual(result.supplements, before.supplements);
  assert.equal(before.items, undefined);
  for (const status of ['已完成', '已取消'])
    assert.throws(
      () =>
        editProjectItems(
          { ...result, status },
          { type: 'remove', id: item.id },
          actor,
          context,
        ),
      /不可编辑/,
    );
  assert.throws(
    () =>
      editProjectItems(
        result,
        { type: 'remove', id: item.id },
        { ...actor, role: '客户' },
        context,
      ),
    /当前身份无权维护/,
  );
  const basicEdit = editServiceProject(
    result,
    { ...result, name: '新标题' },
    actor,
    customers,
  );
  assert.deepEqual(basicEdit.items, result.items);
});

test('创建和详情切换客户均保留服务需求并清理原客户业务对象及材料', () => {
  const withItems = editProjectItems(
    project,
    { type: 'save', item },
    actor,
    context,
  );
  const changed = editServiceProject(
    withItems,
    { ...withItems, customerId: 'c2' },
    actor,
    customers,
  );
  assert.deepEqual(changed.items, resetProjectItemCustomer(withItems.items));
  assert.equal(changed.items[0].description, item.description);
  assert.deepEqual(changed.items[0].businessObjectIds, []);
  assert.equal(changed.items[0].businessObjectSnapshot, undefined);
});
