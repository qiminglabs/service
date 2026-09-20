import type {
  ServiceFlow,
  ServiceFlowConfig,
  ServiceFlowHistory,
  ServiceFlowRule,
} from './service-flows';

// Blob content is part of a flow definition, including same-name/same-size replacements.
async function snapshotKey(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      await value.arrayBuffer(),
    );
    return {
      blobType: value.type,
      hash: Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    };
  }
  if (Array.isArray(value)) return Promise.all(value.map(snapshotKey));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(async ([key, item]) => [key, await snapshotKey(item)]),
      ),
    );
  return value;
}
export async function changedServiceFlows(
  previous: ServiceFlowConfig,
  next: ServiceFlowConfig,
) {
  const changed = new Set<string>();
  for (const flow of previous.flows) {
    const replacement = next.flows.find((row) => row.id === flow.id);
    if (
      !replacement ||
      JSON.stringify(await snapshotKey(flow)) !==
        JSON.stringify(await snapshotKey(replacement))
    )
      changed.add(flow.id);
  }
  return changed;
}
export function serviceFlowHistory(
  previous: ServiceFlowConfig,
  next: ServiceFlowConfig,
  changed: Set<string>,
  actor: string,
  now: string,
) {
  const history = structuredClone(previous.history ?? []);
  const archive = (
    kind: 'rule' | 'default',
    flow: ServiceFlow,
    name: string,
    reason: string,
    rule?: ServiceFlowRule,
  ) => {
    history.push({
      id: crypto.randomUUID(),
      kind,
      name,
      flow: structuredClone(flow),
      ...(rule ? { rule: { ...structuredClone(rule), enabled: false } } : {}),
      revision: previous.revision,
      reason,
      disabledAt: now, disabledBy: actor,
    });
  };
  for (const rule of previous.assignment.rules) {
    const replacement = next.assignment.rules.find((row) => row.id === rule.id);
    if (!replacement) throw new Error('分配规则需停用保留，不能删除。');
    if (!rule.enabled) {
      if (JSON.stringify(rule) !== JSON.stringify(replacement))
        throw new Error('已停用分配规则为只读，不能修改或重新启用。');

    } else if (
      !replacement.enabled ||
      JSON.stringify(rule) !== JSON.stringify(replacement) ||
      changed.has(rule.flowId)
    ) {
      archive(
        'rule',
        previous.flows.find((flow) => flow.id === rule.flowId)!,
        rule.name,
        !replacement.enabled
          ? '规则停用'
          : changed.has(rule.flowId)
            ? '流程配置更新'
            : '规则条件调整',
        rule,
      );
    }
  }
  const oldDefault = previous.flows.find(
    (flow) => flow.id === previous.assignment.defaultFlowId,
  );
  if (
    oldDefault &&
    (next.assignment.defaultFlowId !== oldDefault.id ||
      changed.has(oldDefault.id))
  )
    archive(
      'default',
      oldDefault,
      '历史默认规则',
      next.assignment.defaultFlowId !== oldDefault.id
        ? next.assignment.defaultFlowId
          ? '默认流程已更换'
          : '默认流程已清空'
        : '默认流程配置更新',
    );
  return history;
}
export function disabledServiceFlowRecords(
  config: ServiceFlowConfig,
): ServiceFlowHistory[] {
  const records = [...(config.history ?? [])];
  return records.sort(
    (a, b) =>
      (b.disabledAt ?? '').localeCompare(a.disabledAt ?? '') ||
      b.revision - a.revision,
  );
}
