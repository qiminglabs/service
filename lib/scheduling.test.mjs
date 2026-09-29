import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultSchedule,
  resourceDirectory,
  slotState,
  slotTotals,
  applyScheduleAction,
  pendingOrders,
  pendingProjects,
  bookingIsEffective,
  rangeSlots,
  calendarState,
  weekStart,
  workOrderBookings,
  personalScheduleSnapshot,
} from './scheduling.ts';
import { localInternalUsers } from './internal-users.ts';
import { assignWorkOrders, dispatchableWorkOrders } from './work-order-assignment.ts';

const admin = { id: 'USR-006', role: 'SmartX 系统管理员', name: '陆明' };
const manager = { id: 'USR-003', role: 'SmartX 项目经理', name: '赵言' };
const today = '2026-09-24';
const slot = { date: '2026-09-28' };
function fixture() {
  const directory = {
    users: structuredClone(localInternalUsers),
    contacts: [],
    partnerUsers: [
      { id: 'partner1', partnerId: 'company1', name: '伙伴一', status: '启用' },
      { id: 'partner2', partnerId: 'company1', name: '伙伴二', status: '启用' },
      { id: 'stopped', partnerId: 'company1', name: '停用', status: '停用' },
    ],
    partners: [{ id: 'company1', name: '服务商甲', status: '启用' }],
    providers: {
      revision: 1,
      entries: [
        {
          partnerId: 'company1',
          enabled: true,
          updatedAt: '2026-09-01T00:00:00Z',
          updatedBy: '陆明',
        },
      ],
    },
    services: [{ id: 'svc', name: '实施', certifications: [] }],
    serviceCertifications: [],
  };
  const project = {
    id: 'project1',
    name: '项目一',
    status: '进行中',
    serviceProviderId: 'internal:smartx',
    revision: 1,
    createdSite: '内部系统',
    collaborators: {
      internal: [
        { id: manager.id, name: manager.name, assignmentRoles: ['项目经理'] },
      ],
    },
    workOrders: [
      {
        id: 'order1',
        status: '待执行',
        item: { serviceId: 'svc', serviceName: '实施' },
        assignees: [],
      },
    ],
    operations: { activities: [], worklogs: [] },
  };
  // Match the existing configured internal service provider.
  return {
    data: defaultSchedule(),
    directory,
    projects: [project],
    resources: resourceDirectory(directory, today),
  };
}
import { internalProjectProvider } from './service-project-providers.ts';
function f() {
  const s = fixture();
  s.projects[0].serviceProviderId = internalProjectProvider.id;
  return s;
}

test('待排按项目去重，项目批量指派包含全部可指派工单而非只取待排子集', () => {
  const s = f();
  const project = s.projects[0];
  const base = { ...project.workOrders[0], expectedServiceDate: '2026-09-28', plannedCompletionDate: '2026-09-30' };
  project.workOrders = [
    base,
    { ...structuredClone(base), id: 'already-assigned', assignees: [{ id: 'USR-004', name: '林澈', group: 'internal' }] },
    { ...structuredClone(base), id: 'also-pending' },
    { ...structuredClone(base), id: 'done', status: '已完成' },
    { ...structuredClone(base), id: 'cancelled', status: '已取消' },
  ];
  assert.equal(pendingOrders(s, manager, today).length, 2);
  const grouped = pendingProjects(s, manager, today);
  assert.equal(grouped.length, 1);
  assert.deepEqual(grouped[0].orders.map(order => order.id), ['order1', 'already-assigned', 'also-pending']);
  assert.deepEqual(grouped[0].orders, dispatchableWorkOrders(project));
  const saved = assignWorkOrders(project, manager, { orderIds: grouped[0].orders.map(order => order.id), assignees: [{ id: 'USR-004', group: 'internal' }] }, s.directory);
  assert.ok(dispatchableWorkOrders(saved).every(order => order.assignees.some(person => person.id === 'USR-004')));
  assert.equal(pendingProjects({ ...s, projects: [saved] }, manager, today).length, 0);
});

test('项目待排保持原权限和日期条件，不纳入无工单、终态或已完整安排的项目', () => {
  const s = f();
  const base = structuredClone(s.projects[0]);
  const assigned = { ...base.workOrders[0], expectedServiceDate: '2026-09-28', plannedCompletionDate: '2026-09-30', assignees: [{ id: 'USR-004', group: 'internal' }] };
  s.projects = [
    { ...structuredClone(base), id: 'incomplete', workOrders: [{ ...assigned, plannedCompletionDate: '' }, { ...assigned, id: 'overdue', expectedServiceDate: '2026-09-01', plannedCompletionDate: '2026-09-02' }] },
    { ...structuredClone(base), id: 'planned', workOrders: [assigned] },
    { ...structuredClone(base), id: 'empty', workOrders: [] },
    { ...structuredClone(base), id: 'done', status: '已完成' },
    { ...structuredClone(base), id: 'cancelled', status: '已取消' },
    { ...structuredClone(base), id: 'hidden', collaborators: { internal: [] } },
  ];
  assert.deepEqual(pendingProjects(s, manager, today).map(row => row.project.id), ['incomplete']);
});
function action(s, patch = {}) {
  return {
    type: 'booking',
    projectRevision: s.projects[0].revision,
    booking: {
      id: 'b1',
      resourceKey: 'internal:USR-004',
      projectId: 'project1',
      orderId: 'order1',
      start: slot.date,
      end: slot.date,
      note: '',
      ...patch,
    },
  };
}
function apply(s, a, actor = admin) {
  const result = applyScheduleAction(s, actor, a, today);
  return {
    ...s,
    data: result.data,
    projects: s.projects.map((p) =>
      result.project?.id === p.id ? result.project : p,
    ),
  };
}

function storage(t, stores, failPut = () => false) {
  const old = globalThis.indexedDB;
  const oldWindow = globalThis.window;
  t.after(() => {
    if (old) globalThis.indexedDB = old;
    else delete globalThis.indexedDB;
    if (oldWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  });
  globalThis.window = { dispatchEvent() {} };
  globalThis.indexedDB = {
    open() {
      const open = {
        result: {
          close() {},
          transaction(names, mode) {
            const staged = structuredClone(stores);
            let pending = 0;
            let aborted = false;
            let scheduled = false;
            const complete = () => {
              if (scheduled) return;
              scheduled = true;
              queueMicrotask(() => {
                scheduled = false;
                if (aborted || pending) return;
                if (mode === 'readwrite') Object.assign(stores, staged);
                tx.oncomplete?.();
              });
            };
            const request = (result) => {
              pending++;
              const req = { result: structuredClone(result) };
              queueMicrotask(() => {
                if (aborted) return;
                req.onsuccess?.();
                pending--;
                complete();
              });
              return req;
            };
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(name) {
                return {
                  getAll() {
                    return request(staged[name]);
                  },
                  get(id) {
                    return request(
                      staged[name].find(
                        (record) => (record.id ?? record.serviceId) === id,
                      ),
                    );
                  },
                  put(record) {
                    if (failPut(record)) throw new Error('模拟存储失败');
                    assert.equal(mode, 'readwrite');
                    const id = record.id ?? record.serviceId;
                    const index = staged[name].findIndex(
                      (value) => (value.id ?? value.serviceId) === id,
                    );
                    if (index >= 0)
                      staged[name][index] = structuredClone(record);
                    else staged[name].push(structuredClone(record));
                    complete();
                  },
                };
              },
            };
            return tx;
          },
        },
      };
      queueMicrotask(() => open.onsuccess());
      return open;
    },
  };
}

import { schedulingTransaction } from './scheduling-store.ts';
import { serviceProviderSettingsId } from './service-provider-settings.ts';
function schedulingStores(s) {
  return {
    references: [
      { id: 'workspace', payload: s.directory },
      { id: serviceProviderSettingsId, payload: s.directory.providers },
      { id: 'service-project:project1', payload: s.projects[0] },
    ],
  };
}
test('整天资源名册与容量：内部和伙伴统一使用固定日历，实际工时不扣减', () => {
  const s = f();
  assert.equal(s.resources.length, 3);
  s.data.confirmedPartners = [];
  const unconfirmed = slotTotals(s, s.resources, slot, today);
  s.data.confirmedPartners = ['partner:partner1'];
  assert.deepEqual(slotTotals(s, s.resources, slot, today), unconfirmed);
  assert.deepEqual(slotTotals(s, s.resources, slot, today), {
    available: 3,
    occupied: 0,
    unavailable: 0,
  });
  s.projects[0].operations.worklogs.push({ hours: 24 });
  assert.equal(slotTotals(s, s.resources, slot, today).available, 3);
});
test('工单日期完整且已派人时自动占用整天，不需要独立排期记录', () => {
  const s = f(),
    o = s.projects[0].workOrders[0];
  Object.assign(o, {
    expectedServiceDate: slot.date,
    plannedCompletionDate: slot.date,
    assignees: [{ id: 'USR-004', group: 'internal', name: '林澈' }],
  });
  assert.equal(s.data.bookings.length, 0);
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'occupied');
  assert.equal(pendingOrders(s, admin, today).length, 0);
  o.plannedCompletionDate = '';
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'available');
  assert.equal(pendingOrders(s, admin, today)[0].label, '工单日期待完善');
});
test('服务日历仅返回当前工程师的资源、工单与日历信息', () => {
  const s = f();
  const ownOrder = s.projects[0].workOrders[0];
  Object.assign(ownOrder, {
    expectedServiceDate: slot.date,
    plannedCompletionDate: slot.date,
    assignees: [{ id: 'USR-004', group: 'internal', name: '林澈' }],
  });
  s.projects.push({
    ...structuredClone(s.projects[0]),
    id: 'other-project',
    name: '其他项目',
    workOrders: [
      {
        ...structuredClone(ownOrder),
        id: 'other-order',
        assignees: [{ id: 'partner1', group: 'partner', name: '伙伴一' }],
      },
    ],
  });
  s.data.exceptions = [
    {
      id: 'global',
      resourceKey: '',
      start: slot.date,
      end: slot.date,
      kind: '节假日',
      note: '',
    },
    {
      id: 'own',
      resourceKey: 'internal:USR-004',
      start: slot.date,
      end: slot.date,
      kind: '培训',
      note: '',
    },
    {
      id: 'other',
      resourceKey: 'partner:partner1',
      start: slot.date,
      end: slot.date,
      kind: '请假',
      note: '',
    },
  ];
  const result = personalScheduleSnapshot(s, {
    id: 'USR-004',
    role: 'SmartX 服务工程师',
    name: '林澈',
  });
  assert.deepEqual(
    result.resources.map((item) => item.key),
    ['internal:USR-004'],
  );
  assert.deepEqual(
    result.projects.map((item) => item.id),
    ['project1'],
  );
  assert.deepEqual(
    result.data.exceptions.map((item) => item.id),
    ['global', 'own'],
  );
  assert.equal('directory' in result, false);
});
test('非服务工程师不能读取个人服务日历', () => {
  const s = f();
  assert.throws(() => personalScheduleSnapshot(s, manager), /不能访问服务日历/);
  assert.throws(
    () =>
      personalScheduleSnapshot(s, {
        id: 'missing',
        role: 'SmartX 服务工程师',
        name: '伪造工程师',
      }),
    /不能访问服务日历/,
  );
});
test('调度保存同步工单日期和派单，工单直接改期也实时反映占用', () => {
  let s = f();
  s = apply(s, action(s));
  assert.equal(s.projects[0].workOrders[0].expectedServiceDate, slot.date);
  assert.equal(s.projects[0].workOrders[0].plannedCompletionDate, slot.date);
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'occupied');
  Object.assign(s.projects[0].workOrders[0], {
    expectedServiceDate: '2026-09-29',
    plannedCompletionDate: '2026-09-29',
  });
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'available');
  assert.equal(
    slotState(s, s.resources[0], { date: '2026-09-29' }, today).state,
    'occupied',
  );
});
test('历史半天预约不重复计量，半天不可用事项按整天覆盖', () => {
  let s = f();
  s = apply(s, action(s));
  s.data.bookings.push({
    ...s.data.bookings[0],
    id: 'legacy',
    period: 'am',
    start: '2026-09-29',
    end: '2026-09-29',
    slots: [{ date: '2026-09-29', half: 'am' }],
  });
  assert.equal(slotTotals(s, [s.resources[0]], slot, today).occupied, 1);
  assert.equal(
    slotState(s, s.resources[0], { date: '2026-09-29' }, today).state,
    'available',
  );
  s.data.exceptions.push({
    id: 'legacy-leave',
    resourceKey: s.resources[0].key,
    start: '2026-09-29',
    end: '2026-09-29',
    period: 'am',
    kind: '请假',
    note: '',
  });
  assert.equal(
    slotState(s, s.resources[0], { date: '2026-09-29' }, today).state,
    'unavailable',
  );
});
test('跨周排期扣除工作日，周末与节假日不算占用，调休恢复工作日', () => {
  let s = f();
  s = apply(s, action(s, { start: '2026-09-25', end: '2026-09-28' }));
  const states = ['2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28'].map(
    (date) => slotState(s, s.resources[0], { date }, today).state,
  );
  assert.deepEqual(states, [
    'occupied',
    'unavailable',
    'unavailable',
    'occupied',
  ]);
  s = apply(s, {
    type: 'exception',
    scope: 'global',
    exception: {
      id: 'adjust',
      resourceKey: '',
      start: '2026-09-27',
      end: '2026-09-27',
      kind: '调休上班',
      note: '',
    },
  });
  assert.equal(
    slotState(s, s.resources[0], { date: '2026-09-27' }, today).state,
    'occupied',
  );
  assert.equal(rangeSlots('2026-09-28', '2026-09-29').length, 2);
});
test('同一工单所有工程师共用日期，支持与其他工单重叠并保留日历校验', () => {
  let s = f();
  s = apply(s, action(s));
  s.projects[0].workOrders[0].assignees.push({
    id: 'partner1',
    group: 'partner',
    name: '伙伴一',
  });
  assert.equal(workOrderBookings(s).length, 2);
  const p = s.resources.find((r) => r.key === 'partner:partner1');
  assert.equal(slotState(s, p, slot, today).state, 'occupied');
  s.projects.push({
    ...structuredClone(s.projects[0]),
    id: 'p2',
    workOrders: [
      {
        ...structuredClone(s.projects[0].workOrders[0]),
        id: 'o2',
        expectedServiceDate: '2026-09-29',
        plannedCompletionDate: '2026-09-29',
        assignees: [{ id: 'partner1', group: 'partner', name: '伙伴一' }],
      },
    ],
  });
  const overlapping = apply(
    s,
    action(s, {
      id: workOrderBookings(s)[0].id,
      start: '2026-09-29',
      end: '2026-09-29',
    }),
  );
  const target = { date: '2026-09-29' };
  assert.equal(slotState(overlapping, p, target, today).bookings.length, 2);
  assert.equal(slotTotals(overlapping, [p], target, today).occupied, 1);
  s.data.exceptions.push({
    id: 'leave',
    resourceKey: p.key,
    start: target.date,
    end: target.date,
    kind: '请假',
    note: '',
  });
  assert.throws(
    () =>
      apply(
        s,
        action(s, {
          id: workOrderBookings(s)[0].id,
          start: target.date,
          end: target.date,
        }),
      ),
    /伙伴一.*请假/,
  );
  s.data.exceptions = [];
  s.projects.pop();
  s = apply(
    s,
    action(s, {
      id: workOrderBookings(s)[0].id,
      start: '2026-09-29',
      end: '2026-09-29',
    }),
  );
  assert.equal(slotState(s, p, slot, today).state, 'available');
  assert.equal(
    slotState(s, p, { date: '2026-09-29' }, today).state,
    'occupied',
  );
});
test('换人替换工单指派；取消工单排期清空日期并保留派单', () => {
  let s = f();
  s = apply(s, action(s));
  s = apply(
    s,
    action(s, {
      id: workOrderBookings(s)[0].id,
      resourceKey: 'partner:partner1',
    }),
  );
  assert.deepEqual(
    s.projects[0].workOrders[0].assignees.map((p) => p.id),
    ['partner1'],
  );
  s = apply(s, {
    type: 'cancel',
    id: workOrderBookings(s)[0].id,
    projectRevision: s.projects[0].revision,
  });
  assert.equal(s.projects[0].workOrders[0].expectedServiceDate, '');
  assert.equal(s.projects[0].workOrders[0].plannedCompletionDate, '');
  assert.equal(workOrderBookings(s).length, 0);
  assert.equal(pendingOrders(s, admin, today)[0].label, '工单日期待完善');
});
test('伙伴无需确认即可排期，认证、状态、权限、日期和旧版本校验仍然有效', () => {
  let s = f();
  const partnerScheduled = apply(
    s,
    action(s, { resourceKey: 'partner:partner1' }),
  );
  assert.equal(
    slotState(
      partnerScheduled,
      s.resources.find((p) => p.key === 'partner:partner1'),
      slot,
      today,
    ).state,
    'occupied',
  );
  s.directory.services[0].certifications = ['SMTX OS 认证'];
  assert.throws(() => apply(s, action(s)), /认证/);
  s.directory.services[0].certifications = [];
  assert.throws(() => apply(s, { ...action(s), projectRevision: 0 }), /已更新/);
  assert.throws(() => apply(s, action(s, { end: '2026-09-25' })), /早于/);
  assert.throws(() => apply(s, action(s), { ...admin, id: 'USR-004' }), /身份/);
  s.projects[0].collaborators.internal = [];
  assert.throws(() => apply(s, action(s), manager), /无权/);
  s.projects[0].status = '已完成';
  assert.throws(() => apply(s, action(s)), /进行中/);
});
test('多个工单统一计为有排班且按人去重，暂停保留，完成或改派释放未来容量', () => {
  let s = f();
  s = apply(s, action(s));
  s.projects.push({ ...structuredClone(s.projects[0]), id: 'p2' });
  assert.equal(slotTotals(s, [s.resources[0]], slot, today).occupied, 1);
  assert.equal(slotTotals(s, [s.resources[0]], slot, today).available, 0);
  assert.equal(slotState(s, s.resources[0], slot, today).bookings.length, 2);
  for (let i = 3; i <= 5; i++)
    s.projects.push({ ...structuredClone(s.projects[0]), id: `p${i}` });
  assert.equal(slotState(s, s.resources[0], slot, today).bookings.length, 5);
  assert.equal(slotTotals(s, [s.resources[0]], slot, today).occupied, 1);
  s.data.exceptions.push({
    id: 'leave',
    resourceKey: s.resources[0].key,
    start: slot.date,
    end: slot.date,
    kind: '请假',
    note: '',
  });
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'occupied');
  s.data.exceptions = [];
  s.projects = [s.projects[0]];
  s.projects[0].status = '已暂停';
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'occupied');
  s.projects[0].status = '已完成';
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'available');
  s.projects[0].status = '进行中';
  s.projects[0].workOrders[0].assignees = [];
  assert.equal(slotState(s, s.resources[0], slot, today).state, 'available');
});
test('工单日期与派单一起持久化，过期版本不能取消已更新的工单', async (t) => {
  const s = f(),
    stores = schedulingStores(s);
  storage(t, stores);
  await schedulingTransaction(admin, { revision: 0, action: action(s) });
  const saved = await schedulingTransaction(admin);
  assert.equal(saved.projects[0].workOrders[0].expectedServiceDate, slot.date);
  assert.equal(workOrderBookings(saved).length, 1);
  const cancel = {
    type: 'cancel',
    id: workOrderBookings(saved)[0].id,
    projectRevision: saved.projects[0].revision,
  };
  await assert.rejects(
    schedulingTransaction(admin, { revision: 0, action: cancel }),
    /已更新/,
  );
  await assert.rejects(
    schedulingTransaction(admin, {
      revision: saved.data.revision,
      action: { ...cancel, projectRevision: 0 },
    }),
    /已更新/,
  );
  await schedulingTransaction(admin, {
    revision: saved.data.revision,
    action: cancel,
  });
  assert.equal(workOrderBookings(await schedulingTransaction(admin)).length, 0);
});
test('工单写入失败时排期元数据同步回滚', async (t) => {
  const s = f(),
    stores = schedulingStores(s),
    before = structuredClone(stores);
  storage(t, stores, (r) => r.id === 'service-project:project1');
  await assert.rejects(
    schedulingTransaction(admin, { revision: 0, action: action(s) }),
    /模拟存储失败/,
  );
  assert.deepEqual(stores, before);
});

import { scheduleViewWindow, moveScheduleViewDate } from './scheduling.ts';

test('周视图从周一至周日，月视图完整覆盖平年、闰年及跨年日期', () => {
  const week = scheduleViewWindow('2026-10-01', 'week');
  assert.equal(week.start, '2026-09-28');
  assert.equal(week.end, '2026-10-04');
  assert.equal(week.dates.length, 7);
  const month = scheduleViewWindow('2026-10-01', 'month');
  assert.equal(month.start, '2026-10-01');
  assert.equal(month.end, '2026-10-31');
  assert.equal(month.dates.length, 31);
  assert.equal(scheduleViewWindow('2028-02-15', 'month').end, '2028-02-29');
  assert.equal(scheduleViewWindow('2027-02-15', 'month').dates.length, 28);
  assert.equal(scheduleViewWindow('2026-12-20', 'month').end, '2026-12-31');
});

test('按周或月翻页，月末不会溢出到隔月，所选范围完整用于容量汇总', () => {
  assert.equal(moveScheduleViewDate('2026-12-29', 'week', 1), '2027-01-05');
  assert.equal(moveScheduleViewDate('2026-12-29', 'month', 1), '2027-01-29');
  assert.equal(moveScheduleViewDate('2026-03-31', 'month', -1), '2026-02-28');
  assert.equal(moveScheduleViewDate('2028-01-31', 'month', 1), '2028-02-29');
  const s = f();
  const month = scheduleViewWindow('2026-09-29', 'month');
  const capacity = month.dates.reduce(
    (total, date) =>
      total + slotTotals(s, s.resources, { date }, today).available,
    0,
  );
  assert.equal(capacity, 22 * 3);
});

test('工作日历仅保存每周工作日，按整天调整容量且保留有效日期校验', () => {
  let s = f();
  s = apply(s, {
    type: 'calendar',
    calendar: { weekdays: [2, 3, 4, 5, 6, 6] },
  });
  assert.deepEqual(s.data.calendar, { weekdays: [2, 3, 4, 5, 6] });
  assert.equal(
    slotTotals(s, s.resources, { date: '2026-09-28' }, today).available,
    0,
  );
  assert.equal(
    slotTotals(s, s.resources, { date: '2026-10-03' }, today).available,
    3,
  );
  assert.throws(
    () => apply(s, { type: 'calendar', calendar: { weekdays: [] } }),
    /工作日/,
  );
  assert.throws(
    () => apply(s, { type: 'calendar', calendar: { weekdays: [7] } }),
    /工作日/,
  );
});

import { scheduleFromRows, schedulingId } from './scheduling.ts';
test('旧日历时间与半天字段自动兼容为日期，保留历史记录并可再次保存', () => {
  let s = apply(f(), action(f()));
  Object.assign(s.data.calendar, {
    amStart: '09:00',
    amEnd: '12:00',
    pmStart: '13:00',
    pmEnd: '18:00',
  });
  Object.assign(s.data.bookings[0], {
    period: 'am',
    slots: [
      { date: slot.date, half: 'am' },
      { date: slot.date, half: 'pm' },
    ],
  });
  s.data.exceptions.push({
    id: 'old-leave',
    resourceKey: s.resources[0].key,
    start: '2026-09-29',
    end: '2026-09-29',
    period: 'pm',
    kind: '请假',
    note: '保留备注',
  });
  const rows = [
    { id: schedulingId, payload: s.data },
    { id: 'service-project:project1', payload: s.projects[0] },
  ];
  const normalized = scheduleFromRows(rows, s.directory);
  assert.deepEqual(normalized.data.calendar, { weekdays: [1, 2, 3, 4, 5] });
  assert.equal(normalized.data.bookings.length, 1);
  assert.deepEqual(normalized.data.bookings[0].slots, [{ date: slot.date }]);
  assert.equal('period' in normalized.data.bookings[0], false);
  assert.equal('period' in normalized.data.exceptions[0], false);
  assert.equal(normalized.data.exceptions[0].note, '保留备注');
  assert.equal(
    slotState(normalized, s.resources[0], { date: '2026-09-29' }, today).state,
    'unavailable',
  );
  assert.equal(s.data.bookings[0].period, 'am');
  const saved = apply(normalized, {
    type: 'calendar',
    calendar: { weekdays: [1, 2, 3, 4, 5] },
  });
  assert.deepEqual(saved.data.exceptions, normalized.data.exceptions);
  assert.equal(saved.data.revision, normalized.data.revision + 1);
});

test('个人日历仅调整指定工程师，调休扣减容量、加班覆盖全局休息且校验范围', () => {
  const s = f(),
    resource = s.resources[0];
  const change = (scope, patch = {}) => ({
    type: 'exception',
    scope,
    exception: {
      id: 'personal-day',
      resourceKey: resource.key,
      start: '2026-09-28',
      end: '2026-09-28',
      kind: '调休休息',
      note: '',
      ...patch,
    },
  });
  const leave = apply(s, change('personal'));
  assert.equal(slotState(leave, resource, slot, today).label, '调休休息');
  assert.equal(
    slotTotals(leave, s.resources, slot, today).available,
    s.resources.length - 1,
  );
  const weekend = { date: '2026-09-27' };
  const overtime = apply(
    s,
    change('personal', {
      start: weekend.date,
      end: weekend.date,
      kind: '加班上班',
    }),
  );
  assert.equal(slotTotals(overtime, s.resources, weekend, today).available, 1);
  const holiday = apply(
    s,
    change('global', { resourceKey: '', kind: '节假日' }),
  );
  const overtimeOnHoliday = apply(
    holiday,
    change('personal', { id: 'overtime', kind: '加班上班' }),
  );
  assert.equal(
    slotTotals(overtimeOnHoliday, s.resources, slot, today).available,
    1,
  );
  assert.throws(
    () => apply(s, change('personal', { resourceKey: '' })),
    /请选择具体工程师/,
  );
  assert.throws(() => apply(s, change('global')), /全局日历/);
  assert.throws(
    () => apply(s, change('global', { resourceKey: '', kind: '加班上班' })),
    /全员日历/,
  );
  assert.throws(() => apply(holiday, change('personal')), /不能更改/);
});

import { applyPersonalCalendarAction, canEditPersonalCalendar } from './personal-scheduling.ts';
import { personalSchedulingTransaction } from './scheduling-store.ts';
const engineer = { id: 'USR-004', role: 'SmartX 服务工程师', name: '林澈' };
const personalAction = (patch = {}) => ({ type: 'save', kind: '调休休息', start: '2026-09-28', end: '2026-09-28', note: '  个人安排  ', ...patch });

test('工程师可新增、修改、撤销本人调休，资源和登记人由当前身份决定', () => {
  let s = f();
  const original = structuredClone(s);
  s = { ...s, data: applyPersonalCalendarAction(s, engineer, personalAction({ resourceKey: 'partner:partner1', createdById: admin.id })) };
  const entry = s.data.exceptions[0];
  assert.equal(entry.resourceKey, 'internal:USR-004');
  assert.equal(entry.createdById, engineer.id);
  assert.equal(entry.note, '个人安排');
  assert.equal(entry.source, 'engineer');
  assert.equal(canEditPersonalCalendar(entry, 'internal:USR-004', engineer.id), true);
  assert.equal(calendarState(s.data, s.resources[0], slot).label, '调休休息');
  assert.equal(original.data.exceptions.length, 0);
  const updated = applyPersonalCalendarAction(s, engineer, personalAction({ id: entry.id, kind: '加班上班', start: '2026-09-27', end: '2026-09-27' }));
  assert.equal(updated.exceptions[0].id, entry.id);
  assert.equal(updated.exceptions[0].createdAt, entry.createdAt);
  assert.equal(calendarState(updated, s.resources[0], { date: '2026-09-27' }).state, 'available');
  const removed = applyPersonalCalendarAction({ ...s, data: updated }, engineer, { type: 'remove', id: entry.id });
  assert.equal(removed.exceptions.length, 0);
  assert.equal(removed.revision, 3);
  assert.equal(calendarState(removed, s.resources[0], { date: '2026-09-27' }).state, 'unavailable');
});

test('合作伙伴工程师仅可登记本人日历，停用身份和非工程师被拒绝', () => {
  const s = f();
  const partner = { id: 'partner1', role: '合作伙伴服务工程师', name: '伙伴一' };
  const data = applyPersonalCalendarAction(s, partner, personalAction());
  assert.equal(data.exceptions[0].resourceKey, 'partner:partner1');
  for (const actor of [manager, admin, { ...engineer, id: 'missing' }, { ...partner, id: 'stopped' }])
    assert.throws(() => applyPersonalCalendarAction(s, actor, personalAction()), /不能访问|不可用/);
  s.directory.partners[0].status = '停用';
  assert.throws(() => applyPersonalCalendarAction(s, partner, personalAction()), /不能访问|不可用/);
});

test('不能修改他人或统一安排，不能伪造全局日历类型或未知操作', () => {
  const s = f();
  s.data.exceptions = [
    { id: 'manager', resourceKey: 'internal:USR-004', kind: '调休休息', start: slot.date, end: slot.date, note: '' },
    { id: 'global', resourceKey: '', kind: '节假日', start: slot.date, end: slot.date, note: '' },
    { id: 'other', resourceKey: 'partner:partner1', kind: '调休休息', start: slot.date, end: slot.date, source: 'engineer', createdById: 'partner1', note: '' },
  ];
  for (const id of ['manager', 'global', 'other', 'missing']) {
    assert.throws(() => applyPersonalCalendarAction(s, engineer, personalAction({ id })), /只能修改/);
    assert.throws(() => applyPersonalCalendarAction(s, engineer, { type: 'remove', id }), /只能修改/);
  }
  assert.throws(() => applyPersonalCalendarAction(s, engineer, personalAction({ kind: '节假日' })), /仅支持/);
  assert.throws(() => applyPersonalCalendarAction(s, engineer, { type: 'calendar', calendar: { weekdays: [] } }), /不支持/);
});

test('校验日期、跨度、备注和个人安排重叠；全局假日不阻止本人加班', () => {
  let s = f();
  for (const patch of [{ start: '' }, { start: '2026-02-30' }, { end: '2026-09-27' }, { end: '2027-09-28' }])
    assert.throws(() => applyPersonalCalendarAction(s, engineer, personalAction(patch)), /日期|最多/);
  assert.throws(() => applyPersonalCalendarAction(s, engineer, personalAction({ note: 'a'.repeat(1001) })), /1000/);
  s.data = applyPersonalCalendarAction(s, engineer, personalAction());
  assert.throws(() => applyPersonalCalendarAction(s, engineer, personalAction()), /已有个人/);
  assert.throws(() => applyPersonalCalendarAction(s, engineer, personalAction({ kind: '加班上班' })), /已有个人/);
  assert.doesNotThrow(() => applyPersonalCalendarAction(s, engineer, personalAction({ start: '2026-09-29', end: '2026-09-29' })));
  s = f();
  s.data.exceptions.push({ id: 'holiday', resourceKey: '', kind: '节假日', start: slot.date, end: slot.date, note: '' });
  const data = applyPersonalCalendarAction(s, engineer, personalAction({ kind: '加班上班' }));
  assert.equal(calendarState(data, s.resources[0], slot).state, 'available');
  assert.equal(calendarState(data, s.resources[1], slot).state, 'unavailable');
});

test('调休与已派工单重叠时保留工单，且日历状态可识别冲突', () => {
  const s = apply(f(), action(f()));
  const before = structuredClone(s.projects);
  const data = applyPersonalCalendarAction(s, engineer, personalAction());
  assert.equal(calendarState(data, s.resources[0], slot).state, 'unavailable');
  assert.equal(slotState({ ...s, data }, s.resources[0], slot, today).bookings.length, 1);
  assert.deepEqual(s.projects, before);
});

test('个人登记持久化后调度可见，过期保存和撤销均拒绝，不覆盖其他资源', async (t) => {
  const s = f(), stores = schedulingStores(s);
  storage(t, stores);
  const saved = await personalSchedulingTransaction(engineer, { revision: 0, action: personalAction() });
  const entry = saved.data.exceptions[0];
  assert.equal(saved.data.revision, 1);
  assert.equal((await schedulingTransaction(admin)).data.exceptions[0].id, entry.id);
  await assert.rejects(personalSchedulingTransaction(engineer, { revision: 0, action: personalAction({ start: '2026-09-29', end: '2026-09-29' }) }), /已更新/);
  await assert.rejects(personalSchedulingTransaction(engineer, { revision: 0, action: { type: 'remove', id: entry.id } }), /已更新/);
  await personalSchedulingTransaction({ id: 'partner1', role: '合作伙伴服务工程师', name: '伙伴一' }, { revision: 1, action: personalAction() });
  await personalSchedulingTransaction(engineer, { revision: 2, action: { type: 'remove', id: entry.id } });
  const result = await schedulingTransaction(admin);
  assert.equal(result.data.exceptions.length, 1);
  assert.equal(result.data.exceptions[0].resourceKey, 'partner:partner1');
  assert.deepEqual(result.projects, s.projects);
});

test('个人登记写入失败回滚，原日历与工单不变', async (t) => {
  const stores = schedulingStores(f()), before = structuredClone(stores);
  storage(t, stores, (row) => row.id === schedulingId);
  await assert.rejects(personalSchedulingTransaction(engineer, { revision: 0, action: personalAction() }), /模拟存储失败/);
  assert.deepEqual(stores, before);
});
