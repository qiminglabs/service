import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEngineerWorklogSamples,
  initializeEngineerWorklogSamples,
  engineerWorklogSeedId,
} from './demo-engineer-worklogs.ts';
import { localInternalUsers } from './internal-users.ts';
const now = new Date('2026-09-29T08:00:00+08:00');
const project = (id, patch = {}) => ({
  id,
  name: id,
  status: '进行中',
  revision: 1,
  createdById: 'USR-003',
  createdSite: '企业工作台',
  collaborators: {
    internal: [
      { id: 'USR-003', assignmentRoles: ['项目经理'] },
      { id: 'USR-004' },
    ],
  },
  workOrders: [
    {
      id: `${id}-order`,
      status: '待执行',
      item: { serviceId: 'service', serviceName: '实施服务' },
      assignees: [{ id: 'USR-004', group: 'internal' }],
      catalogSnapshot: {
        id: 'service',
        name: '实施服务',
        priceUnit: '人天',
        priceCoefficient: 1,
      },
    },
  ],
  ...patch,
});
const logs = (projects) =>
  projects.flatMap((project) => project.operations?.worklogs ?? []);

test('仅给林澈可录入的示例项目追加本周工时，覆盖两项目及待确认/已确认', () => {
  const projects = [
    project('SP-REAL'),
    project('SP-DEMO-1'),
    project('SP-DEMO-2'),
    project('SP-DEMO-LOCKED', { worklogsLocked: true }),
    project('SP-DEMO-FINISHED', { status: '已完成' }),
  ];
  const before = structuredClone(projects);
  const updated = buildEngineerWorklogSamples(
    projects,
    localInternalUsers,
    [],
    now,
  );
  assert.deepEqual(
    updated.map((p) => p.id),
    ['SP-DEMO-1', 'SP-DEMO-2'],
  );
  const rows = logs(updated);
  assert.equal(rows.length, 6);
  assert.equal(
    rows.reduce((hours, row) => hours + row.hours, 0),
    9,
  );
  assert.equal(rows.filter((row) => row.confirmedAt).length, 3);
  assert.ok(
    rows.every(
      (row) =>
        row.userId === 'USR-004' &&
        ['2026-09-28', '2026-09-29'].includes(row.date) &&
        row.pricing.kind === 'hourly',
    ),
  );
  assert.deepEqual(projects, before);
  assert.deepEqual(
    buildEngineerWorklogSamples(updated, localInternalUsers, [], now),
    [],
  );
});

test('跳过原有工时占用时段和未来日期，保留已有数据，不给其他身份初始化', () => {
  const existing = {
    id: 'user-log',
    userId: 'USR-004',
    date: '2026-09-28',
    startTime: '09:00',
    endTime: '12:00',
    hours: 3,
    description: '用户原有记录',
  };
  const data = [
    project('SP-DEMO-1', {
      operations: { worklogs: [existing], meetings: [], activities: [] },
    }),
  ];
  const updated = buildEngineerWorklogSamples(
    data,
    localInternalUsers,
    [],
    new Date('2026-09-28T16:00:00+08:00'),
  );
  assert.equal(logs(updated).length, 2);
  assert.deepEqual(
    logs(updated).find((log) => log.id === existing.id),
    existing,
  );
  assert.deepEqual(
    buildEngineerWorklogSamples(
      data,
      localInternalUsers.filter((user) => user.id !== 'USR-004'),
      [],
      now,
    ),
    [],
  );
});

function storage(t, fail = false) {
  const original = globalThis.indexedDB;
  t.after(() => {
    globalThis.indexedDB = original;
  });
  const rows = [
    { id: 'workspace', payload: { users: localInternalUsers, services: [] } },
    ...[project('SP-DEMO-1'), project('SP-DEMO-2')].map((p) => ({
      id: `service-project:${p.id}`,
      payload: p,
    })),
  ];
  globalThis.indexedDB = {
    open() {
      const request = {
        result: {
          close() {},
          transaction(name, mode) {
            assert.equal(name, 'references');
            assert.equal(mode, 'readwrite');
            const staged = structuredClone(rows);
            let aborted = false;
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort());
              },
              objectStore() {
                return {
                  getAll() {
                    const read = { result: structuredClone(staged) };
                    queueMicrotask(() => read.onsuccess());
                    return read;
                  },
                  put(row) {
                    if (fail) throw new Error('模拟失败');
                    const i = staged.findIndex((item) => item.id === row.id);
                    if (i < 0) staged.push(structuredClone(row));
                    else staged[i] = structuredClone(row);
                  },
                };
              },
            };
            queueMicrotask(() =>
              queueMicrotask(() => {
                if (!aborted) {
                  rows.splice(0, rows.length, ...staged);
                  tx.oncomplete();
                }
              }),
            );
            return tx;
          },
        },
      };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  return rows;
}

test('初始化与标记一次性原子保存，再次打开不重复追加', async (t) => {
  const rows = storage(t);
  await initializeEngineerWorklogSamples(now);
  assert.ok(rows.some((row) => row.id === engineerWorklogSeedId));
  assert.equal(
    logs(
      rows
        .filter((row) => row.id.startsWith('service-project:'))
        .map((row) => row.payload),
    ).length,
    6,
  );
  const before = structuredClone(rows);
  await initializeEngineerWorklogSamples(new Date('2026-10-05T16:00:00+08:00'));
  assert.deepEqual(rows, before);
});

test('写入失败回滚，原项目和工时不变', async (t) => {
  const rows = storage(t, true),
    before = structuredClone(rows);
  await assert.rejects(initializeEngineerWorklogSamples(now), /模拟失败/);
  assert.deepEqual(rows, before);
});
