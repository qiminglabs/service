import test from 'node:test';
import assert from 'node:assert/strict';
import { newServiceProject, projectForActor } from './service-projects.ts';
import {
  applyProjectOperation,
  canRecordProjectWorklog,
} from './service-project-operations.ts';
import { projectOperationsOf } from './service-project-activity.ts';
import { storedFile } from './service-requests.ts';
import { meetingAttachments, meetingTranscript } from './request-operations.ts';
const actor = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const partner = {
  id: 'partner-user',
  name: '伙伴工程师',
  role: '合作伙伴服务工程师',
};
const now = '2026-09-16T10:00:00';
const project = () => ({
  ...newServiceProject(
    {
      name: '会议项目',
      customerId: 'c1',
      expectedServiceDate: '2026-09-18',
      note: '',
    },
    actor,
    [{ id: 'c1', name: '客户', status: '启用' }],
  ),
  collaborators: {
    internal: [{ id: actor.id, name: actor.name }],
    customer: [{ id: 'contact', name: '客户联系人' }],
    partner: [{ id: partner.id, name: partner.name }],
  },
});
const schedule = {
  type: 'meeting-schedule',
  title: '需求沟通',
  scheduledDate: '2026-09-17',
  scheduledTime: '14:00',
  durationMinutes: 60,
};
const apply = (record, action, who = actor) =>
  applyProjectOperation(record, action, who, now);
const work = {
  type: 'worklog-add',
  date: '2026-09-15',
  startTime: '09:00',
  endTime: '11:30',
  category: '会议沟通',
  description: '整理会议结论',
};

test('会议预约、三类协作人通知、开始和结束沿用请求流程，并记录活动且不修改项目业务字段', () => {
  const original = project();
  let record = apply(original, schedule);
  const id = record.operations.meetings[0].id;
  assert.equal(record.operations.meetings[0].mode, 'local-demo');
  assert.equal(record.operations.meetings[0].status, '已预约');
  record = apply(record, {
    type: 'meeting-notify',
    id,
    userIds: ['pm'],
    contactIds: ['contact'],
    partnerIds: [partner.id],
  });
  assert.match(
    record.operations.activities.at(-1).detail,
    /合作伙伴协作人：伙伴工程师/,
  );
  assert.match(
    record.operations.activities.at(-1).detail,
    /本地模拟，未实际发送/,
  );
  assert.throws(
    () =>
      apply(record, {
        type: 'meeting-notify',
        id,
        userIds: ['wrong'],
        contactIds: [],
      }),
    /已变更/,
  );
  assert.throws(
    () => apply(record, { type: 'meeting-start', id }, partner),
    /仅主持人/,
  );
  record = apply(record, { type: 'meeting-start', id });
  assert.deepEqual(record.operations.meetings[0].participantNames, [
    '项目经理',
    '伙伴工程师',
    '客户联系人',
  ]);
  assert.throws(() => apply(record, { type: 'meeting-start', id }), /仅已预约/);
  record = apply(record, { type: 'meeting-end', id });
  assert.equal(record.operations.meetings[0].status, '已结束');
  assert.equal(meetingTranscript(record.operations.meetings[0]).example, true);
  assert.throws(
    () =>
      apply(record, {
        type: 'meeting-notify',
        id,
        userIds: ['pm'],
        contactIds: [],
      }),
    /未结束/,
  );
  assert.equal(record.revision, original.revision + 4);
  assert.equal(record.operations.activities.length, 4);
  for (const key of [
    'name',
    'status',
    'customerId',
    'createdById',
    'createdAt',
  ])
    assert.equal(record[key], original[key]);
  assert.equal(original.operations, undefined);
});

test('会议校验预约时间和时长，附件仅主持人或管理员可维护，拒绝重复及超限文件', () => {
  for (const patch of [
    { scheduledDate: '2026-02-30' },
    { scheduledTime: '25:00' },
    { scheduledDate: '2026-09-15' },
    { durationMinutes: 2 },
    { title: ' ' },
  ]) {
    assert.throws(() => apply(project(), { ...schedule, ...patch }));
  }
  let record = apply(project(), schedule);
  const id = record.operations.meetings[0].id;
  const file = storedFile(new File(['会议记录'], '记录.txt'));
  assert.throws(
    () =>
      apply(
        record,
        { type: 'meeting-attachments-add', id, files: [file] },
        partner,
      ),
    /仅主持人/,
  );
  record = apply(record, {
    type: 'meeting-attachments-add',
    id,
    files: [file],
  });
  assert.equal(meetingAttachments(record.operations.meetings[0]).length, 1);
  assert.throws(
    () => apply(record, { type: 'meeting-attachments-add', id, files: [file] }),
    /已存在/,
  );
  const large = storedFile(
    new File([new Uint8Array(20 * 1024 * 1024 + 1)], '大文件.txt'),
  );
  assert.throws(
    () =>
      apply(record, { type: 'meeting-attachments-add', id, files: [large] }),
    /20 MB/,
  );
  record = apply(record, {
    type: 'meeting-attachment-delete',
    id,
    fileId: file.id,
  });
  assert.deepEqual(meetingAttachments(record.operations.meetings[0]), []);
  assert.throws(
    () =>
      apply(record, { type: 'meeting-attachment-delete', id, fileId: file.id }),
    /不存在/,
  );
});

test('工时自动按分钟换算，仅本人可编辑作废，作废记录保留且不计入汇总', () => {
  let record = apply(project(), work);
  const id = record.operations.worklogs[0].id;
  assert.equal(record.operations.worklogs[0].hours, 2.5);
  record = apply(record, {
    ...work,
    type: 'worklog-edit',
    id,
    endTime: '12:00',
  });
  assert.equal(record.operations.worklogs[0].hours, 3);
  assert.equal(record.operations.worklogs.length, 1);
  assert.throws(
    () =>
      apply(
        record,
        { ...work, type: 'worklog-edit', id },
        { ...actor, id: 'other' },
      ),
    /只能编辑自己的/,
  );
  assert.throws(
    () => apply(record, { type: 'worklog-void', id, reason: '更正' }, partner),
    /只能作废自己的/,
  );
  assert.throws(
    () => apply(record, { ...work, date: '2026-09-17' }),
    /不晚于今天/,
  );
  assert.throws(() => apply(record, { ...work, endTime: '08:00' }), /终止时间/);
  assert.throws(
    () => apply(record, { ...work, startTime: '00:00', endTime: '23:00' }),
    /24 小时/,
  );
  record = apply(record, { type: 'worklog-void', id, reason: '重复录入' });
  assert.equal(record.operations.worklogs.length, 1);
  assert.equal(record.operations.worklogs[0].voidReason, '重复录入');
  assert.equal(
    record.operations.worklogs.filter((log) => !log.voidedAt).length,
    0,
  );
  assert.throws(
    () => apply(record, { ...work, type: 'worklog-edit', id }),
    /有效工时/,
  );
});

test('合作伙伴记录本人会议和工时，内部工时及其活动不会对外泄露', () => {
  let record = apply(project(), schedule, partner);
  assert.equal(record.operations.meetings[0].hostId, partner.id);
  record = apply(record, work);
  record = apply(record, work, partner);
  assert.equal(canRecordProjectWorklog(record, partner), true);
  const visible = projectForActor(record, partner);
  assert.equal(visible.operations.meetings.length, 1);
  assert.deepEqual(
    visible.operations.worklogs.map((log) => log.userId),
    [partner.id],
  );
  assert.equal(
    visible.operations.activities.filter(
      (activity) => activity.category === '工时',
    ).length,
    1,
  );
  assert.equal(record.operations.worklogs.length, 2);
});

test('终态项目、无权身份不能写操作，旧项目读空模块，不接受其他请求动作', () => {
  assert.deepEqual(projectOperationsOf(project()), {
    meetings: [],
    worklogs: [],
    activities: [],
  });
  for (const status of ['已完成', '已取消'])
    assert.throws(() => apply({ ...project(), status }, schedule), /已结束/);
  assert.throws(
    () => apply(project(), schedule, { ...partner, id: 'unrelated' }),
    /无权/,
  );
  assert.throws(() => apply(project(), { type: 'basis-add' }), /不支持/);
});
