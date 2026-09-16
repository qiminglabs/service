import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceProjects, projectSplitIssue, projectCreationSaveIssue, canCreateServiceProjects, isProjectCreationEligible, serviceProjectCreationEnabled, serviceProjectPendingMessage } from './request-projects.ts';
import { assetAvailable } from './request-assessment.ts';
const pm = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const at = '2026-09-09T10:00:00Z';
function request() {
  return { id: 'r1', title: '交付申请', customerId: 'c1', status: '待受理', updatedAt: at,
    items: [
      { id: 'item1', serviceId: 's1', serviceName: '平台实施', method: '远程', description: '主站点', materials: [] },
      { id: 'item2', serviceId: 's1', serviceName: '平台实施', method: '远程', description: '备站点', materials: [] },
      { id: 'item3', serviceId: 's2', serviceName: '技术培训', method: '远程', description: '管理员培训', materials: [] },
    ],
    operations: { activities: [], assessment: { managerId: 'pm', plans: [{ id: 'plan1', allocations: [{ assetId: 'a1', days: 3 }] }], approvals: [], confirmation: { planId: 'plan1' } } },
  };
}
const groups = () => [{ id: 'p1', name: '主站点交付', note: '实施与培训', itemIds: ['item1', 'item3'] }, { id: 'p2', name: '备站点交付', note: '', itemIds: ['item2'] }];
test('任意分组生成项目，每个申请项生成一张工单，同目录不同申请项不合并', { skip: !serviceProjectCreationEnabled && '服务项目待开发，生成流程暂停' }, () => {
  const r = request();
  const next = createServiceProjects(r, pm, groups(), 'conversion1', at);
  assert.equal(next.status, '已转服务项目');
  const projects = next.operations.projectCreation.projects;
  assert.equal(projects.length, 2);
  assert.deepEqual(projects.map(project => project.workOrders.length), [2, 1]);
  const orders = projects.flatMap(project => project.workOrders);
  assert.equal(new Set(orders.map(order => order.id)).size, 3);
  assert.deepEqual(orders.map(order => order.sourceItemId), ['item1', 'item3', 'item2']);
  assert.equal(orders.filter(order => order.serviceId === 's1').length, 2);
  assert.equal(projects[0].managerId, pm.id);
  assert.equal(r.status, '待受理');
  assert.equal(projectCreationSaveIssue(next, r, pm), null);
  assert.equal(assetAvailable({ id: 'a1', balanceDays: 5 }, [next]), 2);
  assert.deepEqual(next.operations.assessment, r.operations.assessment);
});
test('完整性校验阻止漏项、重复分配、未知申请项、空项目和空名称', () => {
  const r = request();
  assert.equal(projectSplitIssue(r, [{ id: 'all', name: '统一交付', note: '', itemIds: r.items.map(item => item.id) }]), null);
  assert.equal(projectSplitIssue(r, r.items.map((item, i) => ({ id: `p${i}`, name: `项目${i}`, note: '', itemIds: [item.id] }))), null);
  for (const plan of [[], [{ ...groups()[0], name: '' }], [{ ...groups()[0], itemIds: [] }], [groups()[0]], [groups()[0], { ...groups()[1], itemIds: ['item1', 'item2'] }], [groups()[0], { ...groups()[1], itemIds: ['unknown'] }]]) {
    assert.ok(projectSplitIssue(r, plan));
    assert.throws(() => createServiceProjects(r, pm, plan));
  }
});
test('仅待受理负责项目经理可创建，保存层阻止重复创建与过期覆盖', { skip: !serviceProjectCreationEnabled && '服务项目待开发，生成流程暂停' }, () => {
  const r = request();
  for (const actor of [{ ...pm, id: 'other' }, { ...pm, role: 'SmartX 系统管理员' }, { ...pm, role: '客户' }]) assert.throws(() => createServiceProjects(r, actor, groups()));
  for (const status of ['草稿', '待评估', '待确认', '已取消', '已转服务项目']) assert.equal(canCreateServiceProjects({ ...r, status }, pm), false);
  const next = createServiceProjects(r, pm, groups(), 'one', at);
  assert.throws(() => createServiceProjects(next, pm, groups()));
  const duplicate = createServiceProjects(r, pm, groups(), 'two', at);
  assert.ok(projectCreationSaveIssue(duplicate, next, pm));
  assert.ok(projectCreationSaveIssue({ ...next, title: '篡改标题' }, r, pm));
  assert.ok(projectCreationSaveIssue({ ...r, status: '已转服务项目' }, r, pm));
  assert.ok(projectCreationSaveIssue(next, { ...r, status: '已取消' }, pm));
  assert.ok(projectCreationSaveIssue(next, r, { ...pm, role: '客户' }));
});
test('工单包含独立申请项及材料快照，原材料不被修改', { skip: !serviceProjectCreationEnabled && '服务项目待开发，生成流程暂停' }, async () => {
  const r = request();
  const blob = new Blob(['实施方案'], { type: 'text/plain' });
  r.items[0].materials = [{ id: 'm', files: [{ id: 'f', name: '方案.txt', blob }] }];
  const next = createServiceProjects(r, pm, groups(), 'files', at);
  const item = next.operations.projectCreation.projects[0].workOrders[0].item;
  r.items[0].description = '后续修改';
  assert.equal(item.description, '主站点');
  assert.equal(await item.materials[0].files[0].blob.text(), '实施方案');
});

test('拖动或菜单移动申请项不丢失、不重复，保留项目名称与其他项目顺序', async () => {
  const { moveProjectItem } = await import('./request-projects.ts');
  const before = groups();
  const moved = moveProjectItem(before, 'item3', 'p2');
  assert.deepEqual(moved.map(group => group.itemIds), [['item1'], ['item2', 'item3']]);
  assert.equal(moved[0].name, before[0].name);
  assert.deepEqual(before[0].itemIds, ['item1', 'item3']);
  assert.equal(projectSplitIssue(request(), moved), null);
  assert.deepEqual(moveProjectItem(moved, 'item3', 'p2'), moved);
  assert.deepEqual(moveProjectItem(moved, 'unknown', 'p2'), moved);
  assert.deepEqual(moveProjectItem(moved, 'item3', 'missing'), moved);
  const empty = moveProjectItem(moved, 'item1', 'p2');
  assert.match(projectSplitIssue(request(), empty), /尚未分配/);
  assert.equal(projectSplitIssue(request(), empty.filter(group => group.itemIds.length)), null);
});


test('服务项目待开发期间入口、创建动作和保存均关闭，已生成记录仍可读取', () => {
  if (serviceProjectCreationEnabled) return;
  const r = request();
  const before = structuredClone(r);
  assert.equal(isProjectCreationEligible(r, pm), true);
  assert.equal(canCreateServiceProjects(r, pm), false);
  assert.throws(() => createServiceProjects(r, pm, groups()), /待开发/);
  assert.deepEqual(r, before);
  const attempted = { ...r, status: '已转服务项目', operations: { ...r.operations, projectCreation: { id: 'injected', projects: [] } } };
  assert.equal(projectCreationSaveIssue(attempted, r, pm), serviceProjectPendingMessage);
  assert.equal(projectCreationSaveIssue({ ...r, status: '已转服务项目' }, r, pm), serviceProjectPendingMessage);
  assert.equal(projectCreationSaveIssue(attempted, attempted, pm), null);
  assert.equal(projectCreationSaveIssue(r, r, pm), null);
});
