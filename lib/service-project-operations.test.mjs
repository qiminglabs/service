import test from 'node:test';
import assert from 'node:assert/strict';
import { newServiceProject, projectForActor } from './service-projects.ts';
import {
  applyProjectOperation,
  canRecordProjectWorklog,
} from './service-project-operations.ts';
import { projectOperationsOf } from './service-project-activity.ts';
import { projectWorklogTotals } from './project-worklog-pricing.ts';
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
  workOrders: [{ id: 'wo-1', status: '进行中', item: { serviceId: 'service-1', serviceName: '部署服务' }, catalogSnapshot: { id: 'service-1', name: '部署服务', priceUnit: '人天', priceCoefficient: 1.5 } }],
  collaborators: {
    internal: [{ id: actor.id, name: actor.name, assignmentRoles: ['项目经理'] }],
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
  workOrderId: 'wo-1',
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
    /无权/,
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


test('工时必须关联当前项目工单，禁止新增关联取消工单，允许完成工单补录', () => {
  for (const workOrderId of ['', undefined, 'other-project-order']) {
    assert.throws(() => apply(project(), { ...work, workOrderId }), /关联工单/);
  }
  const p = project();
  p.workOrders[0].status = '已取消';
  assert.throws(() => apply(p, work), /已取消/);
  p.workOrders[0].status = '已完成';
  const saved = apply(p, work);
  assert.equal(saved.operations.worklogs[0].workOrderId, 'wo-1');
  assert.equal(saved.operations.worklogs[0].pricing.hours, 3.75);
});

test('按目录系数计价，编辑重算、切换工单换系数，作废后汇总扣除', () => {
  let p = apply(project(), work);
  const id = p.operations.worklogs[0].id;
  assert.equal(projectWorklogTotals(p).billableHours, 3.75);
  p.workOrders[0].catalogSnapshot.priceCoefficient = 9;
  p = apply(p, { ...work, type: 'worklog-edit', id, endTime: '12:00' });
  assert.equal(p.operations.worklogs[0].pricing.coefficient, 1.5);
  assert.equal(projectWorklogTotals(p).billableHours, 4.5);
  p.workOrders.push({ ...p.workOrders[0], id: 'wo-2', catalogSnapshot: { ...p.workOrders[0].catalogSnapshot, priceCoefficient: 2 } });
  p = apply(p, { ...work, type: 'worklog-edit', id, workOrderId: 'wo-2' });
  assert.equal(projectWorklogTotals(p).billableHours, 5);
  p = apply(p, { type: 'worklog-void', id, reason: '重复' });
  assert.equal(projectWorklogTotals(p).billableHours, 0);
  assert.equal(projectWorklogTotals(p).actualHours, 0);
});

test('权益类只记实际工时，历史未关联记录标记待完善，编辑必须补工单', () => {
  const original = project();
  original.workOrders[0].catalogSnapshot.priceUnit = '巡检权益';
  let p = apply(original, work);
  assert.equal(p.operations.worklogs[0].pricing.kind, 'entitlement');
  assert.deepEqual(projectWorklogTotals(p), { actualHours: 2.5, billableHours: 0, pending: 0, entitlement: 1 });
  delete p.operations.worklogs[0].workOrderId;
  const id = p.operations.worklogs[0].id;
  assert.equal(projectWorklogTotals(p).pending, 1);
  assert.throws(() => apply(p, { ...work, type: 'worklog-edit', id, workOrderId: '' }), /关联工单/);
  p = apply(p, { ...work, type: 'worklog-edit', id });
  assert.equal(projectWorklogTotals(p).pending, 0);
});

test('缺少计价配置仍保留真实工时；旧工单使用当前目录并保存计价快照', () => {
  let p = project();
  delete p.workOrders[0].catalogSnapshot;
  const unknown = apply(p, work);
  assert.equal(projectWorklogTotals(unknown).pending, 1);
  const services = [{ id: 'service-1', name: '部署服务', priceUnit: '人天', priceCoefficient: 1.25 }];
  p = applyProjectOperation(p, work, actor, now, services);
  assert.equal(p.operations.worklogs[0].pricing.hours, 3.125);
  services[0].priceCoefficient = 8;
  assert.equal(projectWorklogTotals(p, services).billableHours, 3.125);
});

test('分钟工时保留计算精度，拆分录入不会重复舍入计价', () => {
  let p = project();
  for (let minute = 0; minute < 3; minute++) {
    p = apply(p, { ...work, startTime: `09:0${minute}`, endTime: `09:0${minute + 1}` });
  }
  assert.ok(Math.abs(projectWorklogTotals(p).billableHours - 0.075) < 1e-10);
});

test('全部 SmartX 协作人在非终态均可录入并维护本人工时，不能编辑他人工时或管理会议', () => {
  const roles = ['SmartX 服务工程师', 'SmartX 售前工程师', 'SmartX 销售经理', 'SmartX 硬件产品经理', 'SmartX 系统管理员', 'SmartX 项目经理'];
  for (const role of roles) for (const status of ['待启动', '进行中', '待复核', '待确认']) {
    const member = { id: 'member', name: '协作成员', role };
    let p = { ...project(), status };
    p.collaborators.internal.push({ id: member.id, name: member.name, ...(member.role === 'SmartX 项目经理' ? { assignmentRoles: ['项目经理'] } : {}) });
    assert.equal(canRecordProjectWorklog(p, member), true, `${role}/${status}`);
    p = apply(p, work, member);
    const id = p.operations.worklogs[0].id;
    assert.equal(p.operations.worklogs[0].userId, member.id);
    assert.equal(p.operations.worklogs[0].workOrderId, 'wo-1');
    p = apply(p, { ...work, type: 'worklog-edit', id, endTime: '12:00' }, member);
    assert.equal(p.operations.worklogs[0].pricing.hours, 4.5);
    assert.throws(() => apply(p, { ...work, type: 'worklog-edit', id }, actor), /自己的/);
    assert.throws(() => apply(p, { type: 'worklog-void', id, reason: '替人作废' }, actor), /自己的/);
    if (!['SmartX 系统管理员', 'SmartX 项目经理'].includes(role)) assert.throws(() => apply(p, schedule, member), /无权/);
    p = apply(p, { type: 'worklog-void', id, reason: '修正' }, member);
    assert.ok(p.operations.worklogs[0].voidedAt);
  }
});

test('非协作人、已移除协作人、客户和关闭项目不能操作工时', () => {
  const member = { id: 'member', name: '协作成员', role: 'SmartX 服务工程师' };
  assert.equal(canRecordProjectWorklog(project(), member), false);
  assert.throws(() => apply(project(), work, member), /无权/);
  let p = project();
  p.collaborators.internal.push({ id: member.id, name: member.name, ...(member.role === 'SmartX 项目经理' ? { assignmentRoles: ['项目经理'] } : {}) });
  assert.equal(canRecordProjectWorklog(p, { ...member, role: '客户' }), false);
  p = apply(p, work, member);
  const id = p.operations.worklogs[0].id;
  for (const status of ['已完成', '已取消']) {
    const closed = { ...p, status };
    assert.equal(canRecordProjectWorklog(closed, member), false);
    for (const action of [work, { ...work, type: 'worklog-edit', id }, { type: 'worklog-void', id, reason: '修正' }]) assert.throws(() => apply(closed, action, member), /已结束/);
  }
  p.collaborators.internal = [];
  assert.throws(() => apply(p, { type: 'worklog-void', id, reason: '修正' }, member), /无权/);
});

test('项目经理逐条或批量确认工时，修改后重新待确认，其他身份及结束项目不可确认', () => {
  let p = project(); p.collaborators.internal[0].assignmentRoles = ['项目经理'];
  p = apply(p, work);
  const id = p.operations.worklogs[0].id;
  assert.equal(p.operations.worklogs[0].confirmedAt, undefined);
  assert.throws(() => apply(p, { type: 'worklog-confirm', ids: [id] }, partner), /无权/);
  assert.throws(() => apply(p, { type: 'worklog-confirm', ids: [id] }, { ...actor, id: 'other-pm' }), /无权/);
  const before = structuredClone(p);
  assert.throws(() => apply(p, { type: 'worklog-confirm', ids: [id, 'missing'] }), /已更新/);
  assert.deepEqual(p, before);
  p = apply(p, { type: 'worklog-confirm', ids: [id] });
  assert.equal(p.operations.worklogs[0].confirmedById, actor.id);
  assert.equal(p.operations.worklogs[0].confirmedBy, actor.name);
  assert.ok(p.operations.worklogs[0].confirmedAt);
  assert.throws(() => apply(p, { type: 'worklog-confirm', ids: [id] }), /已更新/);
  p = apply(p, { ...work, type: 'worklog-edit', id, description: '补充工作内容' });
  assert.equal(p.operations.worklogs[0].confirmedAt, undefined);
  assert.equal(p.operations.worklogs[0].confirmedById, undefined);
  assert.throws(() => apply({ ...p, status: '已完成' }, { type: 'worklog-confirm', ids: [id] }), /已结束/);
  p = apply(p, { type: 'worklog-void', id, reason: '重复录入' });
  assert.throws(() => apply(p, { type: 'worklog-confirm', ids: [id] }), /已更新/);
});

test('管理员维护他人工时保留归属，伙伴来源无工时，内部派给服务商可维护本人工时', () => {
  const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
  let p = apply(project(), work, partner);
  const original = p.operations.worklogs[0];
  p = apply(p, { ...work, type: 'worklog-edit', id: original.id, endTime: '12:00' }, admin);
  assert.equal(p.operations.worklogs[0].userId, partner.id);
  assert.equal(p.operations.worklogs[0].userName, original.userName);
  assert.equal(p.operations.activities.at(-1).actorId, admin.id);
  p = apply(p, { type: 'worklog-void', id: original.id, reason: '管理员代更正' }, admin);
  assert.ok(p.operations.worklogs[0].voidedAt);
  for (const person of [actor, partner, admin]) {
    const external = { ...project(), createdSite: '合作伙伴中心', createdById: partner.id };
    assert.equal(canRecordProjectWorklog(external, person), false);
    assert.throws(() => apply(external, work, person), /无需工时/);
  }
  const pending = { ...project(), review: { confirmations: [{ state: '待确认' }] } };
  assert.equal(canRecordProjectWorklog(projectForActor(pending, partner), partner), false);
});
