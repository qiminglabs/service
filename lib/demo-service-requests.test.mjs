import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestSamples, initializeRequestSamples, requestSamplesMarker } from './demo-service-requests.ts';
import { localInternalUsers } from './internal-users.ts';
import { importedServiceCatalogSeeds } from '../app/service-catalog-import.ts';
import { defaultConfig, requestIssues } from './service-requests.ts';
import { assessmentLockIssue } from './request-assessment.ts';
import { requestReturnNotice } from './request-operations.ts';
import { deliveryConversionIssue, deliveryConversionMaterialIssues } from './request-type-workflow.ts';
import { operationIdentities } from './internal-users.ts';

const sources = {
  services: importedServiceCatalogSeeds.map((s, i) => ({ id: `svc-${i}`, name: s.serviceName, category: s.serviceCategory, status: '已启用', deliveryMethods: ['远程', '现场'], priceUnit: s.pricingUnit ?? '服务人天', priceCoefficient: 1, defaultQuantity: 1 })),
  users: localInternalUsers,
  customers: [{ id: 'c1', name: '示例客户', status: '启用' }],
  contacts: [{ id: 'contact1', customerId: 'c1', name: '示例联系人', status: '启用', email: 'contact@example.com' }],
  businessObjects: [{ id: 'obj1', customerId: 'c1', name: '生产集群', status: '启用', product: 'SMTX OS 系统', nodeCount: 4, upgradeEntitlement: 4, inspectionEntitlement: 4 }],
  assets: [],
};
const now = new Date('2026-09-09T08:00:00Z');

test('售前样例覆盖评估中、评估完成和真实转为服务交付，保留结论且不提前关联服务依据', () => {
  const samples = buildRequestSamples(sources, [], [], [], now, true, 'presales');
  assert.deepEqual(samples.map(r => [r.id, r.requestType, r.status]), [
    ['SR-DEMO-014', '技术评估', '待评估'],
    ['SR-DEMO-015', '技术评估', '评估完成'],
    ['SR-DEMO-016', '服务交付', '待评估'],
  ]);
  for (const request of samples) {
    assert.deepEqual(requestIssues(request, sources), []);
    assert.equal(request.operations.assessment?.plans.length ?? 0, 0);
    assert.equal(request.operations.assessment?.approvals.length ?? 0, 0);
    assert.ok(!request.operations.assessment?.confirmation);
  }
  const completed = samples[1], converted = samples[2];
  for (const request of [completed, converted]) {
    assert.equal(request.operations.assessment.rounds.at(-1).outcome, '评估通过');
    assert.ok(request.operations.assessment.effort.days > 0);
  }
  const manager = operationIdentities(sources.users).find(person => person.id === completed.operations.assessment.managerId);
  assert.equal(deliveryConversionIssue(completed, manager, sources.users), null);
  assert.deepEqual(deliveryConversionMaterialIssues(completed), []);
  assert.equal(converted.operations.activities.at(-1).title, '转为服务交付');
  assert.match(converted.operations.activities.at(-1).detail, /技术评估 → 服务交付/);
});

test('5 条样例各有 1–3 项，覆盖人天/升级/巡检目录、五种状态和可下载材料', async () => {
  const before = structuredClone(sources);
  const samples = buildRequestSamples(sources, [], [], [], now);
  assert.deepEqual(samples.map(r => r.status), ['草稿', '待评估', '待确认', '待受理', '已取消']);
  assert.deepEqual(samples.map(r => r.items.length), [1, 2, 3, 2, 1]);
  assert.equal(new Set(samples.map(r => r.id)).size, 5);
  assert.deepEqual(new Set(samples.flatMap(r => r.items.map(item => sources.services.find(s => s.id === item.serviceId).priceUnit))), new Set(['服务人天', '升级权益', '巡检权益']));
  for (const sample of samples) {
    assert.deepEqual(requestIssues(sample, sources), []);
    assert.equal(assessmentLockIssue(sample, samples, sources.assets, sources.businessObjects), null);
    assert.ok(sample.internalParticipants.every(p => sources.users.some(u => u.id === p.userId)));
    assert.equal(sample.externalCollaborators[0].contactId, sources.contacts[0].id);
    assert.ok(sample.expectedServiceDate > '2026-09-09');
    for (const item of sample.items) for (const material of item.materials) {
      const file = material.files[0];
      assert.equal(file.size, file.blob.size);
      assert.match(await file.blob.text(), /仅用于 Demo/);
    }
  }
  assert.ok(samples[2].operations.assessment.confirmation.planId);
  assert.equal(samples[3].operations.customerDecisions[0].accepted, true);
  assert.match(requestReturnNotice(samples[4]).reason, /维护计划/);
  assert.deepEqual(sources, before);
});

test('使用当前配置、已占用权益和换算版本，保留已有申请', () => {
  const existing = buildRequestSamples(sources, [], [], [], now).map(r => ({ ...r, id: r.id.replace('DEMO', 'EXISTING') }));
  const before = structuredClone(existing);
  const service = sources.services[0];
  const config = { ...defaultConfig(service), fields: ['nodes', 'custom'], fieldOptions: { custom: ['当前选项'] }, materials: [{ id: 'custom-material', name: '最新材料', required: true, instructions: '' }] };
  const samples = buildRequestSamples(sources, existing, [config], [{ id: 'entitlement-conversion-upgrade', payload: [{ days: 0.5, version: 2 }] }], now);
  assert.equal(samples[0].items[0].values.custom, '当前选项');
  assert.equal(samples[0].items[0].materials[0].requirementId, 'custom-material');
  const line = samples[2].operations.assessment.effort.lines.find(line => line.entitlementKind === 'upgrade');
  assert.equal(line.deficitEntitlements, 4);
  assert.equal(line.priceCoefficient, 0.5);
  assert.equal(line.conversionVersion, 2);
  assert.deepEqual(existing, before);
  assert.deepEqual(buildRequestSamples(sources, samples, [], [], now), []);
});

test('原子初始化只执行一次，刷新不覆盖修改、不恢复已删除样例', async t => {
  const previous = globalThis.indexedDB;
  t.after(() => { if (previous) globalThis.indexedDB = previous; else delete globalThis.indexedDB; });
  const stores = { requests: [{ id: 'existing', title: '用户原有数据' }], configs: [], references: [] };
  globalThis.indexedDB = { open() {
    const open = { result: { close() {}, transaction() {
      const staged = structuredClone(stores);
      let pending = 0, aborted = false;
      const tx = {
        abort() { aborted = true; queueMicrotask(() => tx.onabort()); },
        objectStore(name) {
          const read = value => {
            pending++;
            const req = { result: structuredClone(value) };
            queueMicrotask(() => {
              req.onsuccess?.();
              if (--pending === 0 && !aborted) { Object.assign(stores, staged); tx.oncomplete(); }
            });
            return req;
          };
          return { get: id => read(staged[name].find(r => r.id === id)), getAll: () => read(staged[name]), put(record) { staged[name] = [...staged[name].filter(r => r.id !== record.id), structuredClone(record)]; }, add(record) {
            assert.ok(!staged[name].some(r => r.id === record.id));
            staged[name].push(structuredClone(record));
          } };
        },
      };
      return tx;
    } } };
    queueMicrotask(() => open.onsuccess());
    return open;
  } };
  await initializeRequestSamples(sources);
  assert.equal(stores.requests.length, 6);
  assert.ok(stores.references.some(r => r.id === requestSamplesMarker));
  stores.requests[1].title = '用户修改';
  stores.requests.pop();
  await initializeRequestSamples(sources);
  assert.equal(stores.requests.length, 5);
  assert.equal(stores.requests[0].title, '用户原有数据');
  assert.equal(stores.requests[1].title, '用户修改');
  stores.references = [];
  const before = structuredClone(stores);
  await assert.rejects(initializeRequestSamples({ ...sources, services: [] }));
  assert.deepEqual(stores, before);
});

test('初始化包含真实关联人员的会议、客户/内部补充信息及可核对工时', async () => {
  const samples = buildRequestSamples(sources, [], [], [], now);
  for (const record of samples) {
    assert.equal(record.operations.supplements.length, 2);
    assert.ok(record.operations.supplements.some(s => s.externalVisible && s.authorId === sources.contacts[0].id));
    const internal = record.operations.supplements.find(s => !s.externalVisible);
    assert.match(await internal.files[0].blob.text(), /环境核对清单/);
    if (record.status === '草稿') {
      assert.equal(record.operations.meetings.length, 0);
      assert.equal(record.operations.worklogs.length, 0);
      continue;
    }
    const ended = record.operations.meetings.find(m => m.status === '已结束');
    assert.ok(ended);
    assert.ok(Date.parse(ended.endedAt) > Date.parse(ended.startedAt));
    assert.match(ended.transcript, /演示会议纪要/);
    assert.match(await ended.attachments[0].blob.text(), /需求澄清/);
    assert.equal(record.operations.worklogs.length, 2);
    assert.equal(record.operations.worklogs.reduce((sum, log) => sum + log.hours, 0), 2.5);
    assert.ok(record.operations.worklogs.every(log => record.internalParticipants.some(person => person.userId === log.userId)));
  }
  assert.ok(samples[1].operations.meetings.some(m => m.status === '已预约'));
});
