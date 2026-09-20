import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyReportRecipients, defaultDailyReportRecipients, toggleDailyReportRecipient } from './project-daily-report-recipients.ts';
import { dailyReportIssue, dailyReportEml, sendProjectDailyReport } from './service-project-daily-reports.ts';
const project = { customerId: 'c1', collaborators: {
  customer: [{ id: 'c1-person', name: '客户一' }, { id: 'c1-second', name: '客户二' }, { id: 'c1-same', name: '同邮箱客户' }],
  internal: [{ id: 'USR-004', name: '工程师' }, { id: 'pm', name: '项目经理' }], partner: [{ id: 'partner-person', name: '伙伴工程师' }],
} };
const directory = { contacts: [
  { id: 'c1-person', name: '客户一', customerId: 'c1', email: ' Client@One.example ', status: '启用' },
  { id: 'c1-second', name: '客户二', customerId: 'c1', email: 'second@one.example', status: '启用' },
  { id: 'c1-same', name: '同邮箱客户', customerId: 'c1', email: 'client@one.example', status: '启用' },
  { id: 'outside', name: '未关联客户', customerId: 'c1', email: 'outside@one.example', status: '启用' },
], users: [
  { id: 'USR-004', name: '工程师', email: 'engineer@one.example', status: '启用' },
  { id: 'pm', name: '项目经理', email: 'pm@one.example', status: '启用' },
  { id: 'unrelated', name: '未关联内部人员', email: 'private@one.example', status: '启用' },
], partnerUsers: [{ id: 'partner-person', name: '伙伴工程师', email: 'partner@one.example', status: '启用', partnerId: 'partner' }], partners: [{ id: 'partner', status: '启用' }] };
const input = { date: '2026-09-18', subject: '服务日报', greeting: '客户老师', customerEngineers: '客户一', projectManager: '项目经理', engineers: '工程师', startTime: '09:00', endTime: '18:00', serviceNumber: 'PS 1', workContent: '检查配置', nextPlan: '提交资料' };

test('收件人为全部客户协作人、抄送为全部内部协作人；可选伙伴但排除未关联人员', () => {
  const candidates = dailyReportRecipients(project, directory);
  assert.equal(candidates.length, 6);
  assert.ok(!candidates.some(person => person.email === 'private@one.example' || person.email === 'outside@one.example'));
  assert.deepEqual(defaultDailyReportRecipients(candidates), { to: 'client@one.example; second@one.example', cc: 'engineer@one.example; pm@one.example' });
  assert.equal(candidates.find(person => person.group === 'partner').issue, '');
});
test('默认不带入缺失、无效、停用和跨客户地址，保留具名原因；收件与抄送去重', () => {
  const refs = structuredClone(directory);
  refs.contacts[0].email = ''; refs.contacts[1].email = 'bad-address'; refs.contacts[2].customerId = 'another-company';
  refs.users[0].status = '停用'; refs.partners[0].status = '停用';
  const people = dailyReportRecipients(project, refs);
  assert.deepEqual(people.filter(person => person.group === 'customer').map(person => person.issue), ['未填写邮箱', '邮箱格式无效', '联系人不可用']);
  assert.equal(people.find(person => person.group === 'partner').issue, '所属企业不可用');
  assert.deepEqual(defaultDailyReportRecipients(people), { to: '', cc: 'pm@one.example' });
  const duplicate = dailyReportRecipients(project, directory);
  duplicate.find(person => person.group === 'internal').email = 'client@one.example';
  assert.equal(defaultDailyReportRecipients(duplicate).cc, 'pm@one.example');
});
test('勾选和取消协作人保留手动地址，兼容中英文分隔和大小写，禁用项不可选', () => {
  const person = dailyReportRecipients(project, directory).find(person => person.group === 'partner');
  const added = toggleDailyReportRecipient('CUSTOM@ONE.EXAMPLE，partner@one.example；second@one.example', person, true);
  assert.equal(added, 'custom@one.example; partner@one.example; second@one.example');
  assert.equal(toggleDailyReportRecipient(added, person, false), 'custom@one.example; second@one.example');
  assert.equal(toggleDailyReportRecipient('custom@one.example', { ...person, issue: '未填写邮箱' }, true), 'custom@one.example');
});
test('协作人和手动邮箱一起保存并导出；无效手动输入被拦截，重复地址不多计人数', () => {
  const actor = { id: 'USR-004', name: '工程师', role: 'SmartX 服务工程师' };
  const source = { ...project, id: 'sp', name: '项目', status: '进行中', revision: 1, workOrders: [{ id: 'wo', status: '进行中', assignees: [{ ...actor, group: 'internal' }] }] };
  const defaults = defaultDailyReportRecipients(dailyReportRecipients(project, directory));
  const report = sendProjectDailyReport(source, actor, { ...input, ...defaults, cc: `${defaults.cc}; external@one.example` }).dailyReports[0];
  const eml = dailyReportEml(report);
  assert.match(eml, /To: client@one.example,\r\n second@one.example/);
  assert.match(eml, /Cc: engineer@one.example,\r\n pm@one.example,\r\n external@one.example/);
  assert.match(dailyReportIssue({ ...input, ...defaults, cc: 'wrong-address' }), /邮箱格式/);
  const fifty = Array.from({ length: 50 }, (_, i) => `person${i}@one.example`).join('; ');
  assert.equal(dailyReportIssue({ ...input, to: fifty, cc: fifty }), null);
  assert.match(dailyReportIssue({ ...input, to: fifty, cc: 'extra@one.example' }), /50/);
});
