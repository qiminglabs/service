import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig, requestIdentityIssue } from './service-requests.ts';
import {
  applyAssessmentAction,
  assessmentOf,
  canManageAssessmentBasis,
  canSubmitGapApproval,
  assessmentBasisSaveIssue,
  gapApproverOptions,
  repairCustomerRequestApprover,
  assessedEffort,
  currentPlan,
  assetAvailable,
  assessmentLockIssue,
} from './request-assessment.ts';
const pm = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理' };
const boss = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
const engineer = { id: 'USR-004', name: '林澈', role: 'SmartX 服务工程师' };
const users = [pm, sales, boss, engineer].map((u) => ({
  ...u,
  email: 'test@example.com',
  status: '启用',
  department: u.id === sales.id ? '销售部' : '服务部',
}));
const assets = [
  {
    id: 'a1',
    customerId: 'c1',
    name: '远程人天',
    status: '启用',
    balanceDays: 5,
  },
];
const now = '2026-09-08T10:00:00.000Z';
const request = () => ({
  ...newRequest('服务申请', 'c1', pm.name, 'c', pm.id, pm.role),
  externalCollaborators: [{ contactId: 'customer', name: '客户', phone: '', email: '' }], status: '待评估',
  items: [{ ...newItem({ id: 'svc', name: '实施', deliveryMethods: ['远程'], priceCoefficient: 1 }, defaultConfig({ id: 'svc', deliveryMethods: ['远程'] })), id: 'item' }],
});
const act = (r, action, actor = pm, all = [], catalog = assets) =>
  applyAssessmentAction(r, action, actor, catalog, users, all, now, [{ id: 'svc', priceCoefficient: 1, defaultQuantity: 0.1 }], [{ id: r.customerId, ownerUserId: sales.id }]);
const review = {
  type: 'review',
  scope: '安装部署',
  opinion: '材料齐备',
  risks: '维护窗口',
  outcome: '评估通过',
};
const ready = (r = request()) => act(r, review);
const effort = (r, days = 5) => act(r, { type: 'effort', items: [{ itemId: 'item', estimatedDays: days }] });
const link = (r, days = 5) =>
  act(r, {
    type: 'plan',
    allocations: days ? [{ assetId: 'a1', days }] : [],
    salesId: sales.id,
  });
const plan = (days = 5, locked = 5) => link(effort(ready(), days), locked);
const submit = {
  type: 'gap-submit',
  reason: '额外服务额度',
  approverId: boss.id,
};
test('所有内部申请人均可发起额度特批，页面权限与操作校验一致且不能自批', () => {
  const applicants = [pm, engineer, sales, boss,
    { id: 'USR-002', name: '售前', role: 'SmartX 售前工程师' },
    { id: 'USR-008', name: '硬件经理', role: 'SmartX 硬件产品经理' }];
  const directory = [...users, ...applicants.slice(4).map(actor => ({ ...actor, status: '启用', department: '产品部' }))];
  for (const applicant of applicants) {
    const original = { ...plan(8), createdById: applicant.id };
    assert.equal(canSubmitGapApproval(original, applicant, directory), true);
    const approver = applicant.id === boss.id ? sales : boss;
    const run = (r, action, actor) => applyAssessmentAction(r, action, actor, assets, directory, [], now);
    assert.throws(() => run(original, { ...submit, approverId: applicant.id }, applicant), /上级审批人/);
    const pending = run(original, { ...submit, approverId: approver.id }, applicant);
    const approval = assessmentOf(pending).approvals[0];
    assert.equal(approval.authorId, applicant.id);
    assert.equal(approval.author, applicant.name);
    assert.equal(approval.days, 3);
    assert.throws(() => run(pending, submit, sales), /重复/);
    const decision = { type: 'gap-decide', id: approval.id, approve: true, note: '同意' };
    assert.throws(() => run(pending, decision, applicant), /不能自行审批/);
    const approved = run(pending, decision, approver);
    assert.equal(assessmentOf(approved).approvals[0].state, '已通过');
    assert.equal(act(approved, { type: 'confirm' }, applicant).status, '待确认');
  }
});

test('额度发起权限不扩展到其他协作人、其他销售、客户或停用申请人', () => {
  const original = plan(8);
  const otherSales = { id: 'other-sales', name: '其他销售', role: sales.role };
  const directory = [...users, { ...otherSales, status: '启用', department: '销售部' }];
  original.internalParticipants.push({ userId: engineer.id, name: engineer.name });
  for (const actor of [engineer, boss, otherSales, { id: original.createdById, role: '客户', name: '客户' }]) {
    assert.equal(canSubmitGapApproval(original, actor, directory), false);
    assert.throws(() => applyAssessmentAction(original, submit, actor, assets, directory, [], now), /仅内部人员|内部申请人或方案指定的销售/);
  }
  const disabled = directory.map(user => user.id === pm.id ? { ...user, status: '停用' } : user);
  assert.equal(canSubmitGapApproval(original, pm, disabled), false);
  assert.throws(() => applyAssessmentAction(original, submit, pm, assets, disabled, [], now), /内部申请人或方案指定的销售/);
  const customerRequest = { ...original, createdByAudience: 'customer' };
  assert.equal(canSubmitGapApproval(customerRequest, pm, users), false);
  assert.equal(canSubmitGapApproval(customerRequest, sales, users), true);
  assert.throws(() => act(customerRequest, submit, pm), /内部申请人或方案指定的销售/);
  assert.equal(assessmentOf(act(customerRequest, submit, sales)).approvals[0].authorId, sales.id);
  assert.equal(canSubmitGapApproval(request(), pm, users), false);
});

test('内部申请人负责依据与发起确认，其他内部角色不能代办，项目经理仍负责评估核定', () => {
  const presales = { id: 'USR-002', name: '售前', role: 'SmartX 售前工程师' };
  const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
  for (const applicant of [sales, engineer, boss, presales, pm, hardware]) {
    const original = { ...request(), createdById: applicant.id };
    const assessed = effort(ready(original), 3);
    const action = { type: 'plan', allocations: [{ assetId: 'a1', days: 3 }], salesId: sales.id };
    const linked = act(assessed, action, applicant);
    for (const other of [sales, engineer, boss, presales, pm, hardware].filter(actor => actor.id !== applicant.id)) {
      assert.equal(canManageAssessmentBasis(assessed, other), false);
      assert.throws(() => act(assessed, action, other), /内部申请人/);
      assert.throws(() => act(linked, { type: 'confirm' }, other), /内部申请人/);
      assert.match(assessmentBasisSaveIssue(linked, assessed, other), /内部申请人/);
    }
    assert.equal(currentPlan(linked).author, applicant.name);
    const confirmed = act(linked, { type: 'confirm' }, applicant);
    assert.equal(confirmed.operations.assessment.confirmation.by, applicant.name);
    assert.equal(assessmentBasisSaveIssue(confirmed, linked, applicant), null);
    assert.equal(assessmentBasisSaveIssue(effort(linked, 4), linked, pm), null);
    if (applicant.id !== pm.id) assert.throws(() => act(original, review, applicant), /项目经理/);
  }
});
test('客户发起由当前客户所有人处理依据及确认，客户本人和项目经理不能代办', () => {
  const customer = { id: 'customer', name: '客户', role: '客户' };
  const original = { ...request(), createdByAudience: 'customer', createdById: customer.id };
  const assessed = effort(ready(original), 3);
  const refs = [{ id: original.customerId, ownerUserId: sales.id }];
  const action = { type: 'plan', allocations: [{ assetId: 'a1', days: 3 }], salesId: sales.id };
  const linked = act(assessed, action, sales);
  assert.equal(act(linked, { type: 'confirm' }, sales).status, '待确认');
  assert.throws(() => act(assessed, action, pm), /客户所有人/);
  assert.throws(() => act(linked, { type: 'confirm' }, pm), /客户所有人/);
  assert.throws(() => act(linked, { type: 'confirm' }, customer), /内部人员/);
  assert.equal(assessmentBasisSaveIssue(linked, assessed, sales, refs, users), null);
  assert.match(assessmentBasisSaveIssue(linked, assessed, pm, refs, users), /客户所有人/);
  assert.equal(canManageAssessmentBasis(assessed, sales, [], users), false);
  assert.equal(canManageAssessmentBasis(assessed, sales, refs, users.map(user => ({ ...user, status: '停用' }))), false);
  const transferred = [{ id: original.customerId, ownerUserId: boss.id }];
  assert.equal(canManageAssessmentBasis(assessed, sales, transferred, users), false);
  assert.equal(canManageAssessmentBasis(assessed, boss, transferred, users), true);
});
test('材料评估不创建待办，需补充可继续评估，通过后禁止新增', () => {
  const original = request();
  let r = act(original, {
    ...review,
    outcome: '需补充',
    scope: '',
    opinion: '需补充网络拓扑',
  });
  assert.equal(assessmentOf(r).tasks.length, 0);
  for (const actor of [sales, engineer, boss])
    assert.throws(() => act(original, review, actor), /项目经理/);
  r = ready(r);
  assert.equal(assessmentOf(r).rounds.length, 2);
  assert.throws(() => act(r, review), /已通过/);
  assert.throws(() => act(r, { ...review, outcome: '需补充' }), /已通过/);
  assert.equal(original.operations, undefined);
});
test('历史未完成待办及旧重评标识不再阻止评估与核定', () => {
  let r = act(request(), { ...review, outcome: '需补充' });
  r.operations.assessment.tasks = [{ id: 'legacy', content: '旧待办' }];
  r.operations.assessment.needsReview = true;
  r = effort(ready(r), 2);
  assert.equal(assessedEffort(r), 2);
  assert.throws(
    () => act(r, { type: 'reply', id: 'legacy', reply: '反馈', files: [] }),
    /不支持/,
  );
  assert.throws(() => act(r, { type: 'reopen', reason: '重新评估' }), /不支持/);
});
test('三个阶段顺序校验：材料通过、人天核定、服务依据关联', () => {
  assert.throws(() => effort(request()), /材料评估/);
  assert.throws(() => link(ready()), /先完成人天核定/);
  let r = effort(ready(), 3);
  assert.equal(currentPlan(r), undefined);
  assert.equal(r.status, '待评估');
  assert.throws(() => effort(r, 0), /大于 0/);
  assert.throws(() => act(r, { type: 'effort', items: [{ itemId: 'item', estimatedDays: 3 }] }, sales), /项目经理/);
  r = link(r, 3);
  assert.equal(currentPlan(r).effort, 3);
  assert.throws(() => act(r, review), /已通过/);
  r = act(r, { type: 'confirm' });
  assert.equal(r.status, '待确认');
  assert.equal(assessmentOf(r).confirmation.effort, 3);
});
test('修改人天核定释放原服务依据并使特批失效，但材料评估保持通过', () => {
  let r = act(plan(8), submit, sales);
  r = act(
    r,
    {
      type: 'gap-decide',
      id: assessmentOf(r).approvals[0].id,
      approve: true,
      note: '同意',
    },
    boss,
  );
  r = effort(r, 9);
  assert.equal(currentPlan(r), undefined);
  assert.equal(assessmentOf(r).approvals[0].state, '已失效');
  assert.equal(assessmentOf(r).rounds[0].outcome, '评估通过');
  assert.throws(() => act(r, review), /已通过/);
  r = link(r);
  assert.equal(currentPlan(r).effort, 9);
});
test('缺口由销售发起、上级审批后才可客户确认，不能自批', () => {
  let r = plan(8);
  assert.throws(() => act(r, { type: 'confirm' }), /资产不足/);
  assert.throws(() => act(r, submit, engineer), /内部申请人或方案指定的销售/);
  for (const id of [sales.id, pm.id, engineer.id])
    assert.throws(() => act(r, { ...submit, approverId: id }, sales), /上级/);
  r = act(r, submit, sales);
  assert.equal(assessmentOf(r).approvals[0].days, 3);
  assert.throws(() => act(r, submit, sales), /重复/);
  const decision = {
    type: 'gap-decide',
    id: assessmentOf(r).approvals[0].id,
    approve: true,
    note: '同意',
  };
  for (const actor of [pm, sales, engineer])
    assert.throws(() => act(r, decision, actor), /上级/);
  r = act(r, decision, boss);
  r = act(r, { type: 'confirm' });
  assert.equal(r.status, '待确认');
  assert.equal(assessmentOf(r).confirmation.extraDays, 3);
});
test('拒绝保留历史，销售可重新发起，调整依据使旧特批失效', () => {
  let r = act(plan(8), submit, sales);
  r = act(
    r,
    {
      type: 'gap-decide',
      id: assessmentOf(r).approvals[0].id,
      approve: false,
      note: '需补充理由',
    },
    boss,
  );
  r = act(r, submit, sales);
  const id = assessmentOf(r).approvals[1].id;
  r = act(r, { type: 'gap-decide', id, approve: true, note: '同意' }, boss);
  r = link(r, 4);
  assert.equal(assessmentOf(r).approvals[0].state, '已拒绝');
  assert.equal(assessmentOf(r).approvals[1].state, '已失效');
  assert.throws(
    () => act(r, { type: 'gap-decide', id, approve: true, note: '同意' }, boss),
    /变更/,
  );
});
test('关联资产校验客户、状态、余额及跨请求锁定，确认时再次校验', () => {
  const r = effort(ready(), 4),
    action = {
      type: 'plan',
      allocations: [{ assetId: 'a1', days: 4 }],
      salesId: sales.id,
    };
  for (const bad of [
    { ...assets[0], customerId: 'other' },
    { ...assets[0], status: '停用' },
  ])
    assert.throws(() => act(r, action, pm, [], [bad]), /有效|当前客户/);
  assert.throws(
    () => act(r, action, pm, [], [{ ...assets[0], balanceDays: undefined }]),
    /余额/,
  );
  const locked = plan(3, 3);
  assert.equal(assetAvailable(assets[0], [locked], r.id), 2);
  assert.throws(() => act(r, action, pm, [locked]), /余额不足/);
  const next = act(
    r,
    { ...action, allocations: [{ assetId: 'a1', days: 2 }] },
    pm,
    [locked],
  );
  assert.equal(assessmentLockIssue(next, [locked, next], assets), null);
  assert.throws(
    () =>
      act(
        locked,
        { type: 'confirm' },
        pm,
        [],
        [{ ...assets[0], balanceDays: 2 }],
      ),
    /余额不足/,
  );
  assert.throws(
    () =>
      act(
        locked,
        { type: 'confirm' },
        pm,
        [],
        [{ ...assets[0], status: '停用' }],
      ),
    /失效/,
  );
});
test('待评估项目经理退回草稿，释放资产、失效特批、保留评估与操作历史', () => {
  const original = act(plan(8), submit, sales);
  const action = { type: 'return-draft', reason: '请补充客户环境材料' };
  for (const actor of [sales, boss, engineer])
    assert.throws(() => act(original, action, actor), /项目经理/);
  for (const status of ['草稿', '待确认', '待受理', '已转服务项目', '已取消'])
    assert.throws(() => act({ ...original, status }, action), /待评估/);
  assert.throws(() => act(original, { ...action, reason: ' ' }), /退回原因/);
  const returned = act(original, action);
  assert.equal(returned.status, '草稿');
  assert.equal(returned.submittedAt, undefined);
  assert.equal(currentPlan(returned), undefined);
  assert.equal(assetAvailable(assets[0], [returned], 'other'), 5);
  assert.equal(returned.operations.assessmentHistory.length, 1);
  assert.deepEqual(
    returned.operations.assessmentHistory[0].rounds,
    original.operations.assessment.rounds,
  );
  assert.equal(
    returned.operations.assessmentHistory[0].approvals[0].state,
    '已失效',
  );
  assert.equal(returned.operations.activities.at(-1).title, '退回草稿');
  assert.equal(requestIdentityIssue(returned, original, pm), null);
  assert.match(requestIdentityIssue(returned, original, sales), /项目经理/);
  assert.match(requestIdentityIssue(returned, original), /项目经理/);
  assert.match(
    requestIdentityIssue({ ...original, status: '草稿' }, original, pm),
    /项目经理/,
  );
  assert.equal(original.operations.assessment.approvals[0].state, '待审批');
  assert.equal(
    requestIdentityIssue({ ...returned, title: '补充后的申请' }, returned, pm),
    null,
  );
  const resubmitted = { ...returned, status: '待评估' };
  assert.equal(ready(resubmitted).operations.assessment.rounds.length, 1);
  assert.equal(resubmitted.operations.assessmentHistory.length, 1);
});
test('不能篡改已记录历史，也不能退回其他项目经理负责的请求', () => {
  const original = plan();
  assert.throws(
    () =>
      act(
        original,
        { type: 'return-draft', reason: '补充' },
        { ...pm, id: 'another-pm' },
      ),
    /项目经理/,
  );
  const returned = act(original, { type: 'return-draft', reason: '补充' });
  const forged = structuredClone(returned);
  forged.operations.activities[0].detail = '篡改';
  assert.match(requestIdentityIssue(forged, original, pm), /活动/);
});

test('额度审批期间冻结人天与服务依据，通过或拒绝后才允许调整', () => {
  const waiting = act(plan(8), submit, sales);
  const original = structuredClone(waiting);
  assert.throws(() => effort(waiting, 9), /审批中/);
  assert.throws(() => effort(waiting, 8), /审批中/);
  assert.throws(() => link(waiting, 4), /审批中/);
  assert.deepEqual(waiting, original);
  for (const approve of [true, false]) {
    const decided = act(
      waiting,
      {
        type: 'gap-decide',
        id: assessmentOf(waiting).approvals[0].id,
        approve,
        note: '审批结果',
      },
      boss,
    );
    assert.equal(assessedEffort(effort(decided, 9)), 9);
    assert.equal(currentPlan(link(decided, 4)).allocations[0].days, 4);
  }
});

test('人天核定备注选填、可保存和清空，仅修改备注不释放既有资产', () => {
  const initial = ready();
  const saved = act(initial, {
    type: 'effort',
    items: [{ itemId: 'item', estimatedDays: 5 }],
    note: '  实施 3 人天\n验收 2 人天  ',
  });
  assert.equal(assessmentOf(saved).effort.note, '实施 3 人天\n验收 2 人天');
  assert.match(saved.operations.activities.at(-1).detail, /实施 3 人天/);
  const linked = link(saved);
  const updated = act(linked, { type: 'effort', items: [{ itemId: 'item', estimatedDays: 5 }], note: '补充说明' });
  assert.deepEqual(currentPlan(updated), currentPlan(linked));
  assert.equal(assessmentOf(updated).effort.note, '补充说明');
  const cleared = act(updated, { type: 'effort', items: [{ itemId: 'item', estimatedDays: 5 }], note: '' });
  assert.equal(assessmentOf(cleared).effort.note, '');
  assert.equal(assessmentOf(effort(initial)).effort.note, '');
});

test('材料评估只需结论与意见，移除范围风险后仍可通过并推进确认', () => {
  const r = act(request(), {
    type: 'review',
    outcome: '评估通过',
    opinion: '材料完整',
  });
  assert.equal(assessmentOf(r).rounds[0].scope, '');
  assert.equal(assessmentOf(r).rounds[0].risks, '');
  const next = act(link(effort(r)), { type: 'confirm' });
  assert.equal(next.status, '待确认');
  assert.throws(
    () => act(request(), { type: 'review', outcome: '评估通过', opinion: '' }),
    /评估意见/,
  );
});

test('额度审批人同右上角身份菜单一致，排除隐藏的同角色用户', () => {
  const directory = [
    ...users,
    {
      id: 'USR-002',
      name: '陈屿',
      email: 'chen@example.com',
      department: '售前',
      status: '启用',
    },
  ];
  assert.deepEqual(
    gapApproverOptions(directory, sales.id, pm.id).map((user) => user.id),
    [boss.id],
  );
  assert.throws(
    () =>
      applyAssessmentAction(
        plan(8),
        { ...submit, approverId: 'USR-002' },
        sales,
        assets,
        directory,
        [],
        now,
      ),
    /可切换身份/,
  );
});
test('仅修正指定单子不可切换的待审批人，保留额度与历史且重复加载不再修改', () => {
  const directory = [
    ...users,
    {
      id: 'USR-002',
      name: '陈屿',
      email: 'chen@example.com',
      department: '售前',
      status: '启用',
    },
  ];
  const r = act(plan(8), submit, sales);
  r.title = '客户发起请求';
  r.operations.assessment.approvals[0].approverId = 'USR-002';
  r.operations.assessment.approvals[0].approver = '陈屿';
  const fixed = repairCustomerRequestApprover([r], directory, now);
  assert.equal(assessmentOf(fixed).approvals[0].approverId, boss.id);
  assert.equal(assessmentOf(fixed).approvals[0].state, '待审批');
  assert.equal(assessmentOf(fixed).approvals[0].days, 3);
  assert.deepEqual(currentPlan(fixed), currentPlan(r));
  assert.match(fixed.operations.activities.at(-1).detail, /陈屿 → 陆明/);
  assert.equal(requestIdentityIssue(fixed, r), null);
  assert.equal(assessmentOf(r).approvals[0].approverId, 'USR-002');
  assert.equal(repairCustomerRequestApprover([fixed], directory, now), null);
  assert.equal(
    repairCustomerRequestApprover(
      [{ ...r, title: '其他单子' }],
      directory,
      now,
    ),
    null,
  );
  assert.equal(
    repairCustomerRequestApprover(
      [r, { ...r, id: 'duplicate' }],
      directory,
      now,
    ),
    null,
  );
  const decided = structuredClone(r);
  decided.operations.assessment.approvals[0].state = '已通过';
  assert.equal(repairCustomerRequestApprover([decided], directory, now), null);
});

test('发起确认保存独立的客户资产及对外说明快照，兼容未填写说明', () => {
  const linked = plan();
  const next = act(linked, { type: 'confirm', externalNote: ' 服务安排\n请提前准备环境 ' });
  assert.equal(next.status, '待确认');
  assert.equal(next.operations.assessment.confirmation.externalNote, '服务安排\n请提前准备环境');
  assert.deepEqual(next.operations.assessment.confirmation.allocations, currentPlan(linked).allocations);
  currentPlan(linked).allocations[0].days = 1;
  assert.equal(next.operations.assessment.confirmation.allocations[0].days, 5);
  assert.equal(act(plan(), { type: 'confirm' }).operations.assessment.confirmation.externalNote, '');
  assert.throws(() => act(request(), { type: 'confirm' }), /请先完成/);
});

test('客户拒绝后沿用原依据与已批额度再次确认，拒绝历史跨次保留', async () => {
  const { applyCustomerDecision } = await import('./request-customer-decision.ts');
  let r = act(plan(8), submit, sales);
  r = act(r, { type: 'gap-decide', id: assessmentOf(r).approvals[0].id, approve: true, note: '同意' }, boss);
  const originalPlan = structuredClone(currentPlan(r));
  const originalApprovals = structuredClone(assessmentOf(r).approvals);
  const customer = { id: 'customer', name: '客户', role: '客户' };
  for (let i = 0; i < 2; i++) {
    r = act(r, { type: 'confirm', externalNote: `说明${i}` });
    r = applyCustomerDecision(r, customer, r.customerId, false, `拒绝原因${i}`, `2026-09-08T12:00:0${i}Z`);
    assert.deepEqual(currentPlan(r), originalPlan);
    assert.deepEqual(assessmentOf(r).approvals, originalApprovals);
  }
  r = act(r, { type: 'confirm' });
  assert.equal(r.status, '待确认');
  assert.deepEqual(r.operations.customerDecisions.map(d => d.reason), ['拒绝原因0', '拒绝原因1']);
});
