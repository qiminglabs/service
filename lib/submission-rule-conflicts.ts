import { factCatalog, parseCompiledRule, parseRuleDefinition, ruleEvents, ruleScopes } from './submission-rule-schema.ts';
import type { CompiledRule, RuleCondition, RuleDefinition, RuleFact, SubmissionRule } from './submission-rule-schema';
import { builtinConflictRules } from './submission-rule-builtins.ts';

type Candidate = Pick<RuleDefinition, 'scope' | 'events' | 'requirement'>;
type ConflictRule = Candidate & { id: string; compiled: CompiledRule };
export type RuleConflict = { context: string; message: string; requirements: string[] };
export type RuleTestResult = { key: string; compiled: CompiledRule; summary: string; conflicts: RuleConflict[] };
export function ruleCompilationKey(rule: Candidate) {
  return JSON.stringify([rule.scope, [...new Set(rule.events)].sort(), rule.requirement.trim()]);
}
export class RuleConflictError extends Error {
  conflicts: RuleConflict[];
  constructor(conflicts: RuleConflict[]) {
    super('存在规则冲突或尚未完成的检查，请处理后重新转译并测试。');
    this.name = 'RuleConflictError'; this.conflicts = conflicts;
  }
}

type Value = string | number | boolean;
function matches(c: RuleCondition, actual: Value) {
  const type = factCatalog[c.fact].type;
  const value = type === 'number' ? Number(c.value) : type === 'boolean' ? c.value === 'true' : c.value;
  switch (c.operator) {
    case 'eq': return actual === value;
    case 'ne': return actual !== value;
    case 'gt': return Number(actual) > Number(value);
    case 'gte': return Number(actual) >= Number(value);
    case 'lt': return Number(actual) < Number(value);
    case 'lte': return Number(actual) <= Number(value);
    case 'contains': return String(actual).includes(c.value);
    case 'not-empty': return !!String(actual).trim();
  }
}
const condition = (fact: RuleFact, operator: RuleCondition['operator'], value: string): RuleCondition => ({ fact, operator, value });
// Implications known from ruleFacts, independent of any particular application.
const implications: RuleCondition[][] = [
  [condition('customerCollaboratorsValid', 'eq', 'false'), condition('customerCount', 'gte', '1')],
  ...(['allItemsDescribed', 'hasBusinessObjects', 'hasOnsiteItem', 'hasRemoteItem', 'completeness'] as const).map(fact => [condition(fact, 'eq', 'false'), condition('itemCount', 'gte', '1')]),
  [condition('completeness', 'eq', 'false'), condition('title', 'not-empty', '')],
  [condition('completeness', 'eq', 'false'), condition('requiredMaterialsComplete', 'eq', 'true')],
  [condition('itemCount', 'ne', '0'), condition('requiredMaterialsComplete', 'eq', 'true')],
];
type Domains = Map<RuleFact, Value[]>;
type Outcome = 'possible' | 'conflict' | 'unknown';
// Finite representatives preserve each supported unary comparison. OR branches
// are explored together, so individually compatible rules can still conflict.
function solve(rules: ConflictRule[], budget: { remaining: number }): Outcome {
  const clauses = [...implications, ...rules.flatMap(rule => rule.compiled.checks.flatMap(check => check.mode === 'all' ? check.conditions.map(c => [c]) : [check.conditions]))];
  const all = clauses.flat();
  if (all.length > 10000) return 'unknown';
  const magnitude = all.filter(c => factCatalog[c.fact].type === 'number').reduce((n, c) => n + Math.abs(Number(c.value)) + 1, 1);
  if (!Number.isFinite(magnitude)) return 'unknown';
  const domains: Domains = new Map();
  for (const fact of Object.keys(factCatalog) as RuleFact[]) {
    const cs = all.filter(c => c.fact === fact), type = factCatalog[fact].type;
    let values: Value[];
    if (type === 'boolean') values = [false, true];
    else if (type === 'number') {
      const points = [...new Set([-magnitude, -1, 0, 1, magnitude, ...cs.map(c => Number(c.value))])].sort((a, b) => a - b);
      values = [...points, ...points.flatMap(n => [n - 1, n + 1, Math.floor(n), Math.ceil(n)]), ...points.slice(1).map((n, i) => points[i] / 2 + n / 2)]
        .filter(n => Number.isFinite(n) && (fact === 'expectedLeadDays' || n >= 0) && (fact === 'assessedDays' || Number.isInteger(n)));
    } else {
      const contains = cs.filter(c => c.operator === 'contains').map(c => c.value).join(' ');
      let witness = contains + ' 示例';
      while (cs.some(c => c.value === witness)) witness += ' 示例';
      values = ['', ' ', witness, ...cs.map(c => c.value)];
    }
    domains.set(fact, [...new Set(values)]);
  }
  const viable = (state: Domains) => {
    if ([...state.values()].some(values => !values.length)) return false;
    const roleMinimum = (['presalesCount', 'engineerCount', 'managerCount', 'salesCount'] as const)
      .reduce((sum, fact) => sum + Math.min(...state.get(fact) as number[]), 0);
    return roleMinimum <= Math.max(...state.get('internalCount') as number[]);
  };
  function search(state: Domains, pending: RuleCondition[][]): Outcome {
    if (--budget.remaining < 0) return 'unknown';
    if (!viable(state)) return 'conflict';
    let remaining = pending;
    while (true) {
      const unresolved: RuleCondition[][] = [];
      for (const clause of remaining) {
        if (--budget.remaining < 0) return 'unknown';
        const options = clause.filter(c => state.get(c.fact)!.some(v => matches(c, v)));
        if (!options.length) return 'conflict';
        if (options.some(c => state.get(c.fact)!.every(v => matches(c, v)))) continue;
        unresolved.push(options);
      }
      if (!unresolved.length) return 'possible';
      const units = unresolved.filter(clause => clause.length === 1);
      if (!units.length) { remaining = unresolved; break; }
      for (const [c] of units) state.set(c.fact, state.get(c.fact)!.filter(v => matches(c, v)));
      if (!viable(state)) return 'conflict';
      remaining = unresolved;
    }
    const smallest = remaining.reduce((a, b) => a.length <= b.length ? a : b);
    for (const c of smallest) {
      const branch = new Map(state);
      branch.set(c.fact, state.get(c.fact)!.filter(v => matches(c, v)));
      const result = search(branch, remaining);
      if (result !== 'conflict') return result;
    }
    return 'conflict';
  }
  return search(domains, clauses);
}

export function testSubmissionRule(definition: Candidate, raw: unknown, summary: string, stored: SubmissionRule[], excludeId?: string): RuleTestResult {
  const compiled = parseCompiledRule(raw);
  if (!summary.trim()) throw new Error('缺少转译说明，请重新转译并测试。');
  const candidate: ConflictRule = { ...definition, id: 'candidate', compiled };
  const conflicts: RuleConflict[] = [];
  const budget = { remaining: 150000 };
  const self = solve([candidate], budget);
  if (self !== 'possible') {
    conflicts.push({ context: '当前规则', message: self === 'conflict' ? '规则自身的条件无法同时满足，或与人数、数量等事实约束矛盾。' : '条件组合过于复杂，无法完成冲突检查，请拆分或简化规则。', requirements: [definition.requirement] });
  } else {
    const peers: ConflictRule[] = [...builtinConflictRules];
    for (const rule of stored) {
      if (rule.id === excludeId || rule.enabled === false || !rule.active?.enabled) continue;
      try { peers.push({ ...parseRuleDefinition(rule.active), id: rule.id, compiled: parseCompiledRule(rule.active.compiled) }); }
      catch { conflicts.push({ context: '已启用规则', message: '现有规则格式损坏，无法完成冲突检查。', requirements: [rule.requirement] }); }
    }
    for (const scope of ['internal', 'customer'] as const) {
      if (definition.scope !== 'all' && definition.scope !== scope) continue;
      for (const event of definition.events) {
        const context = `${ruleScopes[scope]} · ${ruleEvents[event]}`;
        let group = [candidate, ...peers.filter(r => (r.scope === 'all' || r.scope === scope) && r.events.includes(event))];
        const outcome = solve(group, budget);
        if (outcome === 'possible') continue;
        if (outcome === 'unknown') {
          conflicts.push({ context, message: '条件组合过于复杂，检查未完成，暂不能保存。请简化规则后重试。', requirements: [] });
          continue;
        }
        // Reduce the explanation to an unsatisfiable group; never claim every
        // pair conflicts. Stop reducing when the shared work budget is exhausted.
        for (const member of [...group]) {
          if (budget.remaining <= 0) break;
          const reduced = group.filter(r => r !== member);
          if (solve(reduced, budget) === 'conflict') group = reduced;
        }
        conflicts.push({ context, message: '以下规则的执行条件无法同时满足。', requirements: group.map(r => `${r.id === 'candidate' ? '当前规则：' : r.id.startsWith('builtin-') ? '系统预置：' : '已有规则：'}${r.requirement}`) });
      }
    }
  }
  return { key: ruleCompilationKey(definition), compiled, summary: summary.trim(), conflicts };
}
