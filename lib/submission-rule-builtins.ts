import type { RuleDefinition, CompiledRule, RuleCondition } from './submission-rule-schema';
export const builtinSubmissionRules: (RuleDefinition & { id: string })[] = [
  { id: 'builtin-applicant', scope: 'all', events: ['submit', 'resubmit'], requirement: '仅申请创建人可以提交，申请人必须保留在协作人中。', promptText: '请由申请创建人提交，并保留申请人在协作人中。' },
  { id: 'builtin-presales', scope: 'internal', events: ['submit', 'resubmit'], requirement: '内部协作人至少包含一位已启用的 SmartX 售前工程师。', promptText: '内部申请提交前，请至少添加一位已启用的 SmartX 售前工程师为内部协作人。' },
  { id: 'builtin-customer', scope: 'all', events: ['submit', 'resubmit'], requirement: '至少一位客户协作人；所有客户协作人须为当前客户已启用的联系人。', promptText: '请至少添加一位客户协作人，并确保全部为当前客户已启用的联系人。' },
  { id: 'builtin-completeness', scope: 'all', events: ['submit', 'resubmit'], requirement: '基本信息、申请项及当前申请类型要求必传的材料通过齐套检验，关联资料有效。', promptText: '请按具体缺项补全信息及当前申请类型的必传材料。' },
];
// Necessary conditions of the built-in queue; the queue retains its detailed messages.
const conditions: Record<string, RuleCondition[]> = {
  'builtin-applicant': [{ fact: 'isApplicant', operator: 'eq', value: 'true' }, { fact: 'applicantPresent', operator: 'eq', value: 'true' }],
  'builtin-presales': [{ fact: 'presalesCount', operator: 'gte', value: '1' }],
  'builtin-customer': [{ fact: 'customerCollaboratorsValid', operator: 'eq', value: 'true' }],
  'builtin-completeness': [{ fact: 'completeness', operator: 'eq', value: 'true' }],
};
export const builtinConflictRules = builtinSubmissionRules.map(rule => ({ ...rule, compiled: { version: 1, checks: [{ mode: 'all', conditions: conditions[rule.id], message: rule.promptText }] } as CompiledRule }));
