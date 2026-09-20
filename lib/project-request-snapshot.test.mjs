import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRequestSnapshots } from './project-request-snapshot.ts';
import { sumDays } from './day-quantity.ts';

function fixture() {
  const items = [['r1', '远程', 1], ['r2', '远程', 2], ['s1', '现场', 3], ['e1', '现场', 0]].map(([id, method, days]) => ({ id, serviceName: `服务-${id}`, serviceId: id, method, days }));
  const lines = items.map(item => ({ itemId: item.id, serviceId: item.id, serviceName: item.serviceName, estimatedDays: item.days, priceCoefficient: 1, billableDays: item.days }));
  lines[3] = { ...lines[3], kind: 'entitlement', entitlementKind: 'upgrade', entitlementObjects: [{ objectId: 'o1', name: '业务对象', nodes: 3, available: 3, deficit: 0 }] };
  const plan = { id: 'plan', roundId: 'round', author: '销售', at: '2026-09-16T08:00:00Z', salesId: 'sales', salesName: '销售', effort: 6,
    requirements: [{ method: '远程', days: 3 }, { method: '现场', days: 3 }],
    allocations: [{ assetId: 'remote', name: '远程人天', method: '远程', days: 1 }, { assetId: 'onsite', name: '现场人天', method: '现场', days: 1 }],
    entitlementAllocations: [{ itemId: 'e1', objectId: 'o1', name: '业务对象', kind: 'upgrade', quantity: 3 }] };
  const approval = { id: 'approval', planId: 'plan', state: '已通过', days: 4, gaps: [{ method: '远程', days: 2 }, { method: '现场', days: 2 }], author: '申请人', approver: '上级', reason: '交付支持', note: '同意', decidedAt: '2026-09-16T09:00:00Z', workflow: { ruleName: '特批规则', steps: [{ id: 'step', nodeName: '上级审批', approver: '上级', state: '已通过' }] } };
  const record = { id: 'request', title: '原请求', items, operations: { assessment: { effort: { author: '项目经理', at: '2026-09-16T07:00:00Z', days: 6, estimatedDays: 6, lines, note: '核定备注' }, plans: [plan], approvals: [{ ...approval, id: 'old', state: '已失效', days: 100 }, approval] } } };
  const creation = { at: '2026-09-16T10:00:00Z', projects: [ { id: 'p1', workOrders: [{ sourceItemId: 'r1' }, { sourceItemId: 's1' }] }, { id: 'p2', workOrders: [{ sourceItemId: 'r2' }, { sourceItemId: 'e1' }] } ] };
  return { record, creation };
}

test('明细与权益按服务项拆分，资产及特批按服务方式分配并保持总额', () => {
  const { record, creation } = fixture();
  const [a, b] = projectRequestSnapshots(record, creation).values();
  assert.deepEqual(a.effort.lines.map(line => line.itemId), ['r1', 's1']);
  assert.deepEqual(b.effort.lines.map(line => line.itemId), ['r2', 'e1']);
  assert.deepEqual([a.effort.days, b.effort.days], [4, 2]);
  assert.equal(a.basis.entitlementAllocations.length, 0);
  assert.equal(b.basis.entitlementAllocations[0].quantity, 3);
  assert.deepEqual(a.basis.allocations.map(value => [value.method, value.days]), [['远程', 0.3], ['现场', 1]]);
  assert.deepEqual(b.basis.allocations.map(value => [value.method, value.days]), [['远程', 0.7]]);
  assert.deepEqual(a.approvals[0].gaps, [{ method: '远程', days: 0.7 }, { method: '现场', days: 2 }]);
  assert.equal(b.approvals[0].days, 1.3);
  assert.equal(sumDays([a.approvals[0].days, b.approvals[0].days]), 4);
  assert.equal(a.approvals[0].sourceDays, 4);
  assert.equal(a.approvals[0].id, 'approval');
  assert.equal(a.approvals[0].workflow.steps[0].approver, '上级');
});

test('转换副本与来源、兄弟项目完全独立，保留转换时间及审批记录', () => {
  const { record, creation } = fixture();
  const [a, b] = projectRequestSnapshots(record, creation).values();
  record.operations.assessment.effort.note = '源记录改变';
  record.items[0].serviceName = '改名';
  record.operations.assessment.approvals.at(-1).workflow.steps[0].approver = '源审批人改变';
  assert.equal(a.effort.note, '核定备注');
  assert.equal(a.items[0].name, '服务-r1');
  assert.equal(a.capturedAt, creation.at);
  a.approvals[0].workflow.steps[0].approver = '项目一改变';
  assert.equal(b.approvals[0].workflow.steps[0].approver, '上级');
});

test('多项目尾差按 0.1 人天分配，零人天项目不分额度，各项目足额且总额守恒', () => {
  for (let count = 2; count <= 10; count++) {
    for (let assetUnits = 0; assetUnits <= count; assetUnits++) {
      const { record, creation } = fixture();
      record.items = Array.from({ length: count + 1 }, (_, index) => ({ id: `i${index}`, serviceName: '同一服务', method: '远程' }));
      const effort = record.operations.assessment.effort;
      effort.lines = record.items.map((item, index) => ({ itemId: item.id, serviceName: item.serviceName, estimatedDays: index < count ? 0.1 : 0, billableDays: index < count ? 0.1 : 0, priceCoefficient: 1 }));
      effort.days = effort.estimatedDays = count / 10;
      const plan = record.operations.assessment.plans[0];
      plan.effort = effort.days;
      plan.requirements = [{ method: '远程', days: effort.days }];
      plan.allocations = assetUnits ? [{ assetId: 'a', name: '远程人天', method: '远程', days: assetUnits / 10 }] : [];
      plan.entitlementAllocations = [];
      const approval = record.operations.assessment.approvals.at(-1);
      approval.days = (count - assetUnits) / 10;
      approval.gaps = [{ method: '远程', days: approval.days }];
      creation.projects = record.items.map(item => ({ id: item.id, workOrders: [{ sourceItemId: item.id }] }));
      const snapshots = [...projectRequestSnapshots(record, creation).values()];
      assert.equal(sumDays(snapshots.flatMap(s => s.basis.allocations.map(a => a.days))), assetUnits / 10);
      assert.equal(sumDays(snapshots.flatMap(s => s.approvals.map(a => a.days))), approval.days);
      for (const snapshot of snapshots) assert.equal(sumDays([...snapshot.basis.allocations, ...snapshot.approvals].map(a => a.days)), snapshot.effort.days);
      assert.equal(snapshots.at(-1).approvals.length, 0);
    }
  }
});

test('缺失核定明细、不一致的特批或超额资产阻止拆分，不静默重复或丢失额度', () => {
  for (const change of [
    r => { delete r.operations.assessment.effort.lines; },
    r => { r.operations.assessment.effort.lines.pop(); },
    r => { r.operations.assessment.approvals.at(-1).days = 5; },
    r => { r.operations.assessment.plans[0].allocations[0].days = 4; },
  ]) {
    const { record, creation } = fixture(); change(record);
    assert.throws(() => projectRequestSnapshots(record, creation), /拆分/);
  }
});

test('无拆分保留旧记录原值，未通过或已释放的依据不形成有效特批额度', () => {
  const { record, creation } = fixture();
  creation.projects = [{ id: 'only', workOrders: record.items.map(item => ({ sourceItemId: item.id })) }];
  delete record.operations.assessment.effort.lines;
  const snapshot = projectRequestSnapshots(record, creation).get('only');
  assert.deepEqual(snapshot.basis, record.operations.assessment.plans[0]);
  assert.equal(snapshot.approvals[0].days, 4);
  record.operations.assessment.approvals.at(-1).state = '已拒绝';
  assert.equal(projectRequestSnapshots(record, creation).get('only').approvals.length, 0);
  record.operations.assessment.plans[0].releasedAt = creation.at;
  assert.equal(projectRequestSnapshots(record, creation).get('only').basis, undefined);
});

test('手填额度逐笔保留，拆分项目按分类需求分配且超额审批不阻塞转换', () => {
  const { record, creation } = fixture();
  const original = record.operations.assessment.approvals.at(-1);
  record.operations.assessment.approvals = [
    { ...original, id: 'manual1', manualAmount: true, days: 0.1, gaps: [{ method: '远程', days: 0.1 }] },
    { ...original, id: 'manual2', manualAmount: true, days: 2.9, gaps: [{ method: '远程', days: 2.9 }] },
    { ...original, id: 'manual3', manualAmount: true, days: 2, gaps: [{ method: '现场', days: 2 }] },
  ];
  const snapshots = [...projectRequestSnapshots(record, creation).values()];
  assert.equal(sumDays(snapshots.flatMap(snapshot => snapshot.approvals.map(a => a.days))), 4);
  assert.ok(snapshots.some(snapshot => snapshot.approvals.some(a => a.id === 'manual1')));
  assert.ok(snapshots.some(snapshot => snapshot.approvals.some(a => a.id === 'manual2' && a.sourceDays === 2.9)));
  const single = { ...creation, projects: [{ ...creation.projects[0], workOrders: creation.projects.flatMap(project => project.workOrders) }] };
  const snapshot = [...projectRequestSnapshots(record, single).values()][0];
  assert.deepEqual(snapshot.approvals.map(a => a.days), [0.1, 2.9, 2]);
});
