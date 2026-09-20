import {
  parseRoutePredicate,
  type RoutePredicate,
  type RoutingDictionary,
} from './assessment-routing-schema.ts';
import type {
  FlowCondition,
  FlowContext,
  ServiceFlowRule,
} from './service-flows';

// One project service item is the evaluation scope; never match across multiple items.
export function parseServiceFlowPredicate(
  value: unknown,
  dictionary?: RoutingDictionary,
): RoutePredicate {
  const compiled = parseRoutePredicate(value, dictionary);
  for (const group of compiled.groups) {
    if (
      group.conditions.some((condition) => condition.field === 'source') ||
      group.items.length > 1 ||
      group.items.some((item) => item.mode !== 'some')
    )
      throw new Error(
        '服务流程条件仅支持当前服务项、服务方式、客户和客户负责团队。',
      );
    const conditions = [
      ...group.conditions,
      ...group.items.flatMap((item) => item.conditions),
    ];
    for (const field of ['customerId', 'customerTeam', 'serviceId', 'method']) {
      const sameField = conditions.filter(
        (condition) => condition.field === field,
      );
      const equal = sameField
        .filter((condition) => condition.operator === 'eq')
        .map((condition) => condition.value);
      if (
        new Set(equal).size > 1 ||
        sameField.some(
          (condition) =>
            condition.operator === 'ne' && equal.includes(condition.value),
        )
      )
        throw new Error('同一组条件互相矛盾，请修改描述后重新测试。');
    }
  }
  return compiled;
}
export function serviceFlowConditionGroups(
  rule: ServiceFlowRule,
): FlowCondition[][] {
  if (!rule.naturalLanguage)
    return rule.match === 'all'
      ? [rule.conditions]
      : rule.conditions.map((condition) => [condition]);
  const { requirement, testedRequirement, compiled } = rule.naturalLanguage;
  if (
    !compiled ||
    !requirement.trim() ||
    testedRequirement !== requirement.trim()
  )
    return [];
  return parseServiceFlowPredicate(compiled).groups.map(
    (group) =>
      [
        ...group.conditions,
        ...group.items.flatMap((item) => item.conditions),
      ] as FlowCondition[],
  );
}
export function serviceFlowConditionTrace(
  rule: ServiceFlowRule,
  context: FlowContext,
) {
  return serviceFlowConditionGroups(rule).map((conditions) =>
    conditions.map((condition) => ({
      ...condition,
      actual: context[condition.field],
      matched:
        !!context[condition.field] &&
        (condition.operator === 'eq'
          ? context[condition.field] === condition.value
          : context[condition.field] !== condition.value),
    })),
  );
}
export function validateServiceFlowLanguage(
  rule: ServiceFlowRule,
  dictionary?: RoutingDictionary,
) {
  if (!rule.naturalLanguage) return;
  const { requirement, testedRequirement, compiled } = rule.naturalLanguage;
  if (
    typeof requirement !== 'string' ||
    !requirement.trim() ||
    requirement.length > 4000 ||
    !compiled ||
    testedRequirement !== requirement.trim()
  )
    throw new Error('请先转译并测试当前自然语言条件，再保存规则。');
  parseServiceFlowPredicate(compiled, dictionary);
}
