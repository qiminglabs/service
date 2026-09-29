import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectOverdue,
  projectProgress,
  projectFollowups,
  projectRisks,
  projectServiceBasisInsufficient,
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
