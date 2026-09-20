import test from 'node:test';
import assert from 'node:assert/strict';
import { canCancelServiceProject, cancelServiceProject } from './service-project-cancellation.ts';
import { localInternalUsers } from './internal-users.ts';
import { assetAvailable } from './request-assessment.ts';
import { entitlementAvailable } from './request-entitlement-reservations.ts';
import { projectRequestSnapshots } from './project-request-snapshot.ts';

const actor = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const at = '2026-09-16T12:00:00Z';
function fixture() {
  const items = ['a', 'b'].map(id => ({ id, serviceId: id, serviceName: id, method: '远程' }));
  const plan = { id: 'plan', effort: 4, requirements: [{ method: '远程', days: 4 }], allocations: [{ assetId: 'asset', name: '远程资产', method: '远程', days: 2 }], entitlementAllocations: items.map(item => ({ itemId: item.id, objectId: 'object', name: '集群', kind: 'upgrade', quantity: 2 })) };
  const creation = { at, projects: items.map(item => ({ id: `p-${item.id}`, workOrders: [{ sourceItemId: item.id }] })) };
  const source = { id: 'source', title: '请求', customerId: 'customer', status: '已转服务项目', items, operations: { projectCreation: creation, assessment: { plans: [plan], effort: { days: 4, estimatedDays: 4, lines: items.map(item => ({ itemId: item.id, estimatedDays: 2, billableDays: 2 })) }, approvals: [{ id: 'approval', planId: 'plan', state: '已通过', days: 2, gaps: [{ method: '远程', days: 2 }] }] } } };
  const snapshots = projectRequestSnapshots(source, creation);
  const projects = creation.projects.map(entry => ({ id: entry.id, name: entry.id, createdById: actor.id, customerId: 'customer', status: '进行中', revision: 2, sourceServiceRequestId: source.id, requestConversion: { assessmentSnapshot: snapshots.get(entry.id) }, items: [items.find(item => entry.workOrders[0].sourceItemId === item.id)], operations: { activities: [], meetings: [], worklogs: [] } }));
  return { source, projects };
}

test('启用项目经理和系统管理员可在待启动、进行中、待复核、待确认取消，原因必填且结束后不可重复取消', () => {
  const { projects } = fixture();
  const direct = { ...projects[0], sourceServiceRequestId: undefined, requestConversion: undefined };
  for (const status of ['已完成', '已取消']) assert.equal(canCancelServiceProject({ ...direct, status }, actor, localInternalUsers), false);
  for (const status of ['待启动', '进行中', '待复核', '待确认']) {
    const result = cancelServiceProject({ ...direct, status }, actor, localInternalUsers, '  需求取消  ', undefined, at).project;
    assert.equal(result.status, '已取消');
    assert.equal(result.cancellation.fromStatus, status);
    assert.equal(result.cancellation.reason, '需求取消');
    assert.equal(result.operations.activities.at(-1).title, '取消服务项目');
    assert.deepEqual(result.items, direct.items);
    assert.throws(() => cancelServiceProject(result, actor, localInternalUsers, '重复'), /仅负责/);
  }
  for (const other of [{ ...actor, role: 'SmartX 系统管理员' }, { ...actor, role: '合作伙伴服务工程师' }, { ...actor, id: 'USR-001' }]) assert.throws(() => cancelServiceProject(direct, other, localInternalUsers, '取消'), /仅负责/);
  assert.doesNotThrow(() => cancelServiceProject(direct, { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' }, localInternalUsers, '取消'));
  const users = localInternalUsers.map(user => user.id === actor.id ? { ...user, status: '停用' } : user);
  assert.throws(() => cancelServiceProject(direct, actor, users, '取消'), /仅负责/);
  assert.throws(() => cancelServiceProject(direct, actor, localInternalUsers, ' '), /原因/);
});

test('只释放本项目的人天与权益并作废分配的特批，兄弟项目额度保留，全部取消后完整释放', () => {
  const { source, projects } = fixture();
  const before = structuredClone(source);
  const asset = { id: 'asset', balanceDays: 10 };
  const object = { id: 'object', customerId: 'customer', upgradeEntitlement: 10 };
  assert.equal(assetAvailable(asset, [source], ''), 8);
  assert.equal(entitlementAvailable(object, 'upgrade', [source]), 6);
  const first = cancelServiceProject(projects[0], actor, localInternalUsers, '取消第一个项目', source, at);
  assert.equal(assetAvailable(asset, [first.source], ''), 9);
  assert.equal(entitlementAvailable(object, 'upgrade', [first.source]), 8);
  assert.equal(first.source.projectReservationReleases[0].invalidatedApprovals[0].days, 1);
  assert.deepEqual(first.project.requestConversion.assessmentSnapshot, projects[0].requestConversion.assessmentSnapshot);
  assert.deepEqual(source, before);
  assert.equal(projects[1].status, '进行中');
  const second = cancelServiceProject(projects[1], actor, localInternalUsers, '取消第二个项目', first.source, at);
  assert.equal(assetAvailable(asset, [second.source], ''), 10);
  assert.equal(entitlementAvailable(object, 'upgrade', [second.source]), 10);
  assert.equal(second.source.projectReservationReleases.reduce((sum, release) => sum + release.invalidatedApprovals[0].days, 0), 2);
  assert.deepEqual(second.source.operations.assessment, before.operations.assessment);
  assert.throws(() => cancelServiceProject(projects[0], actor, localInternalUsers, '重复释放', first.source), /已释放/);
});

test('无转换副本的旧项目使用已冻结来源拆分依据；关联损坏时禁止静默释放', () => {
  const { source, projects } = fixture();
  const old = structuredClone(projects[0]); delete old.requestConversion.assessmentSnapshot;
  const result = cancelServiceProject(old, actor, localInternalUsers, '取消', source, at);
  assert.equal(result.source.projectReservationReleases[0].assetAllocations[0].days, 1);
  assert.ok(result.project.requestConversion.assessmentSnapshot);
  assert.throws(() => cancelServiceProject(projects[0], actor, localInternalUsers, '取消'), /来源请求/);
  assert.throws(() => cancelServiceProject(projects[0], actor, localInternalUsers, '取消', { ...source, customerId: 'other' }), /关联/);
});

test('取消项目同步取消全部工单，保留执行资料和原取消记录且不可恢复', () => {
  const project = { ...fixture().projects[0], sourceServiceRequestId: undefined, requestConversion: undefined,
    workOrders: ['待执行', '进行中', '已完成', '已取消'].map((status, i) => ({ id: `wo-${i}`, status, completedAt: status === '已完成' ? at : undefined,
      steps: [{ data: { note: '保留执行记录' } }], ...(status === '已取消' ? { cancellation: { reason: '原取消原因', at } } : {}) })) };
  const original = structuredClone(project);
  const result = cancelServiceProject(project, actor, localInternalUsers, '项目取消', undefined, at).project;
  assert.ok(result.workOrders.every(order => order.status === '已取消'));
  result.workOrders.slice(0, 3).forEach((order, i) => {
    assert.equal(order.cancellation.previousStatus, original.workOrders[i].status);
    assert.equal(order.cancellation.reason, '项目取消');
    assert.deepEqual(order.steps, original.workOrders[i].steps);
  });
  assert.deepEqual(result.workOrders[3], original.workOrders[3]);
  assert.deepEqual(project, original);
  assert.throws(() => changeServiceProjectSuspension(result, actor, localInternalUsers, 'resume'), /不允许/);
});

import { changeServiceProjectSuspension, canPauseServiceProject, canResumeServiceProject } from './service-project-suspension.ts';
import { applyWorkStep, emptyWorkStepData, submitProjectReview } from './service-work-orders.ts';
import { canRecordProjectWorklog, canConfirmProjectWorklog } from './service-project-operations.ts';
import { applyProjectReview } from './service-project-review.ts';
import { editServiceProject } from './service-projects.ts';

test('项目各未关闭阶段可暂停并精确恢复，工单、核定、审批和客户确认保持原样', () => {
  const base = { ...fixture().projects[0], sourceServiceRequestId: undefined, requestConversion: undefined,
    workOrders: [{ id: 'wo', status: '已完成', steps: [{ data: { note: '执行记录' } }] }],
    review: { effort: { stage: '最终', lines: [] }, basis: { allocations: [{ assetId: 'asset', days: 1 }] }, approvals: [{ state: '审批中' }], confirmations: [{ state: '待确认' }] } };
  for (const status of ['待启动', '进行中', '待复核', '待确认']) {
    const project = { ...base, status }, before = structuredClone(project);
    const paused = changeServiceProjectSuspension(project, actor, localInternalUsers, 'pause', at, '等待客户窗口');
    assert.equal(paused.status, '已暂停');
    assert.equal(paused.suspension.fromStatus, status);
    assert.equal(paused.revision, project.revision + 1);
    assert.equal(canPauseServiceProject(paused, actor, localInternalUsers), false);
    assert.equal(canResumeServiceProject(paused, actor, localInternalUsers), true);
    assert.equal(canRecordProjectWorklog(paused, actor), false);
    assert.equal(canConfirmProjectWorklog(paused, actor), false);
    assert.throws(() => applyWorkStep(paused, actor, { orderId: 'wo', type: 'complete', data: emptyWorkStepData() }), /进行中|当前/);
    assert.throws(() => submitProjectReview(paused, actor), /仅本项目/);
    assert.throws(() => editServiceProject(paused, { ...paused, status: '进行中' }, actor, []), /已暂停/);
    assert.throws(() => applyProjectReview(paused, { type: 'gap-submit' }, actor, {}), /阶段/);
    const restored = changeServiceProjectSuspension(paused, actor, localInternalUsers, 'resume', at);
    assert.equal(restored.status, status);
    assert.equal(restored.suspension, undefined);
    assert.equal(restored.revision, project.revision + 2);
    assert.deepEqual(restored.workOrders, project.workOrders);
    assert.deepEqual(restored.review, project.review);
    assert.deepEqual(project, before);
    assert.equal(changeServiceProjectSuspension(restored, actor, localInternalUsers, 'pause', at, '等待客户窗口').suspension.fromStatus, status);
    const cancelled = cancelServiceProject(paused, actor, localInternalUsers, '取消暂停项目', undefined, at).project;
    assert.equal(cancelled.status, '已取消');
    assert.equal(cancelled.cancellation.fromStatus, status);
    assert.equal(cancelled.suspension, undefined);
  }
});

test('暂停恢复校验身份和状态，结束后不可暂停或恢复', () => {
  const project = fixture().projects[0];
  const paused = changeServiceProjectSuspension(project, actor, localInternalUsers, 'pause', at, '等待客户窗口');
  for (const wrong of [{ ...actor, role: 'SmartX 服务工程师' }, { ...actor, role: '合作伙伴服务工程师' }, { ...actor, id: 'missing' }]) {
    assert.equal(canPauseServiceProject(project, wrong, localInternalUsers), false);
    assert.equal(canResumeServiceProject(paused, wrong, localInternalUsers), false);
  }
  const disabled = localInternalUsers.map(user => user.id === actor.id ? { ...user, status: '停用' } : user);
  assert.throws(() => changeServiceProjectSuspension(project, actor, disabled, 'pause'), /不允许/);
  for (const status of ['已完成', '已取消']) for (const action of ['pause', 'resume'])
    assert.throws(() => changeServiceProjectSuspension({ ...paused, status }, actor, localInternalUsers, action), /不允许/);
  assert.throws(() => changeServiceProjectSuspension(project, actor, localInternalUsers, 'resume'), /不允许/);
  assert.throws(() => changeServiceProjectSuspension({ ...paused, suspension: undefined }, actor, localInternalUsers, 'resume'), /不允许/);
});

test('暂停原因必填并保存，恢复不改历史原因且兼容无原因的历史暂停记录', () => {
  const project = fixture().projects[0];
  for (const reason of ['', '  ', 'x'.repeat(2001)]) assert.throws(() => changeServiceProjectSuspension(project, actor, localInternalUsers, 'pause', at, reason), /暂停原因/);
  const paused = changeServiceProjectSuspension(project, actor, localInternalUsers, 'pause', at, '  客户维护窗口延期  ');
  assert.equal(paused.suspension.reason, '客户维护窗口延期');
  assert.match(paused.operations.activities.at(-1).detail, /客户维护窗口延期/);
  const resumed = changeServiceProjectSuspension(paused, actor, localInternalUsers, 'resume', at);
  assert.equal(resumed.suspension, undefined);
  assert.match(resumed.operations.activities.at(-2).detail, /客户维护窗口延期/);
  const legacy = structuredClone(paused); delete legacy.suspension.reason;
  assert.equal(changeServiceProjectSuspension(legacy, actor, localInternalUsers, 'resume', at).status, project.status);
});
