import test from 'node:test';
import assert from 'node:assert/strict';
import { newServiceProject, editServiceProject } from './service-projects.ts';
import {
  projectCollaboratorOptions,
  projectCollaboratorDialogOptions,
  resolveProjectCollaborators,
  editProjectCollaborators,
} from './service-project-collaborators.ts';

const actor = { id: 'manager', name: '项目经理', role: 'SmartX 项目经理' };
const customers = [
  { id: 'c1', name: '客户甲', status: '启用' },
  { id: 'c2', name: '客户乙', status: '启用' },
];
const input = {
  name: '服务项目',
  customerId: 'c1',
  serviceProviderId: 'partner:p1',
  expectedServiceDate: '2026-09-20',
  note: '',
};
const directory = {
  contacts: [
    {
      id: 'contact1',
      customerId: 'c1',
      name: '联系人甲',
      status: '启用',
      email: 'a@example.com',
    },
    { id: 'contact2', customerId: 'c2', name: '联系人乙', status: '启用' },
    { id: 'contact3', customerId: 'c1', name: '停用联系人', status: '停用' },
  ],
  users: [
    {
      id: 'u1',
      name: '员工甲',
      status: '启用',
      department: '技术服务部',
      email: 'u@example.com',
    },
    { id: 'u2', name: '员工乙', status: '停用' },
  ],
  partners: [
    { id: 'p1', name: '服务伙伴甲', status: '启用' },
    { id: 'p2', name: '服务伙伴乙', status: '停用' },
  ],
  partnerUsers: [
    { id: 'pu1', name: '伙伴工程师甲', partnerId: 'p1', status: '启用' },
    { id: 'pu2', name: '伙伴工程师乙', partnerId: 'p2', status: '启用' },
    { id: 'pu3', name: '停用工程师', partnerId: 'p1', status: '停用' },
  ],
};

test('创建前选择三类协作人，保存时去重并使用引用数据中的人员信息', () => {
  const selected = {
    customer: [{ id: 'contact1', name: '旧名字' }, { id: 'contact1' }],
    internal: [{ id: 'u1' }],
    partner: [{ id: 'pu1' }],
  };
  const result = resolveProjectCollaborators(
    'c1',
    selected,
    directory,
    'partner:p1',
  );
  assert.deepEqual(
    result,
    projectCollaboratorOptions('c1', directory, 'partner:p1'),
  );
  assert.equal(selected.customer.length, 2);
  assert.deepEqual(resolveProjectCollaborators('c1', {}, directory), {
    customer: [],
    internal: [],
    partner: [],
  });
});

test('创建时拒绝其他客户或已停用的协作人，避免保存失效选择', () => {
  for (const [group, id] of [
    ['customer', 'contact2'],
    ['customer', 'contact3'],
    ['internal', 'u2'],
    ['partner', 'pu2'],
    ['partner', 'pu3'],
  ]) {
    assert.throws(
      () =>
        resolveProjectCollaborators(
          'c1',
          {
            [group]: [{ id }],
          },
          directory,
        ),
      /不可用/,
    );
  }
  assert.throws(
    () =>
      resolveProjectCollaborators(
        '',
        {
          customer: [{ id: 'contact1' }],
        },
        directory,
      ),
    /不可用/,
  );
});

test('协作人按当前客户、员工启用状态及合作伙伴启用状态筛选', () => {
  const options = projectCollaboratorOptions('c1', directory, 'partner:p1');
  assert.deepEqual(
    options.customer.map((person) => person.id),
    ['contact1'],
  );
  assert.deepEqual(
    options.internal.map((person) => person.id),
    ['u1'],
  );
  assert.deepEqual(
    options.partner.map((person) => person.id),
    ['pu1'],
  );
  assert.equal(options.partner[0].details, '');
});

test('协作人弹窗对齐请求的显示和搜索字段，停用客户可见但不可添加', () => {
  const options = projectCollaboratorDialogOptions(
    'c1',
    {
      ...directory,
      contacts: [
        { ...directory.contacts[0], phone: '13800000000' },
        ...directory.contacts.slice(1),
      ],
      users: [
        { ...directory.users[0], id: 'USR-003', phone: '13900000000' },
        directory.users[1],
      ],
      partnerUsers: [
        {
          ...directory.partnerUsers[0],
          phone: '13700000000',
          email: 'partner@example.com',
        },
        ...directory.partnerUsers.slice(1),
      ],
    },
    'partner:p1',
  );
  assert.deepEqual(
    options.customer.map((person) => person.id),
    ['contact1', 'contact3'],
  );
  assert.equal(options.customer[0].details, '13800000000 · a@example.com');
  assert.equal(options.customer[1].disabled, true);
  assert.equal(options.internal.length, 1);
  assert.equal(options.internal[0].details, 'SmartX 项目经理 · u@example.com');
  assert.ok(!options.internal[0].details.includes('技术服务部'));
  assert.ok(!options.internal[0].details.includes('13900000000'));
  assert.equal(options.partner[0].details, '13700000000 · partner@example.com');
  assert.ok(!options.partner.some((person) => person.id === 'pu2'));
  assert.equal(
    options.partner.find((person) => person.id === 'pu3').disabled,
    true,
  );
  assert.throws(
    () =>
      resolveProjectCollaborators(
        'c1',
        { customer: [options.customer[1]] },
        directory,
      ),
    /不可用/,
  );
});

test('旧项目添加、去重及移除协作人，不覆盖其他组或项目基本信息', () => {
  const original = newServiceProject(
    input,
    actor,
    customers,
    directory.partners,
  );
  let project = editProjectCollaborators(
    original,
    'customer',
    ['contact1', 'contact1'],
    actor,
    directory,
  );
  project = editProjectCollaborators(
    project,
    'internal',
    ['u1'],
    actor,
    directory,
  );
  project = editProjectCollaborators(
    project,
    'partner',
    ['pu1'],
    actor,
    directory,
  );
  assert.equal(project.collaborators.customer.length, 1);
  assert.equal(project.collaborators.internal.length, 1);
  assert.equal(project.collaborators.partner.length, 1);
  const next = editProjectCollaborators(
    project,
    'internal',
    [],
    actor,
    directory,
  );
  assert.deepEqual(next.collaborators.internal, []);
  assert.deepEqual(next.collaborators.customer, project.collaborators.customer);
  assert.deepEqual(next.collaborators.partner, project.collaborators.partner);
  for (const key of [
    'id',
    'name',
    'customerId',
    'note',
    'status',
    'createdBy',
    'createdById',
    'createdAt',
  ])
    assert.equal(next[key], original[key]);
  assert.equal(next.revision, 5);
  assert.equal(original.collaborators, undefined);
});

test('拒绝跨客户、停用人员和未授权编辑，允许移除停用的历史协作人', () => {
  const project = newServiceProject(
    input,
    actor,
    customers,
    directory.partners,
  );
  for (const [group, id] of [
    ['customer', 'contact2'],
    ['customer', 'contact3'],
    ['internal', 'u2'],
    ['partner', 'pu2'],
    ['partner', 'pu3'],
  ])
    assert.throws(
      () => editProjectCollaborators(project, group, [id], actor, directory),
      /不可用/,
    );
  assert.throws(
    () =>
      editProjectCollaborators(
        project,
        'internal',
        ['u1'],
        { ...actor, role: '客户' },
        directory,
      ),
    /当前身份无权维护/,
  );
  for (const status of ['已完成', '已取消'])
    assert.throws(
      () =>
        editProjectCollaborators(
          { ...project, status },
          'internal',
          ['u1'],
          actor,
          directory,
        ),
      /不可编辑/,
    );
  const withPerson = editProjectCollaborators(
    project,
    'internal',
    ['u1'],
    actor,
    directory,
  );
  const disabledDirectory = { ...directory, users: [] };
  assert.equal(
    editProjectCollaborators(
      withPerson,
      'internal',
      ['u1'],
      actor,
      disabledDirectory,
    ).collaborators.internal.length,
    1,
  );
  assert.deepEqual(
    editProjectCollaborators(
      withPerson,
      'internal',
      [],
      actor,
      disabledDirectory,
    ).collaborators.internal,
    [],
  );
});

test('修改客户只清理原客户协作人，其他编辑保留全部协作人', () => {
  let project = newServiceProject(input, actor, customers, directory.partners);
  project = editProjectCollaborators(
    project,
    'customer',
    ['contact1'],
    actor,
    directory,
  );
  project = editProjectCollaborators(
    project,
    'internal',
    ['u1'],
    actor,
    directory,
  );
  project = editProjectCollaborators(
    project,
    'partner',
    ['pu1'],
    actor,
    directory,
  );
  const edited = editServiceProject(
    project,
    { ...input, name: '修改名称', status: '待启动' },
    actor,
    customers,
  );
  assert.deepEqual(edited.collaborators, project.collaborators);
  const moved = editServiceProject(
    edited,
    { ...input, customerId: 'c2', status: '待启动' },
    actor,
    customers,
  );
  assert.deepEqual(moved.collaborators.customer, []);
  assert.deepEqual(
    moved.collaborators.internal,
    project.collaborators.internal,
  );
  assert.deepEqual(moved.collaborators.partner, project.collaborators.partner);
});

test('合作伙伴协作人仅限服务方用户，无服务方、原厂及停用服务方均无选项', () => {
  const refs = {
    ...directory,
    partners: directory.partners.map((partner) => ({
      ...partner,
      status: '启用',
    })),
    partnerUsers: directory.partnerUsers.map((person) => ({
      ...person,
      phone: '13800000000',
      email: `${person.id}@example.com`,
    })),
  };
  for (const providerId of ['', 'provider:smartx', 'partner:missing']) {
    assert.deepEqual(
      projectCollaboratorOptions('c1', refs, providerId).partner,
      [],
    );
    assert.deepEqual(
      projectCollaboratorDialogOptions('c1', refs, providerId).partner,
      [],
    );
    assert.throws(
      () =>
        resolveProjectCollaborators(
          'c1',
          { partner: [{ id: 'pu1' }] },
          refs,
          providerId,
        ),
      /不可用/,
    );
  }
  assert.deepEqual(
    projectCollaboratorOptions('c1', directory, 'partner:p2').partner,
    [],
  );
  assert.deepEqual(
    projectCollaboratorOptions('c1', refs, 'partner:p1').partner.map(
      (person) => person.id,
    ),
    ['pu1'],
  );
  assert.deepEqual(
    projectCollaboratorOptions('c1', refs, 'partner:p2').partner.map(
      (person) => person.id,
    ),
    ['pu2'],
  );
  const option = projectCollaboratorDialogOptions('c1', refs, 'partner:p1')
    .partner[0];
  assert.equal(option.details, '13800000000 · pu1@example.com');
  assert.ok(!`${option.name} ${option.details}`.includes('服务伙伴甲'));
  assert.throws(
    () =>
      resolveProjectCollaborators(
        'c1',
        { partner: [{ id: 'pu2' }] },
        refs,
        'partner:p1',
      ),
    /不可用/,
  );
});

test('修改或清空服务方清理原伙伴协作人，不影响内部和客户协作人，历史关联也不能跨服务方保存', () => {
  const refs = {
    ...directory,
    partners: directory.partners.map((partner) => ({
      ...partner,
      status: '启用',
    })),
  };
  const project = {
    ...newServiceProject(input, actor, customers, refs.partners),
    collaborators: resolveProjectCollaborators(
      'c1',
      {
        customer: [{ id: 'contact1' }],
        internal: [{ id: 'u1' }],
        partner: [{ id: 'pu1' }],
      },
      refs,
      'partner:p1',
    ),
  };
  for (const serviceProviderId of ['', 'partner:p2', 'provider:smartx']) {
    const edited = editServiceProject(
      project,
      { ...input, serviceProviderId, status: '待启动' },
      actor,
      customers,
      refs.partners,
    );
    assert.deepEqual(edited.collaborators.partner, []);
    assert.deepEqual(
      edited.collaborators.internal,
      project.collaborators.internal,
    );
    assert.deepEqual(
      edited.collaborators.customer,
      project.collaborators.customer,
    );
    assert.throws(
      () =>
        editProjectCollaborators(
          { ...project, serviceProviderId },
          'partner',
          ['pu1'],
          actor,
          refs,
        ),
      /不可用/,
    );
  }
  const both = editServiceProject(
    project,
    { ...input, customerId: 'c2', serviceProviderId: '', status: '待启动' },
    actor,
    customers,
    refs.partners,
  );
  assert.deepEqual(both.collaborators.customer, []);
  assert.deepEqual(both.collaborators.partner, []);
  assert.deepEqual(both.collaborators.internal, project.collaborators.internal);
  const unchanged = editServiceProject(
    project,
    { ...input, name: '修改标题', status: '待启动' },
    actor,
    customers,
    refs.partners,
  );
  assert.deepEqual(unchanged.collaborators, project.collaborators);
});


test('默认分配协作人禁止移除，保存其他成员保留身份标记，不能更换客户间接清空', () => {
  const project = newServiceProject(input, actor, customers, directory.partners);
  project.collaborators = { internal: [{ id: 'u1', name: '员工甲', details: '', assignmentRoles: ['客户所有人'] }], customer: [{ id: 'contact1', name: '联系人甲', details: '', assignmentRoles: ['原客户协作人'] }] };
  assert.throws(() => editProjectCollaborators(project, 'internal', [], actor, directory), /不允许移除/);
  assert.throws(() => editProjectCollaborators(project, 'customer', [], actor, directory), /不允许移除/);
  const saved = editProjectCollaborators(project, 'internal', ['u1'], actor, directory);
  assert.deepEqual(saved.collaborators.internal[0].assignmentRoles, ['客户所有人']);
  assert.throws(() => editServiceProject(project, { ...input, status: '待启动', customerId: 'c2' }, actor, customers, directory.partners), /默认分配成员/);
  assert.deepEqual(editServiceProject(project, { ...input, status: '待启动', note: '其他编辑' }, actor, customers, directory.partners).collaborators, project.collaborators);
});
