import test from 'node:test';
import assert from 'node:assert/strict';
import { addSupplement, visibleSupplements, supplementSaveIssue } from './request-supplements.ts';
const pm = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const customer = { id: 'customer', name: '客户', role: '客户' };
const request = { id: 'r', customerId: 'c', status: '草稿' };
const input = (actor, id = 's') => ({ id, authorId: actor.id, author: actor.name, at: '2026-09-09T08:00:00Z', comment: '补充说明', files: [], externalVisible: true });
test('客户和内部人员在草稿、待评估可提交，其他状态及跨客户拒绝', () => {
  for (const status of ['草稿', '待评估']) {
    for (const actor of [pm, customer]) {
      const record = { ...request, status };
      const next = addSupplement(record, actor, 'c', input(actor));
      assert.equal(next.operations.supplements.length, 1);
      assert.equal(supplementSaveIssue(next, record, actor, 'c'), null);
      assert.equal(record.operations, undefined);
    }
  }
  for (const status of ['待确认', '待受理', '已转服务项目', '已取消']) assert.throws(() => addSupplement({ ...request, status }, pm, 'c', input(pm)));
  assert.throws(() => addSupplement(request, customer, 'other', input(customer)));
});
test('内部资料不出现在客户记录或计数中，客户不能发布仅内部可见内容', () => {
  const privateRecord = addSupplement(request, pm, 'c', { ...input(pm), externalVisible: false });
  const next = addSupplement(privateRecord, customer, 'c', input(customer, 'public'));
  assert.equal(visibleSupplements(next, pm).length, 2);
  assert.deepEqual(visibleSupplements(next, customer).map(item => item.id), ['public']);
  assert.throws(() => addSupplement(request, customer, 'c', { ...input(customer), externalVisible: false }));
  const tampered = structuredClone(next); tampered.operations.supplements[0].externalVisible = true;
  assert.match(supplementSaveIssue(tampered, next, customer, 'c'), /不可修改/);
});
test('支持仅文件，保存实际字节，拒绝空内容、非法附件、冒名和重复提交', async () => {
  const blob = new Blob(['补充文件'], { type: 'application/pdf' });
  const payload = { ...input(pm), comment: '', files: [{ id: 'f', name: '材料.pdf', size: blob.size, blob, uploadedAt: input(pm).at }] };
  const next = addSupplement(request, pm, 'c', payload);
  assert.equal(await next.operations.supplements[0].files[0].blob.text(), '补充文件');
  assert.throws(() => addSupplement(request, pm, 'c', { ...input(pm), comment: '' }));
  assert.throws(() => addSupplement(request, pm, 'c', { ...payload, files: [{ ...payload.files[0], size: 0 }] }));
  assert.throws(() => addSupplement(request, pm, 'c', input(customer)));
  assert.throws(() => addSupplement(next, pm, 'c', payload));
});
