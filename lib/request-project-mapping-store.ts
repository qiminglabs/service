import { validateCustomFieldMappings } from './custom-field-mapping.ts';
import { openDatabase, readLocal, type InternalUser } from './service-requests.ts';
import { canManageRouting } from './assessment-routing-store.ts';
import type { OperationActor } from './request-operations';
import { requestProjectMappingId, parseProjectMapping, mappingRules, type MappingSection, type RequestProjectMapping } from './request-project-mapping.ts';

export async function readProjectMapping() {
  const rows = await readLocal<{ id: string; payload: unknown }>('references');
  return parseProjectMapping(rows.find(row => row.id === requestProjectMappingId)?.payload);
}
export async function saveProjectMapping(input: RequestProjectMapping, actor: OperationActor, section?: MappingSection) {
  const checked = parseProjectMapping(input);
  if (section !== undefined && !mappingRules.some(rule => rule.section === section)) throw new Error('不支持的映射分组。');
  const db = await openDatabase();
  try {
    return await new Promise<RequestProjectMapping>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite');
      const store = tx.objectStore('references');
      const read = store.getAll();
      let result: RequestProjectMapping;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('映射配置保存未完成。'));
      tx.onerror = () => reject(tx.error);
      read.onsuccess = () => {
        try {
          const users: InternalUser[] = read.result.find(row => row.id === 'workspace')?.payload?.users ?? [];
          if (!canManageRouting(actor) || !users.some(user => user.id === actor.id && user.status === '启用')) throw new Error('仅已启用的系统管理员可维护请求转项目映射。');
          const previous = parseProjectMapping(read.result.find(row => row.id === requestProjectMappingId)?.payload);
          if (previous.revision !== checked.revision) throw new Error('映射配置已更新，请刷新页面后再保存。');
          const next = section === undefined ? checked : structuredClone(previous);
          if (section !== undefined) {
            for (const { target } of mappingRules.filter(rule => rule.section === section)) {
              next.fields[target] = checked.fields[target];
              if (checked.readonly?.[target] !== undefined) {
                (next.readonly ??= {})[target] = checked.readonly[target];
              } else if (next.readonly) delete next.readonly[target];
            }
          }
          if (section === '请求字段') next.customFields = structuredClone(checked.customFields ?? []);
          validateCustomFieldMappings(next.customFields, read.result.find(row => row.id === 'workspace')?.payload ?? {});
          result = { ...next, revision: previous.revision + 1, updatedAt: new Date().toISOString(), updatedBy: actor.name };
          store.put({ id: requestProjectMappingId, payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
    });
  } finally { db.close(); }
}
