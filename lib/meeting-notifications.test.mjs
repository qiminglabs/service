import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest } from './service-requests.ts';
import { applyRequestAction } from './request-operations.ts';

const actor = { id: 'host', name: '主持人', role: 'SmartX 销售经理' };
const now = '2026-09-14T08:00:00.000Z';
const act = (record, action, who = actor) => applyRequestAction(record, action, who, [], now);
function scheduled() {
  return act({
    ...newRequest('通知测试', 'customer', actor.name),
    status: '待评估',
    internalParticipants: [{ userId: 'same-id', name: '内部甲' }, { userId: 'u2', name: '内部乙' }],
    externalCollaborators: [{ contactId: 'same-id', name: '外部甲' }, { contactId: 'c2', name: '外部乙' }],
  }, {
    type: 'meeting-schedule', title: '需求沟通', scheduledDate: '2030-09-17',
    scheduledTime: '14:30', durationMinutes: 60,
  });
}
const notify = (record, patch = {}) => ({
  type: 'meeting-notify', id: record.operations.meetings[0].id,
  userIds: ['same-id'], contactIds: ['same-id'], ...patch,
});

test('发送仅追加一条活动记录，内外部同标识人员分别记录，原请求保持不变', () => {
  const record = scheduled();
  const before = structuredClone(record);
  const next = act(record, notify(record, { userIds: ['same-id', 'same-id'] }));
  assert.deepEqual(record, before);
  assert.deepEqual({ ...next, operations: { ...next.operations, activities: record.operations.activities } }, record);
  assert.equal(next.operations.activities.length, record.operations.activities.length + 1);
  const entry = next.operations.activities.at(-1);
  assert.equal(entry.title, '发送会议通知');
  assert.equal(entry.actorId, actor.id);
  assert.equal(entry.at, now);
  assert.match(entry.detail, /需求沟通.*2030-09-17 14:30.*内部协作人：内部甲.*外部协作人：外部甲/);
  assert.equal(entry.detail.match(/内部甲/g).length, 1);
  assert.doesNotMatch(entry.detail, /内部乙|外部乙/);
});

test('已预约和进行中的会议均可重复发送，每次追加记录，也可只选内部或外部人员', () => {
  for (const status of ['已预约', '进行中']) {
    let record = scheduled();
    record.operations.meetings[0].status = status;
    const count = record.operations.activities.length;
    const meeting = structuredClone(record.operations.meetings[0]);
    record = act(record, notify(record, { contactIds: [] }));
    record = act(record, notify(record, { userIds: [] }));
    record = act(record, notify(record, { userIds: [] }));
    assert.equal(record.operations.activities.length, count + 3);
    assert.notEqual(record.operations.activities.at(-1).id, record.operations.activities.at(-2).id);
    assert.deepEqual(record.operations.meetings[0], meeting);
  }
});

test('拒绝空选择、非当前协作人及已移除人员，错误不新增活动', () => {
  const record = scheduled();
  const before = structuredClone(record);
  for (const patch of [
    { userIds: [], contactIds: [] },
    { userIds: ['unknown'] },
    { contactIds: ['u2'] },
    { userIds: ['c2'] },
    { userIds: ['same-id', 'unknown'] },
  ]) assert.throws(() => act(record, notify(record, patch)), /协作人/);
  assert.throws(() => act({ ...record, externalCollaborators: [] }, notify(record)), /外部协作人/);
  assert.deepEqual(record, before);
});

test('已结束或不存在的会议、草稿和终止请求以及外部身份均不能发送', () => {
  const record = scheduled();
  assert.throws(() => act(record, notify(record, { id: 'missing' })), /未结束/);
  const ended = structuredClone(record);
  ended.operations.meetings[0].status = '已结束';
  assert.throws(() => act(ended, notify(ended)), /未结束/);
  for (const status of ['草稿', '已取消', '已转服务项目'])
    assert.throws(() => act({ ...record, status }, notify(record)), /提交申请|已结束/);
  assert.throws(() => act(record, notify(record), { id: 'same-id', name: '外部甲', role: '客户' }), /内部操作人/);
});
