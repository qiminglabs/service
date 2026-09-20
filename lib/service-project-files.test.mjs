import test from 'node:test';
import assert from 'node:assert/strict';
import { projectFiles } from './service-project-files.ts';
const file = (id, extra = {}) => ({ id, name: '同名.txt', blob: new Blob(['原文件内容']), size: 15, uploadedAt: '2026-09-17T10:00:00Z', ...extra });
function fixture() {
  return { workOrders: [{ id: 'wo1', item: { serviceName: '平台实施' }, steps: [
    { definition: { id: 's1', name: '执行记录', type: 'combined', materials: [file('guide')] }, updatedBy: '历史执行人', updatedAt: '2026-09-18', data: { attachments: [file('attachment', { uploadedById: 'u1' })], deliverables: {} } },
    { definition: { id: 's2', name: '交付报告', type: 'document', documents: [{ id: 'd1', deliverToCustomer: false, template: file('template') }] }, updatedBy: '后续执行人', data: { attachments: [], deliverables: { d1: [file('document', { submittedBy: '提交人快照', submittedAt: '2026-09-17T11:00:00Z', onlineDocument: { title: '在线文档', content: '在线正文', source: 'blank' } })], legacy: [file('legacy')] } } },
  ] }] };
}
test('项目文件汇总全部已存附件及文档，包括内部材料，排除配置模板和执行指引', async () => {
  const results = projectFiles(fixture(), [{ id: 'u1', name: '原提交人' }]);
  assert.equal(results.length, 3);
  assert.deepEqual(results.map(item => item.kind), ['附件', '在线文档', '文档']);
  assert.equal(results[0].submittedBy, '原提交人');
  assert.equal(results[1].submittedBy, '提交人快照');
  assert.equal(results[1].submittedAt, '2026-09-17T11:00:00Z');
  assert.equal(results[2].submittedBy, '后续执行人');
  assert.equal(results[1].file.onlineDocument.content, '在线正文');
  assert.equal(await results[0].file.blob.text(), '原文件内容');
  assert.equal(results[0].orderId, 'wo1');
  assert.equal(results[0].stepName, '执行记录');
});
test('无工单为空列表，多工单同名文件不丢失且删除后从汇总移除', () => {
  assert.deepEqual(projectFiles({}), []);
  const project = fixture();
  project.workOrders.push({ ...structuredClone(project.workOrders[0]), id: 'wo2' });
  assert.equal(new Set(projectFiles(project).map(item => item.id)).size, 6);
  project.workOrders[0].steps[0].data.attachments = [];
  assert.equal(projectFiles(project).length, 5);
});
