import { submitProjectReview } from './service-work-orders.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newServiceProject,
  editServiceProject,
  serviceProjectIssue,
  serviceProjectStatuses,
} from './service-projects.ts';
import { normalizeProjectFields } from './service-project-fields.ts';

const actor = { id: 'pm-1', name: '项目经理', role: 'SmartX 项目经理' };
const customers = [
  { id: 'customer-1', name: '客户甲', status: '启用' },
  { id: 'customer-2', name: '客户乙', status: '停用' },
];
const input = {
  name: ' 平台实施项目 ',
  expectedServiceDate: '2026-09-18',
  customerId: 'customer-1',
  note: '',
};

test('创建项目生成独立编号和创建信息，忽略传入的系统字段', () => {
  const projects = Array.from({ length: 30 }, () =>
    newServiceProject(
      {
        ...input,
        id: 'forged',
        status: '已完成',
        createdBy: '伪造用户',
        createdAt: '2000-01-01',
        sourceServiceRequestId: 'SR-forged',
      },
      actor,
      customers,
    ),
  );
  assert.equal(new Set(projects.map((project) => project.id)).size, 30);
  for (const project of projects) {
    assert.match(project.id, /^SP-[0-9A-Z]+-[0-9A-F]{4}$/);
    assert.equal(project.name, '平台实施项目');
    assert.equal(project.status, '待启动');
    assert.equal(project.createdBy, actor.name);
    assert.equal(project.createdById, actor.id);
    assert.equal(project.createdAt, project.updatedAt);
    assert.equal(project.sourceServiceRequestId, undefined);
    assert.ok(Date.now() - Date.parse(project.createdAt) < 5000);
  }
});

test('编辑保留编号、创建信息和系统关联的来源服务请求，包括另一用户编辑', () => {
  const project = {
    ...newServiceProject(input, actor, customers),
    sourceServiceRequestId: 'SR-source',
  };
  const before = structuredClone(project);
  const updated = editServiceProject(
    project,
    {
      ...project,
      id: 'forged',
      name: '新项目名称',
      createdById: 'forged',
      createdBy: '伪造用户',
      createdAt: '2000-01-01',
      revision: 999,
      sourceServiceRequestId: 'SR-forged',
    },
    { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' },
    customers,
  );
  for (const key of ['id', 'createdById', 'createdBy', 'createdAt', 'sourceServiceRequestId'])
    assert.equal(updated[key], before[key]);
  assert.equal(updated.name, '新项目名称');
  assert.equal(updated.revision, 2);
  assert.deepEqual(project, before);
});

test('项目按规定顺序流转，拒绝跳级，结束后不能修改或重新打开', () => {
  let project = newServiceProject(input, actor, customers);
  project.collaborators = { internal: [{ id: actor.id, assignmentRoles: ['项目经理'] }] };
  project.workOrders = [{ id: 'WO-ready', status: '已完成' }];
  assert.throws(
    () =>
      editServiceProject(
        project,
        { ...input, status: '已完成' },
        actor,
        customers,
      ),
    /不可跳过/,
  );
  for (const status of ['进行中']) {
    project = editServiceProject(
      project,
      { ...input, status },
      actor,
      customers,
    );
    assert.equal(project.status, status);
  }
  assert.throws(() => editServiceProject(project, { ...input, status: '待复核' }, actor, customers), /手动提交/);
  const engineer = { id: 'engineer', name: '执行工程师', role: 'SmartX 服务工程师' };
  project.collaborators.internal.push({ id: engineer.id });
  project.workOrders[0].assignees = [{ id: engineer.id, name: engineer.name, group: 'internal' }];
  project = submitProjectReview(project, engineer);
  assert.throws(() => editServiceProject(project, { ...input, status: '待确认' }, actor, customers), /复核选项卡/);
  assert.throws(() => editServiceProject({ ...project, status: '待确认' }, { ...input, status: '已完成' }, actor, customers), /复核选项卡/);
  project = { ...project, status: '已完成' };
  assert.throws(
    () =>
      editServiceProject(
        project,
        { ...input, status: '进行中' },
        actor,
        customers,
      ),
    /不可编辑/,
  );
  assert.throws(
    () =>
      editServiceProject(
        project,
        { ...input, status: '已完成', note: '修改' },
        actor,
        customers,
      ),
    /不可编辑/,
  );
});

test('普通项目保存不能绕过取消操作直接改为已取消', () => {
  const project = newServiceProject(input, actor, customers);
  for (const status of ['待启动', '进行中', '待复核', '待确认']) {
    assert.throws(() => editServiceProject({ ...project, status }, { ...input, status: '已取消' }, actor, customers), /项目流程/);
  }
});

test('必填字段、真实日期和客户启用状态校验，项目说明可留空', () => {
  assert.equal(serviceProjectIssue(input, customers), null);
  for (const patch of [
    { name: '' },
    { name: 'a'.repeat(101) },
    { expectedServiceDate: '2026-02-30' },
    { expectedServiceDate: '2026-02-29' },
    { customerId: '' },
    { customerId: 'missing' },
    { customerId: 'customer-2' },
  ])
    assert.ok(serviceProjectIssue({ ...input, ...patch }, customers));
  assert.equal(
    serviceProjectIssue(
      { ...input, expectedServiceDate: '2028-02-29' },
      customers,
    ),
    null,
  );
  const project = newServiceProject(input, actor, customers);
  assert.equal(
    serviceProjectIssue(input, [], project),
    null,
    '历史客户停用或移除后仍保留原关联',
  );
});

test('客户和其他员工不能创建或维护项目', () => {
  const project = newServiceProject(input, actor, customers);
  for (const role of ['客户', 'SmartX 销售经理']) {
    const other = { ...actor, role };
    assert.throws(
      () => newServiceProject(input, other, customers),
      /当前身份不能创建/,
    );
    assert.throws(
      () =>
        editServiceProject(
          project,
          { ...input, status: '进行中' },
          other,
          customers,
        ),
      /当前身份无权维护/,
    );
  }
  assert.throws(() =>
    newServiceProject(input, { ...actor, id: '' }, customers),
  );
});

test('项目字段配置保留自定义标签及修改记录，恢复固定状态与字段类型', () => {
  const fields = normalizeProjectFields([
    {
      id: 'status',
      name: '当前阶段',
      type: 'text',
      options: [{ value: '任意状态', enabled: true }],
      updatedBy: '管理员',
    },
    { id: 'id', name: '服务项目编号', type: 'single', options: [] },
  ]);
  assert.equal(fields.length, 10);
  const status = fields.find((field) => field.id === 'status');
  assert.equal(status.name, '当前阶段');
  assert.equal(status.updatedBy, '管理员');
  assert.equal(status.type, 'single');
  assert.deepEqual(
    status.options.map((option) => option.value),
    serviceProjectStatuses,
  );
  assert.equal(fields.find((field) => field.id === 'id').type, 'text');
  assert.deepEqual(normalizeProjectFields(fields), fields);
});


test('旧初始状态及取消来源状态统一更名，不改写项目历史', async () => {
  const { normalizeServiceProjectStatus, serviceProjectStatuses } = await import('./service-project-status.ts');
  assert.equal(serviceProjectStatuses[0], '待启动');
  const previous = { status: '已取消', cancellation: { fromStatus: '草稿', reason: '取消原因' }, operations: { activities: [{ detail: '历史草稿记录' }] } };
  const renamed = normalizeServiceProjectStatus(previous);
  assert.equal(renamed.status, '已取消');
  assert.equal(renamed.cancellation.fromStatus, '待启动');
  assert.deepEqual(renamed.operations, previous.operations);
  assert.equal(previous.cancellation.fromStatus, '草稿');
  assert.equal(normalizeServiceProjectStatus(renamed), renamed);
});

test('项目日期更名兼容旧字段定义，计划完成日期创建可留空、填写时校验并持久化', () => {
  for (const name of ['期望服务时间', '期望服务日期']) {
    const fields = normalizeProjectFields([{ id: 'expectedServiceDate', name, type: 'date', options: [] }]);
    assert.equal(fields.find(field => field.id === 'expectedServiceDate').name, '计划执行日期');
    assert.equal(fields.find(field => field.id === 'plannedCompletionDate').type, 'date');
  }
  assert.equal(serviceProjectIssue(input, customers), null);
  assert.match(serviceProjectIssue({ ...input, plannedCompletionDate: '2026-09-17' }, customers), /不能早于/);
  assert.match(serviceProjectIssue({ ...input, plannedCompletionDate: '2026-02-30' }, customers), /计划完成日期/);
  const project = newServiceProject({ ...input, plannedCompletionDate: '2026-09-20' }, actor, customers);
  assert.equal(project.plannedCompletionDate, '2026-09-20');
  const saved = editServiceProject(project, { ...input, plannedCompletionDate: '2026-09-21', status: project.status }, actor, customers);
  assert.equal(saved.plannedCompletionDate, '2026-09-21');
});

test('基本信息可先创建待启动项目，日期在启动前完善，填写时仍验证格式和顺序', () => {
  const pending = newServiceProject({ ...input, expectedServiceDate: '', plannedCompletionDate: '' }, actor, customers);
  assert.equal(pending.status, '待启动');
  assert.equal(pending.expectedServiceDate, '');
  assert.equal(serviceProjectIssue({ ...input, expectedServiceDate: '', plannedCompletionDate: '2026-10-01' }, customers), null);
  assert.match(serviceProjectIssue({ ...input, expectedServiceDate: '', plannedCompletionDate: 'invalid' }, customers), /计划完成日期/);
  assert.match(serviceProjectIssue({ ...input, expectedServiceDate: '' }, customers, { ...pending, status: '进行中' }), /计划执行日期/);
});

test('基本信息保存与项目服务项、协作人和工单独立，普通字段修改保留关联记录', () => {
  const project = newServiceProject(input, actor, customers);
  project.items = [{ id: 'item', serviceId: 's1', businessObjectIds: ['asset'], materials: [{ requirementId: 'r1', files: [] }] }];
  project.collaborators = { internal: [{ id: actor.id, assignmentRoles: ['项目经理'] }], customer: [{ id: 'contact' }] };
  project.workOrders = [{ id: 'order', status: '已取消', steps: [] }];
  const updated = editServiceProject(project, { ...input, name: '修改名称', note: '修改说明', status: project.status }, actor, customers);
  assert.equal(updated.name, '修改名称');
  assert.deepEqual(updated.items, project.items);
  assert.deepEqual(updated.collaborators, project.collaborators);
  assert.deepEqual(updated.workOrders, project.workOrders);
});
