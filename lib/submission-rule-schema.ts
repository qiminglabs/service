// Versioned data language shared by the compiler and the deterministic queue.
export const ruleEvents = {
  submit: '提交申请', resubmit: '退回后重新提交',
  'assessment-pass': '材料评估通过', 'effort-confirm': '完成人天核定',
  'plan-confirm': '完成服务依据关联', 'request-confirmation': '发起客户确认',
  'customer-accept': '客户确认通过',
} as const;
export const ruleScopes = { all: '全部', internal: '内部申请', customer: '客户申请' } as const;
export type RuleEvent = keyof typeof ruleEvents;
export const submissionCheckEvents: readonly RuleEvent[] = ['submit', 'resubmit'];
export type RuleScope = keyof typeof ruleScopes;
export const factCatalog = {
  title: { type: 'string', label: '申请主题' },
  description: { type: 'string', label: '申请说明' },
  expectedServiceDate: { type: 'string', label: '期望服务日期（YYYY-MM-DD）' },
  expectedServiceDateUncertain: { type: 'boolean', label: '已明确选择期望服务日期暂不确定，且未指定具体日期' },
  expectedLeadDays: { type: 'number', label: '期望服务日期距检查当天的自然天数；未填或无效时不通过数值比较' },
  customerName: { type: 'string', label: '客户名称' },
  itemCount: { type: 'number', label: '申请项数量' },
  internalCount: { type: 'number', label: '已启用的内部协作人数（去重）' },
  customerCount: { type: 'number', label: '当前客户已启用的客户协作人数（去重）' },
  presalesCount: { type: 'number', label: '已启用的 SmartX 售前工程师内部协作人数' },
  engineerCount: { type: 'number', label: '已启用的 SmartX 服务工程师内部协作人数' },
  managerCount: { type: 'number', label: '已启用的 SmartX 项目经理内部协作人数' },
  salesCount: { type: 'number', label: '已启用的 SmartX 销售经理内部协作人数' },
  isApplicant: { type: 'boolean', label: '操作人是否为申请创建人' },
  applicantPresent: { type: 'boolean', label: '申请人是否保留在协作人中' },
  customerCollaboratorsValid: { type: 'boolean', label: '至少一个客户协作人且全部属于当前客户并已启用' },
  allItemsDescribed: { type: 'boolean', label: '每个申请项均填写需求说明（无申请项为否）' },
  hasOnsiteItem: { type: 'boolean', label: '是否包含现场服务申请项' },
  hasRemoteItem: { type: 'boolean', label: '是否包含远程服务申请项' },
  hasBusinessObjects: { type: 'boolean', label: '每个申请项都关联了业务对象（无申请项为否）' },
  requiredMaterialsComplete: { type: 'boolean', label: '按当前申请类型（技术评估或服务交付）检查必传材料已上传；遵循该申请的材料可见范围，共用材料只需上传一次' },
  completeness: { type: 'boolean', label: '基本信息、申请项字段、当前申请类型的必传材料、客户及引用资料通过齐套检查' },
  managerAssigned: { type: 'boolean', label: '当前评估项目经理已分配且为启用的项目经理' },
  assessedDays: { type: 'number', label: '已核定计价总人天；未核定时不通过数值比较' },
} as const;
export type RuleFact = keyof typeof factCatalog;
export const ruleOperators = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not-empty'] as const;
export type RuleCondition = { fact: RuleFact; operator: typeof ruleOperators[number]; value: string };
export type RuleCheck = { mode: 'all' | 'any'; conditions: RuleCondition[]; message: string };
export type CompiledRule = { version: 1; checks: RuleCheck[] };
export type RuleDefinition = { scope: RuleScope; events: RuleEvent[]; requirement: string; promptText: string };
export type SubmissionRule = RuleDefinition & {
  id: string; revision: number; updatedAt: string; updatedBy: string;
  status: 'pending' | 'error' | 'ready'; error?: string;
  enabled?: boolean; version?: number; disabledAt?: string; disabledBy?: string;
  history?: Array<Omit<SubmissionRule, 'history'> & { archivedAt: string; archivedBy: string }>;
  active?: RuleDefinition & { compiled: CompiledRule; enabled: boolean; summary: string };
};
export const submissionRulesId = 'submission-validation-rules-v1';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('规则格式无效。');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error('规则包含不支持的字段。');
}
export function parseRuleDefinition(value: unknown): RuleDefinition {
  const data = object(value);
  if (typeof data.scope !== 'string' || !Object.hasOwn(ruleScopes, data.scope)) throw new Error('请选择适用申请。');
  if (!Array.isArray(data.events) || !data.events.length || data.events.length > Object.keys(ruleEvents).length || data.events.some(event => typeof event !== 'string' || !Object.hasOwn(ruleEvents, event))) throw new Error('请至少选择一个有效的检查时机。');
  if (typeof data.requirement !== 'string' || !data.requirement.trim() || data.requirement.length > 2000) throw new Error('请输入 1–2000 字的检验要求。');
  if (typeof data.promptText !== 'string' || !data.promptText.trim() || data.promptText.length > 4000) throw new Error('请输入 1–4000 字的提示文本。');
  return { scope: data.scope as RuleScope, events: [...new Set(data.events)] as RuleEvent[], requirement: data.requirement.trim(), promptText: data.promptText.trim() };
}
export function parseSubmissionRuleDefinition(value: unknown): RuleDefinition {
  return parseRuleDefinition({ ...object(value), events: [...submissionCheckEvents] });
}
// Read the current rule schema without upgrading retired fields or events.
export function normalizeStoredSubmissionRule(value: unknown): SubmissionRule {
  const rule = object(value);
  const definition = (data: Record<string, unknown>) => parseRuleDefinition({ scope: data.scope, events: data.events, requirement: data.requirement, promptText: data.promptText });
  const current = { ...structuredClone(rule), ...definition(rule) };
  if (!rule.active) return current as SubmissionRule;
  const active = object(rule.active);
  return { ...current, active: { ...structuredClone(active), ...definition(active), compiled: parseCompiledRule(active.compiled) } } as SubmissionRule;
}
export function parseCompiledRule(value: unknown): CompiledRule {
  const data = object(value); exact(data, ['version', 'checks']);
  if (data.version !== 1 || !Array.isArray(data.checks) || !data.checks.length || data.checks.length > 12) throw new Error('规则必须包含 1–12 个有效检查。');
  const checks = data.checks.map(raw => {
    const check = object(raw); exact(check, ['mode', 'conditions', 'message']);
    if (!['all', 'any'].includes(String(check.mode)) || !Array.isArray(check.conditions) || !check.conditions.length || check.conditions.length > 12 || typeof check.message !== 'string' || !check.message.trim() || check.message.length > 300) throw new Error('检查条件或失败提示无效。');
    const conditions = check.conditions.map(rawCondition => {
      const c = object(rawCondition); exact(c, ['fact', 'operator', 'value']);
      if (typeof c.fact !== 'string' || !Object.hasOwn(factCatalog, c.fact) || !ruleOperators.includes(c.operator as RuleCondition['operator']) || typeof c.value !== 'string' || c.value.length > 300) throw new Error('包含无法执行的条件。');
      const type = factCatalog[c.fact as RuleFact].type;
      const ops = type === 'number' ? ['eq', 'ne', 'gt', 'gte', 'lt', 'lte'] : type === 'boolean' ? ['eq', 'ne'] : ['eq', 'ne', 'contains', 'not-empty'];
      if (!ops.includes(String(c.operator)) || (type === 'number' && (!c.value.trim() || !Number.isFinite(Number(c.value)))) || (type === 'boolean' && !['true', 'false'].includes(c.value)) || (c.operator === 'contains' && !c.value.trim()) || (c.operator === 'not-empty' && c.value !== '')) throw new Error('条件类型与比较值不匹配。');
      return { fact: c.fact, operator: c.operator, value: c.value } as RuleCondition;
    });
    return { mode: check.mode, message: check.message.trim(), conditions } as RuleCheck;
  });
  return { version: 1, checks };
}
export const compiledRuleSchema = {
  type: 'object', additionalProperties: false, required: ['supported', 'explanation', 'checks'],
  properties: {
    supported: { type: 'boolean' }, explanation: { type: 'string' },
    checks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['mode', 'message', 'conditions'], properties: {
      mode: { type: 'string', enum: ['all', 'any'] }, message: { type: 'string' },
      conditions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['fact', 'operator', 'value'], properties: {
        fact: { type: 'string', enum: Object.keys(factCatalog) }, operator: { type: 'string', enum: ruleOperators }, value: { type: 'string' },
      } } },
    } } },
  },
};
