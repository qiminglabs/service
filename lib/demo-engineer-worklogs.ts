import { operationIdentities } from './internal-users.ts';
import { localDate } from './request-operations.ts';
import {
  openDatabase,
  type CatalogService,
  type InternalUser,
} from './service-requests.ts';
import type { ServiceProjectRecord } from './service-projects';
import { assignedEngineers } from './service-work-orders.ts';
import {
  applyProjectOperation,
  canRecordProjectWorklog,
  canConfirmProjectWorklog,
} from './service-project-operations.ts';
import { shiftDate, weekStart } from './scheduling.ts';

export const engineerWorklogSeedId = 'demo-linche-worklogs-2026-09-29-v1';

// An explicitly requested, additive sample update. Never replace existing worklogs.
export function buildEngineerWorklogSamples(
  projects: ServiceProjectRecord[],
  users: InternalUser[],
  services: CatalogService[],
  now = new Date(),
) {
  const actors = operationIdentities(users);
  const engineer = actors.find(
    (actor) =>
      actor.id === 'USR-004' &&
      actor.name === '林澈' &&
      actor.role === 'SmartX 服务工程师',
  );
  if (!engineer) return [];
  const candidates = projects
    .filter(
      (project) =>
        project.id.startsWith('SP-DEMO-') &&
        canRecordProjectWorklog(project, engineer),
    )
    .map((project) => ({
      project,
      orders: (project.workOrders ?? []).filter(
        (order) =>
          !['已完成', '已取消'].includes(order.status) &&
          assignedEngineers(order).some(
            (person) =>
              person.group === 'internal' && person.id === engineer.id,
          ),
      ),
    }))
    .filter((entry) => entry.orders.length)
    .slice(0, 2);
  if (!candidates.length) return [];
  const today = localDate(now);
  const monday = weekStart(today);
  const at = now.toISOString();
  const descriptions = [
    ['项目准备', '核对客户需求与服务范围，整理实施前待确认事项。'],
    ['项目准备', '整理环境信息与前置条件，更新实施准备清单。'],
    ['方案设计', '核对技术方案、实施风险及回退准备。'],
    ['客户沟通', '沟通实施窗口、配合人员与准备事项。'],
    ['项目准备', '检查执行前置条件，补充待办清单。'],
    ['文档整理', '整理项目沟通记录和交付资料目录。'],
  ];
  const times = [
    ['09:00', '10:30'],
    ['10:30', '12:00'],
    ['14:00', '15:30'],
  ];
  const existing = projects.flatMap(
    (project) => project.operations?.worklogs ?? [],
  );
  const occupied = existing.filter(
    (log) => log.userId === engineer.id && !log.voidedAt,
  );
  const updates = new Map<string, ServiceProjectRecord>();
  for (let i = 0; i < descriptions.length; i++) {
    const date = shiftDate(monday, Math.floor(i / 3));
    if (date > today) continue;
    const [startTime, endTime] = times[i % times.length];
    const id = `${engineerWorklogSeedId}-${i + 1}`;
    if (existing.some((log) => log.id === id)) continue;
    // Unknown legacy time slots reserve their whole day; don't invent overlapping work.
    if (
      occupied.some(
        (log) =>
          log.date === date &&
          (!log.startTime ||
            !log.endTime ||
            (startTime < log.endTime && endTime > log.startTime)),
      )
    )
      continue;
    const candidate = candidates[i % candidates.length];
    const order =
      candidate.orders[
        Math.floor(i / candidates.length) % candidate.orders.length
      ];
    let updated = applyProjectOperation(
      updates.get(candidate.project.id) ?? candidate.project,
      {
        type: 'worklog-add',
        workOrderId: order.id,
        date,
        startTime,
        endTime,
        category: descriptions[i][0],
        description: `【示例工时】${descriptions[i][1]}`,
      },
      engineer,
      at,
      services,
    );
    updated.operations!.worklogs[0].id = id;
    const manager = actors.find(
      (actor) =>
        actor.role === 'SmartX 项目经理' &&
        canConfirmProjectWorklog(updated, actor),
    );
    if (i % 2 === 0 && manager)
      updated = applyProjectOperation(
        updated,
        { type: 'worklog-confirm', ids: [id] },
        manager,
        at,
        services,
      );
    updates.set(updated.id, updated);
    occupied.push(updated.operations!.worklogs.find((log) => log.id === id)!);
  }
  return [...updates.values()];
}

export async function initializeEngineerWorklogSamples(now = new Date()) {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () =>
        reject(tx.error ?? new Error('示例工时初始化失败，原数据已保留。'));
      tx.onerror = () => reject(tx.error);
      const store = tx.objectStore('references');
      const read = store.getAll();
      read.onsuccess = () => {
        try {
          const rows = read.result as { id: string; payload: unknown }[];
          if (rows.some((row) => row.id === engineerWorklogSeedId)) return;
          const workspace = rows.find((row) => row.id === 'workspace')
            ?.payload as
            | { users?: InternalUser[]; services?: CatalogService[] }
            | undefined;
          if (!workspace) return;
          const projects = rows.flatMap((row) => {
            const project = row.payload as ServiceProjectRecord | undefined;
            return project?.id && row.id === `service-project:${project.id}`
              ? [project]
              : [];
          });
          const updates = buildEngineerWorklogSamples(
            projects,
            workspace.users ?? [],
            workspace.services ?? [],
            now,
          );
          if (!updates.length) return;
          for (const project of updates)
            store.put({
              id: `service-project:${project.id}`,
              payload: project,
            });
          store.put({
            id: engineerWorklogSeedId,
            payload: { initializedAt: now.toISOString(), userId: 'USR-004' },
          });
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
