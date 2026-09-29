import test from 'node:test';
import assert from 'node:assert/strict';
import {
  engineerWork,
  engineerDayOrders,
  engineerWorkKey,
} from './service-engineer-dashboard.ts';
import { defaultSchedule } from './scheduling.ts';

const today = '2026-09-29';
const person = {
  id: 'engineer',
  group: 'internal',
  name: '工程师',
  key: 'internal:engineer',
};
const order = (id, patch = {}) => ({
  id,
  item: { serviceName: id },
  status: '待执行',
  expectedServiceDate: '2026-09-28',
  plannedCompletionDate: '2026-09-30',
  assignees: [person],
  steps: [],
  ...patch,
});
const snapshot = (orders, status = '进行中') => ({
  resources: [person],
  data: defaultSchedule(),
  projects: [{ id: 'project', status, workOrders: orders }],
});

test('工作和当日统计均仅包含本人获派工单，兼容旧指派字段与多人协作', () => {
  const own = order('own', {
    assignees: [person, { id: 'other', group: 'internal' }],
  });
  const legacy = order('legacy', { assignees: undefined, assignee: person });
  const other = order('other', {
    assignees: [{ id: 'other', group: 'internal' }],
  });
  const sameIdPartner = order('partner', {
    assignees: [{ id: person.id, group: 'partner' }],
  });
  const data = snapshot([own, legacy, other, sameIdPartner]);
  const rows = engineerWork(data, today);
  assert.deepEqual(rows.map((row) => row.order.id).sort(), ['legacy', 'own']);
  assert.deepEqual(
    [...engineerDayOrders(data, today, today)].sort(),
    rows.map(engineerWorkKey).sort(),
  );
});

test('暂停工作保留在未完成和逾期范围，终态工单和项目不算逾期', () => {
  const overdue = order('late', { plannedCompletionDate: '2026-09-28' });
  for (const status of ['已完成', '已取消']) {
    assert.equal(
      engineerWork(snapshot([overdue], status), today)[0].overdue,
      false,
    );
    assert.equal(
      engineerWork(snapshot([{ ...overdue, status }]), today)[0].active,
      false,
    );
  }
  const paused = engineerWork(snapshot([overdue], '已暂停'), today)[0];
  assert.equal(paused.status, '已暂停');
  assert.equal(paused.active, true);
  assert.equal(paused.overdue, true);
  assert.equal(
    engineerWork(
      snapshot([order('due-today', { plannedCompletionDate: today })]),
      today,
    )[0].overdue,
    false,
  );
});

test('进度计入已跳过步骤，优先呈现正在执行的步骤，无步骤不显示虚假进度', () => {
  const data = snapshot([
    order('work', {
      steps: [
        { status: '已完成', definition: { name: '完成' } },
        { status: '已跳过', definition: { name: '跳过' } },
        { status: '待执行', definition: { name: '待执行' } },
        { status: '进行中', definition: { name: '正在执行' } },
      ],
    }),
    order('empty'),
  ]);
  const work = engineerWork(data, today).find((row) => row.order.id === 'work');
  assert.equal(work.completed, 2);
  assert.equal(work.total, 4);
  assert.equal(work.nextStep, '正在执行');
  assert.equal(
    engineerWork(data, today).find((row) => row.order.id === 'empty').total,
    0,
  );
});

test('日历联动遵循工作日规则，已结束工单释放未来排期，未排期工单仍在工作列表', () => {
  const data = snapshot([
    order('active', { plannedCompletionDate: '2026-10-05' }),
    order('finished', {
      status: '已完成',
      plannedCompletionDate: '2026-10-05',
    }),
    order('undated', { expectedServiceDate: '', plannedCompletionDate: '' }),
  ]);
  assert.equal(engineerWork(data, today).length, 3);
  assert.equal(engineerDayOrders(data, '2026-10-01', today).size, 1);
  assert.equal(engineerDayOrders(data, '2026-10-04', today).size, 0);
  data.data.exceptions.push({
    id: 'holiday',
    resourceKey: '',
    start: today,
    end: today,
    kind: '节假日',
    note: '',
  });
  assert.equal(engineerDayOrders(data, today, today).size, 0);
});

test('逾期事项排前，缺日期的事项不丢失，空资源安全返回空列表', () => {
  const data = snapshot([
    order('no-date', { plannedCompletionDate: '' }),
    order('due'),
    order('late', { plannedCompletionDate: '2026-09-28' }),
  ]);
  assert.deepEqual(
    engineerWork(data, today).map((row) => row.order.id),
    ['late', 'due', 'no-date'],
  );
  data.resources = [];
  assert.deepEqual(engineerWork(data, today), []);
  assert.equal(engineerDayOrders(data, today, today).size, 0);
});

import {
  engineerWorklogs,
  engineerWorklogTotals,
} from './service-engineer-dashboard.ts';
const log = (id, patch = {}) => ({
  id,
  userId: 'engineer',
  date: '2026-09-29',
  startTime: '09:00',
  endTime: '10:00',
  hours: 1,
  description: '实施',
  category: '服务',
  createdAt: '2026-09-29T01:00:00Z',
  ...patch,
});
test('个人工时按录入人过滤，历史改派与没有关联工单的工时仍可查看', () => {
  const project = {
    id: 'p',
    workOrders: [
      order('reassigned', { assignees: [{ id: 'other', group: 'internal' }] }),
    ],
    operations: {
      worklogs: [
        log('own', { workOrderId: 'reassigned' }),
        log('legacy'),
        log('other', { userId: 'other' }),
      ],
    },
  };
  const rows = engineerWorklogs([project], 'engineer');
  assert.deepEqual(
    rows.map(({ log }) => log.id),
    ['own', 'legacy'],
  );
  assert.equal(rows[0].order.id, 'reassigned');
  assert.equal(rows[1].order, undefined);
  assert.deepEqual(engineerWorklogs([project], ''), []);
});
test('工时汇总仅计算有效实际工时，作废优先于确认，已确认不计待确认', () => {
  const rows = engineerWorklogs(
    [
      {
        id: 'p',
        operations: {
          worklogs: [
            log('pending', { hours: 1.5 }),
            log('confirmed', { hours: 2.25, confirmedAt: '2026-09-29' }),
            log('voided', {
              hours: 9,
              confirmedAt: '2026-09-29',
              voidedAt: '2026-09-29',
            }),
          ],
        },
      },
    ],
    'engineer',
  );
  assert.deepEqual(engineerWorklogTotals(rows), { hours: 3.75, pending: 1 });
  assert.equal(rows.find(({ log }) => log.id === 'voided').status, '已作废');
  assert.deepEqual(engineerWorklogTotals([]), { hours: 0, pending: 0 });
});
test('跨项目工时按工作日期和开始时间倒序排列，空项目不影响结果', () => {
  const rows = engineerWorklogs(
    [
      { id: 'empty' },
      {
        id: 'p1',
        operations: { worklogs: [log('old', { date: '2026-09-28' })] },
      },
      {
        id: 'p2',
        operations: {
          worklogs: [log('early'), log('late', { startTime: '14:00' })],
        },
      },
    ],
    'engineer',
  );
  assert.deepEqual(
    rows.map(({ log }) => log.id),
    ['late', 'early', 'old'],
  );
});

import {
  engineerDateRange,
  engineerWorkInRange,
  engineerWorklogsInRange,
  groupEngineerProjects,
} from './service-engineer-dashboard.ts';
test('日期范围工具支持独立筛选工单与工时，周月边界包含首尾日期', () => {
  const data = snapshot([
    order('sep', {
      expectedServiceDate: '2026-09-28',
      plannedCompletionDate: '2026-09-30',
    }),
    order('oct', {
      expectedServiceDate: '2026-10-01',
      plannedCompletionDate: '2026-10-02',
    }),
  ]);
  data.projects[0].operations = {
    worklogs: [
      log('sep', { date: '2026-09-30' }),
      log('oct', { date: '2026-10-01' }),
      log('outside', { date: '2026-10-05' }),
    ],
  };
  const work = engineerWork(data, today),
    logs = engineerWorklogs(data.projects, 'engineer');
  const day = engineerDateRange('2026-10-01', 'day');
  assert.deepEqual(
    engineerWorkInRange(data, work, day, today).map(({ order }) => order.id),
    ['oct'],
  );
  assert.deepEqual(
    engineerWorklogsInRange(logs, day).map(({ log }) => log.id),
    ['oct'],
  );
  const month = engineerDateRange(today, 'month');
  assert.deepEqual(month, { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(
    engineerWorkInRange(data, work, month, today).map(({ order }) => order.id),
    ['sep'],
  );
  assert.deepEqual(
    engineerWorklogsInRange(logs, month).map(({ log }) => log.id),
    ['sep'],
  );
  const week = engineerDateRange(today, 'week');
  assert.deepEqual(week, { start: '2026-09-28', end: '2026-10-04' });
  assert.equal(engineerWorkInRange(data, work, week, today).length, 2);
  assert.equal(engineerWorklogsInRange(logs, week).length, 2);
});
test('全部日期保留未排期工单和历史工时，空日期范围返回空结果', () => {
  const data = snapshot([
    order('undated', { expectedServiceDate: '', plannedCompletionDate: '' }),
  ]);
  const work = engineerWork(data, today);
  const logs = engineerWorklogs(
    [
      {
        id: 'history',
        operations: { worklogs: [log('old', { date: '2025-01-01' })] },
      },
    ],
    'engineer',
  );
  const all = engineerDateRange(today, 'all');
  assert.equal(engineerWorkInRange(data, work, all, today).length, 1);
  assert.equal(engineerWorklogsInRange(logs, all).length, 1);
  const day = engineerDateRange(today, 'day');
  assert.deepEqual(engineerWorkInRange(data, work, day, today), []);
  assert.deepEqual(engineerWorklogsInRange(logs, day), []);
});
test('项目分组按项目编号去重，同名项目分开，工单与工时保留所属项目及原顺序', () => {
  const a = { id: 'a', name: '同名项目' },
    b = { id: 'b', name: '同名项目' };
  const groups = groupEngineerProjects([
    { project: a, id: 'one' },
    { project: b, id: 'two' },
    { project: a, id: 'three' },
  ]);
  assert.deepEqual(
    groups.map(({ project }) => project.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    groups[0].rows.map(({ id }) => id),
    ['one', 'three'],
  );
  assert.deepEqual(groupEngineerProjects([]), []);
});

test('工作列表不限制日期，逾期和进行中优先，未排期工单仍可跟进', () => {
  const data = snapshot([
    order('future', {
      expectedServiceDate: '2026-12-01',
      plannedCompletionDate: '2026-12-02',
    }),
    order('finished', { status: '已完成' }),
    order('undated', { expectedServiceDate: '', plannedCompletionDate: '' }),
    order('waiting'),
    order('running', { status: '进行中', plannedCompletionDate: '2026-10-06' }),
    order('overdue', { plannedCompletionDate: '2026-09-28' }),
  ]);
  const rows = engineerWork(data, today).filter((row) => row.active);
  assert.deepEqual(
    rows.map(({ order }) => order.id),
    ['overdue', 'running', 'waiting', 'future', 'undated'],
  );
  const logs = engineerWorklogs(
    [
      {
        id: 'project',
        operations: {
          worklogs: [
            log('monday', { date: '2026-09-28' }),
            log('sunday', { date: '2026-10-04' }),
            log('last-week', { date: '2026-09-27' }),
            log('next-week', { date: '2026-10-05' }),
          ],
        },
      },
    ],
    person.id,
  );
  assert.deepEqual(
    engineerWorklogsInRange(logs, engineerDateRange(today, 'week')).map(
      ({ log }) => log.id,
    ),
    ['sunday', 'monday'],
  );
});

import { engineerProjectPage } from './service-engineer-dashboard.ts';
test('项目分页默认每页10个，项目内多张工单不拆分，最后一页保留余项', () => {
  const rows = Array.from({ length: 21 }, (_, i) => ({
    project: { id: `p${i}` },
    rows: [{ id: `o${i}-1` }, { id: `o${i}-2` }],
  }));
  const first = engineerProjectPage(rows, 1),
    second = engineerProjectPage(rows, 2),
    last = engineerProjectPage(rows, 3);
  assert.equal(first.groups.length, 10);
  assert.equal(first.groups.flatMap((group) => group.rows).length, 20);
  assert.equal(first.total, 21);
  assert.equal(first.pages, 3);
  assert.deepEqual(second.groups, rows.slice(10, 20));
  assert.deepEqual([second.start, second.end], [11, 20]);
  assert.deepEqual(last.groups, [rows[20]]);
  assert.deepEqual([last.start, last.end], [21, 21]);
});
test('筛选或数据减少后分页不会越界，空列表保持第1页且没有项目', () => {
  assert.deepEqual(engineerProjectPage([], 5), {
    groups: [],
    page: 1,
    pages: 1,
    total: 0,
    start: 0,
    end: 0,
  });
  const result = engineerProjectPage(
    [{ project: { id: 'remaining' }, rows: [] }],
    3,
  );
  assert.equal(result.page, 1);
  assert.equal(result.groups[0].project.id, 'remaining');
});
