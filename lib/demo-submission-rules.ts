import { parseCompiledRule, parseRuleDefinition, submissionRulesId } from './submission-rule-schema.ts';
import type { SubmissionRule } from './submission-rule-schema';

export const demoSubmissionRuleId = 'demo-rule-expected-service-three-days';
export const demoSubmissionRulesMarker = 'submission-rule-demo-three-days-v1';

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

export function demoSubmissionRuleReferences(references: { id: string; payload?: unknown }[]) {
  const original = references.find(reference => reference.id === submissionRulesId)?.payload ?? [];
  if (!Array.isArray(original)) throw new Error('校验规则配置损坏，无法初始化演示规则。');
  const demo = buildDemoSubmissionRule();
  // Upgrade only the original date example; preserve administrator edits and
  // its enabled state. The new condition makes this update idempotent.
  const saved = original.map((rule: SubmissionRule) => {
    const active = rule.active;
    const check = active?.compiled?.checks?.[0];
    const versions = [
      { requirement: '禁止提交期望服务日期距今小于3天的申请',
        prompt: '请填写三天后的期望预约时间', mode: 'all',
        conditions: [{ fact: 'expectedLeadDays', operator: 'gte', value: '3' }] },
      { requirement: '期望服务日期可暂不选择；填写时须距今至少3天',
        prompt: '请选择至少三天后的期望服务日期，或清空日期暂不选择。', mode: 'any',
        conditions: [{ fact: 'expectedServiceDate', operator: 'eq', value: '' },
          { fact: 'expectedLeadDays', operator: 'gte', value: '3' }] },
    ];
    const legacy = versions.find(version => rule.requirement === version.requirement &&
      rule.promptText === version.prompt && active?.requirement === version.requirement &&
      active.promptText === version.prompt && check?.mode === version.mode &&
      JSON.stringify(check.conditions) === JSON.stringify(version.conditions));
    if (rule.id !== demoSubmissionRuleId || rule.status !== 'ready' ||
      !legacy || active?.compiled?.checks?.length !== 1) return rule;
    return { ...rule, revision: rule.revision + 1, updatedAt: new Date().toISOString(),
      requirement: demo.requirement, promptText: demo.promptText,
      active: { ...active, requirement: demo.requirement, promptText: demo.promptText,
        summary: demo.active!.summary, compiled: demo.active!.compiled } };
  });
  const upgraded = saved.some((rule, index) => rule !== original[index]);
  if (references.some(reference => reference.id === demoSubmissionRulesMarker)) {
    return upgraded ? [{ id: submissionRulesId, payload: saved }] : [];
  }
  const alreadyExists = saved.some((rule: SubmissionRule) => rule.id === demo.id || (
    rule.requirement === demo.requirement && rule.scope === demo.scope &&
    rule.events.length === demo.events.length && demo.events.every(event => rule.events.includes(event))
  ));
  return [
    ...(!alreadyExists || upgraded ? [{ id: submissionRulesId, payload: alreadyExists ? saved : [...saved, demo] }] : []),
    { id: demoSubmissionRulesMarker, payload: { initializedAt: new Date().toISOString() } },
  ];
}
