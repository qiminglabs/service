import test from 'node:test';
import assert from 'node:assert/strict';
import { parseServiceProviderConfig, changeServiceProvider, ServiceProviderConflict, serviceProviderSettingsId } from './service-provider-settings.ts';
import { readServiceProviders, saveServiceProvider } from './service-provider-store.ts';
import { localInternalUsers } from './internal-users.ts';
import { samplePartners } from './partner-directory.ts';

test('默认无服务商，按企业编号配置，不因同名互相影响', () => {
  const initial = parseServiceProviderConfig(undefined);
  assert.deepEqual(initial, { revision: 0, entries: [] });
  const partners = [{ id: 'a', name: '企业', status: '启用' }, { id: 'b', name: '企业', status: '启用' }];
  const next = changeServiceProvider(initial, partners, 'a', true, 0, '管理员');
  assert.deepEqual(next.entries.map(entry => entry.partnerId), ['a']);
  assert.equal(next.entries[0].enabled, true);
  assert.deepEqual(initial.entries, []);
  assert.throws(() => changeServiceProvider(next, partners, 'b', true, 0, '管理员'), ServiceProviderConflict);
});

test('停用企业不能新增资格，允许取消；不存在的企业不能配置', () => {
  const partners = [{ id: 'a', name: '企业', status: '停用' }];
  const config = parseServiceProviderConfig(undefined);
  assert.throws(() => changeServiceProvider(config, partners, 'a', true, 0, '管理员'), /已停用/);
  assert.throws(() => changeServiceProvider(config, partners, 'missing', true, 0, '管理员'), /不存在/);
  assert.equal(changeServiceProvider(config, partners, 'a', false, 0, '管理员').entries[0].enabled, false);
  assert.throws(() => parseServiceProviderConfig({ revision: 0, entries: [{ partnerId: 'a', enabled: 'yes' }] }), /数据异常/);
});

function mockStorage(t) {
  const data = { references: [{ id: 'workspace', payload: { users: structuredClone(localInternalUsers), partners: structuredClone(samplePartners) } }, { id: 'other-config', payload: { keep: true } }] };
  const original = globalThis.indexedDB;
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const staged = structuredClone(data);
        let pending = 0, aborted = false;
        const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore(name) {
          const run = fn => {
            const result = {}; pending++;
            queueMicrotask(() => {
              if (aborted) return;
              result.result = fn(); result.onsuccess?.(); pending--;
              if (!pending && !aborted) queueMicrotask(() => { if (!pending && !aborted) { Object.assign(data, staged); tx.oncomplete?.(); } });
            });
            return result;
          };
          return { getAll: () => run(() => staged[name]), put: row => run(() => { staged[name] = [...staged[name].filter(item => item.id !== row.id), structuredClone(row)]; }) };
        } };
        return tx;
      } };
      request.onsuccess?.();
    });
    return request;
  } };
  t.after(() => { globalThis.indexedDB = original; });
  return data;
}

test('保存和取消资格可重新读取；拒绝过期覆盖及非管理员写入，并保留企业和其他配置', async t => {
  const data = mockStorage(t);
  const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
  const companyId = samplePartners[0].id;
  const originalWorkspace = structuredClone(data.references[0]);
  assert.equal((await readServiceProviders()).config.entries.length, 0);
  const saved = await saveServiceProvider(companyId, true, 0, admin);
  assert.deepEqual((await readServiceProviders()).config, saved.config);
  assert.equal(saved.config.entries[0].enabled, true);
  assert.deepEqual(data.references.find(row => row.id === 'workspace'), originalWorkspace);
  assert.deepEqual(data.references.find(row => row.id === 'other-config').payload, { keep: true });
  await assert.rejects(() => saveServiceProvider(companyId, false, 0, admin), ServiceProviderConflict);
  assert.equal((await readServiceProviders()).config.entries[0].enabled, true);
  await assert.rejects(() => saveServiceProvider(companyId, false, 1, { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' }), /仅系统管理员/);
  const workspace = data.references.find(row => row.id === 'workspace').payload;
  workspace.partners[0].status = '停用';
  const revoked = await saveServiceProvider(companyId, false, 1, admin);
  assert.equal(revoked.config.entries[0].enabled, false);
  assert.equal(data.references.find(row => row.id === serviceProviderSettingsId).payload.revision, 2);
  workspace.users.find(user => user.id === admin.id).status = '停用';
  // Transactions clone the workspace; update the committed row for the next check.
  data.references.find(row => row.id === 'workspace').payload.users.find(user => user.id === admin.id).status = '停用';
  await assert.rejects(() => saveServiceProvider(companyId, false, 2, admin), /管理员已停用/);
  assert.equal((await readServiceProviders()).config.revision, 2);
});
