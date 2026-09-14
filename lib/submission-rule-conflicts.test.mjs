import test from 'node:test';
import assert from 'node:assert/strict';
import { testSubmissionRule, ruleCompilationKey } from './submission-rule-conflicts.ts';
const def = { scope: 'all', events: ['effort-confirm'], requirement: '当前规则', promptText: '请修改申请' };
const c = (fact, operator, value) => ({ fact, operator, value: String(value) });
const compiled = (conditions, mode = 'all') => ({ version: 1, checks: [{ mode, conditions, message: '提示' }] });
const peer = (id, conditions, changes = {}, mode = 'all') => {
  const definition = { ...def, requirement: id, ...changes };
  return { ...definition, id, revision: 1, status: 'ready', active: { ...definition, enabled: true, compiled: compiled(conditions, mode), summary: id } };
};
const check = (conditions, rules = [], definition = def, mode = 'all', excludeId) => testSubmissionRule(definition, compiled(conditions, mode), '执行条件', rules, excludeId).conflicts;

test('数值边界冲突、整数域和更严格但兼容的日期限制', () => {
  const min = peer('至少3天', [c('expectedLeadDays', 'gte', 3)]);
  assert.ok(check([c('expectedLeadDays', 'lt', 3)], [min]).length);
  assert.equal(check([c('expectedLeadDays', 'gte', 5)], [min]).length, 0);
  assert.equal(check([c('expectedLeadDays', 'lte', 3)], [min]).length, 0);
  assert.ok(check([c('itemCount', 'gt', 1), c('itemCount', 'lt', 2)]).length);
  assert.ok(check([c('itemCount', 'lt', 0)]).length);
  assert.equal(check([c('assessedDays', 'gt', 1), c('assessedDays', 'lt', 2)]).length, 0);
});

test('布尔、文本包含和非空比较，以及人数之间的必然关系', () => {
  assert.ok(check([c('description', 'eq', ''), c('description', 'not-empty', '')]).length);
  assert.ok(check([c('description', 'eq', '甲'), c('description', 'contains', '乙')]).length);
  assert.equal(check([c('description', 'contains', '甲'), c('description', 'contains', '乙')]).length, 0);
  assert.ok(check([c('internalCount', 'lte', 1), c('engineerCount', 'gte', 2)]).length);
  assert.ok(check([c('internalCount', 'eq', 2), c('engineerCount', 'gte', 2), c('managerCount', 'gte', 1)]).length);
  assert.ok(check([c('hasOnsiteItem', 'eq', true), c('itemCount', 'eq', 0)]).length);
});

test('仅比较重叠范围和时机的启用版本，编辑排除自身旧版', () => {
  const p = peer('已有规则', [c('expectedLeadDays', 'gte', 3)]);
  const conditions = [c('expectedLeadDays', 'lt', 3)];
  assert.equal(check(conditions, [{ ...p, active: { ...p.active, enabled: false } }]).length, 0);
  assert.equal(check(conditions, [{ ...p, active: { ...p.active, events: ['submit'] } }]).length, 0);
  assert.equal(check(conditions, [{ ...p, active: { ...p.active, scope: 'customer' } }], { ...def, scope: 'internal' }).length, 0);
  assert.ok(check(conditions, [{ ...p, status: 'error', scope: 'customer', active: { ...p.active, scope: 'internal' } }], { ...def, scope: 'internal' }).length);
  assert.equal(check(conditions, [p], def, 'all', p.id).length, 0);
});

test('系统预置规则参与检查，全范围按内部和客户申请分别检验', () => {
  assert.ok(check([c('isApplicant', 'eq', false)], [], { ...def, events: ['submit'] }).some(issue => issue.requirements.some(r => r.startsWith('系统预置：'))));
  const conflicts = check([c('presalesCount', 'eq', 0)], [], { ...def, events: ['submit'] });
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].context, /内部申请/);
  assert.ok(check([c('requiredMaterialsComplete', 'eq', false)], [], { ...def, events: ['submit'] }).length);
  assert.ok(check([c('customerCount', 'eq', 0)], [], { ...def, events: ['request-confirmation'] }).length);
});

test('OR 分支和三条规则联合矛盾，不把条件分支或重复规则误报为冲突', () => {
  const a = c('hasOnsiteItem', 'eq', true), b = c('hasRemoteItem', 'eq', true);
  const notA = peer('不能现场', [c('hasOnsiteItem', 'eq', false)]);
  const notB = peer('不能远程', [c('hasRemoteItem', 'eq', false)]);
  assert.equal(check([a, b], [notA], def, 'any').length, 0);
  assert.equal(check([a, b], [notB], def, 'any').length, 0);
  const issues = check([a, b], [notA, notB], def, 'any');
  assert.ok(issues.length);
  assert.equal(issues[0].requirements.length, 3);
  assert.equal(check([a], [peer('也必须现场', [a])]).length, 0);
});

test('测试无写入；提示文本不影响转译，检验要求、范围、时机会使结果失效', () => {
  const records = [peer('三天', [c('expectedLeadDays', 'gte', 3)])], before = structuredClone(records);
  check([c('description', 'not-empty', '')], records);
  assert.deepEqual(records, before);
  assert.equal(ruleCompilationKey(def), ruleCompilationKey({ ...def, promptText: '另一个提示' }));
  for (const change of [{ requirement: '新要求' }, { scope: 'internal' }, { events: ['submit'] }]) assert.notEqual(ruleCompilationKey(def), ruleCompilationKey({ ...def, ...change }));
});
