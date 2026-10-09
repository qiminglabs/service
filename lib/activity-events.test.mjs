import test from 'node:test';
import assert from 'node:assert/strict';
import { activityFields, activityMessage, activityList, activityLabel, renderActivityText } from './activity-events.ts';
import { translateActivityDetail, translateActivityTitle } from './i18n/activity.ts';
import { isEditableTranslation } from './i18n/editable.ts';
import { applyRequestAction, appendActivity } from './request-operations.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { newRequest } from './service-requests.ts';
const actor = { id: 'u1', name: '张三', role: 'SmartX 销售经理' };
const now = '2026-10-09T08:00:00.000Z';

test('new operations snapshot event parameters and render them without inspecting the Chinese summary', () => {
  const original = { ...newRequest('申请', 'customer', actor.name), status: '待评估' };
  const title = '客户主题 · A、B；{0}\n第二行';
  const result = applyRequestAction(original, { type: 'meeting-schedule', title, scheduledDate: '2030-10-10', scheduledTime: '14:30', durationMinutes: 60 }, actor, [], now);
  const activity = result.operations.activities.at(-1);
  assert.equal(activity.event.version, 1);
  assert.match(activity.event.type, /^request\./);
  assert.deepEqual(activity.event.params.detail.values, [title, '2030-10-10', '14:30', 60]);
  assert.equal(activity.detail, `${title} · 2030-10-10 14:30 · 60 分钟`);
  assert.equal(translateActivityDetail({ ...activity, detail: '不可解析的中文兼容字段' }, 'en'), `${title} · 2030-10-10 14:30 · 60 minutes`);
  assert.equal(translateActivityTitle(activity, 'zh-CN'), activity.title);
  assert.doesNotMatch(translateActivityTitle(activity, 'en'), /[\u3400-\u9fff]/);
  assert.equal(original.operations, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(activity)).event, activity.event);
});

test('structured project lists preserve names containing punctuation and numeric parameters', () => {
  const projectName = '用户项目：A、B · C\n第二行';
  const fields = activityFields('request', activityMessage('创建服务项目'), activityMessage('创建 {0} 个项目、{1} 个工单。\n{2}', [1, 2, activityList([activityMessage('{0}：{1}', [projectName, activityList([activityLabel('远程'), activityLabel('现场')])])], '\n')]));
  assert.equal(fields.event.type, 'request.projects-created');
  assert.equal(fields.event.params.detail.values[0], 1);
  assert.equal(translateActivityDetail(fields, 'en'), `Created 1 projects and 2 work orders.\n${projectName}: Remote, Onsite`);
  assert.equal(translateActivityDetail(fields, 'zh-CN'), fields.detail);
  const before = structuredClone(fields);
  translateActivityDetail(fields, 'en');
  assert.deepEqual(fields, before);
});

test('event templates are maintained in code and cannot be overridden from the translation workbench', () => {
  const fields = activityFields('request', activityMessage('创建服务项目'), activityMessage('创建 {0} 个项目、{1} 个工单。\n{2}', [1, 2, '用户正文']));
  assert.equal(isEditableTranslation('创建 {0} 个项目、{1} 个工单。\n{2}'), false);
  assert.equal(isEditableTranslation('保存'), true);
  assert.equal(translateActivityDetail(fields, 'en', { '创建 {0} 个项目、{1} 个工单。\n{2}': 'Override {0} {1} {2}' }), 'Created 1 projects and 2 work orders.\n用户正文');
  const values = ['用户填写 · 原文'];
  const snapshot = activityFields('request', activityMessage('创建示例申请'), activityMessage('{0} · {1}', [values[0], 2]));
  values[0] = 'changed';
  assert.equal(renderActivityText(snapshot.event.params.detail, 'en'), '用户填写 · 原文 · 2');
});

test('both writers append versioned events without changing older records or visibility', () => {
  const old = { id: 'old', title: '创建服务项目', detail: '创建 1 个项目、2 个工单。', actor: actor.name, actorId: actor.id, at: now, category: '受理' };
  const request = { ...newRequest('申请', 'customer', actor.name), operations: { meetings: [], worklogs: [], activities: [old] } };
  const appended = appendActivity(request, actor, '提交', activityMessage('取消服务请求'), '用户输入 · 原样保留', now);
  assert.deepEqual(appended.operations.activities[0], old);
  assert.equal(request.operations.activities.length, 1);
  assert.equal(translateActivityDetail(appended.operations.activities[1], 'en'), '用户输入 · 原样保留');
  const project = appendProjectActivity({ operations: { meetings: [], worklogs: [], activities: [] } }, actor, '项目', activityMessage('提交复核'), '', now, false);
  assert.equal(project.operations.activities[0].externalVisible, false);
  assert.match(project.operations.activities[0].event.type, /^project\./);
  assert.match(translateActivityDetail(old, 'en'), /Created 1 projects/);
  assert.equal(translateActivityDetail({ ...old, event: { version: 2 } }, 'en'), translateActivityDetail(old, 'en'));
});
