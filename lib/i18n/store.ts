import { openDatabase, readLocal } from '../service-requests.ts';
import { canManageRouting } from '../assessment-routing-store.ts';
import type { OperationActor } from '../request-operations';
import type { InternalUser } from '../service-requests';
export const translationsId = 'ui-translations-en';
export const translationsEvent = 'service-translations-changed';
export type TranslationRecord = {
  id: string;
  revision: number;
  labels: Record<string, string>;
  updatedAt?: string;
  updatedBy?: string;
};
export const emptyTranslations: TranslationRecord = {
  id: translationsId,
  revision: 0,
  labels: {},
};
export function parseTranslations(value: unknown): TranslationRecord {
  if (!value || typeof value !== 'object') return emptyTranslations;
  const record = value as Partial<TranslationRecord>;
  const labels: Record<string, string> = Object.create(null);
  if (record.labels && typeof record.labels === 'object')
    for (const [key, value] of Object.entries(record.labels)) {
      if (typeof value === 'string' && key.trim() && value.trim())
        labels[key] = value;
    }
  return {
    id: translationsId,
    revision: Number.isSafeInteger(record.revision) ? record.revision! : 0,
    labels,
    updatedAt: record.updatedAt,
    updatedBy: record.updatedBy,
  };
}
export async function readTranslations(): Promise<TranslationRecord> {
  return parseTranslations(
    (await readLocal<TranslationRecord>('references')).find(
      (record) => record.id === translationsId,
    ),
  );
}
export function validateTranslation(
  source: string,
  english: string,
): string | null {
  if (!source.trim() || !english.trim())
    return '中文原文和英文翻译均不能为空。';
  if (source.length > 4000 || english.length > 8000) return '翻译内容过长。';
  const tokens = (value: string) =>
    [...value.matchAll(/\{\d+\}/g)]
      .map((match) => match[0])
      .sort()
      .join(',');
  if (tokens(source) !== tokens(english))
    return '请保留原文中的全部变量占位符，例如 {0}。';
  return null;
}
export async function saveTranslations(
  actor: OperationActor,
  labels: Record<string, string>,
  expectedRevision: number,
): Promise<TranslationRecord> {
  if (!canManageRouting(actor)) throw new Error('仅系统管理员可修改翻译。');
  for (const [source, english] of Object.entries(labels)) {
    const issue = validateTranslation(source, english);
    if (issue) throw new Error(issue);
  }
  const db = await openDatabase();
  try {
    const saved = await new Promise<TranslationRecord>((resolve, reject) => {
      // Translation records use an id; service form configs are keyed by serviceId.
      const tx = db.transaction('references', 'readwrite');
      const references = tx.objectStore('references');
      const currentRequest = references.get(translationsId);
      const usersRequest = references.get('workspace');
      let result: TranslationRecord;
      let failure: Error | undefined;
      const finish = () => {
        try {
          if (
            currentRequest.readyState !== 'done' ||
            usersRequest.readyState !== 'done'
          )
            return;
          const users = (usersRequest.result?.payload?.users ??
            []) as InternalUser[];
          if (
            !users.some(
              (user) => user.id === actor.id && user.status === '启用',
            )
          )
            failure = new Error('仅已启用的系统管理员可修改翻译。');
          const current = parseTranslations(currentRequest.result);
          if (current.revision !== expectedRevision)
            failure = new Error(
              '翻译已被其他窗口修改，请保留当前内容，退出翻译台后重新进入再修改。',
            );
          if (failure) {
            tx.abort();
            return;
          }
          result = {
            id: translationsId,
            revision: current.revision + 1,
            labels,
            updatedAt: new Date().toISOString(),
            updatedBy: actor.name,
          };
          references.put(result);
        } catch (cause) {
          failure =
            cause instanceof Error
              ? cause
              : new Error('翻译保存失败，修改内容已保留。');
          tx.abort();
        }
      };
      currentRequest.onsuccess = finish;
      usersRequest.onsuccess = finish;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error('翻译保存失败，修改内容已保留。'),
        );
      tx.onerror = () =>
        reject(tx.error ?? new Error('翻译保存失败，修改内容已保留。'));
    });
    window.dispatchEvent(new Event(translationsEvent));
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(translationsEvent);
      channel.postMessage('updated');
      channel.close();
    }
    return saved;
  } finally {
    db.close();
  }
}
