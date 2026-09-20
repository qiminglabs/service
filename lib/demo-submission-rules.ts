import { parseCompiledRule,parseRuleDefinition } from './submission-rule-schema.ts';
import type { SubmissionRule } from './submission-rule-schema';

export const demoSubmissionRuleId = 'demo-rule-expected-service-three-days';

// A saved administrator-authored example, using the same data format and editor
// as manually created rules. It is not a mandatory built-in validation rule.
export function buildDemoSubmissionRule(): SubmissionRule {
  const definition = parseRuleDefinition({
    scope: 'all', events: ['submit', 'resubmit'],
    requirement: '期望服务日期须选择具体日期或暂不确定；具体日期须距今至少3天',
    promptText: '请选择至少三天后的期望服务日期，或点击“暂不确定”。',
  });
  return {
    ...definition, id: demoSubmissionRuleId, revision: 1, status: 'ready',
    updatedAt: '2026-09-11T01:21:10+08:00', updatedBy: '陆明',
    active: {
      ...definition, enabled: true,
      summary: '明确选择暂不确定时允许提交；选择具体日期时，距检查当天须至少3个自然日。',
      compiled: parseCompiledRule({ version: 1, checks: [{
        mode: 'any', message: definition.promptText,
        conditions: [
          { fact: 'expectedServiceDateUncertain', operator: 'eq', value: 'true' },
          { fact: 'expectedLeadDays', operator: 'gte', value: '3' },
        ],
      }] }),
    },
  };
}
