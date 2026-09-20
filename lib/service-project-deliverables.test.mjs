import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDeliverables } from './service-project-deliverables.ts';
import { customerServiceProject } from './customer-service-projects.ts';
import { projectForActor, newServiceProject } from './service-projects.ts';
import { newServiceFlowStep } from './service-flow-steps.ts';
import { createDownloadZip } from './download-zip.ts';

const file = (id, name = `${id}.txt`) => ({ id, name, size: 5, blob: new Blob(['hello']), uploadedAt: '2026-09-17T10:00:00Z', uploadedById: 'private-user' });
function fixture() {
  const project = newServiceProject({ name: '交付测试', expectedServiceDate: '2026-09-17', customerId: 'c1', note: '' }, { id: 'pm', name: '经理', role: 'SmartX 项目经理' }, [{ id: 'c1', name: '客户', status: '启用' }]);
  const step = { ...newServiceFlowStep(1), id: 'step1', name: '交付报告', type: 'document', materials: [{ kind: 'text', content: '内部说明' }], documents: [
    { id: 'public', name: '交付文档', deliverToCustomer: true, template: file('template') },
    { id: 'private', name: '内部文档', deliverToCustomer: false },
  ] };
  project.workOrders = [{ id: 'wo1', item: { serviceName: '平台交付' }, steps: [{ definition: step, status: '进行中', data: { values: { private: 'secret' }, description: 'secret', attachments: [file('attachment')], deliverables: { public: [file('doc')], private: [{ ...file('private'), deliverToCustomer: true }], orphan: [file('orphan')] } } } ] }];
  return project;
}
test('仅汇总工单快照中标记交付客户的实际文件，排除模板、内部附件和失效字段', async () => {
  const project = fixture();
  const results = projectDeliverables(project);
  assert.equal(results.length, 1);
  assert.equal(results[0].kind, '文档');
  assert.equal(results[0].serviceName, '平台交付');
  assert.equal(results[0].stepName, '交付报告');
  assert.equal(await results[0].file.blob.text(), 'hello');
  assert.deepEqual(Object.keys(results[0].file).sort(), ['id', 'name', 'size', 'uploadedAt', 'blob'].sort());
  project.workOrders[0].steps[0].definition.documents[0].deliverToCustomer = false;
  assert.deepEqual(projectDeliverables(project), []);
});
test('多工单同名文件保留独立身份，兼容旧步骤交付标记，删除文件即时移出汇总', () => {
  const project = fixture();
  const order = structuredClone(project.workOrders[0]);
  order.id = 'wo2';
  const step = order.steps[0];
  step.definition = { ...newServiceFlowStep(2), id: 'legacy', type: 'upload', deliverToCustomer: true, files: undefined };
  step.data.deliverables = { 'legacy-file': [file('doc')] };
  step.status = '已完成';
  project.workOrders.push(order);
  const results = projectDeliverables(project);
  assert.equal(results.length, 2);
  assert.equal(new Set(results.map(item => item.id)).size, 2);
  assert.equal(results[1].kind, '附件');
  step.data.deliverables = {};
  assert.equal(projectDeliverables(project).length, 1);
  assert.deepEqual(projectDeliverables({}), []);
});
test('客户仅收到交付物投影，内外部交付物保持一致且不泄露完整工单', async () => {
  const project = fixture();
  const customer = customerServiceProject(project);
  assert.equal(Object.hasOwn(customer, 'workOrders'), false);
  assert.equal(customer.deliverables.length, 1);
  assert.equal(JSON.stringify(customer.deliverables).includes('secret'), false);
  for (const role of ['SmartX 项目经理', '合作伙伴服务工程师']) {
    assert.deepEqual(projectDeliverables(projectForActor(project, { id: 'u1', role, name: '用户' })), customer.deliverables);
  }
  assert.equal(await customer.deliverables[0].file.blob.text(), 'hello');
});
test('ZIP 保留内容及 UTF-8 文件名，处理同名冲突和路径字符', async () => {
  const zip = await createDownloadZip([file('a', '报告.txt'), file('b', '报告.txt'), file('c', '../报告.txt')]);
  const bytes = new Uint8Array(await zip.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const names = [];
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 6, true), 0x800);
    assert.equal(view.getUint32(offset + 14, true), 0x3610a686);
    const length = view.getUint16(offset + 26, true);
    const size = view.getUint32(offset + 18, true);
    names.push(new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + length)));
    assert.equal(new TextDecoder().decode(bytes.slice(offset + 30 + length, offset + 30 + length + size)), 'hello');
    offset += 30 + length + size;
  }
  assert.deepEqual(names, ['报告.txt', '报告 (2).txt', '_报告.txt']);
  assert.equal(view.getUint32(offset, true), 0x02014b50);
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(view.getUint16(bytes.length - 12, true), 3);
  assert.equal(view.getUint32(bytes.length - 6, true), offset);
  await assert.rejects(createDownloadZip([]), /请选择/);
});
