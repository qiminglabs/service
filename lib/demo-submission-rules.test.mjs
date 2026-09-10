import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDemoSubmissionRule, demoSubmissionRuleReferences, demoSubmissionRulesMarker } from './demo-submission-rules.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import { evaluateCondition, ruleFacts } from './submission-validation.ts';

test('演示规则为可维护的管理员规则，文案和执行条件对应截图', () => {
  const rule = buildDemoSubmissionRule();
  assert.equal(rule.updatedBy, '陆明');
  assert.equal(rule.promptText, '请填写三天后的期望预约时间');
  assert.equal(rule.scope, 'all');
  assert.deepEqual(rule.events, ['submit', 'resubmit']);
  assert.equal(rule.status, 'ready');
  assert.equal(rule.active.enabled, true);
  const condition = rule.active.compiled.checks[0].conditions[0];
  const now = new Date(2026, 8, 11, 23, 59);
  const record = { title: '演示申请', description: '', customerId: 'c1', items: [], createdByAudience: 'internal' };
  const refs = { customers: [], contacts: [], services: [], businessObjects: [] };
  for (const [date, expected] of [['2026-09-13', false], ['2026-09-14', true], ['2026-09-15', true], ['', false]]) {
    assert.equal(evaluateCondition(condition, ruleFacts({ ...record, expectedServiceDate: date }, refs, now)), expected);
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
