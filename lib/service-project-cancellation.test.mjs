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
  const projects = creation.projects.map(entry => ({ id: entry.id, name: entry.id, customerId: 'customer', status: '进行中', revision: 2, sourceServiceRequestId: source.id, requestConversion: { assessmentSnapshot: snapshots.get(entry.id) }, items: [items.find(item => entry.workOrders[0].sourceItemId === item.id)], operations: { activities: [], meetings: [], worklogs: [] } }));
  return { source, projects };
}

test('仅启用项目经理可在待启动、进行中、待复核、待确认取消，原因必填且结束后不可重复取消', () => {
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
    assert.throws(() => cancelServiceProject(result, actor, localInternalUsers, '重复'), /仅启用/);
  }
  for (const other of [{ ...actor, role: 'SmartX 系统管理员' }, { ...actor, role: '合作伙伴服务工程师' }, { ...actor, id: 'USR-001' }]) assert.throws(() => cancelServiceProject(direct, other, localInternalUsers, '取消'), /仅启用/);
  const users = localInternalUsers.map(user => user.id === actor.id ? { ...user, status: '停用' } : user);
  assert.throws(() => cancelServiceProject(direct, actor, users, '取消'), /仅启用/);
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
