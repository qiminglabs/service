import test from 'node:test';
import assert from 'node:assert/strict';
import { requestReturnNotice } from './request-operations.ts';
const record = { status: '草稿', operations: {
  draftReturns: [{ at: '2026-09-08', actorId: 'pm', reason: '补充部署材料' }],
  customerDecisions: [{ accepted: false, reason: '旧的客户拒绝理由' }],
  activities: [{ title: '取消服务请求', detail: '客户终止项目' }],
} };
test('仅退回草稿或取消时显示对应原因，其他状态不泄漏历史拒绝理由', () => {
  assert.deepEqual(requestReturnNotice(record), { title: '退回原因', reason: '补充部署材料' });
  assert.equal(requestReturnNotice({ ...record, operations: { ...record.operations, draftReturns: [] } }), null);
  assert.deepEqual(requestReturnNotice({ ...record, status: '已取消' }), { title: '取消原因', reason: '客户终止项目' });
  for (const status of ['待评估', '待确认', '待受理', '已转工单']) assert.equal(requestReturnNotice({ ...record, status }), null);
  assert.deepEqual(requestReturnNotice({ status: '已取消' }), { title: '取消原因', reason: '未记录取消原因。' });
});
