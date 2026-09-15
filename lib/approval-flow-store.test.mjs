import test from 'node:test';
import assert from 'node:assert/strict';
import { readApprovalData, readApprovalPreviewData, saveApprovalConfig, saveDefaultApprovalUser } from './approval-flow-store.ts';
import { approvalConfigId, emptyApprovalConfig, newApprovalNode } from './approval-flows.ts';
import { approvalRulesId } from './approval-rules.ts';
import { emptyAssessment } from './request-assessment.ts';
import { localInternalUsers } from './internal-users.ts';

function storage(t) {
  const data = { references: [{ id: 'workspace', payload: { users: structuredClone(localInternalUsers) } }, { id: 'other-config', payload: { unchanged: true } }, { id: approvalConfigId, payload: { ...emptyApprovalConfig(), nodes: [newApprovalNode()] } }] };
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
  const saved = await saveApprovalConfig(admin, 'legacy-approval-rule', config, 0);
  assert.equal(saved.revision, 1);
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, saved);
  assert.deepEqual(data.references.filter(row => row.id !== approvalRulesId), before);
  await assert.rejects(saveApprovalConfig(admin, 'legacy-approval-rule', { ...config, name: '过期修改' }, 0), /其他页面/);
  assert.equal((await readApprovalData('legacy-approval-rule')).config.name, saved.name);
});
test('存储入口拒绝伪造管理员、停用管理员和无效审批人，失败时不写入', async t => {
  const data = storage(t), config = { ...emptyApprovalConfig(), nodes: [newApprovalNode()] };
  await assert.rejects(saveApprovalConfig({ ...admin, id: 'USR-001' }, 'legacy-approval-rule', config, 0), /管理员/);
  data.references[0].payload.users.find(user => user.id === admin.id).status = '停用';
  await assert.rejects(saveApprovalConfig(admin, 'legacy-approval-rule', config, 0), /停用/);
  data.references[0].payload.users.find(user => user.id === admin.id).status = '启用';
  config.nodes[0].source = 'people'; config.nodes[0].userIds = ['missing'];
  await assert.rejects(saveApprovalConfig(admin, 'legacy-approval-rule', config, 0), /内部用户/);
  assert.equal(data.references.some(row => row.id === approvalRulesId), false);
});

test('读取和保存均清除旧节点条件，旧客户端的结束申请设置不会重新写回', async t => {
  const data = storage(t);
  const old = data.references.find(row => row.id === approvalConfigId).payload;
  old.nodes[0] = { ...old.nodes[0], condition: 'amount', threshold: 9999, reject: 'end' };
  const loaded = await readApprovalData('legacy-approval-rule');
  assert.equal(loaded.config.nodes[0].reject, 'return');
  assert.equal('condition' in loaded.config.nodes[0], false);
  const saved = await saveApprovalConfig(admin, 'legacy-approval-rule', old, 0);
  assert.equal(saved.nodes[0].reject, 'return');
  assert.equal('threshold' in saved.nodes[0], false);
  const persisted = data.references.find(row => row.id === approvalRulesId).payload.rules[0].flow;
  assert.deepEqual(persisted, saved);
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, saved);
});

test('旧角色环节读取后待选人，补齐内部用户才能保存且不再写回角色', async t => {
  const data = storage(t);
  const original = data.references.find(row => row.id === approvalConfigId).payload;
  original.nodes[0] = { ...original.nodes[0], source: 'role', role: 'SmartX 销售经理', userIds: ['USR-001'] };
  const loaded = await readApprovalData('legacy-approval-rule');
  assert.equal(loaded.config.nodes[0].source, 'people');
  assert.deepEqual(loaded.config.nodes[0].userIds, []);
  await assert.rejects(saveApprovalConfig(admin, 'legacy-approval-rule', original, 0), /内部用户/);
  loaded.config.nodes[0].userIds = ['USR-001'];
  const saved = await saveApprovalConfig(admin, 'legacy-approval-rule', loaded.config, 0);
  assert.deepEqual(saved.nodes[0].userIds, ['USR-001']);
  assert.equal('role' in saved.nodes[0], false);
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, saved);
});

test('保存入口禁止多人审批，旧多选环节必须重新选择一位启用用户', async t => {
  const data = storage(t);
  const old = data.references.find(row => row.id === approvalConfigId).payload;
  old.nodes[0] = { ...old.nodes[0], source: 'people', userIds: ['USR-001', 'USR-002'], method: 'all' };
  const before = structuredClone(data.references);
  await assert.rejects(saveApprovalConfig(admin, 'legacy-approval-rule', old, 0), /一位已启用/);
  assert.deepEqual(data.references, before);
  const loaded = await readApprovalData('legacy-approval-rule');
  assert.deepEqual(loaded.config.nodes[0].userIds, []);
  loaded.config.nodes[0].userIds = ['USR-002'];
  const saved = await saveApprovalConfig(admin, 'legacy-approval-rule', loaded.config, 0);
  assert.deepEqual(saved.nodes[0].userIds, ['USR-002']);
  assert.equal('method' in saved.nodes[0], false);
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, saved);
});

test('多选截止人保存重读保持一致，无效截止人不会写入', async t => {
  const data = storage(t);
  const stopUserIds = data.references[0].payload.users.filter(user => user.status === '启用').slice(0, 2).map(user => user.id);
  const config = { ...emptyApprovalConfig(), nodes: [{ ...newApprovalNode('org'), stopUserIds }] };
  const saved = await saveApprovalConfig(admin, 'legacy-approval-rule', config, 0);
  assert.deepEqual(saved.nodes[0].stopUserIds, stopUserIds);
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, saved);
  const before = structuredClone(data.references);
  saved.nodes[0].stopUserIds = ['missing'];
  await assert.rejects(saveApprovalConfig(admin, 'legacy-approval-rule', saved, saved.revision), /截止人/);
  assert.deepEqual(data.references, before);
});


test('预览列表仅保留有效方案存在额度缺口的非草稿请求，且不修改存储', async t => {
  const data = storage(t);
  const make = (id, plan, status = '待评估') => ({ id, status, items: [], operations: { assessment: { ...emptyAssessment(), plans: plan ? [plan] : [] } } });
  const plan = { id: 'plan', effort: 3, allocations: [] };
  data.requests = [
    make('required', plan),
    make('draft', plan, '草稿'),
    make('covered', { ...plan, allocations: [{ assetId: 'asset', days: 3 }] }),
    make('unknown'),
    make('released', { ...plan, releasedAt: '2026-09-15' }),
    make('method-gap', { ...plan, requirements: [{ method: '现场', days: 3 }], allocations: [{ assetId: 'remote', method: '远程', days: 3 }] }),
  ];
  const before = structuredClone(data);
  const preview = await readApprovalPreviewData();
  assert.deepEqual(preview.requests.map(request => request.id), ['required', 'method-gap']);
  assert.equal(preview.collection.rules[0].id, 'legacy-approval-rule');
  assert.deepEqual(data, before);
  data.requests[0].operations.assessment.plans[0].allocations = [{ assetId: 'new-asset', days: 3 }];
  assert.deepEqual((await readApprovalPreviewData()).requests.map(request => request.id), ['method-gap']);
});


test('默认审批人独立保存和清空，不覆盖规则流程，其他流程保存保留默认审批人', async t => {
  const data = storage(t);
  const original = (await readApprovalData('legacy-approval-rule')).config;
  const saved = await saveDefaultApprovalUser(admin, 'USR-001', 0);
  assert.equal(saved.defaultUserId, 'USR-001');
  assert.equal(saved.defaultRevision, 1);
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, original);
  await saveApprovalConfig(admin, 'legacy-approval-rule', { ...original, name: '更新流程' }, 0);
  const stored = data.references.find(row => row.id === approvalRulesId).payload;
  assert.equal(stored.defaultUserId, 'USR-001');
  assert.equal(stored.defaultRevision, 1);
  const before = structuredClone(data);
  await assert.rejects(saveDefaultApprovalUser(admin, 'USR-002', 0), /其他页面修改/);
  assert.deepEqual(data, before);
  const cleared = await saveDefaultApprovalUser(admin, '', 1);
  assert.equal(cleared.defaultUserId, '');
  assert.equal(cleared.defaultRevision, 2);
  assert.equal(cleared.rules[0].flow.name, '更新流程');
});

test('默认审批人保存拒绝越权、无效及停用人员，读取保留当前默认值', async t => {
  const data = storage(t);
  await assert.rejects(saveDefaultApprovalUser({ ...admin, role: '客户' }, 'USR-001', 0), /管理员/);
  await assert.rejects(saveDefaultApprovalUser(admin, 'missing', 0), /启用的内部用户/);
  data.references[0].payload.users.find(user => user.id === 'USR-001').status = '停用';
  await assert.rejects(saveDefaultApprovalUser(admin, 'USR-001', 0), /启用的内部用户/);
  assert.equal(data.references.some(row => row.id === approvalRulesId), false);
  await saveDefaultApprovalUser(admin, 'USR-002', 0);
  data.requests = [];
  assert.equal((await readApprovalPreviewData()).collection.defaultUserId, 'USR-002');
});


test('保存旧客户端节点也清除异常处理策略，保留已保存的默认审批人', async t => {
  const data = storage(t);
  await saveDefaultApprovalUser(admin, 'USR-001', 0);
  const loaded = (await readApprovalData('legacy-approval-rule')).config;
  loaded.nodes[0].missing = 'block';
  const saved = await saveApprovalConfig(admin, 'legacy-approval-rule', loaded, 0);
  assert.equal('missing' in saved.nodes[0], false);
  assert.equal(data.references.find(row => row.id === approvalRulesId).payload.defaultUserId, 'USR-001');
  assert.deepEqual((await readApprovalData('legacy-approval-rule')).config, saved);
});
