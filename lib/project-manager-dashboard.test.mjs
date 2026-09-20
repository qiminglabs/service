import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectOverdue,
  projectProgress,
  projectFollowups,
  projectRisks,
  projectServiceBasisInsufficient,
  executingEngineers,
  earliestEngineerScheduleDay,
  assignmentSchedule,
  scheduleDay,
  ganttWindow,
  moveGanttAnchor,
  ganttBarRange,
} from './project-manager-dashboard.ts';

const base = {
  status: '进行中',
  plannedCompletionDate: '2026-09-20',
  workOrders: [],
};

function basisRiskFixture() {
  const asset = { assetId: 'asset', name: '远程人天', method: '远程', days: 1 };
  const project = {
    ...base,
    id: 'project',
    workOrders: [
      {
        id: 'hourly',
        item: { serviceId: 'service' },
        catalogSnapshot: {
          name: '实施',
          priceUnit: '人天',
          priceCoefficient: 2,
        },
      },
    ],
    operations: { worklogs: [{ id: 'log', workOrderId: 'hourly', hours: 8 }] },
    review: {
      approvals: [],
      confirmations: [],
      basis: {
        id: 'basis',
        allocations: [asset],
        capacities: [asset],
        entitlementAllocations: [],
      },
    },
  };
  return { project, context: { requests: [], services: [] } };
}

test('服务依据不足仅统计内部发起或已设为服务商的项目，普通伙伴其他风险仍保留', () => {
  const { project, context } = basisRiskFixture();
  project.operations.worklogs[0].hours = 9;
  context.serviceProviders = {
    revision: 1,
    entries: [
      { partnerId: 'provider', enabled: true },
      { partnerId: 'disabled', enabled: false },
    ],
  };
  project.createdSite = '内部系统';
  project.serviceProviderId = 'partner:ordinary';
  assert.equal(projectServiceBasisInsufficient(project, context), true);
  project.createdSite = '合作伙伴中心';
  for (const serviceProviderId of [
    'partner:ordinary',
    'partner:disabled',
    '',
    undefined,
  ]) {
    project.serviceProviderId = serviceProviderId;
    assert.equal(projectServiceBasisInsufficient(project, context), false);
    assert.deepEqual(projectRisks(project, '2026-09-21', context), [
      '项目逾期',
    ]);
  }
  project.serviceProviderId = 'partner:provider';
  assert.deepEqual(projectRisks(project, '2026-09-20', context), [
    '服务依据不足',
  ]);
  delete context.serviceProviders;
  assert.equal(projectServiceBasisInsufficient(project, context), false);
  delete project.createdSite;
  assert.equal(projectServiceBasisInsufficient(project, context), true);
});

test('服务依据风险比较实际工时：相等不报警，超额包含待确认工时，不乘计价系数', () => {
  const { project, context } = basisRiskFixture();
  assert.equal(projectServiceBasisInsufficient(project, context), false);
  project.operations.worklogs.push({ workOrderId: 'hourly', hours: 0.1 });
  assert.deepEqual(projectRisks(project, '2026-09-20', context), [
    '服务依据不足',
  ]);
  project.operations.worklogs[1].confirmedAt = '2026-09-20';
  assert.equal(projectServiceBasisInsufficient(project, context), true);
  project.operations.worklogs[1].voidedAt = '2026-09-20';
  assert.equal(projectServiceBasisInsufficient(project, context), false);
});

test('权益与未定价工时不参与人天比较，权益额度不能抵扣按工时计费工时', () => {
  const { project, context } = basisRiskFixture();
  project.workOrders.push({
    id: 'entitlement',
    item: { serviceId: 'upgrade' },
    catalogSnapshot: { name: '升级', priceUnit: '升级权益' },
  });
  project.operations.worklogs.push(
    { workOrderId: 'entitlement', hours: 100 },
    { workOrderId: 'missing', hours: 100 },
  );
  assert.equal(projectServiceBasisInsufficient(project, context), false);
  project.review.basis.entitlementAllocations.push({
    objectId: 'object',
    kind: 'upgrade',
    quantity: 100,
  });
  project.operations.worklogs[0].hours = 9;
  assert.equal(projectServiceBasisInsufficient(project, context), true);
});

test('已通过的有效项目额度计入服务依据，待审批、拒绝和失效额度不计入', () => {
  const { project, context } = basisRiskFixture();
  project.operations.worklogs[0].hours = 12;
  project.review.approvals.push({
    id: 'approval',
    independent: true,
    state: '已通过',
    days: 0.5,
    gaps: [{ method: '现场', days: 0.5 }],
  });
  assert.equal(projectServiceBasisInsufficient(project, context), false);
  for (const state of ['待审批', '已拒绝', '已失效']) {
    project.review.approvals[0].state = state;
    assert.equal(projectServiceBasisInsufficient(project, context), true);
  }
  project.review.approvals[0] = {
    ...project.review.approvals[0],
    state: '已通过',
    independent: false,
    planId: 'old-basis',
  };
  assert.equal(projectServiceBasisInsufficient(project, context), true);
});

test('来源申请与项目关联同一资产只计一次，来源有效审批计入，来源释放后不再计入', () => {
  const { project, context } = basisRiskFixture();
  project.sourceServiceRequestId = 'request';
  project.operations.worklogs[0].hours = 12;
  project.requestConversion = {
    assessmentSnapshot: {
      basis: {
        id: 'source-basis',
        allocations: structuredClone(project.review.basis.allocations),
        entitlementAllocations: [],
      },
      approvals: [],
    },
  };
  context.requests.push({
    id: 'request',
    status: '已转服务项目',
    operations: { assessment: { plans: [{ id: 'source-basis' }] } },
  });
  assert.equal(projectServiceBasisInsufficient(project, context), true);
  project.requestConversion.assessmentSnapshot.approvals.push({
    id: 'source-approval',
    state: '已通过',
    days: 0.5,
    gaps: [{ method: '远程', days: 0.5 }],
  });
  assert.equal(projectServiceBasisInsufficient(project, context), false);
  context.requests[0].projectReservationReleases = [{ projectId: project.id }];
  assert.equal(projectServiceBasisInsufficient(project, context), true);
});

test('无额度且有按工时计费工时也报警，无工时和终态项目不报警；多风险仍是一个项目', () => {
  const { project, context } = basisRiskFixture();
  delete project.review;
  assert.equal(projectServiceBasisInsufficient(project, context), true);
  assert.deepEqual(
    projectRisks({ ...project, status: '已暂停' }, '2026-09-21', context),
    ['项目逾期', '项目暂停', '服务依据不足'],
  );
  for (const status of ['已完成', '已取消']) {
    assert.deepEqual(
      projectRisks({ ...project, status }, '2026-09-21', context),
      [],
    );
  }
  project.operations.worklogs = [];
  assert.equal(projectServiceBasisInsufficient(project, context), false);
});
test('日期边界：今天到期不逾期，终态和未设置日期不报警', () => {
  assert.equal(projectOverdue(base, '2026-09-20'), false);
  assert.equal(projectOverdue(base, '2026-09-21'), true);
  for (const status of ['已完成', '已取消']) {
    assert.equal(projectOverdue({ ...base, status }, '2026-09-21'), false);
    assert.deepEqual(projectRisks({ ...base, status }, '2026-09-21'), []);
    assert.deepEqual(projectFollowups({ ...base, status }, '2026-09-21'), []);
  }
  assert.equal(
    projectOverdue({ ...base, plannedCompletionDate: '' }, '2026-09-21'),
    false,
  );
});
test('汇总已完成及跳过步骤，排除取消工单，空工单进度为零', () => {
  assert.deepEqual(projectProgress(base), {
    total: 0,
    completed: 0,
    percent: 0,
  });
  assert.deepEqual(
    projectProgress({
      ...base,
      workOrders: [
        {
          status: '已完成',
          steps: [{ status: '已完成' }, { status: '已跳过' }],
        },
        {
          status: '进行中',
          steps: [
            { status: '已完成' },
            { status: '进行中' },
            { status: '待执行' },
          ],
        },
        { status: '已暂停', steps: [{ status: '待执行' }] },
        {
          status: '已取消',
          steps: [{ status: '已完成' }, { status: '待执行' }],
        },
        { status: '待执行', steps: [] },
      ],
    }),
    { total: 6, completed: 3, percent: 50 },
  );
});
test('仅未指派的可执行工单产生派单事项，兼容旧指派字段', () => {
  assert.deepEqual(
    projectFollowups({
      ...base,
      workOrders: [
        { status: '进行中', assignee: { id: 'one' } },
        { status: '已取消' },
        { status: '已暂停' },
      ],
    }),
    [],
  );
  assert.deepEqual(
    projectFollowups({
      ...base,
      workOrders: [{ status: '待执行', assignees: [] }],
    }),
    ['工单派单'],
  );
});
test('作废及已确认工时不进入待确认事项，暂停项目不产生执行待办', () => {
  const project = {
    ...base,
    operations: { worklogs: [{ voidedAt: 'x' }, { confirmedAt: 'x' }] },
  };
  assert.deepEqual(projectFollowups(project), []);
  project.operations.worklogs.push({});
  assert.deepEqual(projectFollowups(project), ['工时确认']);
  assert.deepEqual(projectFollowups({ ...project, status: '已暂停' }), []);
});
test('已完成工单和失效的客户拒绝不报警，最新有效拒绝需要跟进', () => {
  const project = {
    ...base,
    workOrders: [{ status: '已完成', plannedCompletionDate: '2026-09-01' }],
    review: { confirmations: [{ state: '已拒绝', invalidatedAt: 'x' }] },
  };
  assert.deepEqual(projectRisks(project, '2026-09-20'), []);
  assert.deepEqual(
    projectRisks(
      { ...project, review: { confirmations: [{ state: '已拒绝' }] } },
      '2026-09-20',
    ),
    ['客户拒绝确认'],
  );
});

const engineer = (id, group = 'internal') => ({
  id,
  name: `工程师${id}`,
  group,
});
const order = (id, people, status = '进行中') => ({
  id,
  item: { serviceName: id },
  status,
  expectedServiceDate: '2026-09-20',
  plannedCompletionDate: '2026-09-22',
  assignees: people,
});
const project = (id, managerId, orders, status = '进行中') => ({
  id,
  name: id,
  status,
  collaborators: {
    internal: [{ id: managerId, assignmentRoles: ['项目经理'] }],
  },
  workOrders: orders,
});

test('人员来自本人管辖项目，统计跨经理项目和工单并按项目去重', () => {
  const a = engineer('a'),
    b = engineer('b');
  const projects = [
    project('mine', 'pm1', [order('a1', [a, a]), order('a2', [a])]),
    project('other', 'pm2', [order('a3', [a]), order('b1', [b])]),
  ];
  const people = executingEngineers(projects, 'pm1');
  assert.equal(people.length, 1);
  assert.equal(people[0].id, 'a');
  assert.equal(people[0].projectCount, 2);
  assert.equal(people[0].assignments.length, 3);
  assert.deepEqual(
    people[0].assignments.map((row) => row.order.id),
    ['a1', 'a2', 'a3'],
  );
  assert.equal(executingEngineers(projects, 'pm2').length, 2);
});
test('已完成或取消项目及工单不计入执行，暂停任务保留，已结束的本人工单不扩展人员名单', () => {
  const a = engineer('a'),
    b = engineer('b');
  const projects = [
    project('mine', 'pm1', [
      order('paused', [a], '已暂停'),
      order('done', [b], '已完成'),
    ]),
    project('other', 'pm2', [
      order('active-b', [b]),
      order('cancelled', [a], '已取消'),
    ]),
    project('closed', 'pm1', [order('stale', [a])], '已完成'),
  ];
  const people = executingEngineers(projects, 'pm1');
  assert.equal(people.length, 1);
  assert.equal(people[0].assignments.length, 1);
  assert.equal(people[0].assignments[0].order.id, 'paused');
  assert.deepEqual(executingEngineers(projects, 'unassigned'), []);
});
test('同编号的原厂和伙伴工程师分别统计，兼容单人指派记录', () => {
  const a = engineer('a'),
    partner = engineer('a', 'partner');
  const oldOrder = { ...order('old', []), assignees: undefined, assignee: a };
  const people = executingEngineers(
    [project('mine', 'pm1', [oldOrder, order('partner', [partner])])],
    'pm1',
  );
  assert.equal(people.length, 2);
  assert.deepEqual(
    new Set(people.map((person) => person.key)),
    new Set(['internal:a', 'partner:a']),
  );
  assert.ok(people.every((person) => person.assignments.length === 1));
});
test('甘特日期包含单日工单，缺日期和倒置日期不虚构时间条', () => {
  const assignment = {
    project: {},
    order: {
      expectedServiceDate: '2026-09-20',
      plannedCompletionDate: '2026-09-20',
    },
  };
  const day = scheduleDay('2026-09-20');
  assert.deepEqual(assignmentSchedule(assignment), { start: day, end: day });
  assert.equal(
    assignmentSchedule({
      ...assignment,
      order: { expectedServiceDate: '2026-09-20' },
    }),
    null,
  );
  assert.equal(
    assignmentSchedule({
      ...assignment,
      order: {
        expectedServiceDate: '2026-09-20',
        plannedCompletionDate: '2026-09-19',
      },
    }),
    null,
  );
  assert.equal(scheduleDay('2026-02-30'), null);
  assert.equal(scheduleDay('bad-date'), null);
  assert.equal(scheduleDay('2026-03-09') - scheduleDay('2026-03-08'), 1);
});

test('待确认项目显示待客户确认，已确认和已完成项目没有收尾待办', () => {
  assert.deepEqual(
    projectFollowups({
      ...base,
      status: '待确认',
      review: { confirmations: [{ state: '待确认' }] },
    }),
    ['待客户确认'],
  );
  assert.deepEqual(
    projectFollowups({
      ...base,
      status: '待确认',
      review: { confirmations: [{ state: '已确认' }] },
    }),
    [],
  );
  assert.deepEqual(
    projectFollowups({
      ...base,
      status: '已完成',
      review: { confirmations: [{ state: '已确认' }] },
    }),
    [],
  );
});

test('甘特周窗口从周一到周日，翻页正确跨年', () => {
  const anchor = scheduleDay('2026-01-01');
  assert.deepEqual(ganttWindow(anchor, 'week'), {
    start: scheduleDay('2025-12-29'),
    end: scheduleDay('2026-01-04'),
    days: 7,
  });
  assert.equal(
    ganttWindow(moveGanttAnchor(anchor, 'week', 1), 'week').start,
    scheduleDay('2026-01-05'),
  );
  assert.equal(
    ganttWindow(moveGanttAnchor(anchor, 'week', -1), 'week').start,
    scheduleDay('2025-12-22'),
  );
  assert.equal(
    ganttWindow(scheduleDay('2026-01-04'), 'week').end,
    scheduleDay('2026-01-04'),
  );
});
test('甘特月窗口适配闰年，月底翻页不会跳过二月', () => {
  const leap = scheduleDay('2024-02-18');
  assert.deepEqual(ganttWindow(leap, 'month'), {
    start: scheduleDay('2024-02-01'),
    end: scheduleDay('2024-02-29'),
    days: 29,
  });
  assert.equal(ganttWindow(scheduleDay('2026-02-10'), 'month').days, 28);
  assert.equal(
    moveGanttAnchor(scheduleDay('2026-01-31'), 'month', 1),
    scheduleDay('2026-02-28'),
  );
  assert.equal(
    moveGanttAnchor(scheduleDay('2026-01-31'), 'month', -1),
    scheduleDay('2025-12-31'),
  );
});
test('时间条裁剪到当前窗口，单日有宽度，窗口外不显示', () => {
  const window = { start: 10, end: 16, days: 7 };
  assert.deepEqual(ganttBarRange({ start: 8, end: 20 }, window), {
    left: 0,
    width: 100,
  });
  assert.deepEqual(ganttBarRange({ start: 16, end: 16 }, window), {
    left: (6 / 7) * 100,
    width: (1 / 7) * 100,
  });
  assert.deepEqual(ganttBarRange({ start: 8, end: 10 }, window), {
    left: 0,
    width: (1 / 7) * 100,
  });
  assert.equal(ganttBarRange({ start: 1, end: 9 }, window), null);
  assert.equal(ganttBarRange({ start: 17, end: 20 }, window), null);
});

test('管理员工程师视图汇总所有可见项目，指定经理仍限制人员范围', () => {
  const projects = [
    project('p1', 'pm1', [order('o1', [engineer('a')])]),
    project('p2', 'pm2', [order('o2', [engineer('b')])]),
  ];
  assert.deepEqual(
    new Set(executingEngineers(projects).map((person) => person.id)),
    new Set(['a', 'b']),
  );
  assert.deepEqual(
    executingEngineers(projects, 'pm1').map((person) => person.id),
    ['a'],
  );
  assert.deepEqual(
    executingEngineers(projects, '').map((person) => person.id),
    [],
  );
});

test('甘特默认定位所有显示工程师中最早的有效排期，不被今天截断', () => {
  const a = engineer('a'),
    b = engineer('b');
  const scheduled = (id, people, start, end, status = '进行中') => ({
    ...order(id, people, status),
    expectedServiceDate: start,
    plannedCompletionDate: end,
  });
  const projects = [
    project('mine', 'pm1', [
      scheduled('later', [a], '2026-11-10', '2026-11-12'),
      scheduled('other-person', [b], '2026-10-08', '2026-10-09'),
    ]),
    project('other', 'pm2', [
      scheduled('earliest', [a], '2026-10-01', '2026-10-03'),
      scheduled('done', [a], '2026-01-01', '2026-01-02', '已完成'),
    ]),
  ];
  const today = scheduleDay('2026-09-20');
  assert.equal(
    earliestEngineerScheduleDay(executingEngineers(projects, 'pm1'), today),
    scheduleDay('2026-10-01'),
  );
  assert.equal(
    ganttWindow(
      earliestEngineerScheduleDay(executingEngineers(projects, 'pm1'), today),
      'week',
    ).start,
    scheduleDay('2026-09-28'),
  );
  projects[1].workOrders[0].expectedServiceDate = '2026-08-01';
  assert.equal(
    earliestEngineerScheduleDay(executingEngineers(projects, 'pm1'), today),
    scheduleDay('2026-08-01'),
  );
});
test('无有效排期时回退今天，忽略缺日期及倒置日期', () => {
  const today = scheduleDay('2026-09-20');
  assert.equal(earliestEngineerScheduleDay([], today), today);
  const assignments = [
    { project: {}, order: { expectedServiceDate: '2026-01-01' } },
    {
      project: {},
      order: {
        expectedServiceDate: '2026-09-22',
        plannedCompletionDate: '2026-09-21',
      },
    },
  ];
  assert.equal(earliestEngineerScheduleDay([{ assignments }], today), today);
});
