import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApprovalPreview } from './approval-preview.ts';
import { emptyApprovalConfig, newApprovalNode } from './approval-flows.ts';
import { emptyAssessment } from './request-assessment.ts';
import { newApprovalRule } from './approval-rules.ts';

const person = (id, reportsToUserId) => ({ id, name: `姓名${id}`, email: `${id}@example.com`, department: '测试部门', status: '启用', reportsToUserId });
const users = [person('a', 'b'), person('b', 'c'), person('c', 'd'), person('d')];
const request = { id: 'REQ-1', title: '测试请求', createdById: 'a', createdByAudience: 'internal', createdBy: '姓名a', owner: '姓名a', customerId: 'C-1', status: '待评估', items: [], operations: { assessment: { ...emptyAssessment(), plans: [{ id: 'plan-1', effort: 3, allocations: [], roundId: 'round-1', salesId: 'b', salesName: '姓名b', at: '2026-09-15', author: '姓名a' }] } } };
const conditions = { requirement: '内部申请', testedRequirement: '内部申请', compiled: { version: 1, groups: [{ conditions: [{ field: 'source', operator: 'eq', value: 'internal' }], items: [] }] } };
const rule = (priority, nodes = [newApprovalNode()]) => ({ ...newApprovalRule(), priority, name: `规则${priority}`, conditions: structuredClone(conditions), flow: { ...emptyApprovalConfig(), revision: 1, nodes } });

test('预览取最高优先级规则，展开截止人并继续后续环节，不修改请求与配置', () => {
  const first = { ...newApprovalNode('org'), depth: 1, stopUserIds: ['c', 'b'] };
  const last = { ...newApprovalNode(), source: 'people', userIds: ['d'] };
  const rules = [rule(20), rule(10, [first, last])];
  const before = structuredClone({ request, rules, users });
  const preview = resolveApprovalPreview(request, rules, users, []);
  assert.equal(preview.rule.id, rules[1].id);
  assert.equal(preview.issue, undefined);
  assert.deepEqual(preview.steps[0].approvers, [{ id: 'b', name: '姓名b', cutoff: true }]);
  assert.deepEqual(preview.steps[1].approvers, [{ id: 'd', name: '姓名d', cutoff: false }]);
  assert.deepEqual({ request, rules, users }, before);
});

test('固定级数和直属汇报人分别按申请人解析，层数不足且未配置默认人时待分配', () => {
  const rules = [rule(10, [newApprovalNode(), { ...newApprovalNode('org'), depth: 2 }, { ...newApprovalNode('org'), depth: 4 }])];
  const preview = resolveApprovalPreview(request, rules, users, []);
  assert.deepEqual(preview.steps[0].approvers.map(user => user.id), ['b']);
  assert.deepEqual(preview.steps[1].approvers.map(user => user.id), ['b', 'c']);
  assert.match(preview.steps[2].issue, /未设置汇报人/);
  assert.match(preview.steps[2].issue, /未设置默认审批人.*待分配/);
});

test('未命中与命中但未配置流程分别显示，不跳到低优先级流程', () => {
  assert.deepEqual(resolveApprovalPreview(request, [], users, []), { requirement: 'required', steps: [] });
  const untested = rule(10); untested.conditions.testedRequirement = '';
  assert.equal(resolveApprovalPreview(request, [untested], users, []).rule, undefined);
  const empty = rule(10, []);
  const preview = resolveApprovalPreview(request, [rule(20), empty], users, []);
  assert.equal(preview.rule.id, empty.id);
  assert.match(preview.issue, /尚未配置/);
});

test('外部申请不能借同名或相同编号读取内部汇报链；无编号也不猜测身份', () => {
  const customerRule = rule(10, [newApprovalNode(), { ...newApprovalNode(), source: 'people', userIds: ['c'] }]);
  customerRule.conditions = { requirement: '客户申请', testedRequirement: '客户申请', compiled: { version: 1, groups: [{ conditions: [{ field: 'source', operator: 'eq', value: 'customer' }], items: [] }] } };
  const preview = resolveApprovalPreview({ ...request, createdByAudience: 'customer' }, [customerRule], users, []);
  assert.match(preview.steps[0].issue, /客户发起/);
  assert.equal(preview.steps[0].approvers.length, 0);
  assert.equal(preview.steps[1].approvers[0].id, 'c');
  const missing = resolveApprovalPreview({ ...request, createdById: undefined }, [rule(10)], users, []);
  assert.match(missing.steps[0].issue, /申请人编号/);
});

test('停用、循环及无法到达截止人均给出原因，不显示正常结束', () => {
  const stopped = users.map(user => ({ ...user, status: user.id === 'b' ? '停用' : user.status }));
  const direct = resolveApprovalPreview(request, [rule(10, [{ ...newApprovalNode(), source: 'people', userIds: ['b'] }])], stopped, []);
  assert.match(direct.steps[0].issue, /停用/);
  assert.match(direct.steps[0].issue, /未设置默认审批人.*待分配/);
  const cutoffRule = rule(10, [{ ...newApprovalNode('org'), stopUserIds: ['d'] }]);
  const cycle = resolveApprovalPreview(request, [cutoffRule], [person('a', 'b'), person('b', 'a'), person('d')], []);
  assert.match(cycle.steps[0].issue, /循环/);
  const missing = resolveApprovalPreview(request, [cutoffRule], [person('a', 'b'), person('b'), person('d')], []);
  assert.match(missing.steps[0].issue, /未到达审批截止人/);
});


test('未命中使用默认审批人，命中时仍保留该流程而不替换整个流程', () => {
  const fallback = resolveApprovalPreview(request, [], users, [], 'd');
  assert.deepEqual(fallback.defaultApprover, { id: 'd', name: '姓名d' });
  assert.equal(fallback.rule, undefined);
  assert.equal(resolveApprovalPreview(request, [], users, []).defaultApprover, undefined);
  assert.match(resolveApprovalPreview(request, [], users, [], 'missing').issue, /默认审批人.*待分配/);
  assert.match(resolveApprovalPreview(request, [], users.map(user => ({ ...user, status: '停用' })), [], 'd').issue, /停用/);
  for (const rules of [[rule(10)], [rule(10, [])], [rule(10, [{ ...newApprovalNode(), source: 'people', userIds: ['missing'] }])]]) {
    const result = resolveApprovalPreview(request, rules, users, [], 'd');
    assert.equal(result.rule.id, rules[0].id);
    assert.equal(result.defaultApprover, undefined);
  }
});


test('指定审批人失效与直属汇报人缺失统一由默认人兜底，后续环节继续', () => {
  const requests = { ...request, createdById: 'd' };
  const rules = [rule(10, [
    { ...newApprovalNode(), source: 'people', userIds: ['missing'], missing: 'block' },
    { ...newApprovalNode(), missing: 'admin' },
    { ...newApprovalNode(), source: 'people', userIds: ['c'] },
  ])];
  const before = structuredClone({ requests, rules, users });
  const result = resolveApprovalPreview(requests, rules, users, [], 'b');
  assert.equal(result.issue, undefined);
  assert.deepEqual(result.steps.map(step => step.approvers.map(user => user.id)), [['b'], ['b'], ['c']]);
  assert.ok(result.steps.slice(0, 2).every(step => step.approvers[0].fallback && step.fallbackReason && !step.issue));
  assert.equal(result.steps[2].fallbackReason, undefined);
  assert.deepEqual({ requests, rules, users }, before);
});

test('逐级审批中断保留此前层级，由默认人结束本环节；相邻同一审批人不重复', () => {
  const rules = [rule(10, [{ ...newApprovalNode('org'), stopUserIds: ['outside'] }, { ...newApprovalNode(), source: 'people', userIds: ['b'] }])];
  const data = [...users, person('outside'), person('fallback')];
  const result = resolveApprovalPreview(request, rules, data, [], 'fallback');
  assert.deepEqual(result.steps[0].approvers.map(user => user.id), ['b', 'c', 'd', 'fallback']);
  assert.match(result.steps[0].fallbackReason, /未到达审批截止人/);
  assert.equal(result.steps[0].approvers.at(-1).fallback, true);
  assert.equal(result.steps[0].issue, undefined);
  assert.deepEqual(result.steps[1].approvers.map(user => user.id), ['b']);
  const repeated = resolveApprovalPreview(request, rules, data, [], 'd');
  assert.deepEqual(repeated.steps[0].approvers.map(user => user.id), ['b', 'c', 'd']);
  assert.equal(repeated.steps[0].approvers.at(-1).fallback, true);
});

test('无效默认人不会生成兜底审批，正常截止不追加默认人', () => {
  const rules = [rule(10, [{ ...newApprovalNode(), source: 'people', userIds: ['missing'] }])];
  for (const id of ['', 'unknown', 'off']) {
    const result = resolveApprovalPreview(request, rules, [...users, { ...person('off'), status: '停用' }], [], id);
    assert.equal(result.steps[0].approvers.length, 0);
    assert.match(result.steps[0].issue, /默认审批人.*待分配/);
  }
  const healthy = resolveApprovalPreview(request, [rule(10, [{ ...newApprovalNode('org'), stopUserIds: ['c'] }])], users, [], 'd');
  assert.deepEqual(healthy.steps[0].approvers.map(user => user.id), ['b', 'c']);
  assert.equal(healthy.steps[0].fallbackReason, undefined);
});


test('额度充足不匹配流程也不使用默认审批人，预览不修改原记录', () => {
  const covered = structuredClone(request);
  covered.operations.assessment.plans[0].allocations = [{ assetId: 'asset-1', name: '人天包', days: 3 }];
  const rules = [rule(10)];
  const before = structuredClone({ covered, rules, users });
  assert.deepEqual(resolveApprovalPreview(covered, rules, users, [], 'd'), { requirement: 'not-required', steps: [] });
  assert.deepEqual(resolveApprovalPreview(covered, [], users, [], 'missing'), { requirement: 'not-required', steps: [] });
  assert.deepEqual({ covered, rules, users }, before);
});

test('没有或已释放的服务依据方案不能判断为无需审批，也不提前分配默认人', () => {
  for (const plans of [[], [{ ...request.operations.assessment.plans[0], releasedAt: '2026-09-15' }]]) {
    const pending = { ...request, operations: { assessment: { ...emptyAssessment(), plans } } };
    assert.deepEqual(resolveApprovalPreview(pending, [rule(10)], users, [], 'd'), { requirement: 'pending', steps: [] });
  }
  assert.deepEqual(resolveApprovalPreview({ ...request, operations: undefined }, [], users, [], 'd'), { requirement: 'pending', steps: [] });
});

test('按服务方式核算额度缺口，不能用远程额度抵消现场缺口', () => {
  const mixed = structuredClone(request);
  mixed.operations.assessment.plans[0] = {
    ...mixed.operations.assessment.plans[0], effort: 3,
    requirements: [{ method: '远程', days: 1 }, { method: '现场', days: 2 }],
    allocations: [{ assetId: 'remote', name: '远程额度', method: '远程', days: 3 }],
  };
  const result = resolveApprovalPreview(mixed, [], users, [], 'd');
  assert.equal(result.requirement, 'required');
  assert.equal(result.defaultApprover.id, 'd');
  mixed.operations.assessment.plans[0].allocations = [
    { assetId: 'remote', name: '远程额度', method: '远程', days: 1 },
    { assetId: 'onsite', name: '现场额度', method: '现场', days: 2 },
  ];
  assert.equal(resolveApprovalPreview(mixed, [], users, [], 'd').requirement, 'not-required');
});
