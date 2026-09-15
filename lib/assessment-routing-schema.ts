import {
  defaultHardwareAssessmentTrigger,
  parseHardwareAssessmentTrigger,
  type HardwareAssessmentTrigger,
} from './hardware-assessment-trigger.ts';
import { responsibleTeams } from './customer-teams.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import { requestAudience } from './request-collaboration.ts';

export const assessmentRoutingId = 'assessment-routing-v1';
export const routingRoles = {
  manager: '项目经理分配',
  hardware: '硬件产品经理分配',
} as const;
export type RoutingRole = keyof typeof routingRoles;
export const roleIdentity = {
  manager: 'SmartX 项目经理',
  hardware: 'SmartX 硬件产品经理',
} as const;
export type RoutingDictionary = {
  customers: { id: string; name: string; team?: string }[];
  services: { id: string; name: string }[];
};
export type RouteCondition = {
  field: 'customerId' | 'customerTeam' | 'source' | 'serviceId' | 'method';
  operator: 'eq' | 'ne';
  value: string;
};
export type RouteGroup = {
  conditions: RouteCondition[];
  items: { mode: 'some' | 'none'; conditions: RouteCondition[] }[];
};
export type RoutePredicate = { version: 1; groups: RouteGroup[] };
export type RoutingRule = {
  id: string;
  requirement: string;
  priority: number;
  userId: string;
  enabled: boolean;
  compiled: RoutePredicate;
  updatedAt?: string;
  updatedBy?: string;
};
export type RoutingPolicy = {
  defaultUserId: string;
  rules: RoutingRule[];
  trigger?: HardwareAssessmentTrigger;
};
export type RoutingConfig = {
  version: 1;
  revision: number;
  updatedAt?: string;
  updatedBy?: string;
  manager: RoutingPolicy;
  hardware: RoutingPolicy;
};
export const emptyRoutingConfig = (): RoutingConfig => ({
  version: 1,
  revision: 0,
  manager: { defaultUserId: '', rules: [] },
  hardware: {
    defaultUserId: '',
    rules: [],
    trigger: defaultHardwareAssessmentTrigger(),
  },
});
export const routingUsers = (users: InternalUser[], role: RoutingRole) =>
  users.filter(
    (user) =>
      user.status === '启用' &&
      fixedIdentityRoles[user.id] === roleIdentity[role],
  );
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw new Error('分配规则格式无效。');
  return v as Record<string, unknown>;
};
function exact(value: Record<string, unknown>, keys: string[]) {
  if (
    Object.keys(value).some((key) => !keys.includes(key)) ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error('匹配条件包含不支持的字段。');
}
const array = (v: unknown, max = 8): unknown[] => {
  if (!Array.isArray(v) || v.length > max)
    throw new Error('条件数量超出支持范围。');
  return v;
};
export function parseRoutingDictionary(value: unknown): RoutingDictionary {
  const obj = object(value);
  const parse = (v: unknown) =>
    array(v, 2000).map((entry) => {
      const e = object(entry);
      if (
        typeof e.id !== 'string' ||
        !e.id ||
        e.id.length > 150 ||
        typeof e.name !== 'string' ||
        !e.name ||
        e.name.length > 300
      )
        throw new Error('客户或服务目录格式无效。');
      return { id: e.id, name: e.name };
    });
  return {
    customers: parse(obj.customers).map((customer, index) => {
      const team = object((obj.customers as unknown[])[index]).team;
      if (
        team !== undefined &&
        (typeof team !== 'string' ||
          (team !== '' &&
            !responsibleTeams.includes(
              team as (typeof responsibleTeams)[number],
            )))
      )
        throw new Error('客户负责团队取值无效。');
      return {
        ...customer,
        ...(typeof team === 'string' && team ? { team } : {}),
      };
    }),
    services: parse(obj.services),
  };
}
export function parseRoutePredicate(
  value: unknown,
  dictionary?: RoutingDictionary,
): RoutePredicate {
  const obj = object(value);
  exact(obj, ['version', 'groups']);
  if (obj.version !== 1) throw new Error('不支持的分配规则版本。');
  const condition = (v: unknown, item: boolean): RouteCondition => {
    const c = object(v),
      fields = item
        ? ['serviceId', 'method']
        : ['customerId', 'customerTeam', 'source'];
    exact(c, ['field', 'operator', 'value']);
    if (
      !fields.includes(String(c.field)) ||
      !['eq', 'ne'].includes(String(c.operator)) ||
      typeof c.value !== 'string' ||
      !c.value ||
      c.value.length > 150
    )
      throw new Error('匹配条件包含不支持的字段或比较方式。');
    if (
      c.field === 'customerTeam' &&
      !responsibleTeams.includes(c.value as (typeof responsibleTeams)[number])
    )
      throw new Error('客户负责团队仅支持金融、商业、港澳、其他。');
    if (c.field === 'source' && !['internal', 'customer'].includes(c.value))
      throw new Error('申请来源无效。');
    if (c.field === 'method' && !['远程', '现场'].includes(c.value))
      throw new Error('服务方式仅支持远程或现场。');
    const entries =
      c.field === 'customerId'
        ? dictionary?.customers
        : c.field === 'serviceId'
          ? dictionary?.services
          : undefined;
    if (entries && !entries.some((entry) => entry.id === c.value))
      throw new Error('条件中的客户或服务项不存在，请重新转译。');
    return {
      field: c.field as RouteCondition['field'],
      operator: c.operator as 'eq' | 'ne',
      value: c.value,
    };
  };
  const groups = array(obj.groups).map((v) => {
    const g = object(v),
      conditions = array(g.conditions).map((c) => condition(c, false));
    exact(g, ['conditions', 'items']);
    const items = array(g.items).map((v) => {
      const i = object(v);
      exact(i, ['mode', 'conditions']);
      if (i.mode !== 'some' && i.mode !== 'none')
        throw new Error('申请项匹配方式无效。');
      const conditions = array(i.conditions).map((c) => condition(c, true));
      if (!conditions.length) throw new Error('申请项条件不能为空。');
      return { mode: i.mode as 'some' | 'none', conditions };
    });
    if (!conditions.length && !items.length)
      throw new Error('匹配条件不能为空；所有申请适用时请配置默认负责人。');
    return { conditions, items };
  });
  if (!groups.length) throw new Error('没有可执行的匹配条件。');
  return { version: 1, groups };
}
export function parseRoutingConfig(value: unknown): RoutingConfig {
  if (value === undefined) return emptyRoutingConfig();
  const obj = object(value);
  if (
    obj.version !== 1 ||
    !Number.isSafeInteger(obj.revision) ||
    Number(obj.revision) < 0
  )
    throw new Error('分配配置损坏，请联系管理员。');
  const policy = (value: unknown, hardware = false): RoutingPolicy => {
    const p = object(value);
    if (typeof p.defaultUserId !== 'string')
      throw new Error('默认负责人格式无效。');
    const rules = array(p.rules, 100).map((v) => {
      const r = object(v);
      if (
        typeof r.id !== 'string' ||
        !r.id ||
        typeof r.requirement !== 'string' ||
        !r.requirement.trim() ||
        r.requirement.length > 4000 ||
        typeof r.userId !== 'string' ||
        !r.userId ||
        typeof r.enabled !== 'boolean' ||
        !Number.isSafeInteger(r.priority) ||
        Number(r.priority) < 1 ||
        Number(r.priority) > 9999
      )
        throw new Error('请填写有效的匹配条件、负责人和优先级（1–9999）。');
      return {
        id: r.id,
        requirement: r.requirement.trim(),
        priority: Number(r.priority),
        userId: r.userId,
        enabled: r.enabled,
        compiled: parseRoutePredicate(r.compiled),
        ...(typeof r.updatedAt === 'string' ? { updatedAt: r.updatedAt } : {}),
        ...(typeof r.updatedBy === 'string' ? { updatedBy: r.updatedBy } : {}),
      };
    });
    if (new Set(rules.map((r) => r.id)).size !== rules.length)
      throw new Error('分配规则编号重复。');
    const active = rules.filter((r) => r.enabled);
    if (new Set(active.map((r) => r.priority)).size !== active.length)
      throw new Error('启用规则的优先级不能重复。');
    return {
      defaultUserId: p.defaultUserId,
      ...(hardware
        ? { trigger: parseHardwareAssessmentTrigger(p.trigger) }
        : {}),
      rules: rules.sort((a, b) => a.priority - b.priority),
    };
  };
  return {
    version: 1,
    revision: Number(obj.revision),
    manager: policy(obj.manager),
    hardware: policy(obj.hardware, true),
    ...(typeof obj.updatedAt === 'string' ? { updatedAt: obj.updatedAt } : {}),
    ...(typeof obj.updatedBy === 'string' ? { updatedBy: obj.updatedBy } : {}),
  };
}
function methodValues(method: string): string[] {
  try {
    const v: unknown = JSON.parse(method);
    if (Array.isArray(v))
      return v.filter((x): x is string => typeof x === 'string');
  } catch {
    /* Single selection. */
  }
  return [method];
}
function matches(values: string[], condition: RouteCondition) {
  const found = values.includes(condition.value);
  return condition.operator === 'eq' ? found : !found;
}
export function matchesRoute(
  record: ServiceRequest,
  predicate: RoutePredicate,
  customers: RoutingDictionary['customers'] = [],
): boolean {
  return predicate.groups.some(
    (group) =>
      group.conditions.every((c) => {
        if (c.field === 'customerTeam') {
          const team = customers.find(
            (customer) => customer.id === record.customerId,
          )?.team;
          // Missing/invalid team is unknown, including for “not financial”.
          return (
            !!team &&
            responsibleTeams.includes(
              team as (typeof responsibleTeams)[number],
            ) &&
            matches([team], c)
          );
        }
        return matches(
          [
            c.field === 'customerId'
              ? record.customerId
              : requestAudience(record),
          ],
          c,
        );
      }) &&
      group.items.every((group) => {
        const exists = record.items.some((item) =>
          group.conditions.every((c) =>
            matches(
              c.field === 'serviceId'
                ? [item.serviceId]
                : methodValues(item.method),
              c,
            ),
          ),
        );
        return group.mode === 'some' ? exists : !exists;
      }),
  );
}
export function describeRoute(
  predicate: RoutePredicate,
  dictionary: RoutingDictionary,
): string {
  const label = (c: RouteCondition) => {
    const name =
      c.field === 'customerId'
        ? (dictionary.customers.find((x) => x.id === c.value)?.name ?? c.value)
        : c.field === 'serviceId'
          ? (dictionary.services.find((x) => x.id === c.value)?.name ?? c.value)
          : c.field === 'source'
            ? c.value === 'internal'
              ? '内部申请'
              : '客户申请'
            : c.value;
    return `${{ customerId: '客户', customerTeam: '客户负责团队', source: '申请来源', serviceId: '服务项', method: '服务方式' }[c.field]}${c.operator === 'eq' ? '为' : '不为'}「${name}」`;
  };
  return predicate.groups
    .map((g) =>
      [
        ...g.conditions.map(label),
        ...g.items.map(
          (i) =>
            `${i.mode === 'some' ? '包含' : '不包含'}满足（${i.conditions.map(label).join(' 且 ')}）的同一申请项`,
        ),
      ].join(' 且 '),
    )
    .map((s) => `（${s}）`)
    .join(' 或 ');
}
// Find a possible overlap from the finite values used by these predicates. Each
// positive item group may be witnessed by a different request item.
export function routesOverlap(
  a: RoutePredicate,
  b: RoutePredicate,
  role: RoutingRole,
  trigger?: HardwareAssessmentTrigger,
): boolean {
  return a.groups.some((ga) =>
    b.groups.some((gb) => {
      const cs = [...ga.conditions, ...gb.conditions],
        itemGroups = [...ga.items, ...gb.items];
      const requiredServices =
        role === 'hardware' && trigger
          ? trigger.enabled
            ? trigger.serviceIds
            : []
          : undefined;
      if (requiredServices && !requiredServices.length) return false;
      const customers = [
        ...cs.filter((c) => c.field === 'customerId').map((c) => c.value),
        '__other__',
      ];
      // Team may change independently of the customer ID. Potential overlaps
      // cover all valid teams; missing teams cannot satisfy team predicates.
      if (
        !customers.some((customer) =>
          responsibleTeams.some((team) =>
            ['internal', 'customer'].some((source) =>
              cs.every((c) =>
                matches(
                  [
                    c.field === 'customerId'
                      ? customer
                      : c.field === 'customerTeam'
                        ? team
                        : source,
                  ],
                  c,
                ),
              ),
            ),
          ),
        )
      )
        return false;
      const services = [
        ...(requiredServices ?? []),
        ...itemGroups.flatMap((g) =>
          g.conditions
            .filter((c) => c.field === 'serviceId')
            .map((c) => c.value),
        ),
        '__other__',
      ];
      const candidates = services.flatMap((service) =>
        [['远程'], ['现场'], ['远程', '现场']].map((methods) => ({
          service,
          methods,
        })),
      );
      const accepts = (
        item: (typeof candidates)[number],
        g: (typeof itemGroups)[number],
      ) =>
        g.conditions.every((c) =>
          matches(c.field === 'serviceId' ? [item.service] : item.methods, c),
        );
      const allowed = candidates.filter((item) =>
        itemGroups
          .filter((g) => g.mode === 'none')
          .every((g) => !accepts(item, g)),
      );
      return (
        allowed.length > 0 &&
        (!requiredServices ||
          allowed.some((item) => requiredServices.includes(item.service))) &&
        itemGroups
          .filter((g) => g.mode === 'some')
          .every((g) => allowed.some((item) => accepts(item, g)))
      );
    }),
  );
}
