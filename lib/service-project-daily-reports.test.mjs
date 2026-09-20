import test from 'node:test';
import assert from 'node:assert/strict';
import { canSendProjectDailyReport, sendProjectDailyReport, dailyReportIssue, dailyReportHtml, dailyReportEml } from './service-project-daily-reports.ts';
import { sendStoredProjectDailyReport } from './service-work-order-store.ts';
const engineer = { id: 'USR-004', name: '林澈', role: 'SmartX 服务工程师' };
const partner = { id: 'pu1', name: '伙伴工程师', role: '合作伙伴服务工程师' };
const manager = { id: 'USR-003', name: '经理', role: 'SmartX 项目经理' };
const input = { date: '2026-09-18', subject: '【SmartX 项目实施日报】集群项目', to: 'client@example.com', cc: 'manager@example.com', greeting: '客户老师', customerEngineers: '客户技术人员', projectManager: '项目经理', engineers: '林澈、伙伴工程师', startTime: '09:00', endTime: '18:00', serviceNumber: 'PS 017772', workContent: '1. 实施资料收集\n2. 配置检查', nextPlan: '整理并提交实施资料' };
function project() { return { id: 'SP-1', name: '集群项目', status: '进行中', revision: 1, collaborators: { internal: [engineer], partner: [partner] }, workOrders: [{ id: 'wo1', status: '进行中', assignees: [{ ...engineer, group: 'internal' }, { ...partner, group: 'partner' }] }] }; }

test('每个已分配执行工程师可发送，暂停、复核和确认不等于关闭；客户及普通协作人不能代发，管理员可代发', () => {
  for (const status of ['待启动', '进行中', '已暂停', '待复核', '待确认']) for (const actor of [engineer, partner]) assert.equal(canSendProjectDailyReport({ ...project(), status }, actor), true);
  for (const status of ['已完成', '已取消']) assert.throws(() => sendProjectDailyReport({ ...project(), status }, engineer, input), /未关闭/);
  for (const actor of [manager, { ...engineer, id: 'other' }, { ...engineer, role: '客户' }]) assert.equal(canSendProjectDailyReport(project(), actor), false);
  assert.equal(canSendProjectDailyReport(project(), { id: 'USR-006', role: 'SmartX 系统管理员' }), true);
  const p = project(); p.workOrders[0].status = '已取消'; assert.equal(canSendProjectDailyReport(p, engineer), false);
  p.workOrders[0].status = '已完成'; assert.equal(canSendProjectDailyReport(p, engineer), true);
  p.workOrders[0].assignee = p.workOrders[0].assignees[0]; delete p.workOrders[0].assignees; assert.equal(canSendProjectDailyReport(p, engineer), true);
  p.workOrders[0].assignee.group = 'partner'; assert.equal(canSendProjectDailyReport(p, engineer), false);
});
test('日报校验日期、时间、必填正文和邮箱；收件人去重，保存历史快照并记录真实作者', () => {
  for (const change of [{ date: '2026-02-30' }, { startTime: '25:00' }, { endTime: '08:00' }, { workContent: ' ' }, { nextPlan: '' }, { to: '' }, { cc: 'invalid@' }, { subject: 'hello\r\nBcc: injected@example.com' }]) assert.ok(dailyReportIssue({ ...input, ...change }));
  const p = project(), before = structuredClone(p);
  const saved = sendProjectDailyReport(p, engineer, { ...input, to: 'CLIENT@example.com；client@example.com', cc: 'client@example.com; manager@example.com', authorId: 'forged', delivery: 'sent' });
  assert.deepEqual(p, before); assert.equal(saved.revision, 2); assert.equal(saved.dailyReports[0].delivery, 'local');
  assert.equal(saved.dailyReports[0].authorId, engineer.id); assert.equal(saved.dailyReports[0].to, 'client@example.com'); assert.equal(saved.dailyReports[0].cc, 'manager@example.com');
  const next = sendProjectDailyReport(saved, partner, input); assert.equal(next.dailyReports.length, 2); assert.deepEqual(next.dailyReports[0], saved.dailyReports[0]);
  assert.equal(next.operations.activities.at(-1).category, '服务日报'); assert.equal(next.operations.activities.at(-1).actorId, partner.id);
});
test('导出真实 UTF-8 MIME 邮件草稿，长中文主题折行、正文转义且不引入跟踪像素', () => {
  const report = sendProjectDailyReport(project(), engineer, { ...input, subject: '集群项目日报'.repeat(25), workContent: '<script>alert(1)</script>\nA & B' }).dailyReports[0];
  const html = dailyReportHtml(report, report.projectName); assert.ok(html.includes('&lt;script&gt;')); assert.ok(!html.includes('<script>')); assert.ok(!html.includes('<img'));
  const eml = dailyReportEml(report); assert.match(eml, /^X-Unsent: 1\r\nTo: client@example.com/);
  const [headers, body] = eml.split('\r\n\r\n'); assert.equal(Buffer.from(body, 'base64').toString('utf8'), html);
  const words = [...headers.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)]; assert.equal(words.map(word => Buffer.from(word[1], 'base64').toString('utf8')).join(''), report.subject);
  assert.ok(words.every(word => word[0].length <= 75));
});
function storage(t, stores, failPut = () => false) {
  const old = globalThis.indexedDB;
  const oldWindow = globalThis.window;
  t.after(() => {
    if (old) globalThis.indexedDB = old;
    else delete globalThis.indexedDB;
    if (oldWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  });
  globalThis.window = { dispatchEvent() {} };
  globalThis.indexedDB = {
    open() {
      const open = {
        result: {
          close() {},
          transaction(names, mode) {
            const staged = structuredClone(stores);
            let pending = 0;
            let aborted = false;
            let scheduled = false;
            const complete = () => {
              if (scheduled) return;
              scheduled = true;
              queueMicrotask(() => {
                scheduled = false;
                if (aborted || pending) return;
                if (mode === 'readwrite') Object.assign(stores, staged);
                tx.oncomplete?.();
              });
            };
            const request = (result) => {
              pending++;
              const req = { result: structuredClone(result) };
              queueMicrotask(() => {
                if (aborted) return;
                req.onsuccess?.();
                pending--;
                complete();
              });
              return req;
            };
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(name) {
                return {
                  getAll() {
                    return request(staged[name]);
                  },
                  get(id) {
                    return request(
                      staged[name].find(
                        (record) => (record.id ?? record.serviceId) === id,
                      ),
                    );
                  },
                  put(record) {
                    if (failPut(record)) throw new Error('模拟存储失败');
                    assert.equal(mode, 'readwrite');
                    const id = record.id ?? record.serviceId;
                    const index = staged[name].findIndex(
                      (value) => (value.id ?? value.serviceId) === id,
                    );
                    if (index >= 0)
                      staged[name][index] = structuredClone(record);
                    else staged[name].push(structuredClone(record));
                    complete();
                  },
                };
              },
            };
            return tx;
          },
        },
      };
      queueMicrotask(() => open.onsuccess());
      return open;
    },
  };
}

function stored(t, fail = false) {
  const p = project();
  const stores = { references: [{ id: 'workspace', payload: { users: [{ ...engineer, name: '真实姓名', status: '启用' }], partners: [{ id: 'partner1', status: '启用' }], partnerUsers: [{ ...partner, partnerId: 'partner1', status: '启用' }] } }, { id: 'service-project:SP-1', payload: p }] };
  storage(t, stores, () => fail); return stores;
}
test('事务保存重读身份、分配和项目版本，历史不会被旧页面覆盖', async t => {
  const stores = stored(t);
  const result = await sendStoredProjectDailyReport('SP-1', 1, { ...engineer, name: '伪造姓名' }, input);
  assert.equal(result.dailyReports[0].authorName, '真实姓名');
  await assert.rejects(sendStoredProjectDailyReport('SP-1', 1, engineer, input), /已被其他页面/);
  assert.equal(stores.references[1].payload.dailyReports.length, 1);
  stores.references[1].payload.workOrders[0].assignees = [];
  await assert.rejects(sendStoredProjectDailyReport('SP-1', 2, engineer, input), /执行工程师/);
});
test('发送时重新校验关闭状态、停用账号和伙伴企业，失败不追加记录', async t => {
  const stores = stored(t), p = stores.references[1].payload, directory = stores.references[0].payload;
  for (const status of ['已完成', '已取消']) { p.status = status; await assert.rejects(sendStoredProjectDailyReport('SP-1', 1, engineer, input), /未关闭/); }
  p.status = '进行中'; directory.users[0].status = '停用'; await assert.rejects(sendStoredProjectDailyReport('SP-1', 1, engineer, input), /停用/);
  directory.partners[0].status = '停用'; await assert.rejects(sendStoredProjectDailyReport('SP-1', 1, partner, input), /停用/);
  assert.equal(p.dailyReports, undefined);
});
test('存储失败回滚日报与活动，允许重试', async t => {
  const stores = stored(t, true), before = structuredClone(stores);
  await assert.rejects(sendStoredProjectDailyReport('SP-1', 1, engineer, input), /存储失败/); assert.deepEqual(stores, before);
});

test('客户读取日报按当前所属企业及客户协作名单隔离，客户身份不能发送', async t => {
  const { readCustomerServiceProjects } = await import('./service-project-store.ts');
  const stores = stored(t), directory = stores.references[0].payload;
  const customer = { id: 'contact-1', name: '客户', role: '客户' };
  directory.customers = [{ id: 'customer-1', name: '客户企业', status: '启用' }];
  directory.contacts = [{ id: customer.id, name: customer.name, customerId: 'customer-1', status: '启用' }];
  const p = stores.references[1].payload;
  p.customerId = 'customer-1'; p.createdAt = '2026-09-18T09:00:00Z'; p.workOrders[0].steps = [];
  p.collaborators.customer = [{ id: customer.id, name: customer.name }];
  await sendStoredProjectDailyReport(p.id, p.revision, engineer, input);
  const saved = stores.references[1].payload;
  stores.references.push({ id: 'service-project:other-company', payload: { ...saved, id: 'other-company', customerId: 'customer-2' } });
  stores.references.push({ id: 'service-project:not-collaborator', payload: { ...saved, id: 'not-collaborator', collaborators: {} } });
  const result = await readCustomerServiceProjects(customer);
  assert.deepEqual(result.map(project => project.id), [p.id]);
  assert.equal(result[0].dailyReports[0].workContent, input.workContent);
  assert.equal(result[0].dailyReports[0].authorId, undefined);
  await assert.rejects(sendStoredProjectDailyReport(p.id, saved.revision, customer, input), /无权访问/);
  directory.contacts[0].status = '停用';
  // Storage transactions replace records; mutate the latest directory for the next read.
  stores.references[0].payload.contacts[0].status = '停用';
  await assert.rejects(readCustomerServiceProjects(customer), /不可用/);
});

async function projectMailFixture() {
  const { defaultReportTemplates, renderReport } = await import('./report-templates.ts');
  const { projectDeliverables } = await import('./service-project-deliverables.ts');
  const p = project();
  p.customerId = 'customer-1';
  const file = { id: 'file1', name: '部署说明.txt', blob: new Blob(['客户交付内容']), uploadedAt: '2026-09-20T01:00:00Z' };
  p.workOrders[0].item = { serviceName: '集群部署' };
  p.workOrders[0].steps = [{
    definition: { id: 'delivery', name: '交付文件', type: 'upload', files: [{ id: 'public', name: '交付资料', deliverToCustomer: true }, { id: 'private', name: '内部资料', deliverToCustomer: false }] },
    data: { deliverables: { public: [file], private: [{ ...file, id: 'private-file' }] } },
  }];
  const rendered = renderReport(defaultReportTemplates().templates[0], { project: p, customerName: '客户 A' }, {});
  const document = { title: '项目总结', source: 'template', content: rendered.content, richText: rendered.body, reportSource: { ...rendered.source, projectFiles: [{ deliverableId: projectDeliverables(p)[0].id, description: '部署记录\n客户留档' }] } };
  return { p, mail: { ...input, kind: 'project', projectDocument: document, workContent: '', nextPlan: '', customerEngineers: '', engineers: '', startTime: '', endTime: '' } };
}

test('项目报告使用模板正文走同一邮件发送，免填每日工作字段并保存模板和文件快照', async () => {
  const { p, mail } = await projectMailFixture();
  assert.equal(dailyReportIssue(mail), null);
  const saved = sendProjectDailyReport(p, engineer, mail);
  const record = saved.dailyReports[0];
  assert.equal(record.kind, 'project');
  assert.equal(record.delivery, 'local');
  assert.equal(record.projectDocument.reportSource.template.id, 'report-project-default');
  assert.equal(record.projectFiles[0].description, '部署记录\n客户留档');
  assert.equal(await record.projectFiles[0].file.blob.text(), '客户交付内容');
  assert.equal(saved.templateReports, undefined);
  assert.equal(p.dailyReports, undefined);
  mail.projectDocument.richText.content[0].content[0].text = '编辑后的内容';
  mail.projectDocument.reportSource.projectFiles[0].description = '改动';
  assert.notEqual(record.projectFiles[0].description, '改动');
  assert.ok(!record.projectDocument.content.includes('编辑后的内容'));
  assert.equal(saved.operations.activities.at(-1).title, '发送项目报告（本地）');
});

test('项目报告拒绝错项目、未填充字段和非客户文件；原日报仍要求工作内容', async () => {
  const { p, mail } = await projectMailFixture();
  assert.ok(dailyReportIssue({ ...mail, kind: 'daily' }));
  assert.ok(dailyReportIssue({ ...mail, projectDocument: undefined }));
  const wrong = structuredClone(mail);
  wrong.projectDocument.reportSource.projectId = 'another-project';
  assert.throws(() => sendProjectDailyReport(p, engineer, wrong), /当前项目/);
  const unresolved = structuredClone(mail);
  unresolved.projectDocument.richText = unresolved.projectDocument.reportSource.template.body;
  assert.match(dailyReportIssue(unresolved), /未填充/);
  const privateFile = structuredClone(mail);
  privateFile.projectDocument.reportSource.projectFiles[0].deliverableId = JSON.stringify(['wo1', 'delivery', 'private', 'private-file']);
  assert.throws(() => sendProjectDailyReport(p, engineer, privateFile), /客户交付物/);
  p.workOrders[0].steps[0].definition.files[0].deliverToCustomer = false;
  assert.throws(() => sendProjectDailyReport(p, engineer, mail), /客户交付物/);
  assert.equal(p.dailyReports, undefined);
});

test('客户可读取项目报告邮件和相关文件，但不透出作者 ID 和模板来源配置', async () => {
  const { customerDailyReport } = await import('./service-project-daily-reports.ts');
  const { p, mail } = await projectMailFixture();
  const record = sendProjectDailyReport(p, engineer, mail).dailyReports[0];
  const visible = customerDailyReport(record);
  assert.equal(visible.kind, 'project');
  assert.equal(visible.authorId, undefined);
  assert.equal(visible.projectDocument.reportSource, undefined);
  assert.equal(visible.projectFiles[0].file.onlineDocument, undefined);
  assert.equal(visible.projectFiles[0].description, '部署记录\n客户留档');
  assert.deepEqual(visible.projectDocument.richText, record.projectDocument.richText);
  visible.projectDocument.richText.content[0].content[0].text = '客户侧修改';
  assert.notDeepEqual(visible.projectDocument.richText, record.projectDocument.richText);
});

test('项目邮件导出保留富文本、文件说明和真实附件，正文与文件名安全编码', async () => {
  const { dailyReportEmlWithFiles } = await import('./service-project-daily-reports.ts');
  const { p, mail } = await projectMailFixture();
  mail.projectDocument.richText.content.push({ type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>', marks: [{ type: 'bold' }] }] });
  const record = sendProjectDailyReport(p, engineer, mail).dailyReports[0];
  const html = dailyReportHtml(record, p.name);
  assert.match(html, /<strong>&lt;script&gt;/);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /项目文件/);
  assert.match(html, /客户留档/);
  assert.ok(!html.includes('今日工作内容'));
  const eml = await dailyReportEmlWithFiles(record);
  assert.match(eml, /Content-Type: multipart\/mixed/);
  assert.match(eml, /Content-Disposition: attachment; filename\*=UTF-8''/);
  assert.ok(eml.includes(Buffer.from('客户交付内容').toString('base64')));
  assert.ok(eml.includes(Buffer.from(html).toString('base64').match(/.{1,76}/g).join('\r\n')));
});

test('项目报告邮件通过实际存储事务保存，失效交付物或关闭项目不会追加记录', async t => {
  const stores = stored(t);
  const { p, mail } = await projectMailFixture();
  stores.references[1].payload = p;
  const result = await sendStoredProjectDailyReport(p.id, p.revision, engineer, mail);
  assert.equal(result.dailyReports[0].kind, 'project');
  assert.equal(result.dailyReports[0].authorName, '真实姓名');
  assert.equal(result.dailyReports[0].projectFiles.length, 1);
  const current = stores.references[1].payload;
  current.workOrders[0].steps[0].definition.files[0].deliverToCustomer = false;
  await assert.rejects(sendStoredProjectDailyReport(current.id, current.revision, engineer, mail), /客户交付物/);
  assert.equal(stores.references[1].payload.dailyReports.length, 1);
  current.status = '已完成';
  await assert.rejects(sendStoredProjectDailyReport(current.id, current.revision, engineer, mail), /未关闭/);
  assert.equal(stores.references[1].payload.dailyReports.length, 1);
});

test('日报使用真实服务项目编号，预览和导出链接直达项目且不携带身份参数', async () => {
  const { dailyReportProjectUrl, customerDailyReport, dailyReportHistory } = await import('./service-project-daily-reports.ts');
  const p = project();
  const saved = sendProjectDailyReport(p, engineer, { ...input, serviceNumber: 'wrong', projectId: 'forged' }).dailyReports[0];
  assert.equal(saved.serviceNumber, p.id);
  assert.equal(saved.projectId, p.id);
  assert.equal(customerDailyReport(saved).projectId, p.id);
  const html = dailyReportHtml(saved, p.name);
  assert.match(html, /服务项目编号/);
  assert.ok(!html.includes('PS 服务编号'));
  assert.match(html, /href="http:\/\/localhost:53221\/\?project=SP-1"/);
  const eml = dailyReportEml(saved);
  assert.equal(Buffer.from(eml.split('\r\n\r\n')[1], 'base64').toString('utf8'), html);
  const link = new URL(dailyReportProjectUrl('SP A&user=other', 'https://service.example.com'));
  assert.equal(link.searchParams.get('project'), 'SP A&user=other');
  assert.equal(link.searchParams.get('user'), null);
  const old = { ...saved, projectId: undefined, serviceNumber: 'PS 017772' };
  const history = dailyReportHistory([old], p.id);
  assert.match(dailyReportHtml(history[0], p.name), /\?project=SP-1/);
  assert.equal(old.serviceNumber, 'PS 017772');
});

test('每日工作日报选择客户交付物，说明同步正文且导出保留附件，客户得到独立快照', async () => {
  const { customerDailyReport, dailyReportEmlWithFiles } = await import('./service-project-daily-reports.ts');
  const { p, mail } = await projectMailFixture();
  const relatedFiles = structuredClone(mail.projectDocument.reportSource.projectFiles);
  relatedFiles[0].description = '今日交付\n<客户存档>';
  const record = sendProjectDailyReport(p, engineer, { ...input, kind: 'daily', relatedFiles }).dailyReports[0];
  assert.equal(record.projectDocument, undefined);
  assert.equal(record.relatedFiles, undefined);
  assert.equal(record.projectFiles.length, 1);
  assert.equal(record.projectFiles[0].description, '今日交付\n<客户存档>');
  relatedFiles[0].description = '改动';
  assert.notEqual(record.projectFiles[0].description, '改动');
  const html = dailyReportHtml(record, p.name);
  assert.match(html, /相关文件/);
  assert.match(html, /今日交付\n&lt;客户存档&gt;/);
  assert.ok(html.indexOf('相关文件') > html.indexOf('后续安排'));
  assert.ok(html.indexOf('相关文件') < html.indexOf('如有任何问题'));
  const visible = customerDailyReport(record);
  assert.equal(visible.projectFiles[0].description, record.projectFiles[0].description);
  assert.equal(visible.projectFiles[0].file.onlineDocument, undefined);
  assert.equal(await visible.projectFiles[0].file.blob.text(), '客户交付内容');
  const eml = await dailyReportEmlWithFiles(visible);
  assert.match(eml, /multipart\/mixed/);
  assert.ok(eml.includes(Buffer.from('客户交付内容').toString('base64')));
  const empty = sendProjectDailyReport(p, engineer, { ...input, relatedFiles: [] }).dailyReports[0];
  assert.deepEqual(empty.projectFiles, []);
  assert.ok(!dailyReportHtml(empty, p.name).includes('相关文件'));
});

test('日报相关文件发送事务拒绝内部、重复及失效交付物，不留下发送记录', async t => {
  const stores = stored(t);
  const { p, mail } = await projectMailFixture();
  stores.references[1].payload = p;
  const relatedFiles = mail.projectDocument.reportSource.projectFiles;
  const send = files => sendStoredProjectDailyReport(p.id, p.revision, engineer, { ...input, relatedFiles: files });
  await assert.rejects(send([{ deliverableId: JSON.stringify(['wo1', 'delivery', 'private', 'private-file']), description: '' }]), /客户交付物/);
  await assert.rejects(send([relatedFiles[0], relatedFiles[0]]), /重复/);
  await assert.rejects(send([{ ...relatedFiles[0], description: '字'.repeat(2001) }]), /不能超过/);
  p.workOrders[0].steps[0].definition.files[0].deliverToCustomer = false;
  await assert.rejects(send(relatedFiles), /客户交付物/);
  assert.equal(stores.references[1].payload.dailyReports, undefined);
});

test('项目报告使用内置邮件模板，与日报共用字段和相关文件，无需后台模板或在线文档', async () => {
  const { dailyReportTemplate, customerDailyReport, dailyReportEmlWithFiles } = await import('./service-project-daily-reports.ts');
  const { p, mail } = await projectMailFixture();
  const reportInput = { ...input, kind: 'project', subject: '项目实施报告', workContent: '完成项目实施与验证', relatedFiles: mail.projectDocument.reportSource.projectFiles };
  assert.equal(dailyReportIssue(reportInput), null);
  assert.match(dailyReportIssue({ ...reportInput, workContent: '' }), /服务总结/);
  assert.match(dailyReportIssue({ ...reportInput, startTime: '' }), /实施起止时间/);
  const saved = sendProjectDailyReport(p, engineer, reportInput);
  const report = saved.dailyReports[0];
  assert.equal(report.kind, 'project');
  assert.equal(report.projectDocument, undefined);
  assert.equal(saved.templateReports, undefined);
  assert.equal(report.projectFiles[0].description, '部署记录\n客户留档');
  const visible = customerDailyReport(report);
  assert.equal(visible.workContent, reportInput.workContent);
  assert.equal(visible.projectFiles.length, 1);
  const html = dailyReportHtml(visible, p.name);
  assert.match(html, /服务总结/);
  assert.match(html, /本次项目实施报告/);
  assert.match(html, /相关文件/);
  assert.ok(!html.includes('今日工作内容'));
  assert.match(await dailyReportEmlWithFiles(visible), /multipart\/mixed/);
  assert.equal(dailyReportTemplate('daily').workLabel, '今日工作内容');
  assert.equal(dailyReportTemplate('project').workLabel, '服务总结');
});

test('普通日报和普通项目报告不包含客户确认条款，也不能伪造确认关联', async () => {
  const { projectConfirmationNotice } = await import('./project-confirmation-notice.ts');
  for (const kind of ['daily', 'project']) {
    const report = sendProjectDailyReport(project(), engineer, { ...input, kind, confirmation: { id: 'forged', deadline: '2099-01-01T00:00:00Z', notice: projectConfirmationNotice } }).dailyReports[0];
    assert.equal(report.confirmation, undefined);
    assert.ok(!dailyReportHtml(report, report.projectName).includes(projectConfirmationNotice));
  }
});


test('确认邮件移除后续安排，旧模板内容也不会带入或输出，普通日报保留', async () => {
  const { defaultMailTemplate } = await import('./service-mail-templates.ts');
  const { applyMailTemplate, buildProjectDailyReport, reportHasNextPlan } = await import('./service-project-daily-reports.ts');
  const snapshot = { ...defaultMailTemplate('review'), customerName: '客户', nextPlan: '旧模板后续内容' };
  const form = applyMailTemplate({ ...input, kind: 'project' }, snapshot, project().name);
  assert.equal(form.nextPlan, '');
  form.workContent = '服务已完成';
  assert.equal(dailyReportIssue(form), null);
  const record = buildProjectDailyReport(project(), manager, { ...form, nextPlan: '历史输入后续内容' });
  assert.equal(record.nextPlan, '');
  assert.equal(reportHasNextPlan(record), false);
  assert.doesNotMatch(dailyReportHtml({ ...record, nextPlan: '历史输入后续内容' }, project().name), /后续安排|历史输入后续内容/);
  const legacy = { ...input, kind: 'project', confirmation: { id: 'c1', notice: '请确认' } };
  assert.equal(reportHasNextPlan(legacy), false);
  assert.doesNotMatch(dailyReportHtml(legacy, project().name), /后续安排|整理并提交实施资料/);
  assert.match(dailyReportHtml(input, project().name), /后续安排/);
  assert.equal(dailyReportIssue({ ...input, nextPlan: '' }), '请填写后续安排。');
});
