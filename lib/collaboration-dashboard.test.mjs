import test from 'node:test';
import assert from 'node:assert/strict';
import { collaborationDashboard } from './collaboration-dashboard.ts';
import { emptyAssessment } from './request-assessment.ts';
import { localInternalUsers } from './internal-users.ts';
import { hardwareCompatibilityServiceId } from './request-hardware-assessment.ts';

const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理' };
const presales = { id: 'USR-002', name: '陈屿', role: 'SmartX 售前工程师' };
const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
const request = (id, extra = {}) => ({ id, title: id, status: '草稿', customerId: 'customer', createdById: sales.id, createdByAudience: 'internal', items: [], updatedAt: '2026-09-30', internalParticipants: [{ userId: sales.id }], ...extra });
const project = (id, extra = {}) => ({ id, name: id, status: '进行中', customerId: 'customer', createdById: 'USR-003', workOrders: [], updatedAt: '2026-09-30', collaborators: { internal: [{ id: sales.id }] }, ...extra });
const dashboard = (projects, requests, actor = sales) => collaborationDashboard(projects, requests, actor, { users: localInternalUsers, customers: [{ id: 'customer', ownerUserId: sales.id }], requests, services: [], assets: [], contacts: [] });

test('最近动态仅汇总本人创建或协作记录，按实际时间倒序并与项目经理统一限制十条', () => {
  const activity = (id, at) => ({ id, at, actor: '同事', title: '更新记录' });
  const mine = request('mine', { operations: { activities: [activity('old', '2026-09-29T12:00:00+08:00'), activity('invalid', 'invalid')] } });
  const shared = project('shared', { operations: { activities: [activity('new', '2026-09-30T03:00:00Z')] } });
  const unrelated = request('unrelated', { createdById: presales.id, internalParticipants: [], operations: { activities: [activity('hidden', '2026-09-30T12:00:00Z')] } });
  const result = dashboard([shared], [mine, unrelated]);
  assert.deepEqual(result.activities.map(row => [row.id, row.view, row.recordId]), [['new', 'projects', 'shared'], ['old', 'requests', 'mine']]);
  assert.deepEqual(dashboard([shared], [mine, unrelated], admin).activities, []);
  mine.operations.activities = Array.from({ length: 12 }, (_, i) => activity(String(i), `2026-09-${String(10+i).padStart(2,'0')}T00:00:00Z`));
  assert.deepEqual(dashboard([], [mine]).activities.map(row => row.id), ['11','10','9','8','7','6','5','4','3','2']);
});

test('合并本人创建及协作记录，按更新时间排序、去重且不包含无访问权记录', () => {
  const mine = request('mine');
  const shared = request('shared', { createdById: presales.id });
  const hidden = request('hidden', { createdById: presales.id, internalParticipants: [] });
  const result = dashboard([
    project('created', { createdById: sales.id }),
    project('converted', { sourceServiceRequestId: mine.id }),
    project('shared'),
    project('hidden', { collaborators: { internal: [] } }),
  ], [mine, shared, hidden]);
  assert.deepEqual(result.projects.map(p => p.id), ['converted', 'created', 'shared']);
  assert.deepEqual(result.requests.map(r => r.id), ['mine', 'shared']);
  assert.deepEqual(result.tasks.map(t => [t.id, t.kind]), [['mine', '提交申请']]);
  assert.equal(dashboard([], [mine], { ...presales, name: sales.name }).requests.length, 0);
});

test('待办只归属于当前审批节点，不向历史或后续审批人以及管理员广播', () => {
  const approval = { id: 'approval', days: 2, planId: 'plan', state: '待审批', approverId: sales.id,
    workflow: { steps: [{ approverId: presales.id, state: '已通过' }, { approverId: sales.id, state: '待审批' }, { approverId: hardware.id, state: '未开始' }] } };
  const record = request('approval', { status: '待评估', createdById: presales.id,
    operations: { assessment: { ...emptyAssessment(), plans: [{ id: 'plan' }], approvals: [approval] } } });
  const pendingProject = project('pending-project', { review: { basis: { id: 'plan' }, approvals: [approval], confirmations: [] } });
  assert.deepEqual(dashboard([pendingProject], [record]).tasks.map(t => t.kind).sort(), ['申请额度审批', '项目额度审批'].sort());
  for (const actor of [presales, hardware, admin]) assert.equal(dashboard([pendingProject], [record], actor).tasks.length, 0);
  for (const status of ['已暂停', '已完成', '已取消']) assert.equal(dashboard([{ ...pendingProject, status }], []).tasks.length, 0);
  for (const status of ['待确认', '待受理', '评估完成', '已转服务项目', '已取消']) assert.equal(dashboard([], [{ ...record, status }]).tasks.length, 0);
});

test('依据关联和发起确认仅在评估通过且核定完成后交给实际负责人', () => {
  const record = request('basis', { status: '待评估', operations: { assessment: { ...emptyAssessment(), rounds: [{ outcome: '评估通过' }], effort: { days: 1 } } } });
  assert.equal(dashboard([], [record]).tasks[0].kind, '关联服务依据');
  assert.equal(dashboard([], [record], admin).tasks.length, 0);
  record.operations.assessment.plans.push({ id: 'plan', effort: 1, allocations: [{ days: 1 }] });
  assert.equal(dashboard([], [record]).tasks[0].kind, '发起申请客户确认');
  record.operations.assessment.plans[0].allocations = [];
  assert.equal(dashboard([], [record]).tasks[0].kind, '发起申请额度审批');
  record.operations.assessment.effort = undefined;
  record.operations.assessment.plans = [];
  assert.equal(dashboard([], [record]).tasks.length, 0);
});

test('硬件评估跟随已分配评估人，其他内部角色不会收到该待办', () => {
  const record = request('hardware', { status: '待评估', items: [{ id: 'item', serviceId: hardwareCompatibilityServiceId }],
    operations: { assessment: { ...emptyAssessment(), routing: { hardware: { userId: hardware.id } } } } });
  assert.equal(dashboard([], [record], hardware).tasks[0].kind, '硬件评估');
  assert.equal(dashboard([], [record], sales).tasks.length, 0);
  assert.equal(dashboard([], [record], admin).tasks.length, 0);
  record.status = '已取消';
  assert.equal(dashboard([], [record], hardware).tasks.length, 0);
});

test('参与或创建项目不把项目经理的派单、工时确认等阶段事项变为个人待办', () => {
  for (const actor of [sales, presales, hardware, admin]) {
    const rows = [
      project('start', { status: '待启动' }),
      project('dispatch', { workOrders: [{ id: 'order', status: '待执行' }] }),
      project('worklogs', { operations: { worklogs: [{ id: 'log', hours: 8 }] } }),
      project('review', { status: '待复核' }),
      project('confirm', { status: '待确认' }),
    ].map(record => ({ ...record, collaborators: { internal: [{ id: actor.id }] } }));
    assert.deepEqual(dashboard(rows, [], actor).tasks, []);
    assert.equal(dashboard(rows, [], actor).projects.length, rows.length);
    assert.deepEqual(dashboard(rows.map(row => ({ ...row, createdById: actor.id })), [], actor).tasks, []);
  }
  assert.deepEqual(dashboard([], [request('draft')]).tasks.map(t => t.kind), ['提交申请']);
});

test('实际归属的项目审批仍参与逾期优先排序', () => {
  const approval = { id: 'approval', days: 1, planId: 'basis', state: '待审批', approverId: sales.id };
  const rows = [project('overdue-approval', { plannedCompletionDate: '2026-09-20', review: { basis: { id: 'basis' }, approvals: [approval] } })];
  const requests = [request('draft', { expectedServiceDate: '2026-09-01' })];
  const context = { users: localInternalUsers, customers: [], requests, services: [], assets: [], contacts: [] };
  const result = collaborationDashboard(rows, requests, sales, context, '2026-09-30');
  assert.deepEqual(result.tasks.map(t => [t.id, t.kind, t.overdue]), [['overdue-approval', '项目额度审批', true], ['draft', '提交申请', false]]);
});

test('两个分类只展示未完成记录，保留草稿及暂停项目，完成动态仍可回顾', () => {
  const activity = { id: 'finished-activity', at: '2026-09-30T00:00:00Z', actor: '同事', title: '完成项目' };
  const result = dashboard([
    project('active', { updatedAt: '2026-09-29' }),
    project('paused', { status: '已暂停', updatedAt: '2026-09-30' }),
    project('completed', { status: '已完成', operations: { activities: [activity] } }),
    project('cancelled', { status: '已取消' }),
    project('converted', { sourceServiceRequestId: 'converted-request', collaborators: { internal: [{ id: sales.id }] } }),
  ], [
    ...['草稿', '待评估', '待确认', '待受理', '评估完成', '已取消'].map(status => request(status, { status })),
    request('converted-request', { status: '已转服务项目' }),
    request('collaboration', { status: '待确认', createdById: presales.id, updatedAt: '2026-09-29' }),
  ]);
  assert.deepEqual(result.projects.map(row => row.id), ['converted', 'paused', 'active']);
  assert.deepEqual(new Set(result.requests.map(row => row.id)), new Set(['草稿', '待评估', '待确认', '待受理', 'collaboration']));
  assert.equal(result.requests.at(-1).id, 'collaboration');
  assert.equal(result.activities[0].id, activity.id);
});
