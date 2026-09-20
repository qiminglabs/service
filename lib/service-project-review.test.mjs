import { returnProjectReview, submitProjectReview } from './service-work-orders.ts';
import { canSubmitProjectReview } from './service-project-work-order-policy.ts';
import { projectForActor, editServiceProject } from './service-projects.ts';
import { applyProjectOperation, canRecordProjectWorklog, canConfirmProjectWorklog } from './service-project-operations.ts';
import { projectFieldReadonly } from './service-project-readonly.ts';
import { canExecuteWorkOrders } from './service-work-orders.ts';
import { projectCustomerConfirmationStale } from './service-project-review.ts';
import { projectApprovalRulesId } from './approval-scope.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { applyProjectReview, calculateProjectReviewEffort, projectReviewCovered, projectReviewStale, projectAssetAvailable, updateProjectReviewReservations, projectReviewCoverage, projectReviewProjection, projectBaselineLine, currentProjectReviewApproval } from './service-project-review.ts';
import { saveProjectReview } from './service-project-review-store.ts';
import { saveLocal, updateLocalReference } from './service-requests.ts';
import { assetAvailable } from './request-assessment.ts';
import { entitlementAvailable } from './request-entitlement-reservations.ts';
import { localInternalUsers, fixedIdentityRoles } from './internal-users.ts';
import { customerServiceProject } from './customer-service-projects.ts';
import { projectAssetBasisRows, projectAssetBasisTotals } from './service-project-basis-rows.ts';
import { approvalRulesId } from './approval-rules.ts';
const actor = id => ({ id, name: localInternalUsers.find(u => u.id === id).name, role: fixedIdentityRoles[id] });
const pm = actor('USR-003'), sales = actor('USR-001'), admin = actor('USR-006'), engineer = actor('USR-004');
const customer = { id: 'contact', name: '客户甲', role: '客户' };
function fixture() {
  const orders = ['远程', '现场'].map((method, i) => ({ id: `wo${i}`, status: '已完成', steps: [], item: { id: `item${i}`, serviceId: `s${i}`, serviceName: `服务${i}`, method, businessObjectIds: [], description: '', values: {}, config: { fields: [], materials: [] } }, catalogSnapshot: { id: `s${i}`, name: `服务${i}`, priceUnit: '人天', priceCoefficient: i === 0 ? 2 : 1 } }));
  const p = { id: 'p1', name: '测试项目', status: '待复核', revision: 1, customerId: 'c1', createdSite: '内部系统', createdById: sales.id, items: structuredClone(orders.map(o => o.item)), workOrders: orders, collaborators: { internal: [{ ...pm, assignmentRoles: ['项目经理'] }, sales, engineer], customer: [customer], partner: [] }, operations: { meetings: [], activities: [], worklogs: [{ id: 'log0', workOrderId: 'wo0', hours: 8, confirmedAt: '2026-09-18', confirmedById: pm.id }, { id: 'log1', workOrderId: 'wo1', hours: 4, confirmedAt: '2026-09-18', confirmedById: pm.id }] } };
  const ctx = { services: [], assets: ['远程', '现场'].map((method, i) => ({ id: `a${i}`, name: `${method}人天`, customerId: 'c1', status: '启用', balanceDays: 10 })), businessObjects: [], requests: [], users: structuredClone(localInternalUsers), customers: [{ id: 'c1', status: '启用', ownerUserId: sales.id }], contacts: [{ ...customer, customerId: 'c1', status: '启用' }], rules: { version: 1, rules: [], defaultUserId: admin.id }, conversions: { inspection: { days: .3, version: 1 }, upgrade: { days: .3, version: 1 } } };
  return { p, ctx };
}
const effort = (p, ctx, items = calculateProjectReviewEffort(p, ctx)) => applyProjectReview(p, { type: 'effort', items: items.map(({ itemId, billableDays }) => ({ itemId, finalBillableDays: billableDays })), note: '复核记录' }, pm, ctx);
const basis = (p, ctx, allocations = [{ assetId: 'a0', days: 2 }, { assetId: 'a1', days: .5 }]) => applyProjectReview(p, { type: 'basis', allocations }, sales, ctx);
const confirm = (p, ctx) => applyProjectReview(p, { type: 'confirm', note: '请确认服务完成及资产消耗' }, sales, ctx);
const decide = (p, ctx, accepted = true, reason = '') => applyProjectReview(p, { type: 'customer-decision', confirmationId: p.review.confirmations.at(-1).id, accepted, reason }, customer, ctx);

test('客户确认通过后锁定工时、项目名称与核定，保留确认内容并自动完成项目', () => {
  const { p, ctx } = fixture();
  p.expectedServiceDate = '2026-09-18'; p.note = '';
  p.operations.worklogs.forEach(log => { log.userId = engineer.id; });
  const pending = confirm(basis(effort(p, ctx), ctx), ctx);
  assert.equal(canRecordProjectWorklog(pending, engineer), false);
  const next = decide(pending, ctx), snapshot = structuredClone(next);
  assert.equal(canRecordProjectWorklog(next, engineer), false);
  assert.equal(canConfirmProjectWorklog(next, pm), false);
  assert.equal(projectFieldReadonly(next, 'name'), true);
  const log = { workOrderId: 'wo0', date: '2026-09-19', startTime: '10:00', endTime: '11:00', category: '实施', description: '补录' };
  for (const action of [
    { ...log, type: 'worklog-add' }, { ...log, type: 'worklog-edit', id: 'log0' },
    { type: 'worklog-void', id: 'log0', reason: '更正' }, { type: 'worklog-confirm', ids: ['log0'] },
  ]) assert.throws(() => applyProjectOperation(next, action, action.type === 'worklog-confirm' ? pm : engineer), /工时已锁定/);
  assert.throws(() => editServiceProject(next, { ...next, name: '另一个名称' }, pm, ctx.customers), /已结束的项目不可编辑/);
  for (const type of ['effort', 'basis', 'gap-submit', 'gap-decide', 'confirm'])
    assert.throws(() => applyProjectReview(next, { type }, pm, ctx), /当前项目阶段/);
  assert.equal(canExecuteWorkOrders(next, engineer), false);
  assert.deepEqual(next, snapshot);
  assert.equal(projectCustomerConfirmationStale(next), false);
  assert.equal(next.status, '已完成');
  assert.ok(next.review.settlement);
  assert.throws(() => editServiceProject(next, { ...next, note: '内部备注' }, pm, ctx.customers), /已结束/);
});

test('伙伴投影保留确认锁定标记，不暴露内部复核且不能改名', () => {
  const { p, ctx } = fixture(); p.expectedServiceDate = '2026-09-18'; p.note = '';
  const partner = { id: 'partner', name: '伙伴工程师', role: '合作伙伴服务工程师' };
  p.collaborators.partner = [partner];
  const confirmed = decide(confirm(basis(effort(p, ctx), ctx), ctx), ctx);
  const view = projectForActor(confirmed, partner);
  assert.equal(view.review, undefined);
  assert.equal(view.customerConfirmationLocked, true);
  assert.equal(projectFieldReadonly(view, 'name'), true);
  assert.equal(canRecordProjectWorklog(view, partner), false);
  assert.throws(() => editServiceProject(confirmed, { ...confirmed, name: '新名称' }, partner, ctx.customers), /已结束的项目不可编辑/);
  assert.equal(projectFieldReadonly(projectForActor(p, partner), 'name'), false);
});

test('客户拒绝不触发确认锁定，仍可调整后重新确认', () => {
  const { p, ctx } = fixture();
  const rejected = decide(confirm(basis(effort(p, ctx), ctx), ctx), ctx, false, '需要调整');
  assert.equal(canRecordProjectWorklog(rejected, engineer), true);
  assert.equal(projectFieldReadonly(rejected, 'name'), false);
  assert.equal(confirm(effort(rejected, ctx), ctx).status, '待确认');
});

test('保存事务拦截已确认项目的工时和名称修改，旧页面也不能覆盖', async t => {
  const { saveProjectOperation, updateStoredServiceProject } = await import('./service-project-store.ts');
  const { p, ctx } = fixture(); p.expectedServiceDate = '2026-09-18'; p.note = '';
  const pending = confirm(basis(effort(p, ctx), ctx), ctx), confirmed = decide(pending, ctx);
  const stores = storesFor(confirmed, ctx); storage(t, stores);
  const before = structuredClone(stores);
  const action = { type: 'worklog-add', workOrderId: 'wo0', date: '2026-09-19', startTime: '10:00', endTime: '11:00', category: '实施', description: '补录' };
  await assert.rejects(saveProjectOperation(p.id, confirmed.revision, action, engineer), /工时已锁定/);
  await assert.rejects(saveProjectOperation(p.id, pending.revision, action, engineer), /已被更新/);
  await assert.rejects(updateStoredServiceProject(p.id, confirmed.revision, { ...confirmed, name: '改名' }, pm), /已结束的项目不可编辑/);
  assert.deepEqual(stores, before);
});

test('服务依据按资产聚合，同一资产覆盖多个工单只显示一次', () => {
  const { p, ctx } = fixture();
  p.workOrders[1].item.method = '远程'; p.items[1].method = '远程';
  withSource(p, ctx, 1);
  let next = effort(p, ctx);
  next = basis(next, ctx, [{ assetId: 'a0', days: 2.5 }]);
  const before = structuredClone(next), rows = projectAssetBasisRows(next, ctx);
  assert.deepEqual(next, before);
  assert.equal(rows.filter(row => row.id === 'asset:a0').length, 1);
  assert.deepEqual(rows.map(row => [row.id, row.held, row.usage, row.remaining]), [['asset:a0', 2.5, 2.5, 0], ['asset:a1', .5, 0, .5]]);
  assert.equal(rows[0].source, '客户资产');
  assert.deepEqual(rows.map(row => row.method), ['远程', '现场']);
  assert.deepEqual(projectAssetBasisTotals(rows), [{ unit: '人天', held: 3, usage: 2.5, remaining: .5 }]);
});

test('待审批不进入服务依据，通过后按申请额度新增条目', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 1);
  let next = effort(p, ctx);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 1, reason: '补充额度' }, sales, ctx);
  const id = currentProjectReviewApproval(next).id;
  let rows = projectAssetBasisRows(next, ctx);
  assert.ok(!rows.some(row => row.approvalId === id));
  assert.deepEqual(projectAssetBasisTotals(rows), [{ unit: '人天', held: 1.5, usage: 1.5, remaining: 0 }]);
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, admin, ctx);
  rows = projectAssetBasisRows(next, ctx);
  assert.equal(rows.at(-1).category, '已通过');
  assert.equal(rows.at(-1).source, '服务项目审批');
  assert.equal(rows.at(-1).held, 1);
  assert.equal(rows.at(-1).usage, 1);
  assert.deepEqual(projectAssetBasisTotals(rows), [{ unit: '人天', held: 2.5, usage: 2.5, remaining: 0 }]);
});

test('拒绝审批不进入资产列表，已批准来源额度正常展示', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 1);
  p.requestConversion.assessmentSnapshot.approvals = [{ id: 'source-approval', state: '已通过', days: .5, gaps: [{ method: '远程', days: .5 }] }];
  let next = effort(p, ctx);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 0.5, reason: '补充剩余额度' }, sales, ctx);
  const id = currentProjectReviewApproval(next).id;
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: false, note: '不同意' }, admin, ctx);
  const rows = projectAssetBasisRows(next, ctx);
  assert.equal(rows.at(-1).source, '服务请求审批');
  assert.equal(rows.at(-1).held, .5);
  assert.ok(!rows.some(row => row.approvalId === id));
});

test('服务请求审批与服务项目审批分行显示，按方式分配且额度不重复', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 1);
  p.requestConversion.assessmentSnapshot.approvals = [{ id: 'source-approval', state: '已通过', days: .5, gaps: [{ method: '远程', days: .5 }] }];
  let next = effort(p, ctx);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 0.5, reason: '补充剩余额度' }, sales, ctx);
  const id = currentProjectReviewApproval(next).id;
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, admin, ctx);
  const rows = projectAssetBasisRows(next, ctx);
  assert.deepEqual(rows.filter(row => row.source.endsWith('审批')).map(row => [row.source, row.method, row.held, row.usage]), [
    ['服务请求审批', '远程', .5, .5], ['服务项目审批', '远程', .5, .5],
  ]);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.deepEqual(projectAssetBasisTotals(rows), [{ unit: '人天', held: 2.5, usage: 2.5, remaining: 0 }]);
});

test('共享业务对象权益按资产合并，并与人天、其他权益分开汇总', () => {
  const { p, ctx } = fixture();
  for (const order of p.workOrders) { order.catalogSnapshot.priceUnit = '升级权益'; order.item.businessObjectIds = ['o1']; }
  ctx.businessObjects = [{ id: 'o1', name: '集群', customerId: 'c1', product: 'SMTX OS 系统', status: '启用', nodeCount: 4, upgradeEntitlement: 6 }];
  const next = effort(p, ctx), rows = projectAssetBasisRows(next, ctx);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, '服务权益');
  assert.equal(rows[0].method, '—');
  assert.equal(rows[0].category, '');
  assert.deepEqual([rows[0].name, rows[0].held, rows[0].usage, rows[0].remaining], ['升级权益', 6, 6, 0]);
  assert.deepEqual(projectAssetBasisTotals([...rows, { unit: '人天', held: 2, usage: 1.5, remaining: .5 }, { unit: '巡检权益', held: 3, usage: 2, remaining: 1 }]), [
    { unit: '人天', held: 2, usage: 1.5, remaining: .5 }, { unit: '巡检权益', held: 3, usage: 2, remaining: 1 }, { unit: '升级权益', held: 6, usage: 6, remaining: 0 },
  ]);
});

test('额度审批无需工单、已确认工时、人天核定或服务依据，按手填数量创建独立授权', () => {
  const { p, ctx } = fixture();
  p.status = '待启动'; p.workOrders = []; p.items = []; p.operations.worklogs = [];
  const action = { type: 'gap-submit', method: '现场', days: 1.3, reason: '计划现场服务' };
  let next = applyProjectReview(p, action, sales, ctx);
  assert.equal(next.review.effort, undefined);
  assert.equal(next.review.basis, undefined);
  assert.equal(currentProjectReviewApproval(next).days, 1.3);
  assert.deepEqual(currentProjectReviewApproval(next).gaps, [{ method: '现场', days: 1.3 }]);
  assert.equal(projectAssetBasisRows(next, ctx).length, 0);
  const id = currentProjectReviewApproval(next).id;
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, admin, ctx);
  assert.deepEqual(projectAssetBasisRows(next, ctx).map(row => [row.source, row.method, row.held]), [['服务项目审批', '现场', 1.3]]);
  next = applyProjectReview(next, { ...action, days: .2, reason: '追加额度' }, sales, ctx);
  next = applyProjectReview(next, { type: 'gap-decide', id: currentProjectReviewApproval(next).id, approve: true, note: '同意追加' }, admin, ctx);
  assert.equal(projectAssetBasisRows(next, ctx).length, 2);
  assert.equal(projectAssetBasisTotals(projectAssetBasisRows(next, ctx))[0].held, 1.5);
});

test('额度申请校验正数、0.1粒度、服务方式、理由、权限及重复提交', () => {
  const { p, ctx } = fixture();
  const valid = { type: 'gap-submit', method: '远程', days: .1, reason: '追加额度' };
  for (const days of [undefined, 0, -.1, .01, .11, NaN, Infinity, 100000.1]) {
    assert.throws(() => applyProjectReview(p, { ...valid, days }, sales, ctx), /申请人天/);
  }
  assert.throws(() => applyProjectReview(p, { ...valid, method: '其他' }, sales, ctx), /服务方式/);
  assert.throws(() => applyProjectReview(p, { ...valid, reason: ' ' }, sales, ctx), /申请理由/);
  assert.throws(() => applyProjectReview(p, valid, engineer, ctx), /内部申请人或当前客户所有人/);
  const next = applyProjectReview(p, valid, sales, ctx);
  assert.throws(() => applyProjectReview(next, valid, sales, ctx), /审批处理中/);
  for (const status of ['已完成', '已取消']) assert.throws(() => applyProjectReview({ ...p, status }, valid, sales, ctx), /当前项目阶段/);
});

test('未确认工时不影响额度申请，核定变化不修改已申请金额', () => {
  const { p, ctx } = fixture();
  p.operations.worklogs[0].confirmedAt = undefined;
  let next = applyProjectReview(p, { type: 'gap-submit', method: '远程', days: 9.9, reason: '提前申请服务额度' }, sales, ctx);
  const id = currentProjectReviewApproval(next).id;
  next.operations.worklogs[0].confirmedAt = '2026-09-18';
  next = effort(next, ctx);
  assert.equal(currentProjectReviewApproval(next).days, 9.9);
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, admin, ctx);
  assert.equal(projectReviewCoverage(next, ctx)[0].projectApproval, 9.9);
  next = effort(next, ctx);
  assert.equal(projectAssetBasisRows(next, ctx).find(row => row.approvalId === id).held, 9.9);
});

test('实际工时按八小时折算、按目录计价，允许经理调整并校验输入和身份', () => {
  const { p, ctx } = fixture();
  const lines = calculateProjectReviewEffort(p, ctx);
  assert.deepEqual(lines.map(l => [l.actualHours, l.estimatedDays, l.billableDays]), [[8, 1, 2], [4, .5, .5]]);
  assert.equal(effort(p, ctx, lines.map(l => ({ ...l, billableDays: 3 }))).review.effort.lines[0].billableDays, 3);
  for (const value of [-1, .123, NaN, Infinity]) assert.throws(() => effort(p, ctx, lines.map(l => ({ ...l, billableDays: value }))), /最终计价人天/);
  assert.throws(() => effort(p, ctx, []), /完整核定/);
  assert.throws(() => applyProjectReview(p, { type: 'effort', items: lines, note: '' }, engineer, ctx), /项目经理/);
  assert.throws(() => applyProjectReview(p, { type: 'effort', items: lines, note: '' }, { ...engineer, role: pm.role }, ctx), /有效内部/);
  p.operations.worklogs[0].workOrderId = 'foreign';
  assert.throws(() => calculateProjectReviewEffort(p, ctx), /关联到本项目/);
});

test('服务依据按远程、现场独立匹配，项目占用计入请求可用额度且排除自身', () => {
  const { p, ctx } = fixture();
  const assessed = effort(p, ctx);
  assert.throws(() => basis(assessed, ctx, [{ assetId: 'a1', days: 2.5 }]), /该类计价/);
  assert.throws(() => basis(assessed, ctx, [{ assetId: 'a0', days: 1 }, { assetId: 'a0', days: 1 }]), /重复/);
  const linked = basis(assessed, ctx);
  Object.assign(ctx, updateProjectReviewReservations(linked, ctx));
  assert.equal(assetAvailable(ctx.assets[0], [], ''), 8);
  assert.equal(projectAssetAvailable(linked, ctx.assets[0], ctx), 10);
  assert.equal(projectReviewCovered(linked, ctx), true);
  const competing = { ...assessed, id: 'p2' };
  ctx.assets[0].balanceDays = 2;
  assert.throws(() => basis(competing, ctx), /可用人天不足/);
});

test('来源请求额度复用，不重复占用；仅新增差额进入项目占用', () => {
  const { p, ctx } = fixture();
  const plan = { id: 'source-plan', allocations: [{ assetId: 'a0', name: '远程人天', days: 1.5, method: '远程' }], entitlementAllocations: [] };
  ctx.requests = [{ id: 'r1', customerId: 'c1', status: '已完成', createdById: sales.id, operations: { assessment: { plans: [plan] } } }];
  p.sourceServiceRequestId = 'r1';
  p.requestConversion = { assessmentSnapshot: { basis: plan, approvals: [] } };
  const linked = basis(effort(p, ctx), ctx);
  assert.equal(projectAssetAvailable(linked, ctx.assets[0], ctx), 10);
  Object.assign(ctx, updateProjectReviewReservations(linked, ctx));
  assert.equal(ctx.assets[0].projectReservations[0].days, .5);
  assert.equal(assetAvailable(ctx.assets[0], ctx.requests, ''), 8);
});

test('权益按业务对象节点分配，存在缺额时最终计价人天仍为零', () => {
  const { p, ctx } = fixture();
  for (const order of p.workOrders) { order.catalogSnapshot.priceUnit = '升级权益'; order.item.businessObjectIds = ['o1']; }
  ctx.businessObjects = [{ id: 'o1', name: '集群', customerId: 'c1', product: 'SMTX OS 系统', status: '启用', nodeCount: 4, upgradeEntitlement: 6 }];
  const assessed = effort(p, ctx);
  assert.deepEqual(assessed.review.effort.lines.map(l => [l.deficitEntitlements, l.billableDays]), [[0, 0], [2, 0]]);
  assert.throws(() => basis(assessed, ctx, [{ assetId: 'a1', days: .6 }]), /不能超过/);
  const linked = basis(assessed, ctx, []);
  Object.assign(ctx, updateProjectReviewReservations(linked, ctx));
  assert.equal(entitlementAvailable(ctx.businessObjects[0], 'upgrade'), 0);
  assert.equal(calculateProjectReviewEffort(linked, ctx)[1].deficitEntitlements, 2);
  ctx.businessObjects[0].nodeCount = 5;
  assert.throws(() => confirm(linked, ctx), /节点数量已变更/);
});

test('巡检与升级权益核定固定为零，拒绝非零输入且不依赖人天换算配置', () => {
  for (const [unit, kind, balance] of [['巡检权益', 'inspection', 'inspectionEntitlement'], ['升级权益', 'upgrade', 'upgradeEntitlement']]) {
    const { p, ctx } = fixture();
    p.workOrders[0].catalogSnapshot.priceUnit = unit;
    p.workOrders[0].item.businessObjectIds = ['o1'];
    ctx.businessObjects = [{ id: 'o1', name: '集群', customerId: 'c1', product: 'SMTX OS 系统', status: '启用', nodeCount: 4, [balance]: 2 }];
    ctx.conversions = {};
    const lines = calculateProjectReviewEffort(p, ctx);
    assert.deepEqual(lines.map(l => [l.actualHours, l.estimatedDays, l.billableDays]), [[8, 1, 0], [4, .5, .5]]);
    assert.equal(lines[0].entitlementKind, kind);
    const before = structuredClone(p);
    assert.throws(() => effort(p, ctx, lines.map((l, i) => i === 0 ? { ...l, billableDays: 1 } : l)), /权益类工单.*固定为 0/);
    assert.deepEqual(p, before);
    const assessed = effort(p, ctx, lines.map((l, i) => i === 1 ? { ...l, billableDays: 3 } : l));
    assert.deepEqual(assessed.review.effort.lines.map(l => l.billableDays), [0, 3]);
    assert.equal(assessed.review.basis.entitlementAllocations[0].quantity, 2);
    assert.equal(projectReviewStale(assessed), false);
    assessed.review.effort.lines[0].billableDays = .6;
    assert.equal(projectReviewStale(assessed), true);
    assert.equal(projectReviewProjection(assessed, ctx).review.effort.lines[0].billableDays, 0);
    assert.throws(() => confirm(assessed, ctx), /重新核定/);
    const corrected = effort(assessed, ctx);
    assert.equal(corrected.review.effort.lines[0].billableDays, 0);
    assert.equal(corrected.review.history.at(-1).effort.lines[0].billableDays, .6);
    assert.equal(projectReviewStale({ ...assessed, status: '已完成' }), false);
  }
});

test('完成流程必须客户确认，拒绝后可重新发起且保留记录，客户仅收到公开信息', () => {
  const { p, ctx } = fixture();
  let next = confirm(basis(effort(p, ctx), ctx), ctx);
  assert.equal(next.status, '待确认');
  assert.throws(() => applyProjectReview(next, { type: 'complete' }, pm, ctx), /不支持/);
  assert.throws(() => decide(next, ctx, false), /拒绝原因/);
  assert.throws(() => applyProjectReview(next, { type: 'customer-decision', confirmationId: next.review.confirmations[0].id, accepted: true, reason: '' }, { ...customer, id: 'outsider' }, ctx), /有效客户协作人/);
  next = decide(next, ctx, false, '补充交付记录');
  assert.equal(next.status, '待复核');
  next = decide(confirm(next, ctx), ctx);
  const publicView = customerServiceProject(next, { ...ctx, partners: [], partnerUsers: [] });
  assert.equal(publicView.confirmation.state, '已确认');
  assert.equal(publicView.review, undefined);
  assert.equal(JSON.stringify(publicView).includes('复核记录'), false);
  assert.equal(JSON.stringify(publicView).includes('worklogs'), false);
  assert.equal(next.status, '已完成');
  assert.equal(next.review.confirmations.length, 2);
  assert.throws(() => effort(next, ctx), /当前项目阶段/);
});

test('确认期间工时变化不能隐式重核定，客户拒绝后可重核定并补充依据', () => {
  const { p, ctx } = fixture();
  let next = confirm(basis(effort(p, ctx), ctx), ctx);
  next.operations.worklogs[0].hours = 16;
  assert.equal(projectReviewStale(next), true);
  assert.throws(() => decide(next, ctx), /重新核定/);
  assert.throws(() => effort(next, ctx), /已锁定/);
  next = decide(next, ctx, false, '需要调整核定内容');
  next = effort(next, ctx);
  assert.equal(next.status, '待复核');
  assert.equal(next.review.effort.lines[0].estimatedDays, 2);
  assert.equal(next.review.basis.allocations[0].days, 2);
  assert.equal(next.review.confirmations[0].invalidatedAt, undefined);
  next = basis(next, ctx, [{ assetId: 'a0', days: 4 }]);
  assert.ok(next.review.confirmations[0].invalidatedAt);
});

test('项目进行中可发起额度特批，通过后才能提交客户确认，禁止自审', () => {
  const { p, ctx } = fixture();
  p.status = '进行中';
  let next = basis(effort(p, ctx), ctx, [{ assetId: 'a1', days: .5 }]);
  assert.equal(projectReviewCovered(next, ctx), false);
  ctx.rules.defaultUserId = sales.id;
  assert.throws(() => applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 2, reason: '超额投入' }, sales, ctx), /本人/);
  ctx.rules.defaultUserId = admin.id;
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 2, reason: '超额投入' }, sales, ctx);
  assert.equal(effort(next, ctx).review.approvals.at(-1).state, '待审批');
  const id = next.review.approvals.at(-1).id;
  assert.throws(() => applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, pm, ctx), /审批/);
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, admin, ctx);
  assert.equal(projectReviewCovered(next, ctx), true);
  next.status = '待复核';
  assert.throws(() => confirm(next, ctx), /最终人天核定/);
  assert.equal(confirm(effort(next, ctx), ctx).status, '待确认');
});

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

function storesFor(p, ctx) { return { requests: ctx.requests, configs: [], references: [{ id: 'workspace', payload: { ...ctx, partners: [], partnerUsers: [] } }, { id: `service-project:${p.id}`, payload: p }] }; }
test('独立额度申请保存和审批无需核定记录，版本校验与客户资产保持完整', async t => {
  const { p, ctx } = fixture(); p.status = '待启动'; p.workOrders = []; p.items = []; p.operations.worklogs = [];
  const stores = storesFor(p, ctx);
  stores.references.push({ id: approvalRulesId, payload: ctx.rules });
  storage(t, stores);
  const workspace = structuredClone(stores.references[0].payload);
  const action = { type: 'gap-submit', method: '现场', days: .7, reason: '客户现场支持' };
  let next = await saveProjectReview(p.id, p.revision, action, sales);
  assert.equal(next.review.effort, undefined);
  assert.equal(next.review.basis, undefined);
  assert.deepEqual(stores.references[0].payload, workspace);
  await assert.rejects(saveProjectReview(p.id, p.revision, action, sales), /项目已被更新/);
  next = await saveProjectReview(p.id, next.revision, { type: 'gap-decide', id: currentProjectReviewApproval(next).id, approve: true, note: '同意' }, admin);
  const stored = stores.references.find(row => row.id === `service-project:${p.id}`).payload;
  assert.equal(stored.review.approvals[0].independent, true);
  assert.equal(projectAssetBasisRows(stored, ctx)[0].held, .7);
  assert.deepEqual(stores.references[0].payload, workspace);
});

test('保存同时写入项目与额度，版本冲突和写入失败保持原数据', async t => {
  const { p, ctx } = fixture();
  const assessed = effort(p, ctx), stores = storesFor(assessed, ctx);
  storage(t, stores);
  const next = await saveProjectReview(p.id, assessed.revision, { type: 'basis', allocations: [{ assetId: 'a0', days: 2 }, { assetId: 'a1', days: .5 }] }, sales);
  assert.equal(next.revision, assessed.revision + 1);
  assert.equal(stores.references[0].payload.assets[0].projectReservations[0].days, 2);
  const saved = structuredClone(stores);
  await assert.rejects(saveProjectReview(p.id, assessed.revision, { type: 'basis', allocations: [] }, sales), /已被更新/);
  assert.deepEqual(stores, saved);
  storage(t, stores, record => record.id === `service-project:${p.id}`);
  await assert.rejects(saveProjectReview(p.id, next.revision, { type: 'effort', items: [{ itemId: 'wo0', finalBillableDays: 2 }, { itemId: 'wo1', finalBillableDays: .5 }], note: '' }, pm), /模拟存储失败/);
  assert.deepEqual(stores, saved);
});

test('旧页面自动保存及引用更新不能覆盖项目冻结额度', async t => {
  const { p, ctx } = fixture();
  const stores = storesFor(p, ctx), stale = structuredClone(stores.references[0]);
  stores.references[0].payload.assets[0].projectReservations = [{ projectId: p.id, days: 2 }];
  storage(t, stores);
  await saveLocal('references', stale);
  assert.equal(stores.references[0].payload.assets[0].projectReservations[0].days, 2);
  await updateLocalReference('workspace', () => structuredClone(stale.payload));
  assert.equal(stores.references[0].payload.assets[0].projectReservations[0].days, 2);
  const deleted = structuredClone(stale);
  deleted.payload.assets = [];
  await assert.rejects(saveLocal('references', deleted), /不能删除/);
});

test('取消项目原子释放项目新增人天与权益占用，保留其他项目额度', async t => {
  const { cancelStoredServiceProject } = await import('./service-project-store.ts');
  const { p, ctx } = fixture();
  const linked = basis(effort(p, ctx), ctx);
  Object.assign(ctx, updateProjectReviewReservations(linked, ctx));
  ctx.assets[0].projectReservations.push({ projectId: 'other', days: 1 });
  ctx.businessObjects = [{ id: 'o1', projectReservations: [{ projectId: p.id, kind: 'upgrade', quantity: 2 }, { projectId: 'other', kind: 'upgrade', quantity: 1 }] }];
  const stores = storesFor(linked, ctx);
  storage(t, stores);
  const result = await cancelStoredServiceProject(p.id, linked.revision, '客户终止服务', pm);
  assert.equal(result.status, '已取消');
  assert.deepEqual(stores.references[0].payload.assets[0].projectReservations, [{ projectId: 'other', days: 1 }]);
  assert.deepEqual(stores.references[0].payload.businessObjects[0].projectReservations, [{ projectId: 'other', kind: 'upgrade', quantity: 1 }]);
});

function withSource(p, ctx, days = 3) {
  const plan = { id: 'source-plan', allocations: [{ assetId: 'a0', name: '远程人天', days, method: '远程' }, { assetId: 'a1', name: '现场人天', days: .5, method: '现场' }], entitlementAllocations: [], requirements: [{ method: '远程', days }, { method: '现场', days: .5 }] };
  ctx.requests = [{ id: 'r1', customerId: 'c1', status: '已转服务项目', createdById: sales.id, operations: { assessment: { plans: [structuredClone(plan)] } } }];
  p.sourceServiceRequestId = 'r1';
  p.requestConversion = { workOrders: [], assessmentSnapshot: { requestId: 'r1', requestTitle: '原申请', capturedAt: '2026-09-18', items: p.items.map(i => ({ id: i.id, name: i.serviceName, method: i.method })), effort: { days: days + .5, lines: [{ itemId: 'item0', billableDays: days }, { itemId: 'item1', billableDays: .5 }] }, basis: plan, approvals: [] } };
  return p;
}

test('来源基准在首次核定前即可展示，核定后自动沿用并只分配实际所需额度', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  const before = structuredClone(p), preview = projectReviewProjection(p, ctx);
  assert.deepEqual(p, before);
  assert.equal(projectBaselineLine(p, 'wo0').billableDays, 3);
  assert.equal(preview.review.basis.allocations[0].days, 2);
  const next = effort(p, ctx);
  assert.equal(next.review.basis.capacities[0].days, 3);
  assert.equal(next.review.basis.allocations[0].days, 2);
  assert.equal(projectReviewCovered(next, ctx), true);
  assert.equal(confirm(next, ctx).status, '待确认');
  const held = updateProjectReviewReservations(next, ctx);
  assert.deepEqual(held.assets[0].projectReservations, []);
});

test('来源已失效时保留历史并阻止客户确认，不静默沿用无效额度', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  const next = effort(p, ctx);
  ctx.requests[0].operations.assessment.plans[0].releasedAt = 'now';
  assert.equal(projectReviewCovered(next, ctx), false);
  assert.throws(() => confirm(next, ctx), /来源申请依据已失效/);
  assert.equal(next.requestConversion.assessmentSnapshot.basis.allocations[0].days, 3);
});

test('新增工单不能按同名目录错误继承原工单人天基准', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  p.workOrders.push({ ...structuredClone(p.workOrders[0]), id: 'manual', item: { ...structuredClone(p.items[0]), id: 'manual-item' } });
  assert.equal(projectBaselineLine(p, 'manual'), undefined);
  const next = effort(p, ctx);
  assert.equal(projectReviewCovered(next, ctx), true);
});

test('同范围增量审批累积授权，录入新工时不扩大待审批快照', () => {
  const { p, ctx } = fixture(); p.status = '进行中'; withSource(p, ctx, 1);
  let next = effort(p, ctx);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 1, reason: '新增工作量' }, sales, ctx);
  const id = next.review.approvals[0].id;
  assert.deepEqual(next.review.approvals[0].gaps, [{ method: '远程', days: 1 }]);
  next.operations.worklogs[0].hours = 16;
  next = effort(next, ctx);
  assert.equal(next.review.approvals[0].days, 1);
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意原申请增量' }, admin, ctx);
  assert.equal(projectReviewCoverage(next, ctx)[0].gap, 2);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 2, reason: '第二次新增工作量' }, sales, ctx);
  assert.equal(next.review.approvals[1].days, 2);
  next = applyProjectReview(next, { type: 'gap-decide', id: next.review.approvals[1].id, approve: true, note: '同意新增两天' }, admin, ctx);
  assert.equal(projectReviewCoverage(next, ctx)[0].projectApproval, 3);
  assert.equal(projectReviewCovered(next, ctx), true);
});

test('工单内容变更只需重新核定，无人天缺口时不触发审批或强制备注', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 3);
  let next = effort(p, ctx);
  next.workOrders[0].item.description = '新增迁移范围';
  assert.equal(projectReviewStale(next), true);
  next = effort(next, ctx);
  assert.equal(projectReviewCoverage(next, ctx)[0].gap, 0);
  assert.equal(projectReviewCovered(next, ctx), true);
  assert.equal(next.review.approvals.length, 0);
  assert.equal(applyProjectReview(next, { type: 'confirm', note: '' }, sales, ctx).status, '待确认');
});

test('历史范围变更标记和零人天待审批不再阻塞客户确认或新的额度特批', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 3);
  let next = effort(p, ctx);
  next.review.scopeChange = true;
  next.review.approvals.push({ id: 'legacy-scope', planId: next.review.basis.id, scopeChange: true, scopeFingerprint: 'old', days: 0, gaps: [], state: '待审批', approverId: admin.id });
  assert.equal(currentProjectReviewApproval(next), undefined);
  assert.equal(projectReviewCovered(next, ctx), true);
  assert.equal(applyProjectReview(next, { type: 'confirm', note: '' }, sales, ctx).status, '待确认');
  assert.throws(() => applyProjectReview(next, { type: 'gap-decide', id: 'legacy-scope', approve: true, note: '同意' }, admin, ctx), /审批已变更/);
  next.operations.worklogs[0].hours = 16;
  next = effort(next, ctx);
  assert.equal(projectReviewCovered(next, ctx), false);
  assert.throws(() => confirm(next, ctx), /额度特批/);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 1, reason: '补充人天' }, sales, ctx);
  assert.equal(currentProjectReviewApproval(next).days, 1);
  assert.equal(next.review.approvals[0].id, 'legacy-scope');
});

test('工单内容变更不作废已批准额度，新增缺口仍需特批', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 1);
  let next = effort(p, ctx);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 1, reason: '补充人天' }, sales, ctx);
  const id = currentProjectReviewApproval(next).id;
  next = applyProjectReview(next, { type: 'gap-decide', id, approve: true, note: '同意' }, admin, ctx);
  next.review.approvals[0].scopeChange = true;
  next.review.approvals[0].scopeFingerprint = 'legacy-scope';
  next.workOrders[0].item.description = '更新描述';
  next = effort(next, ctx);
  assert.equal(next.review.approvals[0].state, '已通过');
  assert.equal(projectReviewCoverage(next, ctx)[0].projectApproval, 1);
  assert.equal(projectReviewCovered(next, ctx), true);
  next.operations.worklogs[0].hours = 16;
  next = effort(next, ctx);
  assert.equal(projectReviewCoverage(next, ctx)[0].gap, 2);
  assert.throws(() => confirm(next, ctx), /额度特批/);
});

test('待客户确认和客户已确认均锁定核定、补充依据及额度审批，确认后自动进入完成状态', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  const pending = confirm(effort(p, ctx), ctx);
  for (const next of [pending, decide(pending, ctx)]) {
    const before = structuredClone(next);
    const inputs = next.review.effort.lines.map(l => ({ itemId: l.itemId, finalBillableDays: l.billableDays }));
    for (const manager of [pm, admin]) assert.throws(() => applyProjectReview(next, { type: 'effort', items: inputs, note: '补充内部记录' }, manager, ctx), next.status === '已完成' ? /当前项目阶段/ : /已锁定/);
    assert.throws(() => basis(next, ctx), next.status === '已完成' ? /当前项目阶段/ : /已锁定/);
    assert.throws(() => applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 1, reason: '追加额度' }, sales, ctx), next.status === '已完成' ? /当前项目阶段/ : /已锁定/);
    assert.throws(() => applyProjectReview(next, { type: 'gap-decide', id: 'legacy-pending', approve: true, note: '同意' }, admin, ctx), next.status === '已完成' ? /当前项目阶段/ : /已锁定/);
    assert.deepEqual(next, before);
  }
  assert.equal(decide(pending, ctx).status, '已完成');
});

test('客户拒绝后解锁核定及服务依据，重新发起后再次锁定', () => {
  const { p, ctx } = fixture();
  let next = confirm(basis(effort(p, ctx), ctx), ctx);
  const original = structuredClone(next.review.confirmations[0]);
  next = decide(next, ctx, false, '请核对实际投入');
  next.operations.worklogs[0].hours = 12;
  next = effort(next, ctx);
  next = basis(next, ctx, [{ assetId: 'a0', days: 3 }, { assetId: 'a1', days: .5 }]);
  assert.equal(next.review.effort.lines[0].billableDays, 3);
  assert.equal(next.review.history[0].effort.lines[0].billableDays, 2);
  assert.deepEqual(next.review.confirmations[0].allocations, original.allocations);
  next = confirm(next, ctx);
  assert.equal(next.review.confirmations.length, 2);
  assert.equal(next.status, '待确认');
  assert.throws(() => effort(next, ctx), /已锁定/);
});

test('额度足够但还有审批待处理时须先处理审批再发起客户确认', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  let next = effort(p, ctx);
  next = applyProjectReview(next, { type: 'gap-submit', method: '远程', days: 1, reason: '预留额度' }, sales, ctx);
  assert.equal(projectReviewCovered(next, ctx), true);
  assert.throws(() => confirm(next, ctx), /完成正在进行的额度审批/);
  next = applyProjectReview(next, { type: 'gap-decide', id: next.review.approvals.at(-1).id, approve: false, note: '无需追加' }, admin, ctx);
  assert.equal(confirm(next, ctx).status, '待确认');
});

test('保存事务阻止旧窗口和最新版本在客户确认后核定，拒绝后允许重新核定', async t => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  let next = effort(p, ctx);
  const revision = next.revision;
  const stores = storesFor(next, ctx); storage(t, stores);
  next = await saveProjectReview(next.id, revision, { type: 'confirm', note: '' }, sales);
  const action = { type: 'effort', items: next.review.effort.lines.map(l => ({ itemId: l.itemId, finalBillableDays: l.billableDays })), note: '重新核定' };
  const before = structuredClone(stores);
  await assert.rejects(saveProjectReview(next.id, revision, action, pm), /已被更新/);
  await assert.rejects(saveProjectReview(next.id, next.revision, action, pm), /已锁定/);
  await assert.rejects(saveProjectReview(next.id, next.revision, { type: 'basis', allocations: [] }, sales), /已锁定/);
  assert.deepEqual(stores, before);
  const rejected = await saveProjectReview(next.id, next.revision, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: false, reason: '重新核对' }, customer);
  const reviewed = await saveProjectReview(next.id, rejected.revision, action, pm);
  assert.equal(reviewed.status, '待复核');
  assert.equal(reviewed.review.history.length, 1);
});

test('核销按最终数量记账并释放本项目原冻结，其他拆分项目额度不变', async t => {
  const { p, ctx } = fixture(); withSource(p, ctx, 4);
  ctx.requests[0].operations.assessment.plans[0].allocations[0].days = 6;
  let next = confirm(effort(p, ctx), ctx);
  Object.assign(ctx, updateProjectReviewReservations(next, ctx));
  const stores = storesFor(next, ctx);
  storage(t, stores);
  next = await saveProjectReview(p.id, next.revision, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: true, reason: '' }, customer);
  next = stores.references.find(row => row.id === `service-project:${p.id}`).payload;
  assert.equal(next.review.settlement.allocations[0].days, 2);
  assert.equal(next.review.settlement.released[0].days, 2);
  const workspace = stores.references[0].payload;
  assert.deepEqual(workspace.assets[0].projectReservations, []);
  assert.equal(workspace.assets[0].projectConsumptions[0].days, 2);
  assert.equal(stores.requests[0].projectReservationReleases[0].assetAllocations[0].days, 4);
  assert.equal(assetAvailable(workspace.assets[0], stores.requests, ''), 6); // 10 - sibling hold 2 - consumption 2
  const saved = structuredClone(stores);
  await assert.rejects(saveProjectReview(p.id, next.revision, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: true, reason: '' }, customer), /当前项目阶段/);
  assert.deepEqual(stores, saved);
  await saveLocal('references', { id: 'workspace', payload: { ...ctx, services: [] } });
  assert.equal(stores.references[0].payload.assets[0].projectConsumptions[0].days, 2);
});

test('核销事务失败时申请释放、项目状态与资产账本一并回滚', async t => {
  const { p, ctx } = fixture(); withSource(p, ctx, 4);
  const next = confirm(effort(p, ctx), ctx), stores = storesFor(next, ctx);
  const before = structuredClone(stores);
  storage(t, stores, row => row.id === 'r1');
  await assert.rejects(saveProjectReview(p.id, next.revision, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: true, reason: '' }, customer), /模拟存储失败/);
  assert.deepEqual(stores, before);
});

test('余额被调低时不能靠来源冻结额度恢复出不存在的可用资产', () => {
  const { p, ctx } = fixture(); withSource(p, ctx, 4);
  ctx.assets[0].balanceDays = 1;
  const next = effort(p, ctx);
  assert.equal(projectAssetAvailable(next, ctx.assets[0], ctx), 1);
  assert.throws(() => confirm(next, ctx), /可用人天不足/);
});

test('权益核销释放来源未用份额，已核销权益不再供其他项目使用', async t => {
  const { p, ctx } = fixture(); withSource(p, ctx, 1);
  p.workOrders = [p.workOrders[0]]; p.items = [p.items[0]]; p.operations.worklogs = [p.operations.worklogs[0]];
  p.workOrders[0].catalogSnapshot.priceUnit = '升级权益';
  p.workOrders[0].item.businessObjectIds = ['o1']; p.items[0].businessObjectIds = ['o1'];
  ctx.businessObjects = [{ id: 'o1', name: '集群', customerId: 'c1', product: 'SMTX OS 系统', status: '启用', nodeCount: 4, upgradeEntitlement: 8 }];
  const entitlements = [{ itemId: 'item0', objectId: 'o1', name: '集群', kind: 'upgrade', quantity: 6 }];
  p.requestConversion.assessmentSnapshot.basis.entitlementAllocations = structuredClone(entitlements);
  ctx.requests[0].operations.assessment.plans[0].entitlementAllocations = structuredClone(entitlements);
  let next = confirm(effort(p, ctx), ctx);
  Object.assign(ctx, updateProjectReviewReservations(next, ctx));
  const stores = storesFor(next, ctx); storage(t, stores);
  next = await saveProjectReview(p.id, next.revision, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: true, reason: '' }, customer);
  next = stores.references.find(row => row.id === `service-project:${p.id}`).payload;
  assert.equal(next.review.settlement.entitlementAllocations[0].quantity, 4);
  assert.equal(next.review.settlement.releasedEntitlements[0].quantity, 2);
  assert.equal(stores.references[0].payload.businessObjects[0].projectConsumptions[0].quantity, 4);
  assert.equal(entitlementAvailable(stores.references[0].payload.businessObjects[0], 'upgrade', stores.requests), 4);
});

test('交付内容变更使客户确认失效，确认版本保留原交付内容', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  let next = confirm(effort(p, ctx), ctx);
  const original = structuredClone(next.review.confirmations[0]);
  next.workOrders[0].item.description = '更改交付范围';
  assert.throws(() => decide(next, ctx), /重新核定/);
  assert.throws(() => effort(next, ctx), /已锁定/);
  next = decide(next, ctx, false, '需要调整核定内容');
  next = effort(next, ctx);
  assert.equal(next.status, '待复核');
  assert.ok(next.review.confirmations[0].invalidatedAt);
  assert.deepEqual(next.review.confirmations[0].services, original.services);
});

test('未确认工时阻止核定及客户确认，经理确认后可输入最终计价人天且不再乘系数', async t => {
  const { saveProjectOperation } = await import('./service-project-store.ts');
  const { p, ctx } = fixture();
  delete p.operations.worklogs[0].confirmedAt;
  assert.throws(() => effort(p, ctx), /确认全部有效工时/);
  const stores = storesFor(p, ctx); storage(t, stores);
  const confirmed = await saveProjectOperation(p.id, p.revision, { type: 'worklog-confirm', ids: ['log0'] }, { ...pm, name: '伪造显示名' });
  assert.equal(confirmed.operations.worklogs[0].confirmedBy, pm.name);
  const reviewed = applyProjectReview(confirmed, { type: 'effort', items: [{ itemId: 'wo0', finalBillableDays: 3 }, { itemId: 'wo1', finalBillableDays: .5 }], note: '核定最终消耗' }, pm, ctx);
  assert.equal(reviewed.review.effort.lines[0].estimatedDays, 1);
  assert.equal(reviewed.review.effort.lines[0].priceCoefficient, 2);
  assert.equal(reviewed.review.effort.lines[0].billableDays, 3);
  delete reviewed.operations.worklogs[0].confirmedAt;
  assert.equal(projectReviewStale(reviewed), true);
});

test('确认工时保存层阻止身份伪造、停用用户和过期版本，且不部分写入', async t => {
  const { saveProjectOperation } = await import('./service-project-store.ts');
  const { p, ctx } = fixture(); delete p.operations.worklogs[0].confirmedAt;
  const stores = storesFor(p, ctx); storage(t, stores);
  const before = structuredClone(stores);
  const action = { type: 'worklog-confirm', ids: ['log0'] };
  await assert.rejects(saveProjectOperation(p.id, p.revision, action, { ...engineer, role: pm.role }), /已启用/);
  await assert.rejects(saveProjectOperation(p.id, p.revision - 1, action, pm), /已被更新/);
  assert.deepEqual(stores, before);
  stores.references[0].payload.users.find(user => user.id === pm.id).status = '停用';
  await assert.rejects(saveProjectOperation(p.id, p.revision, action, pm), /已启用/);
  assert.equal(stores.references[1].payload.operations.worklogs[0].confirmedAt, undefined);
});


test('服务项目新审批仅使用项目配置，配置变化不改写已发起流程，请求配置独立', async t => {
  const { p, ctx } = fixture();
  const stores = storesFor(p, ctx);
  const requestRules = { version: 1, rules: [], defaultUserId: engineer.id };
  stores.references.push({ id: approvalRulesId, payload: requestRules }, { id: projectApprovalRulesId, payload: ctx.rules });
  storage(t, stores);
  let next = await saveProjectReview(p.id, p.revision, { type: 'gap-submit', method: '远程', days: .5, reason: '项目审批' }, sales);
  const approval = currentProjectReviewApproval(next);
  assert.equal(approval.approverId, admin.id);
  stores.references.find(row => row.id === projectApprovalRulesId).payload = { ...ctx.rules, defaultUserId: engineer.id };
  next = await saveProjectReview(p.id, next.revision, { type: 'gap-decide', id: approval.id, approve: true, note: '沿用原流程' }, admin);
  assert.equal(next.review.approvals[0].state, '已通过');
  next = await saveProjectReview(p.id, next.revision, { type: 'gap-submit', method: '远程', days: .2, reason: '新增项目额度' }, sales);
  assert.equal(currentProjectReviewApproval(next).approverId, engineer.id);
  assert.deepEqual(stores.references.find(row => row.id === approvalRulesId).payload, requestRules);
  stores.references.find(row => row.id === projectApprovalRulesId).payload = { version: 1, rules: [] };
  next = await saveProjectReview(p.id, next.revision, { type: 'gap-decide', id: currentProjectReviewApproval(next).id, approve: true, note: '同意' }, engineer);
  await assert.rejects(saveProjectReview(p.id, next.revision, { type: 'gap-submit', method: '现场', days: .1, reason: '无项目审批人' }, sales), /未找到审批人/);
});


const partnerActor = { id: 'partner-user', name: '合作伙伴创建人', role: '合作伙伴服务工程师' };
function partnerConfirmationFixture() {
  const { p, ctx } = fixture();
  Object.assign(p, { status: '进行中', createdSite: '合作伙伴中心', createdById: partnerActor.id, createdBy: partnerActor.name, serviceProviderId: 'partner:company' });
  p.collaborators.partner = [{ id: partnerActor.id, name: partnerActor.name }];
  for (const log of p.operations.worklogs) delete log.confirmedAt;
  ctx.partners = [{ id: 'company', name: '合作伙伴企业', status: '启用' }];
  ctx.partnerUsers = [{ id: partnerActor.id, name: partnerActor.name, partnerId: 'company', status: '启用' }];
  return { p, ctx };
}

test('伙伴创建项目工单完成后直接确认，跳过核定依据及工时确认，拒绝返回进行中', () => {
  const { p, ctx } = partnerConfirmationFixture();
  assert.equal(canSubmitProjectReview(p, pm), false);
  let next = applyProjectReview(p, { type: 'confirm', note: '请验收交付成果' }, partnerActor, ctx);
  assert.equal(next.status, '待确认');
  assert.equal(next.review.effort, undefined);
  assert.equal(next.review.basis, undefined);
  assert.deepEqual(next.review.confirmations[0].allocations, []);
  assert.deepEqual(next.review.confirmations[0].entitlementAllocations, []);
  assert.equal(projectForActor(next, partnerActor).review.confirmations[0].note, '请验收交付成果');
  assert.equal(customerServiceProject(next, ctx).skipsReview, true);
  assert.throws(() => applyProjectReview(next, { type: 'complete' }, partnerActor, ctx), /不支持/);
  next = applyProjectReview(next, { type: 'customer-decision', confirmationId: next.review.confirmations[0].id, accepted: false, reason: '补充交付说明' }, customer, ctx);
  assert.equal(next.status, '进行中');
  next = applyProjectReview(next, { type: 'confirm', note: '已补充' }, partnerActor, ctx);
  assert.equal(next.review.confirmations.length, 2);
  next = applyProjectReview(next, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: true, reason: '' }, customer, ctx);
  assert.equal(canRecordProjectWorklog(next, partnerActor), false);
  assert.equal(projectFieldReadonly(projectForActor(next, partnerActor), 'name'), true);
  assert.throws(() => applyProjectReview(next, { type: 'confirm', note: '重新确认' }, partnerActor, ctx), /当前项目阶段/);
  assert.equal(next.status, '已完成');
  assert.equal(next.review.settlement, undefined);
  assert.deepEqual(updateProjectReviewReservations(next, ctx).assets, ctx.assets);
});

test('伙伴确认严格校验完成工单、客户、创建人和账号，已变更交付不能确认且内部项目不跳复核', () => {
  const { p, ctx } = partnerConfirmationFixture();
  for (const workOrders of [[], p.workOrders.map(order => ({ ...order, status: '已取消' })), [{ ...p.workOrders[0], status: '进行中' }]])
    assert.throws(() => applyProjectReview({ ...p, workOrders }, { type: 'confirm', note: '' }, partnerActor, ctx), /工单/);
  for (const action of [{ type: 'effort', items: [], note: '' }, { type: 'basis', allocations: [] }, { type: 'gap-submit', method: '远程', days: 1, reason: '额度' }])
    assert.throws(() => applyProjectReview(p, action, pm, ctx), /无需/);
  assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '' }, { ...partnerActor, id: 'other' }, ctx), /创建人/);
  assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '' }, partnerActor, { ...ctx, partnerUsers: [] }), /失效/);
  assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '' }, partnerActor, { ...ctx, partners: [] }), /失效/);
  assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '' }, partnerActor, { ...ctx, contacts: [] }), /客户协作人/);
  const pending = applyProjectReview(p, { type: 'confirm', note: '' }, partnerActor, ctx);
  const changed = structuredClone(pending); changed.workOrders[0].item.description = '变更交付范围';
  assert.equal(projectCustomerConfirmationStale(changed), true);
  assert.throws(() => applyProjectReview(changed, { type: 'customer-decision', confirmationId: changed.review.confirmations[0].id, accepted: true, reason: '' }, customer, ctx), /内容已变化/);
  const newVersion = applyProjectReview(changed, { type: 'confirm', note: '' }, partnerActor, ctx);
  assert.ok(newVersion.review.confirmations[0].invalidatedAt);
  assert.equal(projectCustomerConfirmationStale(newVersion), false);
  const internal = { ...p, createdSite: '内部系统', createdById: sales.id };
  assert.throws(() => applyProjectReview(internal, { type: 'confirm', note: '' }, sales, ctx), /待复核/);
  assert.equal(canSubmitProjectReview(internal, pm), false);
});

test('伙伴确认保存闭环：权限及并发版本校验，客户通过后自动完成且无资产核销', async t => {
  const { p, ctx } = partnerConfirmationFixture();
  const stores = storesFor(p, ctx);
  Object.assign(stores.references[0].payload, { partners: ctx.partners, partnerUsers: ctx.partnerUsers });
  stores.references.push({ id: projectApprovalRulesId, payload: { invalid: true } });
  storage(t, stores);
  const assets = structuredClone(ctx.assets);
  let next = await saveProjectReview(p.id, p.revision, { type: 'confirm', note: '交付完成' }, partnerActor);
  assert.equal(next.status, '待确认');
  assert.equal(next.review.confirmations.length, 1);
  await assert.rejects(saveProjectReview(p.id, p.revision, { type: 'confirm', note: '' }, partnerActor), /已被更新/);
  let publicView = await saveProjectReview(p.id, next.revision, { type: 'customer-decision', confirmationId: next.review.confirmations[0].id, accepted: true, reason: '' }, customer);
  assert.equal(publicView.confirmation.state, '已确认');
  assert.equal(publicView.review, undefined);
  assert.equal(publicView.status, '已完成');
  next = stores.references.find(row => row.id === `service-project:${p.id}`).payload;
  assert.equal(next.status, '已完成');
  assert.deepEqual(stores.references[0].payload.assets, assets);
  assert.equal(next.review.settlement, undefined);
});


test('经理退回复核后保留核定和依据，重提必须再次最终核定且旧客户确认不可复用', () => {
  const { p, ctx } = fixture(); withSource(p, ctx);
  for (const order of p.workOrders) order.steps = [{ definition: { id: 'final' }, status: '已完成', data: { description: '原交付', attachments: [], deliverables: {}, values: {} } }];
  let next = decide(confirm(effort(p, ctx), ctx), ctx, false, '请补充说明');
  const oldBasis = structuredClone(next.review.basis), oldEffort = structuredClone(next.review.effort.lines);
  next = returnProjectReview(next, pm, { reason: '补充交付说明' });
  assert.equal(next.review.effort.stage, '过程');
  assert.deepEqual(next.review.effort.lines, oldEffort);
  assert.deepEqual(next.review.basis, oldBasis);
  assert.ok(next.review.confirmations[0].invalidatedAt);
  for (const order of next.workOrders) { order.status = '已完成'; order.steps[0].status = '已完成'; }
  next.workOrders[0].assignees = [{ id: engineer.id, name: engineer.name, group: 'internal' }];
  next = submitProjectReview(next, engineer);
  assert.throws(() => confirm(next, ctx), /最终人天核定/);
  next = confirm(effort(next, ctx), ctx);
  assert.equal(next.review.confirmations.length, 2);
});

const confirmationMailInput = { kind: 'project', date: '2026-09-20', subject: '项目实施报告及确认', to: 'client@example.com', cc: 'pm@example.com', greeting: '客户老师', customerEngineers: '客户甲', projectManager: '项目经理', engineers: '工程师', startTime: '09:00', endTime: '18:00', serviceNumber: 'ignored', workContent: '完成实施及验证', nextPlan: '交付完成，请确认', relatedFiles: [] };
function confirmationReady() {
  const { p, ctx } = fixture();
  return { p: basis(effort(p, ctx), ctx), ctx };
}
test('确认发起人与日报工程师权限独立；确认邮件及确认版本一次保存', async () => {
  const { projectConfirmationNotice } = await import('./project-confirmation-notice.ts');
  const { canSendProjectDailyReport, dailyReportHtml, dailyReportEml } = await import('./service-project-daily-reports.ts');
  const { p, ctx } = confirmationReady(), before = structuredClone(p);
  assert.equal(canSendProjectDailyReport(p, sales), false);
  const result = applyProjectReview(p, { type: 'confirm', note: '请确认', mail: confirmationMailInput }, sales, ctx, '2026-09-20T01:00:00Z');
  assert.deepEqual(p, before);
  assert.equal(result.revision, p.revision + 1);
  assert.equal(result.status, '待确认');
  const report = result.dailyReports[0], confirmation = result.review.confirmations.at(-1);
  assert.equal(confirmation.reportId, report.id);
  assert.equal(confirmation.deadline, undefined);
  assert.equal(report.confirmation.deadline, undefined);
  assert.equal(report.confirmation.id, confirmation.id);
  assert.equal(report.confirmation.notice, projectConfirmationNotice);
  assert.equal(report.authorId, sales.id);
  const html = dailyReportHtml(report, p.name);
  assert.ok(html.includes(projectConfirmationNotice));
  assert.ok(html.includes('>去确认</a>'));
  assert.ok(html.includes(`?project=${encodeURIComponent(p.id)}`));
  assert.ok(!html.includes('confirmation='));
  assert.ok(!html.includes('确认截止时间'));
  assert.equal(projectConfirmationNotice, '烦请贵司老师在收到本邮件后在客户中心确认；如有修改意见，请反馈您的意见。若超期未确认，视为贵司已确认本次项目报告并确认本次服务项目完成。');
  assert.equal(Buffer.from(dailyReportEml(report).split('\r\n\r\n')[1], 'base64').toString('utf8'), html);
  const visible = customerServiceProject(result, { ...ctx, partners: [], partnerUsers: [] });
  assert.equal(visible.dailyReports[0].confirmation.notice, projectConfirmationNotice);
  assert.equal(visible.confirmation.reportId, report.id);
  assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '', mail: confirmationMailInput }, engineer, ctx, '2026-09-20T01:00:00Z'), /内部申请人|客户所有人/);
});

test('确认邮件格式无效时，不推进项目或留下发送记录', () => {
  const { p, ctx } = confirmationReady(), before = structuredClone(p);
  for (const patch of [{ mail: { ...confirmationMailInput, to: '' } }, { mail: { ...confirmationMailInput, kind: 'daily' } }, { mail: { ...confirmationMailInput, relatedFiles: [{ deliverableId: 'private', description: '' }] } }]) {
    assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '', mail: confirmationMailInput, ...patch }, sales, ctx, '2026-09-20T01:00:00Z'));
    assert.deepEqual(p, before);
  }
});

test('补发确认邮件操作已移除，旧入口不能新增邮件或修改确认记录', () => {
  const { p, ctx } = confirmationReady();
  const next = applyProjectReview(p, { type: 'confirm', note: '', mail: confirmationMailInput }, sales, ctx, '2026-09-20T01:00:00Z');
  const before = structuredClone(next);
  assert.throws(() => applyProjectReview(next, { type: 'resend-confirmation-mail' }, sales, ctx), /不支持的项目复核操作/);
  assert.deepEqual(next, before);
});

test('确认邮件真实事务写入失败回滚邮件与确认，重试只生成一个版本', async t => {
  const { p, ctx } = confirmationReady();
  const stores = storesFor(p, ctx), before = structuredClone(stores);
  storage(t, stores, record => record.id === `service-project:${p.id}`);
  const action = { type: 'confirm', note: '', mail: confirmationMailInput };
  await assert.rejects(saveProjectReview(p.id, p.revision, action, sales), /模拟存储失败/);
  assert.deepEqual(stores, before);
  storage(t, stores);
  const saved = await saveProjectReview(p.id, p.revision, action, sales);
  assert.equal(saved.review.confirmations.length, 1);
  assert.equal(saved.dailyReports.length, 1);
  await assert.rejects(saveProjectReview(p.id, p.revision, action, sales), /已被更新/);
});

test('伙伴项目发起确认也生成同版确认邮件，拒绝后重新发起绑定新报告', () => {
  const { p, ctx } = partnerConfirmationFixture();
  const action = { type: 'confirm', note: '', mail: confirmationMailInput };
  let next = applyProjectReview(p, action, partnerActor, ctx, '2026-09-20T01:00:00Z');
  const original = next.review.confirmations[0];
  assert.equal(next.dailyReports[0].confirmation.id, original.id);
  next = applyProjectReview(next, { type: 'customer-decision', confirmationId: original.id, accepted: false, reason: '需要补充' }, customer, ctx, '2026-09-20T02:00:00Z');
  next = applyProjectReview(next, action, partnerActor, ctx, '2026-09-20T03:00:00Z');
  assert.equal(next.review.confirmations.length, 2);
  assert.notEqual(next.review.confirmations[1].reportId, original.reportId);
  assert.notEqual(next.dailyReports[1].confirmation.id, original.id);
  assert.throws(() => applyProjectReview(next, { type: 'customer-decision', confirmationId: original.id, accepted: true, reason: '' }, customer, ctx), /已更新/);
});


test('客户确认入口使用复核模板，普通项目模板不影响确认正文，已发送邮件保留原快照', async () => {
  const { parseMailConfig, changeMailTemplate, canonicalMailTemplate } = await import('./service-mail-templates.ts');
  const { dailyReportHtml } = await import('./service-project-daily-reports.ts');
  const { p, ctx } = confirmationReady();
  let config = parseMailConfig(undefined);
  config = changeMailTemplate(config, { ...config.templates[2], introduction: '复核专用正文', confirmationNotice: '请在客户中心确认{{项目名称}}。' }, 0, '管理员');
  ctx.mailTemplates = config;
  const input = { ...confirmationMailInput, emailTemplate: canonicalMailTemplate(config, 'review') };
  const next = applyProjectReview(p, { type: 'confirm', note: '', mail: input }, sales, ctx, '2026-09-20T01:00:00Z');
  const report = next.dailyReports[0], html = dailyReportHtml(report, next.name);
  assert.equal(report.emailTemplate.id, 'review');
  assert.equal(report.confirmation.notice, `请在客户中心确认${p.name}。`);
  assert.ok(html.includes('复核专用正文'));
  assert.ok(html.includes('>去确认</a>'));
  assert.equal(next.status, '待确认');
  ctx.mailTemplates = changeMailTemplate(config, { ...config.templates[2], confirmationNotice: '新版正文' }, 1, '管理员');
  assert.equal(dailyReportHtml(next.dailyReports[0], next.name), html);
  assert.throws(() => applyProjectReview(p, { type: 'confirm', note: '', mail: input }, sales, ctx), /模板已更新/);
});

test('管理员代项目核定、依据和客户确认，待确认锁工时、拒绝恢复、确认禁止取消', async () => {
  const { canCancelServiceProject } = await import('./service-project-cancellation.ts');
  const { p, ctx } = fixture();
  let next = applyProjectReview(p, { type: 'effort', items: calculateProjectReviewEffort(p, ctx).map(({ itemId, billableDays }) => ({ itemId, finalBillableDays: billableDays })), note: '' }, admin, ctx);
  next = applyProjectReview(next, { type: 'basis', allocations: [{ assetId: 'a0', days: 2 }, { assetId: 'a1', days: .5 }] }, admin, ctx);
  next = applyProjectReview(next, { type: 'confirm', note: '' }, admin, ctx);
  const pending = structuredClone(next);
  assert.equal(canRecordProjectWorklog(next, admin), false);
  assert.equal(canConfirmProjectWorklog(next, admin), false);
  const refusal = applyProjectReview(next, { type: 'customer-decision', confirmationId: next.review.confirmations.at(-1).id, accepted: false, reason: '需补充' }, admin, ctx);
  assert.equal(canRecordProjectWorklog(refusal, engineer), true);
  next = applyProjectReview(pending, { type: 'customer-decision', confirmationId: pending.review.confirmations.at(-1).id, accepted: true, reason: '' }, admin, ctx);
  assert.match(next.review.confirmations.at(-1).decidedBy, /管理员代确认/);
  for (const person of [admin, pm]) assert.equal(canCancelServiceProject(next, person, ctx.users), false);
  assert.equal(next.status, '已完成');
});

test('客户确认时额度失效不能留下已确认或已完成记录', async t => {
  const { p, ctx } = fixture();
  const pending = confirm(basis(effort(p, ctx), ctx), ctx);
  ctx.assets[0].balanceDays = 0;
  const stores = storesFor(pending, ctx); storage(t, stores);
  const snapshot = structuredClone(stores);
  await assert.rejects(saveProjectReview(p.id, pending.revision, { type: 'customer-decision', confirmationId: pending.review.confirmations.at(-1).id, accepted: true, reason: '' }, customer), /可用人天不足/);
  assert.deepEqual(stores, snapshot);
});
