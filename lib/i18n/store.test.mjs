import test from 'node:test';
import assert from 'node:assert/strict';
import { readTranslations, saveTranslations, translationsId } from './store.ts';
import { localInternalUsers } from '../internal-users.ts';
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
function storage(t) {
  const data = { configs: [{ id: 'existing-service-config', fields: ['nodes'] }], references: [{ id: 'workspace', payload: { users: structuredClone(localInternalUsers) } }] };
  const previous = globalThis.indexedDB, previousWindow = globalThis.window, previousChannel = globalThis.BroadcastChannel;
  globalThis.window = new EventTarget();
  globalThis.BroadcastChannel = undefined;
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const staged = structuredClone(data); let pending = 0, aborted = false;
        const tx = {
          abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
          objectStore(name) {
            const run = fn => { const result = { readyState: 'pending' }; pending++; queueMicrotask(() => { if (aborted) return; result.result = fn(); result.readyState = 'done'; result.onsuccess?.(); pending--; if (!pending && !aborted) queueMicrotask(() => { if (!pending && !aborted) { Object.assign(data, staged); tx.oncomplete?.(); } }); }); return result; };
            return { get: key => run(() => staged[name].find(item => item.id === key)), getAll: () => run(() => staged[name]), put: record => run(() => { staged[name] = [...staged[name].filter(item => item.id !== record.id), structuredClone(record)]; }) };
          },
        }; return tx;
      } }; request.onsuccess?.();
    }); return request;
  } };
  t.after(() => { globalThis.indexedDB = previous; globalThis.window = previousWindow; globalThis.BroadcastChannel = previousChannel; });
  return data;
}
test('translation overrides persist without changing business records; stale saves cannot overwrite changes', async t => {
  const data = storage(t), before = structuredClone(data);
  assert.equal((await readTranslations()).revision, 0);
  const saved = await saveTranslations(admin, { 保存: 'Save record' }, 0);
  assert.equal(saved.revision, 1);
  assert.equal((await readTranslations()).labels.保存, 'Save record');
  assert.deepEqual(data.references, before.references);
  assert.deepEqual(data.configs.filter(record => record.id !== translationsId), before.configs);
  await assert.rejects(saveTranslations(admin, { 保存: 'Outdated label' }, 0), /其他窗口/);
  assert.equal((await readTranslations()).labels.保存, 'Save record');
  await saveTranslations(admin, {}, 1);
  assert.deepEqual(Object.keys((await readTranslations()).labels), []);
});
test('translation writes reject non-admin users, disabled accounts and malformed templates', async t => {
  const data = storage(t);
  await assert.rejects(saveTranslations({ ...admin, id: 'USR-001' }, { 保存: 'Save' }, 0), /管理员/);
  data.references[0].payload.users.find(user => user.id === admin.id).status = '停用';
  await assert.rejects(saveTranslations(admin, { 保存: 'Save' }, 0), /已启用/);
  data.references[0].payload.users.find(user => user.id === admin.id).status = '启用';
  await assert.rejects(saveTranslations(admin, { '最少 {0} 人天': 'Minimum days' }, 0), /占位符/);
  assert.equal(data.configs.some(record => record.id === translationsId), false);
});
