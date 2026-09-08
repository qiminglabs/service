import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, requestIdentityIssue } from './service-requests.ts';
import {
  applyRequestAction,
  appendActivity,
  operationsOf,
  uncoveredItems,
  basisUsable,
} from './request-operations.ts';

const now = '2026-09-08T08:00:00.000Z';
const pmo = { id: 'u1', name: 'PMO 一', role: 'SmartX 销售经理' };
const reviewer = { id: 'u2', name: '审核人', role: 'SmartX 销售经理' };
const sales = { id: 'u3', name: '销售一', role: 'SmartX 销售经理' };
const engineer = { id: 'u4', name: '工程师', role: 'SmartX 服务工程师' };
const assets = [
  { id: 'a1', name: '远程人天', customerId: 'c1', status: '启用' },
  { id: 'a2', name: '现场人天', customerId: 'c2', status: '启用' },
];
function request() {
  return {
    ...newRequest('实施申请', 'c1', '销售', 'contact1'),
    status: '待评估',
    submittedAt: now,
    items: [{ id: 'i1', serviceName: '部署' }],
    internalParticipants: [
      { userId: 'u1', name: 'PMO 一' },
      { userId: 'u3', name: '销售一' },
    ],
  };
}
const act = (r, a, who = pmo, refs = assets) =>
  applyRequestAction(r, a, who, refs, now);

test('预约会议保存日期时间和时长，不立即开会或自动填入协作人名单', () => {
  const original = request();
  let r = act(original, {
    type: 'meeting-schedule',
    title: '  需求沟通  ',
    scheduledDate: '2030-10-10',
    scheduledTime: '14:30',
    durationMinutes: 60,
  });
  const m = r.operations.meetings[0];
  assert.equal(m.title, '需求沟通');
  assert.equal(m.status, '已预约');
  assert.equal(m.scheduledDate, '2030-10-10');
  assert.equal(m.scheduledTime, '14:30');
  assert.equal(m.durationMinutes, 60);
  assert.deepEqual(m.participantNames, []);
  assert.equal(original.operations, undefined);
  assert.equal(r.operations.activities.at(-1).title, '预约模拟会议');
  assert.throws(
    () => act(r, { type: 'meeting-end', id: m.id }),
    /未结束|不存在|已结束/,
  );
  assert.throws(
    () => act(r, { type: 'meeting-start', id: m.id }, reviewer),
    /主持人/,
  );
  r = act(r, { type: 'meeting-start', id: m.id });
  assert.equal(r.operations.meetings[0].status, '进行中');
  assert.throws(() => act(r, { type: 'meeting-start', id: m.id }), /已预约/);
  r = act(r, { type: 'meeting-end', id: m.id });
  assert.equal(r.operations.meetings[0].status, '已结束');
});

test('预约必须有主题、有效的未来日期时间及支持的时长', () => {
  const input = {
    type: 'meeting-schedule',
    title: '需求沟通',
    scheduledDate: '2030-10-10',
    scheduledTime: '14:30',
    durationMinutes: 60,
  };
  for (const patch of [
    { title: ' ' },
    { scheduledDate: '' },
    { scheduledDate: '2030-02-30' },
    { scheduledDate: '2020-01-01' },
    { scheduledTime: '' },
    { scheduledTime: '25:00' },
    { durationMinutes: 0 },
    { durationMinutes: 17 },
  ]) {
    assert.throws(() => act(request(), { ...input, ...patch }));
  }
});
function covered() {
  const r = act(request(), {
    type: 'basis-add',
    kind: 'asset',
    assetId: 'a1',
    quantity: 3,
    itemIds: ['i1'],
    reason: '核定部署服务',
  });
  return act(r, {
    type: 'basis-decide',
    id: r.operations.bases[0].id,
    approve: true,
    note: '已核对有效期、远程服务范围与剩余额度 3 人天',
  });
}
const evaluation = {
  scope: '部署与交付报告',
  opinion: '具备交付条件',
  risks: '确认实施窗口',
  effort: 2,
  approverId: 'u2',
  approverName: '审核人',
};
function pending() {
  return act(covered(), {
    type: 'evaluation-save',
    input: evaluation,
    submit: true,
  });
}

test('历史请求按需初始化模块，不伪造业务记录', () => {
  assert.deepEqual(operationsOf(request()), {
    meetings: [],
    worklogs: [],
    bases: [],
    evaluations: [],
    activities: [],
  });
});
test('提交后基本信息、申请项锁定，内外部协作人允许修改', () => {
  const r = request();
  for (const key of [
    'title',
    'contactId',
    'description',
    'expectedServiceDate',
    'items',
  ]) {
    const next = { ...r, [key]: key === 'items' ? [] : 'changed' };
    assert.match(requestIdentityIssue(next, r), /只读/);
  }
  assert.equal(
    requestIdentityIssue(
      { ...r, internalParticipants: [], externalCollaborators: [] },
      r,
    ),
    null,
  );
  assert.match(
    requestIdentityIssue({ ...r, status: '草稿' }, r),
    /仅待评估阶段的负责项目经理可以退回草稿/,
  );
});
test('活动追加式保存，不能改写或删除历史', () => {
  const r = appendActivity(request(), pmo, '协作', '修改协作人', '', now);
  const next = appendActivity(r, pmo, '会议', '发起会议', '', now);
  assert.equal(requestIdentityIssue(next, r), null);
  assert.match(
    requestIdentityIssue(
      { ...r, operations: { ...r.operations, activities: [] } },
      r,
    ),
    /活动/,
  );
});
test('草稿、终态和客户角色不能操作内部模块', () => {
  for (const status of ['草稿', '已取消', '已转工单'])
    assert.throws(() =>
      act(
        { ...request(), status },
        { type: 'meeting-create', title: '沟通', participantNames: [] },
      ),
    );
  assert.throws(
    () =>
      act(
        request(),
        { type: 'meeting-create', title: '沟通', participantNames: [] },
        { ...pmo, role: '客户' },
      ),
    /内部/,
  );
});
test('工时只允许内部协作人记录自己的投入，按起止时间计算投入', () => {
  const action = {
    type: 'worklog-add',
    date: '2026-09-08',
    startTime: '09:00',
    endTime: '10:30',
    category: '需求调研',
    description: '核对客户网络条件',
  };
  const r = act(request(), action);
  assert.equal(r.operations.worklogs[0].userId, pmo.id);
  assert.equal(r.operations.activities[0].category, '工时');
  assert.throws(() => act(request(), action, reviewer), /内部协作人/);
  assert.equal(r.operations.worklogs[0].hours, 1.5);
  assert.equal(r.operations.worklogs[0].startTime, '09:00');
  assert.equal(r.operations.worklogs[0].endTime, '10:30');
  assert.equal(
    act(request(), { ...action, endTime: '09:01', hours: 99 }).operations
      .worklogs[0].hours,
    1 / 60,
  );
  for (const endTime of ['', '09:00', '08:59', '24:00', '10:60', 'invalid'])
    assert.throws(() => act(request(), { ...action, endTime }), /时间/);
  assert.throws(() => act(request(), { ...action, startTime: '' }), /时间/);
  for (const date of ['2026-02-30', '2027-01-01', '', 'invalid'])
    assert.throws(() => act(request(), { ...action, date }), /工作日期/);
  assert.throws(
    () => act(request(), { ...action, description: ' ' }),
    /工作内容/,
  );
});
test('工时累计不超过 24 小时，作废留痕且允许重新录入', () => {
  const action = {
    type: 'worklog-add',
    date: '2026-09-08',
    startTime: '00:00',
    endTime: '20:00',
    category: '调研',
    description: '长时间调研',
  };
  let r = act(request(), action);
  assert.throws(() => act(r, { ...action, endTime: '05:00' }), /累计/);
  assert.throws(
    () =>
      act(
        r,
        {
          type: 'worklog-void',
          id: r.operations.worklogs[0].id,
          reason: '更正',
        },
        sales,
      ),
    /自己的/,
  );
  r = act(r, {
    type: 'worklog-void',
    id: r.operations.worklogs[0].id,
    reason: '时间填写错误',
  });
  assert.ok(r.operations.worklogs[0].voidedAt);
  r = act(r, { ...action, endTime: '05:00' });
  assert.equal(r.operations.worklogs.length, 2);
  assert.equal(r.operations.activities.length, 3);
});
test('关联资产校验客户、状态、重复关联与申请项范围', () => {
  const input = {
    type: 'basis-add',
    kind: 'asset',
    assetId: 'a1',
    quantity: 3,
    itemIds: ['i1'],
    reason: '部署',
  };
  const r = act(request(), input);
  assert.equal(r.operations.bases[0].state, '待核对');
  assert.equal(uncoveredItems(r, assets).length, 1);
  assert.throws(() => act(request(), { ...input, assetId: 'a2' }), /当前客户/);
  assert.throws(
    () => act(request(), { ...input, itemIds: ['foreign'] }),
    /申请项/,
  );
  assert.throws(() => act(request(), input, engineer), /SmartX 销售经理/);
  assert.throws(() => act(r, input), /重复/);
  assert.throws(
    () => act(request(), input, pmo, [{ ...assets[0], status: '已使用' }]),
    /已启用/,
  );
});
test('PMO 核对通过才形成有效依据，资产失效后自动不再计入覆盖', () => {
  const r = covered();
  assert.equal(uncoveredItems(r, assets).length, 0);
  assert.equal(
    basisUsable(r.operations.bases[0], r, [{ ...assets[0], status: '停用' }]),
    false,
  );
});
test('特批由销售发起，指定其他人审批，不允许自批或重复审批', () => {
  const input = {
    type: 'basis-add',
    kind: 'exception',
    quantity: 3,
    itemIds: ['i1'],
    reason: '客户服务额度不足',
    approverId: 'u2',
    approverName: '审核人',
  };
  assert.throws(() => act(request(), input, engineer), /SmartX 销售经理/);
  assert.throws(
    () => act(request(), { ...input, approverId: sales.id }, sales),
    /其他内部用户/,
  );
  let r = act(request(), input, sales);
  const id = r.operations.bases[0].id;
  assert.equal(uncoveredItems(r, assets).length, 1);
  assert.throws(
    () =>
      act(r, { type: 'basis-decide', id, approve: true, note: '通过' }, sales),
    /指定审批人/,
  );
  r = act(
    r,
    { type: 'basis-decide', id, approve: true, note: '同意特批' },
    reviewer,
  );
  assert.equal(r.operations.bases[0].state, '有效');
  assert.equal(r.status, '待评估');
  assert.equal(uncoveredItems(r, assets).length, 0);
  assert.throws(
    () =>
      act(
        r,
        { type: 'basis-decide', id, approve: true, note: '再次批准' },
        reviewer,
      ),
    /已处理/,
  );
});
test('特批拒绝保留审批意见，可新增申请而不覆盖旧记录', () => {
  const input = {
    type: 'basis-add',
    kind: 'exception',
    quantity: 3,
    itemIds: ['i1'],
    reason: '申请',
    approverId: 'u2',
    approverName: '审核人',
  };
  let r = act(request(), input, sales);
  r = act(
    r,
    {
      type: 'basis-decide',
      id: r.operations.bases[0].id,
      approve: false,
      note: '依据不足',
    },
    reviewer,
  );
  r = act(r, input, sales);
  assert.equal(r.status, '待评估');
  assert.equal(r.operations.bases.length, 2);
  assert.equal(r.operations.bases[1].state, '已拒绝');
  assert.equal(r.operations.bases[1].decisionNote, '依据不足');
});
test('评估草稿可不完整，提交时要求意见、人天、范围、他人审批和服务依据', () => {
  const r = act(request(), {
    type: 'evaluation-save',
    input: { ...evaluation, scope: '', opinion: '', effort: 0 },
    submit: false,
  });
  assert.equal(r.operations.evaluations[0].state, '草稿');
  assert.throws(
    () =>
      act(request(), {
        type: 'evaluation-save',
        input: evaluation,
        submit: true,
      }),
    /服务依据|所有申请项/,
  );
  for (const input of [
    { ...evaluation, scope: '' },
    { ...evaluation, opinion: '' },
    { ...evaluation, effort: 0 },
    { ...evaluation, approverId: pmo.id },
  ])
    assert.throws(() =>
      act(covered(), { type: 'evaluation-save', input, submit: true }),
    );
  assert.throws(
    () =>
      act(covered(), {
        type: 'evaluation-save',
        input: { ...evaluation, effort: 4 },
        submit: true,
      }),
    /人天不足/,
  );
});
test('评估草稿仅作者可修改，审批中的内容不可编辑', () => {
  let r = act(covered(), {
    type: 'evaluation-save',
    input: evaluation,
    submit: false,
  });
  const id = r.operations.evaluations[0].id;
  assert.throws(
    () =>
      act(
        r,
        { type: 'evaluation-save', id, input: evaluation, submit: false },
        reviewer,
      ),
    /自己的/,
  );
  r = act(r, { type: 'evaluation-save', id, input: evaluation, submit: true });
  assert.throws(
    () =>
      act(r, { type: 'evaluation-save', id, input: evaluation, submit: false }),
    /自己的评估草稿/,
  );
  assert.throws(
    () => act(r, { type: 'evaluation-save', input: evaluation, submit: true }),
    /已有评估/,
  );
});
test('审批期间不能移除依据，审批前再次检查资产有效性', () => {
  const r = pending();
  assert.throws(
    () =>
      act(r, {
        type: 'basis-remove',
        id: r.operations.bases[0].id,
        reason: '撤销',
      }),
    /正用于评估审批/,
  );
  assert.throws(
    () =>
      act(
        r,
        {
          type: 'evaluation-decide',
          id: r.operations.evaluations[0].id,
          approve: true,
          note: '批准',
        },
        reviewer,
        [{ ...assets[0], status: '停用' }],
      ),
    /已失效/,
  );
});
test('评估审批仅指定审批人处理，通过进入待确认而非待受理，且不可重复审批', () => {
  let r = pending();
  const id = r.operations.evaluations[0].id;
  assert.throws(
    () =>
      act(r, { type: 'evaluation-decide', id, approve: true, note: '批准' }),
    /指定审批人/,
  );
  r = act(
    r,
    {
      type: 'evaluation-decide',
      id,
      approve: true,
      note: '范围与依据核对无误',
    },
    reviewer,
  );
  assert.equal(r.status, '待确认');
  assert.match(r.operations.activities.at(-1).detail, /进入待确认/);
  assert.equal(requestIdentityIssue(r, r), null);
  assert.match(requestIdentityIssue({ ...r, title: '变更申请' }, r), /只读/);
  assert.equal(r.operations.evaluations[0].state, '已通过');
  assert.equal(r.operations.activities.at(-1).category, '审批');
  assert.throws(() =>
    act(
      r,
      { type: 'evaluation-decide', id, approve: true, note: '批准' },
      reviewer,
    ),
  );
});
test('评估拒绝保留记录，请求仍待评估，可创建新一轮评估', () => {
  let r = pending();
  r = act(
    r,
    {
      type: 'evaluation-decide',
      id: r.operations.evaluations[0].id,
      approve: false,
      note: '请补充风险措施',
    },
    reviewer,
  );
  assert.equal(r.status, '待评估');
  assert.equal(r.operations.evaluations[0].state, '已拒绝');
  r = act(r, { type: 'evaluation-save', input: evaluation, submit: false });
  assert.equal(r.operations.evaluations.length, 2);
  assert.equal(r.operations.evaluations[1].decisionNote, '请补充风险措施');
});
test('会议仅为本地模拟，主持人可结束并归档真实录制 Blob 和转写', () => {
  let r = act(request(), {
    type: 'meeting-create',
    title: '调研会议',
    participantNames: ['客户代表'],
  });
  const id = r.operations.meetings[0].id;
  assert.equal(r.operations.meetings[0].mode, 'local-demo');
  assert.throws(() => act(r, { type: 'meeting-end', id }, sales), /主持人/);
  assert.throws(
    () => act(r, { type: 'meeting-materials', id, transcript: '转写' }),
    /先结束会议/,
  );
  r = act(r, { type: 'meeting-end', id });
  const blob = new Blob(['test recording bytes'], { type: 'video/mp4' });
  const recording = {
    id: 'f1',
    name: 'meeting.mp4',
    size: blob.size,
    blob,
    uploadedAt: now,
  };
  r = act(r, {
    type: 'meeting-materials',
    id,
    transcript: '客户：确认部署范围。',
    recording,
  });
  assert.ok(r.operations.meetings[0].recording.blob instanceof Blob);
  assert.equal(r.operations.meetings[0].transcript, '客户：确认部署范围。');
  assert.throws(
    () =>
      act(r, {
        type: 'meeting-materials',
        id,
        transcript: '',
        recording: { ...recording, size: 30 * 1024 * 1024 },
      }),
    /20 MB/,
  );
});
test('每次操作不修改传入对象，成功结果可通过请求存储校验', () => {
  const before = request();
  const snapshot = structuredClone(before);
  const after = act(before, {
    type: 'meeting-create',
    title: '会议',
    participantNames: [],
  });
  assert.deepEqual(before, snapshot);
  assert.equal(requestIdentityIssue(after, before), null);
});

test('编辑工时原位更新、重新计算且排除原记录，拒绝越权和已作废记录', () => {
  const input = {
    type: 'worklog-add',
    date: '2026-09-08',
    startTime: '00:00',
    endTime: '20:00',
    category: '调研',
    description: '原内容',
  };
  const original = act(request(), input);
  const id = original.operations.worklogs[0].id;
  const edit = {
    ...input,
    type: 'worklog-edit',
    id,
    endTime: '21:01',
    category: '其他',
    description: '更新内容',
  };
  const updated = act(original, edit);
  assert.equal(updated.operations.worklogs.length, 1);
  assert.equal(updated.operations.worklogs[0].id, id);
  assert.equal(updated.operations.worklogs[0].hours, 1261 / 60);
  assert.equal(updated.operations.worklogs[0].category, '其他');
  assert.equal(updated.operations.worklogs[0].description, '更新内容');
  assert.equal(original.operations.worklogs[0].hours, 20);
  assert.equal(updated.operations.activities.at(-1).title, '编辑内部工时');
  assert.throws(() => act(original, edit, reviewer), /自己的/);
  assert.throws(() => act(original, { ...edit, id: 'missing' }), /自己的/);
  assert.throws(() => act(original, { ...edit, endTime: '00:00' }), /时间/);
  const crowded = act(original, { ...input, endTime: '04:00' });
  assert.throws(() => act(crowded, edit), /累计/);
  const voided = act(original, { type: 'worklog-void', id, reason: '取消' });
  assert.throws(() => act(voided, edit), /自己的/);
});

test('项目经理不加入协作人即可录入和编辑自己的工时，其他人员及结束状态仍受限制', () => {
  const pm = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
  const r = { ...request(), internalParticipants: [] };
  const action = { type: 'worklog-add', date: '2026-09-08', startTime: '09:00', endTime: '10:00', category: '技术评估', description: '查看客户材料' };
  const next = applyRequestAction(r, action, pm, assets, now);
  assert.equal(next.operations.worklogs[0].userId, pm.id);
  assert.deepEqual(next.internalParticipants, []);
  const edited = applyRequestAction(next, { ...action, type: 'worklog-edit', id: next.operations.worklogs[0].id, endTime: '10:30' }, pm, assets, now);
  assert.equal(edited.operations.worklogs[0].hours, 1.5);
  assert.throws(() => applyRequestAction(r, action, engineer, assets, now), /协作人/);
  for (const status of ['草稿', '已取消', '已转工单']) assert.throws(() => applyRequestAction({ ...r, status }, action, pm, assets, now));
});
