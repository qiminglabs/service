import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoSubmissionRule } from './demo-submission-rules.ts';
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

function legacyRule() {
  const rule = buildDemoSubmissionRule();
  rule.requirement = rule.active.requirement = '禁止提交期望服务日期距今小于3天的申请';
  rule.promptText = rule.active.promptText = '请填写三天后的期望预约时间';
  rule.active.compiled.checks = [{ mode: 'all', message: rule.promptText,
    conditions: [{ fact: 'expectedLeadDays', operator: 'gte', value: '3' }] }];
  return rule;
}
