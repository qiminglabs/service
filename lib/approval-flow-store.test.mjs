import test from 'node:test';
import assert from 'node:assert/strict';
import { readApprovalData, saveApprovalConfig } from './approval-flow-store.ts';
import { approvalConfigId, emptyApprovalConfig, newApprovalNode } from './approval-flows.ts';
import { localInternalUsers } from './internal-users.ts';

function storage(t) {
  const data = { references: [{ id: 'workspace', payload: { users: structuredClone(localInternalUsers) } }, { id: 'other-config', payload: { unchanged: true } }] };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open() {
    const req = {};
    queueMicrotask(() => {
      req.result = { close() {}, transaction() {
        const staged = structuredClone(data); let pending = 0, aborted = false;
        const tx = {
          abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
          objectStore(name) {
            const run = fn => {
              const r = {}; pending++;
              queueMicrotask(() => { if (aborted) return; r.result = fn(); r.onsuccess?.(); pending--;
                if (!pending && !aborted) queueMicrotask(() => { if (!pending && !aborted) { Object.assign(data, staged); tx.oncomplete?.(); } });
              }); return r;
            };
            return { getAll: () => run(() => staged[name]), put: record => run(() => { staged[name] = [...staged[name].filter(row => row.id !== record.id), structuredClone(record)]; }) };
          },
        }; return tx;
      } }; req.onsuccess?.();
    }); return req;
  } };
  t.after(() => { globalThis.indexedDB = previous; }); return data;
}
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
test('审批配置保存后可重读，引用数据和其他配置不被覆盖，冲突版本禁止覆盖', async t => {
  const data = storage(t), config = { ...emptyApprovalConfig(), nodes: [newApprovalNode()] };
  const before = structuredClone(data.references);
  const saved = await saveApprovalConfig(admin, config, 0);
  assert.equal(saved.revision, 1);
  assert.deepEqual((await readApprovalData()).config, saved);
  assert.deepEqual(data.references.filter(row => row.id !== approvalConfigId), before);
  await assert.rejects(saveApprovalConfig(admin, { ...config, name: '过期修改' }, 0), /其他页面/);
  assert.equal((await readApprovalData()).config.name, saved.name);
});
test('存储入口拒绝伪造管理员、停用管理员和无效审批人，失败时不写入', async t => {
  const data = storage(t), config = { ...emptyApprovalConfig(), nodes: [newApprovalNode()] };
  await assert.rejects(saveApprovalConfig({ ...admin, id: 'USR-001' }, config, 0), /管理员/);
  data.references[0].payload.users.find(user => user.id === admin.id).status = '停用';
  await assert.rejects(saveApprovalConfig(admin, config, 0), /停用/);
  data.references[0].payload.users.find(user => user.id === admin.id).status = '启用';
  config.nodes[0].source = 'people'; config.nodes[0].userIds = ['missing'];
  await assert.rejects(saveApprovalConfig(admin, config, 0), /内部用户/);
  assert.equal(data.references.some(row => row.id === approvalConfigId), false);
});
