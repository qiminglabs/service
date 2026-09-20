import { parseHardwareAssessmentTrigger } from './hardware-assessment-trigger.ts';
import { openDatabase, readLocal } from './service-requests.ts';
import type { InternalUser, ServiceRequest } from './service-requests';
import type { OperationActor } from './request-operations';
import { fixedIdentityRoles } from './internal-users.ts';
import {
  assessmentRoutingId,
  parseRoutingConfig,
  parseRoutePredicate,
  routesOverlap,
  routingUsers,
  type RoutingRole,
  type RoutingConfig,
  type RoutingDictionary,
  type RoutingPolicy,
  type RoutingRule,
  type RoutePredicate,
} from './assessment-routing-schema.ts';
export type RoutingWorkspace = RoutingDictionary & { users: InternalUser[] };
export const canManageRouting = (actor: OperationActor) =>
  !!actor.id &&
  actor.role === 'SmartX 系统管理员' &&
  fixedIdentityRoles[actor.id] === actor.role;
export const routingTestKey = (
  rule: Pick<RoutingRule, 'requirement' | 'priority' | 'userId'>,
) => JSON.stringify([rule.requirement.trim(), rule.priority, rule.userId]);
export type TestedRouting = { key: string; compiled: RoutePredicate };
export async function readRoutingData() {
  const [refs, requests] = await Promise.all([
    readLocal<{ id: string; payload?: unknown }>('references'),
    readLocal<ServiceRequest>('requests'),
  ]);
  const workspace = refs.find((r) => r.id === 'workspace')?.payload as
    | Partial<RoutingWorkspace>
    | undefined;
  return {
    config: parseRoutingConfig(
      refs.find((r) => r.id === assessmentRoutingId)?.payload,
    ),
    workspace: {
      customers: workspace?.customers ?? [],
      services: workspace?.services ?? [],
      users: workspace?.users ?? [],
    },
    requests,
  };
}
function assertAdmin(actor: OperationActor, users: InternalUser[]) {
  if (
    !canManageRouting(actor) ||
    !users.some((user) => user.id === actor.id && user.status === '启用')
  )
    throw new Error('仅已启用的系统管理员可维护分配流程。');
}
export async function saveRoutingPolicy(
  actor: OperationActor,
  role: RoutingRole,
  policy: RoutingPolicy,
  expectedRevision: number,
  tested?: TestedRouting,
): Promise<RoutingConfig> {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可维护分配流程。');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite'),
        store = tx.objectStore('references'),
        get = store.getAll();
      let result: RoutingConfig;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('分配配置保存未完成。'));
      tx.onerror = () => reject(tx.error);
      get.onsuccess = () => {
        try {
          const workspace: RoutingWorkspace = get.result.find(
            (r) => r.id === 'workspace',
          )?.payload ?? { users: [], customers: [], services: [] };
          assertAdmin(actor, workspace.users);
          const config = parseRoutingConfig(
            get.result.find((r) => r.id === assessmentRoutingId)?.payload,
          );
          if (config.revision !== expectedRevision)
            throw new Error('分配配置已被其他页面修改，请刷新后重试。');
          result = parseRoutingConfig({
            ...config,
            [role]:
              role === 'hardware'
                ? {
                    ...policy,
                    trigger: policy.trigger ?? config.hardware.trigger,
                  }
                : policy,
            revision: config.revision + 1,
            updatedAt: new Date().toISOString(),
            updatedBy: actor.name,
          });
          if (role === 'hardware') {
            const trigger = parseHardwareAssessmentTrigger(
              result.hardware.trigger,
            );
            const changed =
              JSON.stringify(trigger) !==
              JSON.stringify(config.hardware.trigger);
            if (
              changed &&
              trigger.enabled &&
              trigger.serviceIds.some(
                (id) =>
                  !workspace.services.some((service) => service.id === id),
              )
            )
              throw new Error('触发条件中的服务项已不存在，请重新选择。');
          }
          if (config[role].rules.some(old => !result[role].rules.some(rule => rule.id === old.id)))
            throw new Error('分配规则只能停用，不能删除。');
          const eligible = routingUsers(workspace.users, role);
          if (
            policy.defaultUserId &&
            policy.defaultUserId !== config[role].defaultUserId &&
            !eligible.some((u) => u.id === policy.defaultUserId)
          )
            throw new Error('默认负责人已停用或角色不符，请重新选择。');
          for (const rule of result[role].rules) {
            const previous = config[role].rules.find((r) => r.id === rule.id);
            const changed =
              !previous ||
              routingTestKey(previous) !== routingTestKey(rule) ||
              JSON.stringify(previous.compiled) !==
                JSON.stringify(rule.compiled);
            if ((!previous && !rule.enabled) || (previous && !previous.enabled && rule.enabled))
              throw new Error('停用规则不能直接启用，请新建规则。');
            if (previous && !previous.enabled && (changed || tested?.key === routingTestKey(rule)))
              throw new Error('停用规则只读，不可编辑。');
            if (
              changed &&
              (!tested ||
                tested.key !== routingTestKey(rule) ||
                JSON.stringify(parseRoutePredicate(tested.compiled)) !==
                  JSON.stringify(rule.compiled))
            )
              throw new Error('匹配条件或分配设置已变化，请重新转译并测试。');
            if (rule.enabled && (changed || !previous?.enabled)) {
              if (!eligible.some((u) => u.id === rule.userId))
                throw new Error('规则负责人已停用或角色不符，请重新选择。');
              parseRoutePredicate(rule.compiled, workspace);
              if (!routesOverlap(rule.compiled, rule.compiled, role))
                throw new Error('匹配条件互相矛盾或不适用于当前评估角色。');
            }
          }
          result[role].rules = result[role].rules.map(rule => {
            const previous = config[role].rules.find(item => item.id === rule.id);
            const edited = !!previous && (routingTestKey(previous) !== routingTestKey(rule)
              || JSON.stringify(previous.compiled) !== JSON.stringify(rule.compiled)
              || (!!tested && tested.key === routingTestKey(rule)));
            const changed = !previous || edited || previous.enabled !== rule.enabled;
            const { history: _history, revision: _revision, updatedAt: _at, updatedBy: _by, ...definition } = rule;
            if (!changed) return structuredClone(previous!);
            const history = structuredClone(previous?.history ?? []);
            if (edited) {
              const { history: _oldHistory, ...snapshot } = structuredClone(previous!);
              history.push({ ...snapshot, revision: previous!.revision ?? 1, enabled: false, archivedAt: result.updatedAt!, archivedBy: actor.name });
            }
            return { ...definition, revision: previous ? (previous.revision ?? 1) + (edited ? 1 : 0) : 1,
              ...(history.length ? { history } : {}), updatedAt: result.updatedAt, updatedBy: actor.name };
          });
          store.put({ id: assessmentRoutingId, payload: result });
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}
