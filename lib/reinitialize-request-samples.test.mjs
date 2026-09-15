import test from 'node:test';
import assert from 'node:assert/strict';
import { reinitializeRuleBasedRequestSamples, ruleBasedRequestSamplesMarker } from './reinitialize-request-samples.ts';
import { localInternalUsers } from './internal-users.ts';
import { importedServiceCatalogSeeds } from '../app/service-catalog-import.ts';
import { demoReportingUsers, demoWorkflowRuleReferences } from './demo-workflow-rules.ts';
import { presalesRequestSamplesMarker } from './demo-service-requests.ts';

const workspace = {
  services: importedServiceCatalogSeeds.map((s, i) => ({ id: `svc-${i}`, name: s.serviceName, category: s.serviceCategory, status: '已启用', deliveryMethods: ['远程', '现场'], priceUnit: s.pricingUnit ?? '服务人天', priceCoefficient: 1, defaultQuantity: 1 })),
  users: demoReportingUsers(localInternalUsers), customers: [{ id: 'c1', name: '测试客户', status: '启用', team: '商业', ownerUserId: 'USR-001' }],
  contacts: [{ id: 'contact', name: '客户联系人', customerId: 'c1', status: '启用' }],
  businessObjects: [{ id: 'object', name: '集群', customerId: 'c1', status: '启用', product: 'SMTX OS 系统', nodeCount: 4, upgradeEntitlement: 4, inspectionEntitlement: 4 }], assets: [],
};
function storage(t, fail = false) {
  const old = globalThis.indexedDB;
  t.after(() => { if (old) globalThis.indexedDB = old; else delete globalThis.indexedDB; });
  const stores = { requests: [{ id: 'old-request' }], configs: [], references: [{ id: 'workspace', payload: workspace }, ...demoWorkflowRuleReferences(workspace)] };
  globalThis.indexedDB = { open() {
    const opening = { result: { close() {}, transaction(names, mode) {
      assert.deepEqual(names, ['requests', 'configs', 'references']); assert.equal(mode, 'readwrite');
      const staged = structuredClone(stores); let aborted = false, reads = 0;
      const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort()); }, objectStore(name) { return {
        getAll() { const r = { result: staged[name] }; queueMicrotask(() => { r.onsuccess(); if (++reads === 3 && !aborted) { Object.assign(stores, staged); tx.oncomplete(); } }); return r; },
        clear() { staged[name] = []; },
        add(r) { if (fail) throw new Error('模拟写入失败'); staged[name].push(r); },
        put(r) { staged[name] = [...staged[name].filter(old => old.id !== r.id), r]; },
      }; } }; return tx;
    } } };
    queueMicrotask(() => opening.onsuccess()); return opening;
  } };
  return stores;
}

test('仅重建请求，保留当前规则、用户和目录，刷新后不再覆盖', async t => {
  const stores = storage(t), refs = structuredClone(stores.references), configs = structuredClone(stores.configs);
  await reinitializeRuleBasedRequestSamples();
  assert.equal(stores.requests.length, 16);
  assert.deepEqual(stores.references.filter(r => refs.some(old => old.id === r.id)), refs);
  assert.deepEqual(stores.configs, configs);
  assert.ok(stores.references.some(r => r.id === ruleBasedRequestSamplesMarker));
  stores.requests[0].title = '用户后续编辑';
  await reinitializeRuleBasedRequestSamples();
  assert.equal(stores.requests[0].title, '用户后续编辑');
});

test('写入失败时旧请求和配置保持完整，不写入成功标记', async t => {
  const stores = storage(t, true), before = structuredClone(stores);
  await assert.rejects(reinitializeRuleBasedRequestSamples(), /模拟写入失败/);
  assert.deepEqual(stores, before);
});

test('已初始化站点只补入三条售前样例，保留旧请求、配置，刷新不重建删除的样例', async t => {
  const stores = storage(t);
  stores.references.push({ id: ruleBasedRequestSamplesMarker, payload: { initializedAt: 'before' } });
  const existing = structuredClone(stores.requests), references = structuredClone(stores.references);
  await reinitializeRuleBasedRequestSamples();
  assert.deepEqual(stores.requests.slice(0, existing.length), existing);
  assert.equal(stores.requests.length, existing.length + 3);
  assert.deepEqual(stores.references.filter(r => r.id !== presalesRequestSamplesMarker), references);
  assert.ok(stores.references.some(r => r.id === presalesRequestSamplesMarker));
  stores.requests[1].title = '用户修改的售前请求';
  stores.requests.pop();
  const after = structuredClone(stores);
  await reinitializeRuleBasedRequestSamples();
  assert.deepEqual(stores, after);
});

test('售前补入失败时回滚，原请求及规则不变', async t => {
  const stores = storage(t, true);
  stores.references.push({ id: ruleBasedRequestSamplesMarker });
  const before = structuredClone(stores);
  await assert.rejects(reinitializeRuleBasedRequestSamples(), /模拟写入失败/);
  assert.deepEqual(stores, before);
});
