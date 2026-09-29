import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentPeriod, assignmentScheduleEntries, assignmentOverlaps } from './work-order-assignment-schedule.ts';
import { assignWorkOrders } from './work-order-assignment.ts';
import { localInternalUsers } from './internal-users.ts';

const actor = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const person = { id: 'USR-004', name: '林澈', group: 'internal' };
const key = 'internal:USR-004';
const order = (id, start = '2026-09-29', end = '2026-10-01') => ({ id, item: { serviceId: 'service', serviceName: id }, status: '待执行', expectedServiceDate: start, plannedCompletionDate: end, assignees: [person] });
const project = (id, orders) => ({ id, name: id, status: '进行中', revision: 1, createdSite: '内部系统', serviceProviderId: 'provider:smartx',
  expectedServiceDate: '2026-09-28', plannedCompletionDate: '2026-10-09',
  collaborators: { internal: [{ id: actor.id, assignmentRoles: ['项目经理'] }] }, workOrders: orders });

test('优先工单日期，无日期时明确采用项目日期，部分或无效日期不拼凑范围', () => {
  const p = project('p', []);
  assert.deepEqual(assignmentPeriod(p, order('a')), { start: '2026-09-29', end: '2026-10-01', source: 'order' });
  assert.deepEqual(assignmentPeriod(p, order('a', '', '')), { start: '2026-09-28', end: '2026-10-09', source: 'project' });
  for (const [start, end] of [['2026-09-29', ''], ['', '2026-10-01'], ['2026-02-30', '2026-03-01'], ['2026-10-01', '2026-09-29']]) {
    assert.equal(assignmentPeriod(p, order('a', start, end)), null);
  }
});

test('查全所选人员的已有工单，排除自身及终态，兼容旧派单字段和跨项目占用', () => {
  const target = project('target', [order('self'), order('same-project')]);
  const other = project('other', [order('legacy'), { ...order('cancelled'), status: '已取消' }, { ...order('done'), status: '已完成' }, { ...order('paused'), status: '已暂停' }]);
  other.workOrders[0].assignee = person;
  delete other.workOrders[0].assignees;
  const entries = assignmentScheduleEntries([target, other, { ...project('closed', [order('x')]), status: '已完成' }], actor, 'target', ['self']);
  const overlaps = assignmentOverlaps([assignmentPeriod(target, target.workOrders[0])], [key], entries);
  assert.deepEqual(overlaps[0].orders.map(o => o.orderName).sort(), ['legacy', 'paused', 'same-project']);
  assert.deepEqual(assignmentOverlaps([assignmentPeriod(target, target.workOrders[0])], ['partner:USR-004'], entries), []);
  assert.deepEqual(assignmentOverlaps([assignmentPeriod(target, target.workOrders[0])], [], entries), []);
});

test('按每张待派工单单独比较日期，边界当天重叠，批量日期之间的空档不误报', () => {
  const target = project('target', [order('a', '2026-09-29', '2026-09-30'), order('b', '2026-10-05', '2026-10-06')]);
  const existing = project('existing', [order('gap', '2026-10-01', '2026-10-04'), order('boundary', '2026-09-30', '2026-09-30'), order('both', '2026-09-29', '2026-10-07')]);
  const entries = assignmentScheduleEntries([target, existing], actor, target.id, ['a', 'b']);
  const result = assignmentOverlaps(target.workOrders.map(o => assignmentPeriod(target, o)), [key, key], entries);
  assert.equal(result.length, 1);
  assert.equal(result[0].orders.length, 2);
  assert.deepEqual(result[0].orders.find(o => o.orderName === 'both').ranges, [{ start: '2026-09-29', end: '2026-09-30' }, { start: '2026-10-05', end: '2026-10-06' }]);
  assert.deepEqual(result[0].orders.find(o => o.orderName === 'boundary').ranges, [{ start: '2026-09-30', end: '2026-09-30' }]);
});

test('无权查看的项目仍提示日期占用，不泄露项目名称或工单名称', () => {
  const target = project('target', [order('self')]);
  const hidden = { ...project('保密项目', [order('保密工单')]), collaborators: { internal: [] } };
  const entries = assignmentScheduleEntries([hidden], actor, target.id, ['self']);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].projectName, '其他项目');
  assert.equal(entries[0].orderName, '已安排工单');
  assert.ok(!JSON.stringify(entries).includes('保密'));
  assert.equal(assignmentOverlaps([assignmentPeriod(target, target.workOrders[0])], [key], entries).length, 1);
});

test('日期重叠仅作提示，不加入派单阻止条件，正常权限与认证规则仍适用', () => {
  const target = project('target', [{ ...order('self'), assignees: [] }]);
  const existing = project('existing', [order('busy')]);
  const entries = assignmentScheduleEntries([existing], actor, target.id, ['self']);
  assert.equal(assignmentOverlaps([assignmentPeriod(target, target.workOrders[0])], [key], entries).length, 1);
  const directory = { users: localInternalUsers, contacts: [], partners: [], partnerUsers: [], services: [{ id: 'service', name: '实施', certifications: ['无认证要求'] }], serviceCertifications: [], providers: { revision: 0, entries: [] } };
  const saved = assignWorkOrders(target, actor, { orderIds: ['self'], assignees: [person] }, directory);
  assert.equal(saved.workOrders[0].assignees[0].id, person.id);
  assert.throws(() => assignWorkOrders(target, { ...actor, id: 'not-manager' }, { orderIds: ['self'], assignees: [person] }, directory));
});
