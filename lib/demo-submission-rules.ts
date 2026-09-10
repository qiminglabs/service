import { parseCompiledRule, parseRuleDefinition, submissionRulesId } from './submission-rule-schema.ts';
import type { SubmissionRule } from './submission-rule-schema';

export const demoSubmissionRuleId = 'demo-rule-expected-service-three-days';
export const demoSubmissionRulesMarker = 'submission-rule-demo-three-days-v1';

// A saved administrator-authored example, using the same data format and editor
// as manually created rules. It is not a mandatory built-in validation rule.
export function buildDemoSubmissionRule(): SubmissionRule {
  const definition = parseRuleDefinition({
    scope: 'all', events: ['submit', 'resubmit'],
    requirement: '禁止提交期望服务日期距今小于3天的申请',
    promptText: '请填写三天后的期望预约时间',
  });
  return {
    ...definition, id: demoSubmissionRuleId, revision: 1, status: 'ready',
    updatedAt: '2026-09-11T01:21:10+08:00', updatedBy: '陆明',
    active: {
      ...definition, enabled: true,
      summary: '仅当期望服务日期距检查当天的自然天数大于或等于3天时允许提交。',
      compiled: parseCompiledRule({ version: 1, checks: [{
        mode: 'all', message: definition.promptText,
        conditions: [{ fact: 'expectedLeadDays', operator: 'gte', value: '3' }],
      }] }),
    },
  };
}

export function demoSubmissionRuleReferences(references: { id: string; payload?: unknown }[]) {
  if (references.some(reference => reference.id === demoSubmissionRulesMarker)) return [];
  const saved = references.find(reference => reference.id === submissionRulesId)?.payload ?? [];
  if (!Array.isArray(saved)) throw new Error('校验规则配置损坏，无法初始化演示规则。');
  const demo = buildDemoSubmissionRule();
  const alreadyExists = saved.some((rule: SubmissionRule) => rule.id === demo.id || (
    rule.requirement === demo.requirement && rule.scope === demo.scope &&
    rule.events.length === demo.events.length && demo.events.every(event => rule.events.includes(event))
  ));
  return [
    ...(!alreadyExists ? [{ id: submissionRulesId, payload: [...saved, demo] }] : []),
    { id: demoSubmissionRulesMarker, payload: { initializedAt: new Date().toISOString() } },
  ];
}
