import type { ReportTemplate } from './report-templates';
import {
  withFlowReportTemplates,
  validateFlowReportTemplates,
} from './flow-report-templates.ts';
import {
  validateServiceFlowPhases,
  type ServiceFlowPhase,
} from './service-flow-phases.ts';
import {
  serviceFlowConditionTrace,
  validateServiceFlowLanguage,
} from './service-flow-conditions.ts';
import type { RoutePredicate } from './assessment-routing-schema';
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
  phases?: ServiceFlowPhase[];
  reportTemplates?: ReportTemplate[];
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
  serviceScope?: { mode: 'all' | 'selected'; serviceIds: string[] };
  naturalLanguage?: {
    requirement: string;
    testedRequirement?: string;
    compiled?: RoutePredicate;
  };
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
  history?: ServiceFlowHistory[];
};
export type ServiceFlowHistory = {
  id: string;
  kind: 'rule' | 'default';
  name: string;
  rule?: ServiceFlowRule;
  flow: ServiceFlow;
  revision: number;
  reason: string;
  disabledAt?: string;
  disabledBy?: string;
};
export type FlowContext = Record<FlowConditionField, string>;
export type FlowDictionary = {
  workOrderFields?: import('../components/request-field-settings').RequestField[];
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

export function validateServiceFlowScope(
  rule: ServiceFlowRule,
  dictionary?: FlowDictionary,
) {
  const scope = rule.serviceScope;
  if (scope === undefined) return; // Existing rules retain their original unrestricted scope.
  if (
    !scope ||
    !['all', 'selected'].includes(scope.mode) ||
    !Array.isArray(scope.serviceIds) ||
    scope.serviceIds.some(
      (id) => typeof id !== 'string' || !id.trim() || id.length > 150,
    ) ||
    new Set(scope.serviceIds).size !== scope.serviceIds.length
  )
    throw new Error('适用服务目录配置无效，请重新选择。');
  if (scope.mode === 'all' && scope.serviceIds.length)
    throw new Error('全部服务目录不能同时指定目录。');
  if (scope.mode === 'selected' && !scope.serviceIds.length)
    throw new Error('请至少选择一个适用服务目录。');
  if (
    dictionary &&
    scope.serviceIds.some(
      (id) => !dictionary.services.some((service) => service.id === id),
    )
  )
    throw new Error('所选服务目录已不存在，请重新选择。');
}
export function serviceFlowScopeMatches(
  rule: ServiceFlowRule,
  serviceId: string,
) {
  return (
    rule.serviceScope === undefined ||
    rule.serviceScope.mode === 'all' ||
    (!!serviceId && rule.serviceScope.serviceIds.includes(serviceId))
  );
}
export function serviceFlowScopeLabel(
  rule: ServiceFlowRule,
  dictionary: FlowDictionary,
) {
  if (!rule.serviceScope || rule.serviceScope.mode === 'all')
    return '全部服务目录';
  return (
    rule.serviceScope.serviceIds
      .map(
        (id) =>
          dictionary.services.find((service) => service.id === id)?.name ??
          `${id}（已不存在）`,
      )
      .join('、') || '尚未选择服务目录'
  );
}

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
  if (config.history !== undefined) {
    if (!Array.isArray(config.history) || !unique(config.history))
      fail('服务流程历史记录格式无效。');
    for (const entry of config.history) {
      if (
        !['rule', 'default'].includes(entry.kind) ||
        !required(entry.name) ||
        !entry.flow ||
        !required(entry.flow.id) ||
        !required(entry.flow.name) ||
        !Number.isInteger(entry.revision) ||
        entry.revision < 0 ||
        !required(entry.reason) ||
        (entry.kind === 'rule' && !entry.rule?.id)
      )
        fail('服务流程历史记录格式无效。');
      entry.flow.steps = parseServiceFlowSteps(entry.flow.steps);
      validateServiceFlowPhases(entry.flow);
    }
  }
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
    Object.assign(flow, withFlowReportTemplates(flow));
    validateFlowReportTemplates(flow);
    validateServiceFlowPhases(flow);
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
    validateServiceFlowScope(rule);
    if (
      !required(rule.name) ||
      typeof rule.enabled !== 'boolean' ||
      !['all', 'any'].includes(rule.match) ||
      !Number.isInteger(rule.priority) ||
      rule.priority < 1 ||
      rule.priority > 9999
    )
      fail('请填写规则名称，优先级须为 1–9999 的整数。');
    if (rule.enabled && priorities.has(rule.priority))
      fail('规则优先级重复，请使用其他数字。');
    if (rule.enabled) priorities.add(rule.priority);
    rule.name = rule.name.trim();
    if (!config.flows.some((flow) => flow.id === rule.flowId))
      fail('规则引用的流程不存在，请先调整或删除相关规则。');
    if (rule.enabled && !active(rule.flowId))
      fail('启用的规则不能分配停用流程，请先调整相关规则。');
    if (rule.naturalLanguage) {
      validateServiceFlowLanguage(rule);
      continue;
    }
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
export function resolveServiceFlow(
  config: ServiceFlowConfig,
  context: FlowContext,
) {
  const trace = sortedFlowRules(config.assignment.rules).map((rule) => {
    const groups = serviceFlowConditionTrace(rule, context);
    const conditions = groups.flat();
    const available = config.flows.some(
      (flow) => flow.id === rule.flowId && flow.enabled,
    );
    const scopeMatched = serviceFlowScopeMatches(rule, context.serviceId);
    const matched =
      rule.enabled &&
      available &&
      scopeMatched &&
      groups.some(
        (group) =>
          group.length > 0 && group.every((condition) => condition.matched),
      );
    return { rule, conditions, groups, available, scopeMatched, matched };
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
