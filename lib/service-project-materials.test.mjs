import test from 'node:test';
import assert from 'node:assert/strict';
import { projectMaterialRecord } from './service-project-materials.ts';
import { requestMaterialGroups, requestMaterialIssues } from './request-materials.ts';
import { editProjectItems } from './service-project-items.ts';
import { newItem, defaultConfig } from './service-requests.ts';

const actor = { id: 'pm', name: '经理', role: 'SmartX 项目经理' };
const service = { id: 's', name: '部署', status: '已启用', priceUnit: '服务人天', deliveryMethods: ['远程'] };
const context = { services: [service], businessObjects: [], requests: [] };
function project() {
  const config = { ...defaultConfig(service), fields: [], basicFields: { description: { enabled: true, required: false } },
    materials: [{ id: 'doc', name: '移交材料', instructions: '', required: true,
      requiredByType: { '技术评估': false, '服务交付': true }, deduplicate: true, onlineTemplateUrl: 'https://example.com/handover' }] };
  return { id: 'SP1', name: '项目', customerId: 'c', status: '进行中', createdById: actor.id, createdBy: actor.name, createdAt: '', updatedAt: '', revision: 1,
    items: [newItem(service, config), newItem(service, config)] };
}

test('项目按服务交付要求展示材料和共用分组，没有服务项或材料时返回空列表', () => {
  const record = project(), before = structuredClone(record);
  const view = projectMaterialRecord(record);
  assert.equal(view.requestType, '服务交付');
  assert.equal(view.id, record.id);
  assert.equal(requestMaterialGroups(view).length, 1);
  assert.equal(requestMaterialGroups(view)[0].requirement.required, true);
  assert.equal(requestMaterialIssues(view).length, 1);
  assert.deepEqual(requestMaterialGroups(projectMaterialRecord({ ...record, items: undefined })), []);
  assert.deepEqual(requestMaterialGroups(projectMaterialRecord({ ...record, items: [{ ...record.items[0], config: { ...record.items[0].config, materials: [] } }] })), []);
  assert.deepEqual(record, before);
});

test('项目共用材料上传、持久化数据、移除服务项和删除文件保持一致，并记录实际上传人', async () => {
  const original = project();
  const file = { id: 'file', name: '移交.txt', size: 3, blob: new Blob(['abc']), uploadedAt: '2026-09-16T00:00:00Z', uploadedById: 'forged' };
  const saved = editProjectItems(original, { type: 'materials', id: original.items[0].id, material: { requirementId: 'doc', files: [file] } }, actor, context);
  assert.equal(saved.revision, 2);
  assert.equal(saved.items[1].materials[0].files[0].uploadedById, actor.id);
  assert.equal(await saved.items[1].materials[0].files[0].blob.text(), 'abc');
  assert.deepEqual(requestMaterialIssues(projectMaterialRecord(saved)), []);
  assert.deepEqual(original.items[0].materials, []);
  const removed = editProjectItems(saved, { type: 'remove', id: saved.items[0].id }, actor, context);
  assert.equal(requestMaterialGroups(projectMaterialRecord(removed))[0].material.files.length, 1);
  const cleared = editProjectItems(removed, { type: 'materials', id: removed.items[0].id, material: { requirementId: 'doc', files: [] } }, actor, context);
  assert.equal(requestMaterialIssues(projectMaterialRecord(cleared)).length, 1);
});

test('结束项目只读，合作伙伴仅能维护有权限项目，已不存在的材料要求不能写入', () => {
  const record = project(), change = { type: 'materials', id: record.items[0].id, material: { requirementId: 'doc', files: [] } };
  for (const status of ['已完成', '已取消']) assert.throws(() => editProjectItems({ ...record, status }, change, actor, context), /不可编辑/);
  const partner = { id: 'partner', name: '伙伴', role: '合作伙伴服务工程师' };
  assert.throws(() => editProjectItems(record, change, partner, context), /无权/);
  assert.doesNotThrow(() => editProjectItems({ ...record, collaborators: { partner: [{ id: partner.id }] } }, change, partner, context));
  assert.throws(() => editProjectItems(record, { ...change, material: { requirementId: 'missing', files: [] } }, actor, context), /材料要求已变化/);
});
