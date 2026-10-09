import test from 'node:test';
import assert from 'node:assert/strict';
import { readTranslations, saveTranslations, translationsId } from './store.ts';
import { translate } from './translate.ts';
import { localInternalUsers } from '../internal-users.ts';
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
function storage(t, { writeError } = {}) {
  const data = {
    configs: [{ serviceId: 'existing-service-config', fields: ['nodes'] }],
    references: [
      {
        id: 'workspace',
        payload: { users: structuredClone(localInternalUsers) },
      },
    ],
  };
  const schema = new Map();
  const previous = globalThis.indexedDB,
    previousWindow = globalThis.window,
    previousChannel = globalThis.BroadcastChannel;
  globalThis.window = new EventTarget();
  globalThis.BroadcastChannel = undefined;
  globalThis.indexedDB = {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = {
          objectStoreNames: { contains: (name) => schema.has(name) },
          createObjectStore(name, { keyPath }) {
            schema.set(name, keyPath);
          },
          close() {},
          transaction() {
            const staged = structuredClone(data);
            let pending = 0,
              aborted = false;
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(name) {
                const run = (fn) => {
                  const result = { readyState: 'pending' };
                  pending++;
                  queueMicrotask(() => {
                    if (aborted) return;
                    result.result = fn();
                    result.readyState = 'done';
                    try {
                      result.onsuccess?.();
                    } catch {
                      tx.error = new DOMException(
                        'Uncaught exception in event handler.',
                        'AbortError',
                      );
                      tx.abort();
                    }
                    pending--;
                    if (!pending && !aborted)
                      queueMicrotask(() => {
                        if (!pending && !aborted) {
                          Object.assign(data, staged);
                          tx.oncomplete?.();
                        }
                      });
                  });
                  return result;
                };
                return {
                  get: (key) =>
                    run(() =>
                      staged[name].find(
                        (item) => item[schema.get(name)] === key,
                      ),
                    ),
                  getAll: () => run(() => staged[name]),
                  put: (record) => {
                    if (writeError) throw writeError;
                    const keyPath = schema.get(name);
                    if (record[keyPath] === undefined)
                      throw new DOMException(
                        'Missing object-store key: ' + keyPath,
                        'DataError',
                      );
                    const copy = structuredClone(record);
                    return run(() => {
                      staged[name] = [
                        ...staged[name].filter(
                          (item) => item[keyPath] !== copy[keyPath],
                        ),
                        copy,
                      ];
                    });
                  },
                };
              },
            };
            return tx;
          },
        };
        if (!schema.size) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };
  t.after(() => {
    globalThis.indexedDB = previous;
    globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
  });
  return data;
}
test('translation overrides persist without changing business records; stale saves cannot overwrite changes', async (t) => {
  const data = storage(t),
    before = structuredClone(data);
  assert.equal((await readTranslations()).revision, 0);
  const saved = await saveTranslations(admin, { 保存: 'Save record' }, 0);
  assert.equal(saved.revision, 1);
  assert.equal((await readTranslations()).labels.保存, 'Save record');
  assert.deepEqual(
    data.references.filter((record) => record.id !== translationsId),
    before.references,
  );
  assert.deepEqual(data.configs, before.configs);
  assert.equal(
    data.references.find((record) => record.id === translationsId)?.revision,
    1,
  );
  await assert.rejects(
    saveTranslations(admin, { 保存: 'Outdated label' }, 0),
    /其他窗口/,
  );
  assert.equal((await readTranslations()).labels.保存, 'Save record');
  await saveTranslations(admin, {}, 1);
  assert.deepEqual(Object.keys((await readTranslations()).labels), []);
});
test('translation writes reject non-admin users, disabled accounts and malformed templates', async (t) => {
  const data = storage(t);
  await assert.rejects(
    saveTranslations({ ...admin, id: 'USR-001' }, { 保存: 'Save' }, 0),
    /管理员/,
  );
  data.references[0].payload.users.find((user) => user.id === admin.id).status =
    '停用';
  await assert.rejects(saveTranslations(admin, { 保存: 'Save' }, 0), /已启用/);
  data.references[0].payload.users.find((user) => user.id === admin.id).status =
    '启用';
  await assert.rejects(
    saveTranslations(admin, { '最少 {0} 人天': 'Minimum days' }, 0),
    /占位符/,
  );
  assert.equal(
    data.references.some((record) => record.id === translationsId),
    false,
  );
});

test('edited workspace label persists and is used only for English display', async (t) => {
  storage(t);
  let updates = 0;
  window.addEventListener('service-translations-changed', () => updates++);
  await saveTranslations(admin, { 项目经理工作台: 'PM Workspace' }, 0);
  const record = await readTranslations();
  assert.equal(
    translate('项目经理工作台', 'en', record.labels),
    'PM Workspace',
  );
  assert.equal(
    translate('项目经理工作台', 'zh-CN', record.labels),
    '项目经理工作台',
  );
  assert.equal(updates, 1);
});
test('synchronous database errors retain their cause and never publish a successful save', async (t) => {
  const writeError = new DOMException('Test write failure', 'DataError');
  const data = storage(t, { writeError }),
    before = structuredClone(data);
  let updates = 0;
  window.addEventListener('service-translations-changed', () => updates++);
  await assert.rejects(
    saveTranslations(admin, { 保存: 'Save' }, 0),
    (error) => error === writeError,
  );
  assert.deepEqual(data, before);
  assert.equal(updates, 0);
});
