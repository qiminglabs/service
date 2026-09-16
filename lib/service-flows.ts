import {
  parseServiceFlowSteps,
  type ServiceFlowStep,
} from './service-flow-steps.ts';
export type { ServiceFlowStep } from './service-flow-steps';
export const serviceFlowConfigId = 'service-flow-config-v1';
export const flowConditionFields = {
  serviceId: '服务项',
  method: '服务方式',
  customerId: '客户',
  customerTeam: '客户负责团队',
} as const;
export type FlowConditionField = keyof typeof flowConditionFields;
export type ServiceFlow = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  steps: ServiceFlowStep[];
};
export type FlowCondition = {
  field: FlowConditionField;
  operator: 'eq' | 'ne';
  value: string;
};
export type ServiceFlowRule = {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  match: 'all' | 'any';
  conditions: FlowCondition[];
  flowId: string;
};
export type ServiceFlowAssignment = {
  defaultFlowId: string;
  rules: ServiceFlowRule[];
};
export type ServiceFlowConfig = {
  version: 1;
  revision: number;
  flows: ServiceFlow[];
  assignment: ServiceFlowAssignment;
  updatedAt?: string;
  updatedBy?: string;
};
export type FlowContext = Record<FlowConditionField, string>;
export type FlowDictionary = {
  services: { id: string; name: string }[];
  customers: { id: string; name: string; team?: string }[];
};
export const emptyServiceFlowConfig = (): ServiceFlowConfig => ({
  version: 1,
  revision: 0,
  flows: [],
  assignment: { defaultFlowId: '', rules: [] },
});
export const sortedFlowRules = (rules: ServiceFlowRule[]) =>
  [...rules].sort(
    (a, b) => a.priority - b.priority || a.id.localeCompare(b.id),
  );

// Validate saved configuration too: damaged records must never silently become defaults.
export function parseServiceFlowConfig(value: unknown): ServiceFlowConfig {
  if (value === undefined) return emptyServiceFlowConfig();
  const config = structuredClone(value) as ServiceFlowConfig;
  const fail = (message: string): never => {
    throw new Error(message);
  };
  const text = (value: unknown, max = 4000) =>
    typeof value === 'string' && value.length <= max;
  const required = (value: unknown, max = 120) =>
    text(value, max) && !!(value as string).trim();
  const unique = (rows: { id: string }[]) =>
    rows.every((row) => row && required(row.id)) &&
    new Set(rows.map((row) => row.id)).size === rows.length;
  if (
    !config ||
    config.version !== 1 ||
    !Number.isInteger(config.revision) ||
    config.revision < 0 ||
    !Array.isArray(config.flows) ||
    !config.assignment ||
    !Array.isArray(config.assignment.rules)
  )
    fail('服务流程配置格式无效。');
  if (!unique(config.flows) || !unique(config.assignment.rules))
    fail('流程或规则标识重复或无效。');
  const names = new Set<string>();
  for (const flow of config.flows) {
    if (
      !required(flow.name) ||
      !text(flow.description) ||
      typeof flow.enabled !== 'boolean'
    )
      fail('请填写流程名称和有效的基本信息。');
    flow.name = flow.name.trim();
    if (names.has(flow.name)) fail('流程名称已存在，请使用其他名称。');
    names.add(flow.name);
    flow.steps = parseServiceFlowSteps(flow.steps);
  }
  const active = (id: string) =>
    config.flows.some((flow) => flow.id === id && flow.enabled);
  if (
    !text(config.assignment.defaultFlowId, 120) ||
    (config.assignment.defaultFlowId &&
      !active(config.assignment.defaultFlowId))
  )
    fail('默认流程不存在或已停用，请先调整默认服务流程。');
  const priorities = new Set<number>();
  for (const rule of config.assignment.rules) {
    if (
      !required(rule.name) ||
      typeof rule.enabled !== 'boolean' ||
      !['all', 'any'].includes(rule.match) ||
      !Number.isInteger(rule.priority) ||
      rule.priority < 1 ||
      rule.priority > 9999
    )
      fail('请填写规则名称，优先级须为 1–9999 的整数。');
    if (priorities.has(rule.priority)) fail('规则优先级重复，请使用其他数字。');
    priorities.add(rule.priority);
    rule.name = rule.name.trim();
    if (!config.flows.some((flow) => flow.id === rule.flowId))
      fail('规则引用的流程不存在，请先调整或删除相关规则。');
    if (rule.enabled && !active(rule.flowId))
      fail('启用的规则不能分配停用流程，请先调整相关规则。');
    if (
      !Array.isArray(rule.conditions) ||
      !rule.conditions.length ||
      rule.conditions.length > 20
    )
      fail('每条规则需配置 1–20 个条件。');
    for (const condition of rule.conditions) {
      if (
        !condition ||
        !Object.hasOwn(flowConditionFields, condition.field) ||
        !['eq', 'ne'].includes(condition.operator) ||
        !required(condition.value, 150)
      )
        fail('请完整配置条件的字段、比较方式和值。');
      if (
        condition.field === 'method' &&
        !['现场', '远程'].includes(condition.value)
      )
        fail('服务方式须为现场或远程。');
      if (
        condition.field === 'customerTeam' &&
        !['金融', '商业', '港澳', '其他'].includes(condition.value)
      )
        fail('客户负责团队取值无效。');
    }
  }
  config.assignment.rules = sortedFlowRules(config.assignment.rules);
  return config;
}

export function flowConditionMatches(
  condition: FlowCondition,
  context: FlowContext,
) {
  const actual = context[condition.field];
  // Unknown data does not satisfy either equality or inequality.
  return (
    !!actual &&
    (condition.operator === 'eq'
      ? actual === condition.value
      : actual !== condition.value)
  );
}
export function resolveServiceFlow(
  config: ServiceFlowConfig,
  context: FlowContext,
) {
  const trace = sortedFlowRules(config.assignment.rules).map((rule) => {
    const conditions = rule.conditions.map((condition) => ({
      ...condition,
      actual: context[condition.field],
      matched: flowConditionMatches(condition, context),
    }));
    const available = config.flows.some(
      (flow) => flow.id === rule.flowId && flow.enabled,
    );
    const matched =
      rule.enabled &&
      available &&
      conditions.length > 0 &&
      (rule.match === 'all'
        ? conditions.every((row) => row.matched)
        : conditions.some((row) => row.matched));
    return { rule, conditions, available, matched };
  });
  const selected = trace.find((row) => row.matched);
  const flowId = selected?.rule.flowId ?? config.assignment.defaultFlowId;
  const flow = config.flows.find((row) => row.id === flowId && row.enabled);
  return {
    flow,
    steps: flow
      ? parseServiceFlowSteps(flow.steps).filter((step) => step.enabled)
      : [],
    rule: selected?.rule,
    source: selected
      ? ('rule' as const)
      : flow
        ? ('default' as const)
        : ('unassigned' as const),
    trace,
  };
}

export function flowConditionLabel(
  condition: FlowCondition,
  dictionary: FlowDictionary,
) {
  const options =
    condition.field === 'serviceId'
      ? dictionary.services
      : condition.field === 'customerId'
        ? dictionary.customers
        : [];
  const value =
    options.find((row) => row.id === condition.value)?.name ?? condition.value;
  return `${flowConditionFields[condition.field]}${condition.operator === 'eq' ? '等于' : '不等于'}「${value}」`;
}
