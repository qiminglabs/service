import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newRequest } from './service-requests.ts';
import {
  applyRequestAction,
  meetingAttachments,
  meetingTranscript,
} from './request-operations.ts';

const host = { id: 'u1', name: '主持人', role: 'SmartX 销售经理' };
const now = '2026-09-08T08:00:00.000Z';
function act(record, action, actor = host) {
  return applyRequestAction(record, action, actor, [], now);
}
function ended() {
  let r = {
    ...newRequest('服务申请', 'c1', '主持人'),
    status: '待评估',
  };
  r = act(r, {
    type: 'meeting-create',
    title: '需求沟通',
    participantNames: ['甲', '乙'],
  });
  return act(r, { type: 'meeting-end', id: r.operations.meetings[0].id });
}
function file(id, name = '会议纪要.pdf') {
  const blob = new Blob(['会议附件'], { type: 'application/pdf' });
  return { id, name, blob, size: blob.size, uploadedAt: now };
}

test('多个同名附件独立保存，旧录制和转写保持不变，真实文件字节可恢复', async () => {
  const r = ended();
  const m = r.operations.meetings[0];
  m.recording = file('legacy', '历史资料.mp4');
  m.transcript = '已有转写原文';
  const next = act(r, {
    type: 'meeting-attachments-add',
    id: m.id,
    files: [file('a'), file('b')],
  });
  assert.equal(meetingAttachments(next.operations.meetings[0]).length, 3);
  assert.equal(next.operations.meetings[0].transcript, '已有转写原文');
  assert.equal(m.attachments, undefined);
  assert.equal(next.operations.activities.at(-1).title, '上传会议附件');
  const restored = structuredClone(next);
  assert.equal(
    await restored.operations.meetings[0].attachments[0].blob.text(),
    '会议附件',
  );
  assert.throws(
    () =>
      act(next, {
        type: 'meeting-attachments-add',
        id: m.id,
        files: [file('a')],
      }),
    /已存在/,
  );
});

test('附件校验空文件、超限、类型和元数据，批量失败不部分写入', () => {
  const r = ended();
  const id = r.operations.meetings[0].id;
  const large = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]);
  const invalid = [
    { ...file('x'), blob: new Blob([]), size: 0 },
    { ...file('x'), size: 100 },
    file('x', '程序.exe'),
    { ...file('x'), blob: large, size: large.size },
  ];
  for (const bad of invalid)
    assert.throws(() =>
      act(r, {
        type: 'meeting-attachments-add',
        id,
        files: [file('valid'), bad],
      }),
    );
  assert.equal(r.operations.meetings[0].attachments, undefined);
  assert.throws(
    () => act(r, { type: 'meeting-attachments-add', id, files: [] }),
    /请选择附件/,
  );
  assert.throws(
    () =>
      act(
        r,
        { type: 'meeting-attachments-add', id, files: [file('x')] },
        { id: 'other', name: '其他人', role: 'SmartX 销售经理' },
      ),
    /主持人/,
  );
  assert.throws(
    () =>
      act(
        { ...r, status: '已取消' },
        { type: 'meeting-attachments-add', id, files: [file('x')] },
      ),
    /已结束/,
  );
});

test('示例转写只在空白或 test 占位时展示，不覆盖真实原文', () => {
  const m = ended().operations.meetings[0];
  assert.equal(meetingTranscript(m).example, true);
  assert.match(meetingTranscript(m).text, /主持人（示例）/);
  assert.equal(meetingTranscript({ ...m, transcript: 'test' }).example, true);
  assert.deepEqual(
    meetingTranscript({ ...m, transcript: '客户补充的真实内容' }),
    { text: '客户补充的真实内容', example: false },
  );
  assert.equal(m.transcript, undefined);
});

test('会议资料界面保留转写、时间、参会人及普通附件，不显示录制或转写编辑框', () => {
  const source = readFileSync(
    new URL('../components/request-operations.tsx', import.meta.url),
    'utf8',
  );
  const form = source.slice(source.indexOf('function MeetingForm('));
  assert.doesNotMatch(form, /<video|会议录制|导入录制|转写正文|setTranscript/);
  for (const text of [
    '会议时间',
    '参会人',
    '会议转写',
    '上传附件',
    '保存附件',
    '模拟示例',
  ])
    assert.ok(form.includes(text));
});

test('按标识删除会议附件，同名文件和转写保留，历史录制可删除且操作留痕', () => {
  const original = ended();
  const id = original.operations.meetings[0].id;
  original.operations.meetings[0].recording = file('legacy');
  original.operations.meetings[0].transcript = '原转写';
  const uploaded = act(original, {
    type: 'meeting-attachments-add',
    id,
    files: [file('a'), file('b')],
  });
  const action = { type: 'meeting-attachment-delete', id, fileId: 'a' };
  const next = act(uploaded, action);
  assert.deepEqual(
    meetingAttachments(next.operations.meetings[0]).map((f) => f.id),
    ['b', 'legacy'],
  );
  assert.equal(meetingAttachments(uploaded.operations.meetings[0]).length, 3);
  assert.equal(next.operations.meetings[0].transcript, '原转写');
  assert.equal(next.operations.activities.at(-1).title, '删除会议附件');
  assert.throws(() => act(next, action), /不存在/);
  assert.throws(
    () =>
      act(uploaded, action, {
        id: 'other',
        name: '其他人',
        role: 'SmartX 销售经理',
      }),
    /主持人/,
  );
  const ongoing = structuredClone(uploaded);
  ongoing.operations.meetings[0].status = '进行中';
  assert.equal(meetingAttachments(act(ongoing, action).operations.meetings[0]).some(file => file.id === action.fileId), false);
  let empty = act(next, { ...action, fileId: 'legacy' });
  assert.equal(empty.operations.meetings[0].recording, undefined);
  empty = act(empty, { ...action, fileId: 'b' });
  assert.deepEqual(meetingAttachments(empty.operations.meetings[0]), []);
});

test('所有非终止请求阶段均支持各会议状态上传和删除附件，终止阶段禁止修改', () => {
  for (const status of ['草稿', '待评估', '待确认', '待受理']) {
    for (const meetingStatus of ['已预约', '进行中', '已结束']) {
      const r = ended();
      r.status = status;
      const meeting = r.operations.meetings[0];
      meeting.status = meetingStatus;
      const next = act(r, { type: 'meeting-attachments-add', id: meeting.id, files: [file('new')] });
      assert.equal(meetingAttachments(next.operations.meetings[0]).length, 1);
      assert.equal(next.operations.meetings[0].status, meetingStatus);
      assert.equal(next.status, status);
      const removed = act(next, { type: 'meeting-attachment-delete', id: meeting.id, fileId: 'new' });
      assert.equal(meetingAttachments(removed.operations.meetings[0]).length, 0);
      for (const closed of ['已转服务项目', '已取消']) {
        assert.throws(() => act({ ...next, status: closed }, { type: 'meeting-attachments-add', id: meeting.id, files: [file('other')] }), /已结束/);
        assert.throws(() => act({ ...next, status: closed }, { type: 'meeting-attachment-delete', id: meeting.id, fileId: 'new' }), /已结束/);
      }
    }
  }
});
