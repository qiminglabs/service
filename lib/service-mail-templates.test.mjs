import test from 'node:test';
import assert from 'node:assert/strict';
import { localInternalUsers } from './internal-users.ts';
import { samplePartners } from './partner-directory.ts';
import { defaultMailTemplate, parseMailConfig, mailTemplateIssue, changeMailTemplate, canonicalMailTemplate, MailTemplateConflict, serviceMailTemplatesId } from './service-mail-templates.ts';
import { readServiceMailTemplates, saveServiceMailTemplate } from './service-mail-template-store.ts';
import { applyMailTemplate, buildProjectDailyReport, customerDailyReport, dailyReportHtml, dailyReportEml, reportMailText } from './service-project-daily-reports.ts';
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
function mockStorage(t) {
  const data = { references: [{ id: 'workspace', payload: { users: structuredClone(localInternalUsers), partners: structuredClone(samplePartners) } }, { id: 'other-config', payload: { keep: true } }] };
  const original = globalThis.indexedDB;
  globalThis.indexedDB = { open() {
    const request = {};
    queueMicrotask(() => {
      request.result = { close() {}, transaction() {
        const staged = structuredClone(data);
        let pending = 0, aborted = false;
        const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore(name) {
          const run = fn => {
            const result = {}; pending++;
            queueMicrotask(() => {
              if (aborted) return;
              result.result = fn(); result.onsuccess?.(); pending--;
              if (!pending && !aborted) queueMicrotask(() => { if (!pending && !aborted) { Object.assign(data, staged); tx.oncomplete?.(); } });
            });
            return result;
          };
          return { getAll: () => run(() => staged[name]), put: row => run(() => { staged[name] = [...staged[name].filter(item => item.id !== row.id), structuredClone(row)]; }) };
        } };
        return tx;
      } };
      request.onsuccess?.();
    });
    return request;
  } };
  t.after(() => { globalThis.indexedDB = original; });
  return data;
}


test('预置三类独立模板，保存后保留其他配置，校验权限和并发版本', async t => {
  const data = mockStorage(t), original = structuredClone(data.references);
  const initial = await readServiceMailTemplates();
  assert.deepEqual(initial.config.templates.map(item => item.id), ['daily', 'project', 'review']);
  const draft = { ...defaultMailTemplate('daily'), introduction: '{{客户名称}}，{{项目名称}}今日服务情况如下。' };
  const saved = await saveServiceMailTemplate(draft, 0, admin);
  assert.equal(saved.config.templates[0].version, 2);
  assert.equal((await readServiceMailTemplates()).config.templates[0].introduction, draft.introduction);
  assert.deepEqual(data.references.filter(row => row.id !== serviceMailTemplatesId), original);
  assert.deepEqual(saved.config.templates[1], initial.config.templates[1]);
  await assert.rejects(saveServiceMailTemplate(draft, 0, admin), MailTemplateConflict);
  await assert.rejects(saveServiceMailTemplate(draft, 1, { id: 'USR-004', name: '工程师', role: 'SmartX 服务工程师' }), /仅系统管理员/);
  data.references.find(row => row.id === 'workspace').payload.users.find(user => user.id === admin.id).status = '停用';
  await assert.rejects(saveServiceMailTemplate(draft, 1, admin), /已停用/);
  assert.equal((await readServiceMailTemplates()).config.revision, 1);
});
test('拒绝无效占位符、超长主题、空确认正文和损坏配置', () => {
  assert.match(mailTemplateIssue({ ...defaultMailTemplate('daily'), introduction: '{{无此字段}}' }), /不支持/);
  assert.match(mailTemplateIssue({ ...defaultMailTemplate('daily'), subject: 'a'.repeat(201) }), /200/);
  assert.match(mailTemplateIssue({ ...defaultMailTemplate('daily'), greeting: '{{客户名称}' }), /不完整/);
  assert.match(mailTemplateIssue({ ...defaultMailTemplate('review'), confirmationNotice: '' }), /客户确认正文/);
  assert.match(mailTemplateIssue({ ...defaultMailTemplate('project'), confirmationNotice: '意外正文' }), /仅适用于/);
  assert.throws(() => parseMailConfig({ revision: 1, templates: [defaultMailTemplate('daily')] }), /无效/);
});
test('变量填充与邮件导出一致，正文转义且保存快照不受新模板影响', () => {
  const config = changeMailTemplate(parseMailConfig(undefined), { ...defaultMailTemplate('daily'), subject: '{{项目名称}} / {{报告日期}}', introduction: '{{客户名称}}：{{实施工程师}}已完成{{项目名称}}服务。<script>x</script>', workContent: '{{服务项目编号}} 完成检查', closing: '谢谢{{客户技术人员}}' }, 0, '管理员');
  const base = { kind: 'daily', date: '2026-09-20', to: 'client@example.com', cc: '', greeting: '', subject: '', customerEngineers: '客户甲', projectManager: '经理', engineers: '工程师乙', startTime: '09:00', endTime: '18:00', serviceNumber: 'SP-1', workContent: '', nextPlan: '后续' };
  const snapshot = canonicalMailTemplate(config, 'daily', undefined, '客户企业');
  const input = applyMailTemplate(base, snapshot, '集群项目'); input.nextPlan = '后续计划';
  assert.equal(input.subject, '集群项目 / 2026-09-20');
  assert.equal(input.greeting, '客户企业的老师');
  assert.equal(input.workContent, 'SP-1 完成检查');
  const report = buildProjectDailyReport({ id: 'SP-1', name: '集群项目' }, admin, input);
  const html = dailyReportHtml(report, report.projectName);
  assert.ok(html.includes('客户企业：工程师乙已完成集群项目服务。&lt;script&gt;x&lt;/script&gt;'));
  assert.ok(html.includes('谢谢客户甲'));
  assert.ok(!html.includes('去确认'));
  assert.equal(Buffer.from(dailyReportEml(report).split('\r\n\r\n')[1], 'base64').toString('utf8'), html);
  config.templates[0].introduction = '新模板'; snapshot.introduction = '修改来源';
  assert.equal(dailyReportHtml(report, report.projectName), html);
  const customer = customerDailyReport(report); customer.emailTemplate.closing = '外部修改';
  assert.equal(reportMailText(report, report.projectName).closing, '谢谢客户甲');
  assert.throws(() => canonicalMailTemplate(config, 'review', report.emailTemplate), /已更新/);
  const changed = changeMailTemplate(config, config.templates[0], 1, '管理员');
  assert.throws(() => canonicalMailTemplate(changed, 'daily', report.emailTemplate), /已更新/);
  const forged = { ...report.emailTemplate, introduction: '伪造' };
  assert.equal(canonicalMailTemplate(config, 'daily', forged).introduction, '新模板');
});
