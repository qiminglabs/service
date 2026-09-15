import test from 'node:test';
import assert from 'node:assert/strict';
import { removedDemoRuleUpdates, removedDemoRulesMarker, removeSelectedDemoRules } from './remove-demo-rules.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import { assessmentRoutingId } from './assessment-routing-schema.ts';
import { approvalRulesId } from './approval-rules.ts';

const refs = [
  { id: submissionRulesId, payload: ['demo-rule-item-description', 'demo-rule-presales', 'demo-rule-customer-contact', 'demo-rule-assessment-materials', 'demo-rule-confirmation-effort', 'demo-rule-expected-service-three-days', 'custom'].map(id => ({ id })) },
  { id: assessmentRoutingId, payload: { version: 1, revision: 5, manager: { rules: [{ id: 'demo-manager-onsite' }] }, hardware: { defaultUserId: 'USR-008', trigger: { enabled: true, serviceIds: ['hardware'] }, rules: ['demo-hardware-finance', 'demo-hardware-onsite', 'demo-hardware-customer', 'custom'].map(id => ({ id })) } } },
  { id: approvalRulesId, payload: { version: 1, defaultUserId: 'USR-006', defaultRevision: 3, rules: ['demo-approval-finance', 'demo-approval-onsite', 'demo-approval-upgrade', 'demo-approval-customer', 'custom'].map(id => ({ id })) } },
  { id: 'workspace', payload: { users: [{ id: 'existing-user' }] } },
];

test('精确删除截图九条样例规则，保留默认人、触发条件、其他规则和主数据', () => {
  const before = structuredClone(refs);
  const updates = removedDemoRuleUpdates(refs);
  assert.deepEqual(updates.find(r => r.id === submissionRulesId).payload.map(r => r.id), ['demo-rule-expected-service-three-days', 'custom']);
  const routing = updates.find(r => r.id === assessmentRoutingId).payload;
  assert.deepEqual(routing.manager, refs[1].payload.manager);
  assert.equal(routing.revision, 6);
  assert.equal(routing.hardware.defaultUserId, 'USR-008');
  assert.deepEqual(routing.hardware.trigger, refs[1].payload.hardware.trigger);
  assert.deepEqual(routing.hardware.rules.map(r => r.id), ['demo-hardware-finance', 'custom']);
  const approvals = updates.find(r => r.id === approvalRulesId).payload;
  assert.equal(approvals.defaultRevision, 3);
  assert.equal(approvals.defaultUserId, 'USR-006');
  assert.deepEqual(approvals.rules.map(r => r.id), ['demo-approval-finance', 'demo-approval-onsite', 'custom']);
  assert.ok(!updates.some(r => r.id === 'workspace'));
  assert.deepEqual(refs, before);
  assert.deepEqual(removedDemoRuleUpdates([...refs, updates.find(r => r.id === removedDemoRulesMarker)]), []);
});

test('删除与一次性标记在同一事务提交，刷新不重复写入', async t => {
  const old = globalThis.indexedDB;
  t.after(() => { if (old) globalThis.indexedDB = old; else delete globalThis.indexedDB; });
  const records = new Map(refs.map(r => [r.id, structuredClone(r)]));
  let writes = 0;
  globalThis.indexedDB = { open() {
    const opening = { result: { close() {}, transaction(name, mode) {
      assert.equal(name, 'references'); assert.equal(mode, 'readwrite');
      const tx = { objectStore() { return { getAll() {
        const read = { result: [...records.values()] };
        queueMicrotask(() => { read.onsuccess(); tx.oncomplete(); });
        return read;
      }, put(record) { records.set(record.id, record); writes++; } }; } };
      return tx;
    } } };
    queueMicrotask(() => opening.onsuccess()); return opening;
  } };
  await removeSelectedDemoRules();
  assert.equal(writes, 4);
  assert.ok(records.has(removedDemoRulesMarker));
  await removeSelectedDemoRules();
  assert.equal(writes, 4);
});
