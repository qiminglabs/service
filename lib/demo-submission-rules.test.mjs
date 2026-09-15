import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoSubmissionRule, demoSubmissionRuleReferences, demoSubmissionRulesMarker } from './demo-submission-rules.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import { evaluateCondition, ruleFacts, runValidationQueue } from './submission-validation.ts';

test('期望服务日期须明确选择；具体日期仍须提前至少三个自然日', () => {
  const rule = buildDemoSubmissionRule();
  assert.equal(rule.updatedBy, '陆明');
  assert.equal(rule.promptText, '请选择至少三天后的期望服务日期，或点击“暂不确定”。');
  assert.equal(rule.scope, 'all');
  assert.deepEqual(rule.events, ['submit', 'resubmit']);
  assert.equal(rule.status, 'ready');
  assert.equal(rule.active.enabled, true);
  const check = rule.active.compiled.checks[0];
  assert.equal(check.mode, 'any');
  const now = new Date(2026, 8, 11, 23, 59);
  const record = { title: '演示申请', description: '', customerId: 'c1', items: [], createdByAudience: 'internal' };
  const refs = { customers: [], contacts: [], services: [], businessObjects: [] };
  for (const [date, expected] of [['2026-09-13', false], ['2026-09-14', true], ['2026-09-15', true], ['', false], [undefined, false], ['invalid', false], ['2026-02-30', false]]) {
    assert.equal(check.conditions.some(condition => evaluateCondition(condition, ruleFacts({ ...record, expectedServiceDate: date }, refs, now))), expected);
  }
  for (const event of ['submit', 'resubmit']) {
    const failures = runValidationQueue({ ...record, expectedServiceDate: '', expectedServiceDateUncertain: true }, refs, [event], [rule]);
    assert.equal(failures.some(failure => failure.ruleId === rule.id), false);
  }
});

test('初始化只补入一次，保留已有手动录入规则以及修改、停用状态', () => {
  const additions = demoSubmissionRuleReferences([]);
  assert.equal(additions.find(r => r.id === submissionRulesId).payload.length, 1);
  assert.deepEqual(demoSubmissionRuleReferences(additions), []);
  const manuallyCreated = { ...buildDemoSubmissionRule(), id: 'manual-rule', revision: 4 };
  manuallyCreated.active.enabled = false;
  const saved = [{ id: submissionRulesId, payload: [manuallyCreated] }];
  const before = structuredClone(saved);
  assert.deepEqual(demoSubmissionRuleReferences(saved).map(r => r.id), [demoSubmissionRulesMarker]);
  assert.deepEqual(saved, before);
  const custom = { ...manuallyCreated, requirement: '其他规则' };
  const merged = demoSubmissionRuleReferences([{ id: submissionRulesId, payload: [custom] }]);
  assert.deepEqual(merged.find(r => r.id === submissionRulesId).payload[0], custom);
  assert.throws(() => demoSubmissionRuleReferences([{ id: submissionRulesId, payload: {} }]));
});

function legacyRule() {
  const rule = buildDemoSubmissionRule();
  rule.requirement = rule.active.requirement = '禁止提交期望服务日期距今小于3天的申请';
  rule.promptText = rule.active.promptText = '请填写三天后的期望预约时间';
  rule.active.compiled.checks = [{ mode: 'all', message: rule.promptText,
    conditions: [{ fact: 'expectedLeadDays', operator: 'gte', value: '3' }] }];
  return rule;
}

test('已初始化站点升级原始日期规则，保留停用状态，且刷新不重复改写', () => {
  const rule = legacyRule();
  rule.active.enabled = false;
  const original = structuredClone(rule);
  const marker = { id: demoSubmissionRulesMarker, payload: {} };
  const changes = demoSubmissionRuleReferences([marker, { id: submissionRulesId, payload: [rule] }]);
  assert.equal(changes.length, 1);
  const upgraded = changes[0].payload[0];
  assert.equal(upgraded.active.enabled, false);
  assert.equal(upgraded.revision, rule.revision + 1);
  assert.deepEqual(upgraded.active.compiled, buildDemoSubmissionRule().active.compiled);
  assert.deepEqual(rule, original);
  assert.deepEqual(demoSubmissionRuleReferences([marker, ...changes]), []);
});

test('日期规则升级保留管理员自定义规则、编辑内容和已删除状态', () => {
  const custom = { ...legacyRule(), id: 'custom-date-rule' };
  const edited = legacyRule();
  edited.active.compiled.checks[0].conditions[0].value = '7';
  const pending = { ...legacyRule(), status: 'pending' };
  const marker = { id: demoSubmissionRulesMarker, payload: {} };
  for (const rules of [[custom, edited, pending], []]) {
    const refs = [marker, { id: submissionRulesId, payload: rules }];
    const before = structuredClone(refs);
    assert.deepEqual(demoSubmissionRuleReferences(refs), []);
    assert.deepEqual(refs, before);
  }
});

test('升级上一版选填规则为空日期须明确选择暂不确定', () => {
  const rule = legacyRule();
  rule.requirement = rule.active.requirement = '期望服务日期可暂不选择；填写时须距今至少3天';
  rule.promptText = rule.active.promptText = '请选择至少三天后的期望服务日期，或清空日期暂不选择。';
  rule.active.compiled.checks[0] = { mode: 'any', message: rule.promptText,
    conditions: [{ fact: 'expectedServiceDate', operator: 'eq', value: '' },
      { fact: 'expectedLeadDays', operator: 'gte', value: '3' }] };
  const changes = demoSubmissionRuleReferences([{ id: demoSubmissionRulesMarker }, { id: submissionRulesId, payload: [rule] }]);
  assert.deepEqual(changes[0].payload[0].active.compiled, buildDemoSubmissionRule().active.compiled);
});
