import { openDatabase } from './service-requests.ts';
import { assignmentDirectoryFromRows } from './service-work-order-store.ts';
import {
  applyScheduleAction,
  assertScheduler,
  personalScheduleSnapshot,
  scheduleFromRows,
  schedulingId,
  type PersonalScheduleSnapshot,
  type ScheduleAction,
  type ScheduleSnapshot,
} from './scheduling.ts';
import type { OperationActor } from './request-operations';
import {
  applyPersonalCalendarAction,
  type PersonalCalendarAction,
} from './personal-scheduling.ts';

// Read scheduling and projects from the same snapshot; write reservation and assignment atomically.
export async function schedulingTransaction(
  actor: OperationActor,
  mutation?: { revision: number; action: ScheduleAction },
): Promise<ScheduleSnapshot> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        'references',
        mutation ? 'readwrite' : 'readonly',
      );
      const store = tx.objectStore('references');
      const read = store.getAll();
      let result: ScheduleSnapshot;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(tx.error ?? new Error('调度保存失败，原有数据未修改。'));
      tx.onerror = () => reject(tx.error ?? new Error('调度数据读取失败。'));
      read.onsuccess = () => {
        try {
          const rows = read.result as { id: string; payload?: unknown }[];
          const directory = assignmentDirectoryFromRows(rows);
          assertScheduler(actor, directory);
          result = scheduleFromRows(rows, directory);
          if (!mutation) return;
          if (result.data.revision !== mutation.revision)
            throw new Error('排期或日历已更新，请关闭编辑面板后重新打开。');
          const updated = applyScheduleAction(result, actor, mutation.action);
          store.put({ id: schedulingId, payload: updated.data });
          if (updated.project)
            store.put({
              id: `service-project:${updated.project.id}`,
              payload: updated.project,
            });
          result = {
            ...result,
            data: updated.data,
            projects: result.projects.map((p) =>
              p.id === updated.project?.id ? updated.project! : p,
            ),
          };
        } catch (cause) {
          reject(cause);
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}

export async function personalSchedulingTransaction(
  actor: OperationActor,
  mutation?: { revision: number; action: PersonalCalendarAction },
): Promise<PersonalScheduleSnapshot> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(
        'references',
        mutation ? 'readwrite' : 'readonly',
      );
      const store = tx.objectStore('references');
      const read = store.getAll();
      let result: PersonalScheduleSnapshot;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('服务日历读取失败。'));
      tx.onerror = () => reject(tx.error ?? new Error('服务日历读取失败。'));
      read.onsuccess = () => {
        try {
          const rows = read.result as { id: string; payload?: unknown }[];
          const directory = assignmentDirectoryFromRows(rows);
          const snapshot = scheduleFromRows(rows, directory);
          result = personalScheduleSnapshot(snapshot, actor);
          if (!mutation) return;
          if (snapshot.data.revision !== mutation.revision)
            throw new Error('日历已更新，请关闭窗口后重新打开登记。');
          const data = applyPersonalCalendarAction(
            snapshot,
            actor,
            mutation.action,
          );
          store.put({ id: schedulingId, payload: data });
          result = personalScheduleSnapshot({ ...snapshot, data }, actor);
        } catch (cause) {
          reject(cause);
          tx.abort();
        }
      };
    });
  } finally {
    db.close();
  }
}
