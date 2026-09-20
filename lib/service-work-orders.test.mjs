import { editProjectCollaborators } from './service-project-collaborators.ts';
import { canEditWorkOrderBasicInfo, editWorkOrderBasicInfo, workOrderContactOptions } from './work-order-basic-info.ts';
import { saveStoredWorkOrderBasicInfo } from './service-work-order-store.ts';
import { canSubmitProjectReview, canChangeProjectWorkOrders, projectReviewIssue } from './service-project-work-order-policy.ts';
import { addProjectWorkOrder, cancelProjectWorkOrder, submitProjectReview, returnProjectReview } from './service-work-orders.ts';
import { addStoredProjectWorkOrder, cancelStoredProjectWorkOrder, submitStoredProjectReview, returnStoredProjectReview } from './service-work-order-store.ts';
import { projectDeliverables } from './service-project-deliverables.ts';
import { projectFiles } from './service-project-files.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startProjectWorkOrders, applyWorkStep, emptyWorkStepData, validateWorkStepData, canExecuteWorkOrders, canViewWorkOrderOverview, canManageWorkOrders, canExecuteSpecificWorkOrder, assignedEngineers, workOrderProgress, workOrderOverdue, workOrderUpdatedAt } from './service-work-orders.ts';
import { startStoredServiceProject, saveStoredWorkStep, saveStoredWorkOrderAssignment } from './service-work-order-store.ts';
import { canAssignWorkOrders, assignmentCandidates, assignWorkOrders, engineerKey, assignmentToday } from './work-order-assignment.ts';
import { serviceProviderSettingsId } from './service-provider-settings.ts';
import { newServiceProject, canViewServiceProject, canManageServiceProjects, editServiceProject } from './service-projects.ts';
import { editProjectItems } from './service-project-items.ts';
import { customerServiceProject } from './customer-service-projects.ts';
import { emptyServiceFlowConfig, serviceFlowConfigId } from './service-flows.ts';
import { newServiceFlowStep } from './service-flow-steps.ts';
import { newItem, defaultConfig } from './service-requests.ts';
const manager = { id: 'USR-003', name: '项目经理', role: 'SmartX 项目经理' };
const engineer = { id: 'USR-004', name: '工程师', role: 'SmartX 服务工程师' };
const partner = { id: 'pu1', name: '伙伴工程师', role: '合作伙伴服务工程师' };
const customer = { id: 'customer', name: '客户', role: '客户' };
const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
const users = [manager, engineer, admin].map(user => ({ ...user, status: '启用' }));
const customers = [{ id: 'c1', name: '客户甲', status: '启用', team: '金融' }];
const service = { id: 's1', name: '平台实施', status: '已启用', deliveryMethods: ['远程'] };
function manualInput(serviceId = 's1', method = '远程') {
  const item = newItem({ ...service, id: serviceId }, defaultConfig({ ...service, id: serviceId }));
  item.method = method; item.description = '本次工单需求';
  item.materials = [{ requirementId: 'requirements', files: [{ id: 'file', name: '需求.txt', size: 3, blob: new Blob(['abc']), uploadedAt: '2026-09-18' }] }];
  return { item };
}
function fixture() {
  const project = newServiceProject({ name: '实施项目', expectedServiceDate: '2026-09-20', plannedCompletionDate: '2026-09-22', customerId: 'c1', note: '' }, manager, customers);
  project.items = [newItem(service, defaultConfig(service)), { ...newItem(service, defaultConfig(service)), serviceId: 's2', serviceName: '检查' }];
  project.collaborators = { internal: [{ id: engineer.id, name: engineer.name }], partner: [{ id: partner.id, name: partner.name }] };
  const step = { ...newServiceFlowStep(1), type: 'combined', name: '实施记录', recordRequired: true };
  const config = { ...emptyServiceFlowConfig(), revision: 3, flows: [{ id: 'flow', name: '通用流程', enabled: true, description: '', steps: [step, { ...newServiceFlowStep(2), type: 'combined', required: false, name: '可选补充' }] }], assignment: { defaultFlowId: 'flow', rules: [] } };
  const dictionary = { customers, services: [service] };
  return { project, config, dictionary };
}
const start = (f = fixture()) => startProjectWorkOrders(f.project, manager, users, f.config, f.dictionary);
// Execution fixtures explicitly assign engineers; collaboration alone grants no execution access.
function withTestAssignees(project) {
  for (const order of project.workOrders) order.assignees = [
    { id: engineer.id, name: engineer.name, group: 'internal' },
    { id: partner.id, name: partner.name, group: 'partner' },
  ];
  return project;
}
const startAssigned = (f = fixture()) => withTestAssignees(start(f));
const assignStoredEngineer = p => saveStoredWorkOrderAssignment(p.id, p.revision, manager, {
  orderIds: [p.workOrders[0].id], assignees: [{ id: engineer.id, group: 'internal' }],
});
const act = (project, type, data = emptyWorkStepData(), index = 0, extra = {}) => ({ orderId: project.workOrders[0].id, stepId: project.workOrders[0].steps[index].definition.id, type, data, ...extra });

test('启动按服务项生成独立工单，流程、表单、材料均保留独立快照，排除停用步骤', () => {
  const f = fixture();
  const step = f.config.flows[0].steps[0];
  step.materials = [{ id: 'a', kind: 'attachment', name: '说明.txt', blob: new Blob(['说明']) }];
  f.config.flows[0].steps.push({ ...newServiceFlowStep(3), enabled: false });
  const next = start(f);
  assert.equal(next.status, '进行中'); assert.equal(next.workOrders.length, 2);
  assert.equal(new Set(next.workOrders.map(order => order.id)).size, 2);
  assert.equal(next.workOrders[0].steps.length, 2);
  f.project.items[0].serviceName = '修改后'; step.name = '新步骤';
  assert.equal(next.workOrders[0].item.serviceName, '平台实施');
  assert.equal(next.workOrders[0].steps[0].definition.name, '实施记录');
  assert.equal(f.project.status, '待启动');
  assert.throws(() => startProjectWorkOrders(next, manager, users, f.config, f.dictionary), /重复/);
});
test('无流程、无步骤、空服务项或越权启动均失败，不改变项目', () => {
  const f = fixture(); const before = structuredClone(f.project);
  assert.throws(() => startProjectWorkOrders(f.project, partner, users, f.config, f.dictionary), /项目经理/);
  assert.throws(() => startProjectWorkOrders(f.project, manager, [], f.config, f.dictionary), /项目经理/);
  assert.throws(() => startProjectWorkOrders(f.project, manager, users, emptyServiceFlowConfig(), f.dictionary), /未匹配/);
  f.config.flows[0].steps.forEach(step => step.enabled = false);
  assert.throws(() => start(f), /启用步骤/); assert.deepEqual(f.project, before);
  f.project.items = []; assert.throws(() => start(f), /添加服务项/);
});
test('启动后锁定服务项增删改复制材料，更换客户不能间接修改服务项', () => {
  const p = start();
  for (const type of ['save', 'copy', 'remove', 'materials']) assert.throws(() => editProjectItems(p, { type, id: p.items[0].id, item: p.items[0] }, manager, {}), /锁定/);
  assert.throws(() => editServiceProject(p, { ...p, customerId: 'c2' }, manager, [...customers, { id: 'c2', status: '启用' }]), /锁定/);
});
test('可先跳过后面的可选步骤，必填校验及工单完成条件不变', () => {
  let p = startAssigned();
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'complete')), /执行说明/);
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'skip', emptyWorkStepData(), 1)), /跳过原因/);
  p = applyWorkStep(p, partner, act(p, 'skip', emptyWorkStepData(), 1, { reason: '不适用' }));
  assert.equal(p.workOrders[0].steps[0].status, '待执行');
  assert.equal(p.workOrders[0].steps[1].status, '已跳过');
  assert.equal(p.workOrders[0].status, '进行中');
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'skip', emptyWorkStepData(), 0, { reason: '不适用' })), /必做步骤不能跳过/);
  p = applyWorkStep(p, engineer, act(p, 'save')); assert.equal(p.workOrders[0].status, '进行中');
  p = applyWorkStep(p, engineer, act(p, 'complete', { ...emptyWorkStepData(), description: '实施完成' }));
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'complete')), /重复/);
  assert.equal(p.workOrders[0].status, '已完成'); assert.equal(p.workOrders[1].status, '待执行'); assert.equal(p.status, '进行中');
});
test('后面的必做步骤可先保存和完成，前面的步骤保持未完成且工单不提前结束', () => {
  const f = fixture();
  f.config.flows[0].steps[1] = { ...f.config.flows[0].steps[1], required: true, recordRequired: true };
  let p = startAssigned(f);
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'complete', emptyWorkStepData(), 1)), /执行说明/);
  p = applyWorkStep(p, engineer, act(p, 'save', emptyWorkStepData(), 1));
  assert.equal(p.workOrders[0].steps[1].status, '进行中');
  p = applyWorkStep(p, engineer, act(p, 'complete', { ...emptyWorkStepData(), description: '先完成第二步' }, 1));
  assert.equal(p.workOrders[0].steps[0].status, '待执行');
  assert.equal(p.workOrders[0].steps[1].status, '已完成');
  assert.equal(p.workOrders[0].status, '进行中');
  assert.equal(p.workOrders[0].completedAt, undefined);
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'save', emptyWorkStepData(), 1)), /执行说明/);
  p = applyWorkStep(p, engineer, act(p, 'complete', { ...emptyWorkStepData(), description: '再完成第一步' }));
  assert.equal(p.workOrders[0].status, '已完成');
  assert.ok(p.workOrders[0].completedAt);
});
test('未完成工单允许修改已完成步骤，保存保留完成状态并记录修改，完成工单后锁定', () => {
  let p = startAssigned();
  const data = { ...emptyWorkStepData(), description: '原执行记录' };
  p = applyWorkStep(p, engineer, act(p, 'complete', data));
  const before = structuredClone(p);
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'save')), /执行说明/);
  assert.deepEqual(p, before);
  p = applyWorkStep(p, manager, act(p, 'save', { ...data, description: '修订后的执行记录' }), '2026-09-19T10:00:00Z');
  assert.equal(p.workOrders[0].steps[0].data.description, '修订后的执行记录');
  assert.equal(p.workOrders[0].steps[0].status, '已完成');
  assert.equal(p.workOrders[0].steps[0].updatedBy, manager.name);
  assert.equal(p.workOrders[0].status, '进行中');
  assert.equal(p.revision, before.revision + 1);
  assert.equal(p.operations.activities.at(-1).title, '修改已完成工单步骤');
  for (const status of ['待复核', '待确认', '已取消', '已完成']) {
    assert.throws(() => applyWorkStep({ ...p, status }, engineer, act(p, 'save', data)), /状态/);
  }
  assert.throws(() => applyWorkStep(p, customer, act(p, 'save', data)), /身份/);
  p = applyWorkStep(p, engineer, act(p, 'skip', emptyWorkStepData(), 1, { reason: '无需补充' }));
  assert.equal(p.workOrders[0].status, '已完成');
  assert.equal(p.status, '进行中');
  for (const type of ['save', 'complete', 'skip']) {
    assert.throws(() => applyWorkStep(p, engineer, act(p, type, data)), /该工单已完成/);
  }
  let skipped = startAssigned();
  skipped = applyWorkStep(skipped, engineer, act(skipped, 'skip', emptyWorkStepData(), 1, { reason: '无需补充' }));
  assert.throws(() => applyWorkStep(skipped, engineer, act(skipped, 'save', data, 1)), /该步骤已结束/);
});
test('已完成表单、文档和文件步骤可修订且继续执行完整必填校验', () => {
  for (const type of ['form', 'document', 'upload']) {
    const f = fixture();
    const step = f.config.flows[0].steps[0];
    step.type = type;
    const item = { id: 'material', name: '交付材料', required: true, instructions: '', deliverToCustomer: true, onlineTemplateUrl: '', formats: '.txt', minFiles: 1 };
    step.documents = [item]; step.files = [item];
    step.executionFormId = 'form';
    step.executionForm = { id: 'form', name: '执行检查', description: '', fields: [{ id: 'result', name: '检查结果', type: 'text', required: true, options: [] }], layout: { order: ['result'], widths: {}, rowStarts: [] } };
    const file = { id: 'file', name: '记录.txt', size: 3, blob: new Blob(['abc']), uploadedAt: '2026-09-19T09:00:00Z' };
    const data = { ...emptyWorkStepData(), values: { result: '通过' }, deliverables: { material: [file] } };
    let p = startAssigned(f);
    p = applyWorkStep(p, engineer, act(p, 'complete', data));
    assert.throws(() => applyWorkStep(p, engineer, act(p, 'save')), type === 'form' ? /检查结果/ : /至少/);
    p = applyWorkStep(p, manager, act(p, 'save', { ...data, values: { result: '复查通过' }, deliverables: { material: [{ ...file, id: 'replacement', name: '修订记录.txt' }] } }));
    assert.equal(p.workOrders[0].steps[0].status, '已完成');
    assert.equal(p.workOrders[0].status, '进行中');
    if (type === 'form') assert.equal(p.workOrders[0].steps[0].data.values.result, '复查通过');
    else {
      assert.equal(p.workOrders[0].steps[0].data.deliverables.material[0].name, '修订记录.txt');
      assert.equal(p.workOrders[0].steps[0].data.deliverables.material[0].submittedBy, manager.name);
      assert.equal(p.workOrders[0].steps[0].data.deliverables.material[0].deliverToCustomer, true);
    }
  }
});
test('布尔 false 为有效填写值，多选空值、非法日期、数字和文件格式被拒绝', () => {
  const step = { ...newServiceFlowStep(1), executionForm: { id: 'form', name: '实施', description: '', fields: [{ id: 'flag', type: 'boolean', name: '通过', required: true, options: [] }], layout: { order: ['flag'], widths: {}, rowStarts: [] } } };
  assert.equal(validateWorkStepData(step, { ...emptyWorkStepData(), values: { flag: false } }, true).values.flag, false);
  assert.throws(() => validateWorkStepData(step, emptyWorkStepData(), true), /通过/);
  for (const [type, value] of [['multiple', '[]'], ['date', '2026-02-30'], ['integer', '1.5']]) {
    step.executionForm.fields[0].type = type;
    assert.throws(() => validateWorkStepData(step, { ...emptyWorkStepData(), values: { flag: value } }, true));
  }
  const file = { id: 'f', name: 'file.txt', size: 2, uploadedAt: '', blob: new Blob(['ok']) };
  const upload = { ...newServiceFlowStep(1), type: 'upload', files: [{ id: 'doc', name: '材料', required: true, instructions: '', deliverToCustomer: true, formats: '.pdf', minFiles: 2 }] };
  assert.throws(() => validateWorkStepData(upload, { ...emptyWorkStepData(), deliverables: { doc: [file] } }, true), /至少/);
  assert.throws(() => validateWorkStepData(upload, { ...emptyWorkStepData(), deliverables: { doc: [file] } }, false), /格式/);
  upload.files[0].formats = '.txt'; upload.files[0].minFiles = 1;
  assert.equal(validateWorkStepData(upload, { ...emptyWorkStepData(), deliverables: { doc: [file] } }, true).deliverables.doc[0].deliverToCustomer, true);
});
test('工程师按协作范围访问，客户投影不含工单，已结束项目不可执行', () => {
  const p = start();
  assert.ok(canViewServiceProject(engineer, p)); assert.ok(canExecuteWorkOrders(p, partner));
  assert.equal(canViewServiceProject({ ...engineer, id: 'unassigned' }, p), false);
  assert.equal(canExecuteWorkOrders(p, customer), false);
  assert.equal(Object.hasOwn(customerServiceProject(p), 'workOrders'), false);
  for (const status of ['已取消', '已完成', '待复核', '待确认']) assert.throws(() => applyWorkStep({ ...p, status }, engineer, act(p, 'save')), /状态/);
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

function storesFixture() {
  const f = fixture();
  f.project.serviceProviderId = 'provider:smartx';
  return { f, stores: { configs: [], requests: [], references: [
    { id: 'workspace', payload: { ...f.dictionary, users, partners: [], partnerUsers: [] } },
    { id: serviceFlowConfigId, payload: f.config },
    { id: `service-project:${f.project.id}`, payload: f.project },
  ] } };
}
test('事务启动并重读工单，执行保存附件字节，过期保存与重复启动不能覆盖', async t => {
  const { f, stores } = storesFixture(); storage(t, stores);
  let saved = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  saved = await assignStoredEngineer(saved);
  assert.equal(stores.references.find(row => row.id === `service-project:${f.project.id}`).payload.workOrders.length, 2);
  await assert.rejects(() => startStoredServiceProject(saved.id, saved.revision, manager), /重复/);
  const file = { id: 'file', name: '记录.txt', uploadedAt: '2026-09-18', size: 3, blob: new Blob(['abc']) };
  saved = await saveStoredWorkStep(saved.id, saved.revision, engineer, act(saved, 'complete', { ...emptyWorkStepData(), description: '完成', attachments: [file] }));
  assert.equal(await saved.workOrders[0].steps[0].data.attachments[0].blob.text(), 'abc');
  saved = await saveStoredWorkStep(saved.id, saved.revision, manager, act(saved, 'save', { ...saved.workOrders[0].steps[0].data, description: '保存修订记录' }));
  const persisted = stores.references.find(row => row.id === `service-project:${saved.id}`).payload;
  assert.equal(persisted.workOrders[0].steps[0].status, '已完成');
  assert.equal(persisted.workOrders[0].steps[0].data.description, '保存修订记录');
  assert.equal(await persisted.workOrders[0].steps[0].data.attachments[0].blob.text(), 'abc');
  await assert.rejects(() => saveStoredWorkStep(saved.id, saved.revision - 1, engineer, act(saved, 'save')), /已被其他页面/);
  assert.equal(stores.references.find(row => row.id === `service-project:${saved.id}`).payload.revision, saved.revision);
});
test('缺少流程及写入失败时启动事务不产生任何半成品工单或状态变更', async t => {
  const { f, stores } = storesFixture(); storage(t, stores, () => true);
  const before = structuredClone(stores);
  await assert.rejects(() => startStoredServiceProject(f.project.id, f.project.revision, manager), /模拟存储失败/);
  assert.deepEqual(stores, before);
});

test('启动必须校验两项计划日期，拒绝缺失、无效及倒置日期，同日允许', () => {
  const f = fixture();
  for (const patch of [{ expectedServiceDate: '' }, { plannedCompletionDate: undefined }, { plannedCompletionDate: '' }, { expectedServiceDate: '2026-02-30' }, { plannedCompletionDate: '2026-02-29' }, { plannedCompletionDate: '2026-09-19' }]) {
    assert.throws(() => start({ ...f, project: { ...f.project, ...patch } }), /计划.*日期/);
  }
  const started = start({ ...f, project: { ...f.project, plannedCompletionDate: f.project.expectedServiceDate } });
  assert.equal(started.workOrders[0].plannedCompletionDate, f.project.expectedServiceDate);
  assert.equal(f.project.status, '待启动');
});
test('启动弹窗提交日期与工单、状态在同一事务保存，校验失败不写入', async t => {
  const { f, stores } = storesFixture();
  delete f.project.plannedCompletionDate;
  storage(t, stores);
  const before = structuredClone(stores);
  await assert.rejects(startStoredServiceProject(f.project.id, f.project.revision, manager, { expectedServiceDate: '2026-09-25', plannedCompletionDate: '2026-09-24' }), /不能早于/);
  assert.deepEqual(stores, before);
  const schedule = { expectedServiceDate: '2026-09-25', plannedCompletionDate: '2026-09-28' };
  const saved = await startStoredServiceProject(f.project.id, f.project.revision, manager, schedule);
  const stored = stores.references.find(row => row.id === `service-project:${saved.id}`).payload;
  assert.equal(stored.expectedServiceDate, schedule.expectedServiceDate);
  assert.equal(stored.plannedCompletionDate, schedule.plannedCompletionDate);
  assert.equal(stored.status, '进行中');
  for (const order of stored.workOrders) {
    assert.equal(order.expectedServiceDate, schedule.expectedServiceDate);
    assert.equal(order.plannedCompletionDate, schedule.plannedCompletionDate);
  }
  assert.equal(customerServiceProject(saved).plannedCompletionDate, schedule.plannedCompletionDate);
});
test('启动填写计划日期不绕过原有只读限制，写入失败时日期和工单一起回滚', async t => {
  const { f, stores } = storesFixture();
  f.project.requestConversion = { mapping: { fields: { expectedServiceDate: 'expectedServiceDate' }, readonly: { expectedServiceDate: true } }, workOrders: [] };
  storage(t, stores, () => true);
  const before = structuredClone(stores);
  await assert.rejects(startStoredServiceProject(f.project.id, f.project.revision, manager, { expectedServiceDate: '2026-09-25', plannedCompletionDate: '2026-09-28' }), /只读/);
  await assert.rejects(startStoredServiceProject(f.project.id, f.project.revision, manager, { expectedServiceDate: f.project.expectedServiceDate, plannedCompletionDate: '2026-09-28' }), /模拟存储失败/);
  assert.deepEqual(stores, before);
});

test('文件提交信息由保存身份记录，后续保存保留原提交人时间，新增文件归属当前用户', () => {
  const project = startAssigned();
  const data = emptyWorkStepData();
  data.description = '执行记录';
  data.attachments = [{ id: 'file-a', name: '记录.txt', blob: new Blob(['记录']), size: 6, uploadedAt: '2026-09-17T01:00:00Z', uploadedById: 'forged', submittedBy: '伪造用户' }];
  const first = applyWorkStep(project, engineer, act(project, 'save', data), '2026-09-17T02:00:00Z');
  const firstFile = first.workOrders[0].steps[0].data.attachments[0];
  assert.equal(firstFile.uploadedById, engineer.id);
  assert.equal(firstFile.submittedBy, engineer.name);
  assert.equal(firstFile.submittedAt, '2026-09-17T02:00:00Z');
  const nextData = structuredClone(first.workOrders[0].steps[0].data);
  nextData.attachments[0].submittedBy = '篡改归属';
  nextData.attachments.push({ id: 'file-b', name: '补充.txt', blob: new Blob(['补充']), size: 6, uploadedAt: '2026-09-17T03:00:00Z' });
  const saved = applyWorkStep(first, manager, act(first, 'complete', nextData), '2026-09-17T04:00:00Z');
  const files = saved.workOrders[0].steps[0].data.attachments;
  assert.equal(files[0].submittedBy, engineer.name);
  assert.equal(files[0].submittedAt, firstFile.submittedAt);
  assert.equal(files[1].submittedBy, manager.name);
  assert.equal(files[1].submittedAt, '2026-09-17T04:00:00Z');
});


const managementDirectory = () => ({ users, contacts: [], partners: [{ id: 'p1', status: '启用' }], partnerUsers: [{ id: partner.id, name: partner.name, partnerId: 'p1', status: '启用' }] });
const managementInput = p => ({ orderId: p.workOrders[0].id, expectedServiceDate: '2026-09-21', plannedCompletionDate: '2026-09-23' });
test('概览对有项目访问权的内部和合作伙伴人员开放，管理仅进行中项目的经理和管理员可用', () => {
  const p = start();
  assert.equal(canViewWorkOrderOverview(p, manager), true);
  assert.equal(canViewWorkOrderOverview(p, engineer), true);
  assert.equal(canViewWorkOrderOverview(p, partner), true);
  for (const actor of [customer, { ...engineer, id: 'outsider' }]) {
    assert.equal(canViewWorkOrderOverview(p, actor), false);
  }
  assert.equal(canManageWorkOrders(p, engineer), false);
  assert.equal(canManageWorkOrders(p, { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' }), true);
});
test('步骤统计区分完成与跳过，逾期排除当日、已完成和取消项目', () => {
  const p = start(); const order = p.workOrders[0];
  order.steps[0].status = '已完成'; order.steps[1].status = '已跳过';
  assert.deepEqual(workOrderProgress(order), { completed: 1, skipped: 1, total: 2 });
  assert.equal(workOrderOverdue(p, order, '2026-09-22'), false);
  assert.equal(workOrderOverdue(p, order, '2026-09-23'), true);
  assert.equal(workOrderOverdue(p, { ...order, plannedCompletionDate: undefined }, '2026-09-23'), false);
  assert.equal(workOrderOverdue(p, { ...order, status: '已完成' }, '2026-09-23'), false);
  assert.equal(workOrderOverdue({ ...p, status: '已取消' }, order, '2026-09-23'), false);
});

const assignmentNow = '2026-09-17T01:00:00Z';
function assignmentFixture() {
  const project = { ...start(), serviceProviderId: 'provider:smartx', serviceProviderName: '北京志凌海纳' };
  const directory = {
    users: users.map(u => ({ ...u, email: `${u.id}@example.com` })), contacts: [],
    partners: [{ id: 'p1', name: '服务商甲', status: '启用' }, { id: 'p2', name: '合作伙伴乙', status: '启用' }, { id: 'p3', name: '停用企业', status: '停用' }],
    partnerUsers: [{ ...partner, partnerId: 'p1', status: '启用', email: 'a@example.com' }, { id: 'pu2', name: '乙工程师', partnerId: 'p2', status: '启用' }, { id: 'pu3', name: '停用用户', partnerId: 'p1', status: '停用' }, { id: 'pu4', name: '停用企业用户', partnerId: 'p3', status: '启用' }],
    providers: { revision: 1, entries: [{ partnerId: 'p1', enabled: true, updatedAt: assignmentNow, updatedBy: manager.name }, { partnerId: 'p3', enabled: true, updatedAt: assignmentNow, updatedBy: manager.name }] },
    services: [{ ...service, certifications: ['SMTX OS 认证'] }, { ...service, id: 's2', name: '检查', certifications: ['CloudTower 认证'] }],
    serviceCertifications: [
      { id: 'cert1', userId: engineer.id, userName: engineer.name, holderType: 'internal', certification: 'SMTX OS 认证', status: '启用', expiresOn: '2099-09-17' },
      { id: 'cert2', userId: partner.id, userName: partner.name, holderType: 'partner', certification: 'CloudTower 认证', status: '启用', expiresOn: '2099-09-17' },
    ],
  };
  const input = { orderIds: project.workOrders.map(o => o.id), assignees: [{ id: engineer.id, group: 'internal' }, { id: partner.id, group: 'partner' }] };
  return { project, directory, input };
}
test('可派范围随服务方变化：原厂加启用服务商，其他企业仅本企业，未知服务方无候选', () => {
  const { project, directory } = assignmentFixture();
  const ids = p => assignmentCandidates(p, directory, '2026-09-17').map(engineerKey);
  assert.deepEqual(ids(project), ['internal:USR-004', 'partner:pu1']);
  assert.deepEqual(ids({ ...project, serviceProviderId: 'partner:p1' }), ['partner:pu1']);
  assert.deepEqual(ids({ ...project, serviceProviderId: 'partner:p2' }), ['partner:pu2']);
  assert.deepEqual(ids({ ...project, serviceProviderId: 'partner:p3' }), []);
  assert.deepEqual(ids({ ...project, serviceProviderId: undefined }), []);
  directory.providers.entries[0].enabled = false;
  assert.deepEqual(ids(project), ['internal:USR-004']);
  directory.users.find(u => u.id === engineer.id).status = '停用';
  assert.deepEqual(ids(project), []);
});
test('认证仅取有效且属于本人类型的记录，按北京时间含到期当天', () => {
  const { project, directory } = assignmentFixture();
  const cert = directory.serviceCertifications[0];
  cert.expiresOn = '2026-09-17';
  directory.serviceCertifications.push({ ...cert, id: 'expired', expiresOn: '2026-09-16' }, { ...cert, id: 'disabled', status: '停用' }, { ...cert, id: 'wrong-type', holderType: 'partner' });
  assert.deepEqual(assignmentCandidates(project, directory, '2026-09-17')[0].certifications.map(c => c.id), ['cert1']);
  assert.deepEqual(assignmentCandidates(project, directory, '2026-09-18')[0].certifications, []);
  assert.equal(assignmentToday('2026-09-17T16:00:00Z'), '2026-09-18');
});
test('多人认证并集覆盖批量工单，单人缺认证整批失败，保存保留执行记录与计划', () => {
  const { project, directory, input } = assignmentFixture();
  const before = structuredClone(project);
  assert.throws(() => assignWorkOrders(project, manager, { ...input, assignees: [input.assignees[0]] }, directory, assignmentNow), /CloudTower/);
  assert.deepEqual(project, before);
  input.assignees[0].name = '伪造姓名';
  const saved = assignWorkOrders(project, manager, input, directory, assignmentNow);
  assert.equal(saved.revision, project.revision + 1);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual(saved.workOrders[i].assignees.map(p => p.name), [engineer.name, partner.name]);
    assert.deepEqual(saved.workOrders[i].steps, project.workOrders[i].steps);
    assert.equal(saved.workOrders[i].plannedCompletionDate, project.workOrders[i].plannedCompletionDate);
    assert.equal(saved.workOrders[i].status, project.workOrders[i].status);
  }
  assert.equal(saved.operations.activities.at(-1).externalVisible, false);
  assert.match(saved.operations.activities.at(-1).detail, /工程师.*伙伴工程师/);
  assert.equal(assignWorkOrders(saved, manager, input, directory, assignmentNow), saved);
});
test('逐单改派替换人员并兼容旧单人记录，收回旧工程师执行权限', () => {
  const { project, directory, input } = assignmentFixture();
  project.workOrders[0].assignee = { ...engineer, group: 'internal' };
  directory.services[0].certifications = ['CloudTower 认证'];
  project.collaborators.partner = [];
  const saved = assignWorkOrders(project, manager, { orderIds: [input.orderIds[0]], assignees: [input.assignees[1]] }, directory, assignmentNow);
  assert.equal(saved.workOrders[0].assignee, undefined);
  assert.deepEqual(assignedEngineers(saved.workOrders[0]).map(p => p.id), [partner.id]);
  assert.deepEqual(saved.workOrders[1], project.workOrders[1]);
  assert.equal(canViewServiceProject(partner, saved), true);
  assert.equal(canExecuteSpecificWorkOrder(saved, saved.workOrders[0], partner), true);
  assert.equal(canExecuteSpecificWorkOrder(saved, saved.workOrders[1], partner), false);
  assert.throws(() => applyWorkStep(saved, engineer, act(saved, 'save')), /未被指派/);
  assert.doesNotThrow(() => applyWorkStep(saved, partner, act(saved, 'save')));
});
test('拒绝无权限、空选、重复、跨企业、已完成、无目录及任一工单认证不足，原项目不变', () => {
  const { project, directory, input } = assignmentFixture();
  const before = structuredClone(project);
  for (const patch of [{ orderIds: [] }, { orderIds: ['missing'] }, { orderIds: [input.orderIds[0], input.orderIds[0]] }, { assignees: [] }, { assignees: [input.assignees[0], input.assignees[0]] }, { assignees: [{ id: 'pu2', group: 'partner' }] }])
    assert.throws(() => assignWorkOrders(project, manager, { ...input, ...patch }, directory, assignmentNow));
  for (const actor of [engineer, partner, customer]) assert.throws(() => assignWorkOrders(project, actor, input, directory, assignmentNow), /身份/);
  assert.throws(() => assignWorkOrders({ ...project, status: '已完成' }, manager, input, directory, assignmentNow), /状态/);
  assert.throws(() => assignWorkOrders({ ...project, workOrders: project.workOrders.map((o,i) => i ? { ...o, status: '已完成' } : o) }, manager, input, directory, assignmentNow), /已完成工单/);
  assert.throws(() => assignWorkOrders(project, manager, input, { ...directory, services: [directory.services[0]] }, assignmentNow), /目录不存在/);
  assert.deepEqual(project, before);
  directory.services.forEach(s => s.certifications = ['无认证要求']);
  directory.serviceCertifications = [];
  assert.doesNotThrow(() => assignWorkOrders(project, manager, input, directory, assignmentNow));
});
function assignmentStores() {
  const f = assignmentFixture();
  return { ...f, stores: { references: [{ id: 'workspace', payload: f.directory }, { id: serviceProviderSettingsId, payload: f.directory.providers }, { id: `service-project:${f.project.id}`, payload: f.project }] } };
}
test('指派事务重读最新服务商、认证和角色，拒绝过期版本，整批保存', async t => {
  const { project, directory, input, stores } = assignmentStores(); storage(t, stores);
  const original = structuredClone(project);
  directory.providers.entries[0].enabled = false;
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, manager, input), /范围/);
  directory.providers.entries[0].enabled = true;
  directory.serviceCertifications[1].status = '停用';
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, manager, input), /CloudTower/);
  directory.serviceCertifications[1].status = '启用';
  directory.users.find(u => u.id === engineer.id).status = '停用';
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, manager, input), /范围/);
  directory.users.find(u => u.id === engineer.id).status = '启用';
  assert.deepEqual(stores.references.at(-1).payload, original);
  const saved = await saveStoredWorkOrderAssignment(project.id, project.revision, manager, input);
  assert.equal(saved.workOrders.every(order => order.assignees.length === 2), true);
  assert.ok(saved.collaborators.internal.some(person => person.id === engineer.id && person.assignmentRoles.includes('服务工程师')));
  assert.ok(saved.collaborators.partner.some(person => person.id === partner.id && person.assignmentRoles.includes('服务工程师')));
  assert.deepEqual(stores.references.at(-1).payload.collaborators, saved.collaborators);
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, manager, input), /已被其他页面/);
});
test('批量指派写入失败时所有工单和活动记录回滚', async t => {
  const { project, input, stores } = assignmentStores();
  storage(t, stores, () => true);
  const before = structuredClone(stores.references.at(-1).payload);
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, manager, input));
  assert.deepEqual(stores.references.at(-1).payload, before);
});

function managedProject() {
  const f = fixture();
  f.project.collaborators.internal.push({ id: manager.id, name: manager.name, assignmentRoles: ['项目经理'] });
  return { ...f, project: start(f) };
}
test('负责项目经理和管理员可增减进行中工单，合作伙伴仅可管理自己创建的项目', () => {
  const { project, config, dictionary } = managedProject();
  assert.equal(canChangeProjectWorkOrders(project, manager), true);
  assert.doesNotThrow(() => addProjectWorkOrder(project, admin, manualInput(), config, dictionary));
  assert.doesNotThrow(() => cancelProjectWorkOrder(project, admin, project.workOrders[0].id, '调整'));
  const own = { ...project, createdSite: '合作伙伴中心', createdById: partner.id };
  assert.doesNotThrow(() => addProjectWorkOrder(own, partner, manualInput(), config, dictionary));
  assert.doesNotThrow(() => cancelProjectWorkOrder(own, partner, own.workOrders[0].id, '调整'));
  assert.throws(() => submitProjectReview(own, partner), /执行工程师/);
  assert.equal(canChangeProjectWorkOrders({ ...own, createdById: 'other' }, partner), false);

  for (const actor of [{ ...manager, id: 'other' }, engineer, partner, customer]) {
    assert.throws(() => addProjectWorkOrder(project, actor, manualInput(), config, dictionary), /身份/);
    assert.throws(() => cancelProjectWorkOrder(project, actor, project.workOrders[0].id, '调整'), /身份/);
  }
  for (const status of ['待启动', '待复核', '待确认', '已完成', '已取消']) {
    assert.throws(() => addProjectWorkOrder({ ...project, status }, manager, manualInput(), config, dictionary), /进行中/);
    assert.throws(() => cancelProjectWorkOrder({ ...project, status }, manager, project.workOrders[0].id, '调整'), /进行中/);
  }
});
test('手动工单按当前目录及流程独立快照，服务项、材料、日期与已有工单不变', () => {
  const { project, config, dictionary } = managedProject();
  const before = structuredClone(project);
  config.revision = 8; config.flows[0].steps[0].name = '新增时步骤';
  const saved = addProjectWorkOrder(project, manager, manualInput(), config, dictionary, '2026-09-18T10:00:00Z');
  const order = saved.workOrders.at(-1);
  assert.equal(order.origin, 'manual'); assert.equal(order.flowRevision, 8);
  assert.equal(order.createdById, manager.id); assert.equal(order.createdAt, '2026-09-18T10:00:00Z');
  assert.equal(order.steps[0].definition.name, '新增时步骤');
  assert.deepEqual(saved.items, before.items); assert.deepEqual(saved.workOrders.slice(0, -1), before.workOrders);
  assert.equal(saved.plannedCompletionDate, before.plannedCompletionDate);
  config.flows[0].steps[0].name = '后续变化'; dictionary.services[0] = { ...dictionary.services[0], name: '后续目录' };
  assert.equal(order.steps[0].definition.name, '新增时步骤'); assert.equal(order.catalogSnapshot.name, '平台实施');
  assert.equal(saved.operations.activities.at(-1).title, '创建工单');
  assert.deepEqual(project, before);
  assert.throws(() => addProjectWorkOrder(project, manager, manualInput('bad'), config, dictionary), /服务目录/);
  assert.throws(() => addProjectWorkOrder(project, manager, manualInput('s1', 'bad'), config, dictionary), /服务方式/);
  assert.throws(() => addProjectWorkOrder(project, manager, manualInput(), emptyServiceFlowConfig(), dictionary), /未匹配/);
});
test('任意工单状态都可取消且不可恢复，文件与工时额度保留，交付物撤下', async () => {
  for (const status of ['待执行', '进行中', '已完成']) {
    const { project } = managedProject();
    const order = project.workOrders[0]; order.status = status;
    order.steps[0].definition = { ...order.steps[0].definition, type: 'document', documents: [{ id: 'doc', name: '交付报告', deliverToCustomer: true }] };
    order.steps[0].data.deliverables = { doc: [{ id: 'f', name: '交付.txt', blob: new Blob(['正文']), size: 6, uploadedAt: '2026-09-18' }] };
    project.operations.worklogs = [{ id: 'log', hours: 3 }]; project.requestConversion = { workOrders: [], mapping: {}, assessmentSnapshot: { basis: { entitlementAllocations: [{ objectId: 'asset', quantity: 2 }] }, approvals: [] } };
    assert.equal(projectDeliverables(project).length, 1);
    assert.throws(() => cancelProjectWorkOrder(project, manager, order.id, '  '), /取消原因/);
    const result = cancelProjectWorkOrder(project, manager, order.id, '范围调整', '2026-09-18T11:00:00Z');
    assert.equal(result.workOrders[0].status, '已取消');
    assert.equal(result.workOrders[0].cancellation.previousStatus, status);
    assert.deepEqual(result.workOrders[0].steps, order.steps);
    assert.deepEqual(result.operations.worklogs, project.operations.worklogs);
    assert.deepEqual(result.requestConversion, project.requestConversion);
    assert.equal(projectDeliverables(result).length, 0); assert.equal(customerServiceProject(result).deliverables.length, 0);
    assert.equal(await projectFiles(result)[0].file.blob.text(), '正文');
    assert.throws(() => cancelProjectWorkOrder(result, manager, order.id, '再次取消'), /已取消/);
    assert.throws(() => applyWorkStep(result, manager, act(result, 'save')), /不能修改/);
    assert.equal(workOrderOverdue(result, result.workOrders[0], '2027-01-01'), false);
  }
});
test('复核必须有有效工单且全部完成，取消不阻塞复核，复核后禁止增减', () => {
  const { project, config, dictionary } = managedProject();
  withTestAssignees(project);
  assert.ok(projectReviewIssue(project));
  assert.throws(() => submitProjectReview(project, engineer), /所有未取消/);
  assert.throws(() => editServiceProject(project, { ...project, status: '待复核' }, manager, customers), /手动提交/);
  let cancelled = cancelProjectWorkOrder(project, manager, project.workOrders[0].id, '范围调整');
  cancelled = cancelProjectWorkOrder(cancelled, manager, project.workOrders[1].id, '范围调整');
  assert.match(projectReviewIssue(cancelled), /至少保留/);
  assert.throws(() => submitProjectReview(cancelled, engineer), /执行工程师/);
  const remaining = structuredClone(project); remaining.workOrders[1].status = '已完成';
  const ready = cancelProjectWorkOrder(remaining, manager, remaining.workOrders[0].id, '范围调整');
  assert.equal(projectReviewIssue(ready), null);
  const reviewed = submitProjectReview(ready, engineer);
  assert.equal(reviewed.status, '待复核');
  assert.throws(() => addProjectWorkOrder(reviewed, manager, manualInput(), config, dictionary), /进行中/);
  assert.throws(() => cancelProjectWorkOrder(reviewed, manager, reviewed.workOrders[1].id, '不能取消'), /进行中/);
});
test('新增和取消事务校验版本、最新流程与权限，失败不产生记录或日志', async t => {
  const { f, stores } = storesFixture();
  f.project.collaborators.internal.push({ id: manager.id, name: manager.name, assignmentRoles: ['项目经理'] });
  let fail = false;
  storage(t, stores, () => fail);
  let project = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  const flow = stores.references.find(row => row.id === serviceFlowConfigId).payload;
  flow.revision = 9; flow.flows[0].steps[0].name = '当前流程';
  project = await addStoredProjectWorkOrder(project.id, project.revision, manager, manualInput());
  assert.equal(project.workOrders.at(-1).flowRevision, 9);
  assert.equal(project.workOrders.at(-1).steps[0].definition.name, '当前流程');
  await assert.rejects(addStoredProjectWorkOrder(project.id, project.revision - 1, manager, manualInput()), /更新/);
  const before = structuredClone(stores);
  fail = true;
  await assert.rejects(cancelStoredProjectWorkOrder(project.id, project.revision, manager, project.workOrders[0].id, '取消'), /模拟存储失败/);
  assert.deepEqual(stores, before);
  await assert.rejects(addStoredProjectWorkOrder(project.id, project.revision, manager, manualInput()), /模拟存储失败/);
  assert.deepEqual(stores, before);
  fail = false;
  const cancelled = await cancelStoredProjectWorkOrder(project.id, project.revision, manager, project.workOrders[0].id, '取消');
  assert.equal(cancelled.workOrders[0].status, '已取消');
  const next = await addStoredProjectWorkOrder(cancelled.id, cancelled.revision, manager, manualInput());
  assert.equal(new Set(next.workOrders.map(order => order.id)).size, 4);
  const persisted = stores.references.find(row => row.id === `service-project:${next.id}`).payload;
  withTestAssignees(persisted);
  await assert.rejects(submitStoredProjectReview(next.id, next.revision, engineer), /所有未取消/);
  for (const order of persisted.workOrders) if (order.status !== '已取消') order.status = '已完成';
  const reviewed = await submitStoredProjectReview(next.id, next.revision, engineer);
  assert.equal(reviewed.status, '待复核');
  assert.equal(stores.references.find(row => row.id === `service-project:${next.id}`).payload.status, '待复核');
  await assert.rejects(cancelStoredProjectWorkOrder(reviewed.id, reviewed.revision, manager, reviewed.workOrders[1].id, '取消'), /进行中/);
});

test('新建工单按当前操作人使用内部或合作伙伴表单，保存配置快照且不改变服务项', async t => {
  const { f, stores } = storesFixture();
  f.project.collaborators.internal.push({ ...manager, assignmentRoles: ['项目经理'] });
  f.project.createdSite = '合作伙伴中心'; f.project.createdById = partner.id;
  const workspace = stores.references[0].payload;
  workspace.partners = [{ id: 'p1', status: '启用' }];
  workspace.partnerUsers = [{ ...partner, partnerId: 'p1', status: '启用' }];
  const internalForm = { ...defaultConfig(service), revision: 4, fields: ['internal-only'], fieldNames: { 'internal-only': '内部字段' }, materials: [] };
  const partnerForm = { ...defaultConfig(service), revision: 7, fields: ['partner-only'], fieldNames: { 'partner-only': '伙伴字段' }, materials: [] };
  stores.configs = [internalForm];
  stores.references.push({ id: 'partner-request-config:s1', payload: partnerForm });
  storage(t, stores);
  let project = await startStoredServiceProject(f.project.id, f.project.revision, admin);
  const input = manualInput(); input.item.values = { 'internal-only': '内部值', 'partner-only': '伙伴值' };
  input.item.config = { ...input.item.config, fields: [], materials: [] }; // client config is not authoritative
  project = await addStoredProjectWorkOrder(project.id, project.revision, admin, input);
  assert.deepEqual(project.workOrders.at(-1).item.values, { 'internal-only': '内部值' });
  assert.equal(project.workOrders.at(-1).item.config.revision, 4);
  const previous = structuredClone(project.workOrders);
  project = await addStoredProjectWorkOrder(project.id, project.revision, partner, input);
  assert.deepEqual(project.workOrders.at(-1).item.values, { 'partner-only': '伙伴值' });
  assert.equal(project.workOrders.at(-1).item.config.revision, 7);
  assert.deepEqual(project.workOrders.slice(0, -1), previous);
  assert.deepEqual(project.items, f.project.items);
  const storedForm = stores.references.find(row => row.id === 'partner-request-config:s1').payload;
  storedForm.fields = []; storedForm.basicFields.description.required = false;
  const empty = manualInput(); empty.item.description = ''; empty.item.materials = [];
  project = await addStoredProjectWorkOrder(project.id, project.revision, partner, empty);
  assert.deepEqual(project.workOrders.at(-1).item.values, {}); // empty partner form must not fall back to internal
  assert.deepEqual(project.workOrders.at(-2).item.config.fields, ['partner-only']);
});

test('创建时重读表单必填规则，伪造字段配置、跨客户对象和未开放目录均不可绕过', async t => {
  const { f, stores } = storesFixture();
  f.project.collaborators.internal.push({ ...manager, assignmentRoles: ['项目经理'] });
  stores.configs = [{ ...defaultConfig(service), fields: ['serial'], fieldNames: { serial: '序列号' } }];
  storage(t, stores);
  const project = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  const input = manualInput(); input.item.config = { ...input.item.config, fields: [], materials: [] };
  const original = structuredClone(stores.references.find(row => row.id === `service-project:${project.id}`).payload);
  const save = () => addStoredProjectWorkOrder(project.id, project.revision, manager, input);
  await assert.rejects(save(), /序列号/);
  input.item.values.serial = 'SN001'; input.item.materials = [];
  stores.configs[0].basicFields.businessObjects = { enabled: true, required: true };
  await assert.rejects(save(), /业务对象/);
  input.item.businessObjectIds = ['foreign'];
  stores.references[0].payload.businessObjects = [{ id: 'foreign', customerId: 'other', status: '启用', name: '其他客户资产' }];
  await assert.rejects(save(), /客户|业务对象/);
  stores.configs[0].basicFields.businessObjects = { enabled: false, required: false };
  stores.references[0].payload.services[0].allowedInitiatorSites = ['合作伙伴中心'];
  await assert.rejects(save(), /未开放/);
  assert.deepEqual(stores.references.find(row => row.id === `service-project:${project.id}`).payload, original);
});

test('系统管理员可启动并代替执行工程师提交复核，概览对内部角色开放', () => {
  const f = fixture();
  const project = startProjectWorkOrders(f.project, admin, users, f.config, f.dictionary);
  for (const role of ['SmartX 销售经理', 'SmartX 售前工程师', 'SmartX 硬件产品经理', 'SmartX 服务工程师']) {
    const actor = { id: 'internal-user', role, name: '内部用户' };
    const visible = { ...project, collaborators: { ...project.collaborators, internal: [{ id: actor.id }] } };
    assert.equal(canViewWorkOrderOverview(visible, actor), true);
    assert.equal(canChangeProjectWorkOrders(visible, actor), false);
  }
  for (const order of project.workOrders) order.status = '已完成';
  assert.equal(submitProjectReview(project, admin).status, '待复核');
  assert.throws(() => editServiceProject(project, { ...project, status: '待复核' }, admin, customers), /手动提交/);
  assert.throws(() => startProjectWorkOrders(f.project, admin, users.map(user => ({ ...user, status: '停用' })), f.config, f.dictionary), /启用/);
});


test('手动创建仅引用目录表单，不校验或保存申请材料，执行步骤材料保持原样', async t => {
  const { f, stores } = storesFixture();
  f.project.collaborators.internal.push({ ...manager, assignmentRoles: ['项目经理'] });
  const form = { ...defaultConfig(service), fields: ['serial'], fieldNames: { serial: '序列号' } };
  assert.ok(form.materials.length);
  const originalForm = structuredClone(form);
  stores.configs = [form];
  f.config.flows[0].steps[0].type = 'upload';
  f.config.flows[0].steps[0].files = [{ id: 'delivery', name: '结果证明', required: true, deliverToCustomer: true, minFiles: 1, formats: '.pdf', instructions: '' }];
  storage(t, stores);
  let project = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  const originalItems = structuredClone(project.items);
  const input = manualInput(); input.item.values = { serial: 'SN001' }; input.item.materials = [];
  project = await addStoredProjectWorkOrder(project.id, project.revision, manager, input);
  let created = project.workOrders.at(-1);
  assert.deepEqual(created.item.config.materials, []);
  assert.deepEqual(created.item.materials, []);
  assert.deepEqual(created.item.values, { serial: 'SN001' });
  assert.deepEqual(created.steps[0].definition.files, f.config.flows[0].steps[0].files);
  input.item.materials = manualInput().item.materials;
  input.item.materials[0].files[0].blob = new Blob([]);
  project = await addStoredProjectWorkOrder(project.id, project.revision, manager, input);
  created = stores.references.find(row => row.id === `service-project:${project.id}`).payload.workOrders.at(-1);
  assert.deepEqual(created.item.config.materials, []);
  assert.deepEqual(created.item.materials, []);
  assert.deepEqual(stores.configs[0], originalForm);
  assert.deepEqual(project.items, originalItems);
});


const basicInfoInput = p => ({ orderId: p.workOrders[0].id, expectedServiceDate: '2026-09-25', plannedCompletionDate: '2026-09-28', address: JSON.stringify({ kind: 'address', province: '北京市', city: '北京市', detail: '测试地址 1 号' }), description: '更新后的服务说明', contact: { id: engineer.id, group: 'internal' } });
test('基本信息允许待执行和进行中工单的四类授权身份编辑，已结束及未指派身份不可编辑', () => {
  let p = start(); p.workOrders[0].status = '进行中';
  p.workOrders[0].assignees = [{ ...engineer, group: 'internal' }, { ...partner, group: 'partner' }];
  for (const status of ['待执行', '进行中']) {
    p.workOrders[0].status = status;
    for (const actor of [manager, admin, engineer, partner]) {
      assert.equal(canEditWorkOrderBasicInfo(p, p.workOrders[0], actor), true);
      const saved = editWorkOrderBasicInfo(p, actor, basicInfoInput(p), managementDirectory());
      assert.equal(saved.workOrders[0].status, status);
      assert.equal(saved.workOrders[0].startedAt, p.workOrders[0].startedAt);
    }
  }
  for (const actor of [customer, { ...engineer, id: 'other-engineer' }, { ...engineer, role: 'SmartX 售前工程师' }])
    assert.throws(() => editWorkOrderBasicInfo(p, actor, basicInfoInput(p), managementDirectory()), /身份或工单状态/);
  for (const status of ['已完成', '已取消']) {
    const closed = structuredClone(p); closed.workOrders[0].status = status;
    assert.throws(() => editWorkOrderBasicInfo(closed, manager, basicInfoInput(closed), managementDirectory()), /身份或工单状态/);
  }
  for (const status of ['待启动', '待复核', '待确认', '已完成', '已取消'])
    assert.throws(() => editWorkOrderBasicInfo({ ...p, status }, admin, basicInfoInput(p), managementDirectory()), /身份或工单状态/);
});
test('基本信息只更新单张工单白名单字段，保留项目、服务项、流程和执行数据并校验日期及必填内容', () => {
  const p = startAssigned(); p.workOrders[0].status = '进行中';
  p.workOrders[0].item.config.fields.push('address');
  const before = structuredClone(p);
  const input = { ...basicInfoInput(p), status: '已完成', flowId: 'forged', serviceId: 'forged' };
  const saved = editWorkOrderBasicInfo(p, engineer, input, managementDirectory());
  const order = saved.workOrders[0];
  assert.deepEqual(p, before);
  assert.equal(order.expectedServiceDate, input.expectedServiceDate);
  assert.equal(order.item.values.address, input.address);
  assert.equal(order.item.description, input.description);
  assert.equal(order.contactName, engineer.name);
  assert.equal(order.status, '进行中');
  assert.equal(order.flowId, p.workOrders[0].flowId);
  assert.deepEqual(order.steps, p.workOrders[0].steps);
  assert.deepEqual(order.item.config, p.workOrders[0].item.config);
  assert.deepEqual(order.item.materials, p.workOrders[0].item.materials);
  assert.deepEqual(saved.items, p.items);
  assert.deepEqual(saved.workOrders[1], p.workOrders[1]);
  assert.equal(saved.expectedServiceDate, p.expectedServiceDate);
  assert.equal(saved.revision, p.revision + 1);
  assert.equal(saved.operations.activities.at(-1).title, '编辑工单基本信息');
  for (const patch of [{ plannedCompletionDate: '2026-09-24' }, { expectedServiceDate: '2026-02-30' }, { description: '' }, { address: '' }, { contact: { id: 'outsider', group: 'internal' } }])
    assert.throws(() => editWorkOrderBasicInfo(p, manager, { ...input, ...patch }, managementDirectory()));
});
test('基本信息事务保存持久化，拒绝过期版本和停用人员', async t => {
  const { f, stores } = storesFixture(); storage(t, stores);
  let p = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  p = await assignStoredEngineer(p);
  p = await saveStoredWorkStep(p.id, p.revision, engineer, act(p, 'save'));
  const input = basicInfoInput(p); const revision = p.revision;
  p = await saveStoredWorkOrderBasicInfo(p.id, p.revision, engineer, input);
  const saved = stores.references.find(row => row.id === `service-project:${p.id}`).payload;
  assert.equal(saved.workOrders[0].contactPhone, '');
  assert.deepEqual(saved.workOrders[0].contactRef, input.contact);
  assert.equal(saved.workOrders[0].item.description, input.description);
  await assert.rejects(saveStoredWorkOrderBasicInfo(p.id, revision, engineer, input), /已被其他页面/);
  stores.references.find(row => row.id === 'workspace').payload.users = users.map(user => ({ ...user, status: '停用' }));
  await assert.rejects(saveStoredWorkOrderBasicInfo(p.id, p.revision, engineer, input), /停用/);
  assert.deepEqual(stores.references.find(row => row.id === `service-project:${p.id}`).payload, saved);
});


test('现场联系人限项目协作人，姓名和电话取目录而非提交值，拒绝停用、移除和跨客户联系人', () => {
  const p = start(); p.workOrders[0].status = '进行中'; p.serviceProviderId = 'partner:p1';
  p.collaborators.customer = [{ id: 'c-contact', name: '客户联系人' }, { id: 'foreign', name: '其他客户联系人' }];
  const directory = { ...managementDirectory(), users: users.map(user => ({ ...user, phone: '010-12345678' })), contacts: [
    { id: 'c-contact', customerId: p.customerId, status: '启用', name: '客户联系人', phone: '13800000000' },
    { id: 'foreign', customerId: 'other', status: '启用', name: '其他客户', phone: '13900000000' },
  ] };
  assert.deepEqual(workOrderContactOptions(p, directory).map(person => person.group), ['customer', 'internal', 'partner']);
  const input = { ...basicInfoInput(p), contact: { id: 'c-contact', group: 'customer' }, contactName: '伪造', contactPhone: '伪造' };
  const saved = editWorkOrderBasicInfo(p, manager, input, directory);
  assert.equal(saved.workOrders[0].contactName, '客户联系人');
  assert.equal(saved.workOrders[0].contactPhone, '13800000000');
  for (const changed of [
    { ...directory, contacts: directory.contacts.map(person => ({ ...person, status: '停用' })) },
    { ...directory, contacts: directory.contacts.filter(person => person.id !== 'c-contact') },
  ]) assert.throws(() => editWorkOrderBasicInfo(p, manager, input, changed), /协作人/);
  assert.throws(() => editWorkOrderBasicInfo({ ...p, collaborators: { ...p.collaborators, customer: [] } }, manager, input, directory), /协作人/);
  assert.throws(() => editWorkOrderBasicInfo(p, manager, { ...input, contact: { id: 'foreign', group: 'customer' } }, directory), /协作人/);
  const cleared = editWorkOrderBasicInfo(saved, manager, { ...input, contact: null }, directory);
  assert.equal(cleared.workOrders[0].contactRef, undefined);
  assert.equal(cleared.workOrders[0].contactPhone, '');
});
test('实际执行时间首次有效执行时记录且不被再次保存改写，完成时间由系统记录', () => {
  let p = startAssigned(); const first = '2026-09-20T08:00:00Z', next = '2026-09-21T08:00:00Z', end = '2026-09-22T08:00:00Z';
  assert.equal(p.workOrders[0].startedAt, undefined);
  assert.throws(() => applyWorkStep(p, engineer, act(p, 'complete'), first));
  assert.equal(p.workOrders[0].startedAt, undefined);
  p = applyWorkStep(p, engineer, act(p, 'save'), first);
  assert.equal(p.workOrders[0].startedAt, first);
  p = applyWorkStep(p, engineer, act(p, 'complete', { ...emptyWorkStepData(), description: '完成' }), next);
  assert.equal(p.workOrders[0].startedAt, first);
  assert.equal(p.workOrders[0].completedAt, undefined);
  p = applyWorkStep(p, engineer, act(p, 'skip', emptyWorkStepData(), 1, { reason: '无需执行' }), end);
  assert.equal(p.workOrders[0].startedAt, first);
  assert.equal(p.workOrders[0].completedAt, end);
  let legacy = startAssigned(); legacy.workOrders[0].status = '进行中';
  legacy = applyWorkStep(legacy, engineer, act(legacy, 'save'), next);
  assert.equal(legacy.workOrders[0].startedAt, undefined);
});

// Work-order forms use their own schema snapshot, including types and layout.
import { workOrderField, workOrderFieldValue, workOrderVisibleFields } from './work-order-form.ts';
import { requestFormLayoutFields } from './request-form-layout.ts';
function dynamicOrderFixture() {
  const f = fixture();
  const item = f.project.items[0];
  item.config = { ...item.config,
    fields: ['edition', 'nodes', 'features', 'visitDate', 'address', 'notes'],
    fieldOrder: ['nodes', 'edition', 'features', 'address', 'visitDate', 'notes', 'method', 'description'],
    fieldWidths: { features: 'full', notes: 'full' }, fieldRowStarts: ['visitDate'],
    fieldNames: { edition: '授权版本', nodes: '节点数', features: '功能', visitDate: '预约日期', address: '地址', notes: '备注' },
    fieldOptions: { edition: ['企业版', '标准版'], features: ['备份', '监控'] },
    fieldRequired: { notes: false }, fieldRequiredWhen: { address: 'onsite' },
    basicFields: { description: { enabled: true, required: true }, businessObjects: { enabled: false, required: false } },
  };
  item.description = '服务说明';
  item.values = { edition: '企业版', nodes: '3', features: '["备份"]', visitDate: '2026-09-25', notes: '第一行\n第二行', address: '历史隐藏地址', obsolete: '旧数据' };
  f.dictionary.workOrderFields = [
    { id: 'features', name: '新名称不覆盖快照名称', type: 'multiple', options: [] },
    { id: 'visitDate', name: '日期', type: 'date', options: [] },
    { id: 'notes', name: '备注', type: 'textarea', options: [] },
  ];
  const p = startAssigned(f); p.workOrders[0].status = '进行中';
  return { p, f };
}
test('工单只读字段使用快照顺序、宽度、显隐和格式，目录后续修改不影响已生成工单', () => {
  const { p, f } = dynamicOrderFixture(); const item = p.workOrders[0].item;
  f.dictionary.workOrderFields[0].type = 'text'; f.project.items[0].config.fieldOptions.features.push('新选项');
  assert.deepEqual(workOrderVisibleFields(item), ['nodes', 'edition', 'features', 'visitDate', 'notes', 'method', 'description']);
  assert.equal(workOrderField(item, 'features', f.dictionary.workOrderFields).type, 'multiple');
  assert.equal(workOrderField(item, 'features').name, '功能');
  assert.deepEqual(workOrderField(item, 'features').options.map(x => x.value), ['备份', '监控']);
  assert.equal(workOrderFieldValue({ ...item, values: { ...item.values, features: '["备份","监控"]' } }, 'features'), '备份、监控');
  assert.equal(workOrderFieldValue(item, 'notes'), '第一行\n第二行');
  const layout = requestFormLayoutFields(item.config, workOrderVisibleFields(item));
  assert.equal(layout.find(field => field.id === 'features').gridColumn, '1 / -1');
  assert.equal(layout.find(field => field.id === 'visitDate').gridColumn, '1 / span 1');
});
test('动态字段保存校验快照类型、必填和选项，清除隐藏值且不更改流程和其他工单', () => {
  const { p } = dynamicOrderFixture(); const original = structuredClone(p);
  const { obsolete, ...values } = p.workOrders[0].item.values;
  const input = { ...basicInfoInput(p), values: { ...values, nodes: '5', features: '["备份","监控"]' } };
  const saved = editWorkOrderBasicInfo(p, manager, input, managementDirectory());
  assert.equal(saved.workOrders[0].item.values.nodes, '5');
  assert.equal(saved.workOrders[0].item.values.address, undefined);
  assert.equal(saved.workOrders[0].item.values.obsolete, obsolete);
  assert.deepEqual(saved.workOrders[0].steps, p.workOrders[0].steps);
  assert.deepEqual(saved.items, p.items); assert.deepEqual(saved.workOrders[1], p.workOrders[1]);
  assert.deepEqual(p, original);
  assert.match(saved.operations.activities.at(-1).description ?? saved.operations.activities.at(-1).content ?? JSON.stringify(saved.operations.activities.at(-1)), /节点数/);
  for (const patch of [{ nodes: '0' }, { nodes: '1.5' }, { features: '["非法选项"]' }, { features: '' }, { visitDate: '2026-02-30' }, { edition: '未知版本' }, { method: '现场' }])
    assert.throws(() => editWorkOrderBasicInfo(p, manager, { ...input, values: { ...input.values, ...patch } }, managementDirectory()));
});
test('条件字段随着动态值显隐；保存只校验可见字段；禁用说明不被提交覆盖', () => {
  const { p } = dynamicOrderFixture(); const item = p.workOrders[0].item;
  item.config.fieldRequiredWhen.notes = 'enterprise';
  item.config.basicFields.description.enabled = false;
  const { obsolete, ...values } = item.values;
  const saved = editWorkOrderBasicInfo(p, manager, { ...basicInfoInput(p), description: '', values: { ...values, edition: '标准版' } }, managementDirectory());
  assert.equal(saved.workOrders[0].item.values.notes, undefined);
  assert.equal(saved.workOrders[0].item.description, item.description);
  assert.ok(!workOrderVisibleFields(saved.workOrders[0].item).includes('description'));
});
test('动态字段事务保存使用工单类型快照，后台改型不影响保存且失败不写入', async t => {
  const { f, stores } = storesFixture();
  const item = f.project.items[0];
  item.config.fields = ['customCount']; item.config.fieldNames.customCount = '设备数量';
  item.values = { customCount: '2' }; item.description = '说明';
  stores.references.find(row => row.id === 'workspace').payload.requestFields = [{ id: 'customCount', name: '设备数量', type: 'integer', options: [] }];
  storage(t, stores);
  let p = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  p = await assignStoredEngineer(p);
  assert.equal(p.workOrders[0].item.config.fieldDefinitions.customCount.type, 'integer');
  p = await saveStoredWorkStep(p.id, p.revision, engineer, act(p, 'save'));
  stores.references.find(row => row.id === 'workspace').payload.requestFields[0].type = 'text';
  p = await saveStoredWorkOrderBasicInfo(p.id, p.revision, engineer, { ...basicInfoInput(p), values: { customCount: '4' } });
  const saved = structuredClone(stores.references.find(row => row.id === `service-project:${p.id}`).payload);
  assert.equal(saved.workOrders[0].item.values.customCount, '4');
  await assert.rejects(saveStoredWorkOrderBasicInfo(p.id, p.revision, engineer, { ...basicInfoInput(p), values: { customCount: '非数字' } }), /整数/);
  assert.deepEqual(stores.references.find(row => row.id === `service-project:${p.id}`).payload, saved);
});

test('修改服务方式使用工单选项快照，联动现场地址必填并记录变化，保留流程及执行记录', () => {
  const { p } = dynamicOrderFixture();
  const item = p.workOrders[0].item;
  item.methods = ['远程', '现场'];
  const original = structuredClone(p);
  const { obsolete, ...values } = item.values;
  const input = { ...basicInfoInput(p), method: '现场', values: { ...values, address: '' } };
  assert.deepEqual(workOrderField(item, 'method').options.map(option => option.value), ['远程', '现场']);
  assert.throws(() => editWorkOrderBasicInfo(p, manager, input, managementDirectory()), /地址/);
  input.values.address = input.address;
  const saved = editWorkOrderBasicInfo(p, manager, input, managementDirectory());
  assert.equal(saved.workOrders[0].item.method, '现场');
  assert.equal(saved.workOrders[0].item.values.address, input.address);
  assert.ok(workOrderVisibleFields(saved.workOrders[0].item).includes('address'));
  assert.deepEqual(saved.workOrders[0].steps, original.workOrders[0].steps);
  assert.equal(saved.workOrders[0].flowId, original.workOrders[0].flowId);
  assert.deepEqual(saved.items, original.items);
  assert.deepEqual(saved.workOrders[1], original.workOrders[1]);
  assert.match(JSON.stringify(saved.operations.activities.at(-1)), /服务方式：远程 → 现场/);
  const remote = editWorkOrderBasicInfo(saved, manager, { ...input, method: '远程' }, managementDirectory());
  assert.equal(remote.workOrders[0].item.values.address, undefined);
  assert.ok(!workOrderVisibleFields(remote.workOrders[0].item).includes('address'));
  for (const method of ['', '不存在的选项', 3]) assert.throws(() => editWorkOrderBasicInfo(p, manager, { ...input, method }, managementDirectory()), /服务方式/);
  assert.deepEqual(p, original);
});
test('服务方式多选按保存类型编辑，选项不依赖当前目录，包含现场时地址必填', () => {
  const { p } = dynamicOrderFixture(); withTestAssignees(p); const item = p.workOrders[0].item;
  item.methods = ['远程', '现场']; item.methodFieldType = 'multiple'; item.method = '["远程"]';
  const { obsolete, ...values } = item.values;
  assert.equal(workOrderField(item, 'method').type, 'multiple');
  const input = { ...basicInfoInput(p), method: '["远程","现场"]', values: { ...values, address: '' } };
  assert.throws(() => editWorkOrderBasicInfo(p, engineer, input, managementDirectory()), /地址/);
  input.values.address = input.address;
  const saved = editWorkOrderBasicInfo(p, engineer, input, managementDirectory());
  assert.equal(workOrderFieldValue(saved.workOrders[0].item, 'method'), '远程、现场');
  for (const method of ['[]', '["未知"]', '[1]']) assert.throws(() => editWorkOrderBasicInfo(p, engineer, { ...input, method }, managementDirectory()), /服务方式/);
});

test('待执行工单可直接保存基本信息，事务不自动启动工单或执行步骤', async t => {
  const { f, stores } = storesFixture(); storage(t, stores);
  let p = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  p = await assignStoredEngineer(p);
  const steps = structuredClone(p.workOrders[0].steps);
  p = await saveStoredWorkOrderBasicInfo(p.id, p.revision, engineer, basicInfoInput(p));
  const saved = stores.references.find(row => row.id === `service-project:${p.id}`).payload;
  assert.equal(saved.workOrders[0].status, '待执行');
  assert.equal(saved.workOrders[0].startedAt, undefined);
  assert.deepEqual(saved.workOrders[0].steps, steps);
  assert.equal(saved.workOrders[0].item.description, '更新后的服务说明');
});


test('派单同步两类协作人并去重，合并原身份，重复派单保持幂等', () => {
  const { project, directory, input } = assignmentFixture();
  project.collaborators = { internal: [{ id: engineer.id, name: engineer.name, details: '原信息', assignmentRoles: ['申请人'] }], customer: [{ id: 'customer', name: '客户', details: '' }] };
  const before = structuredClone(project);
  const saved = assignWorkOrders(project, manager, input, directory, assignmentNow);
  assert.equal(saved.collaborators.internal.length, 1);
  assert.deepEqual(saved.collaborators.internal[0].assignmentRoles, ['申请人', '服务工程师']);
  assert.deepEqual(saved.collaborators.partner.map(p => p.id), [partner.id]);
  assert.deepEqual(saved.collaborators.partner[0].assignmentRoles, ['服务工程师']);
  assert.deepEqual(saved.collaborators.customer, before.collaborators.customer);
  assert.deepEqual(project, before);
  assert.equal(assignWorkOrders(saved, manager, input, directory, assignmentNow), saved);
  assert.doesNotThrow(() => editProjectCollaborators(saved, 'partner', [partner.id], manager, directory));
  assert.throws(() => editProjectCollaborators(saved, 'partner', [partner.id, 'pu2'], manager, directory), /不可用/);
});

test('改派保留原协作人及其身份，同时添加新工程师，不改变其他工单', () => {
  const { project, directory, input } = assignmentFixture();
  directory.services.forEach(service => { service.certifications = []; });
  project.collaborators = {};
  const first = assignWorkOrders(project, manager, { ...input, assignees: [input.assignees[0]] }, directory, assignmentNow);
  const changed = assignWorkOrders(first, manager, { orderIds: [input.orderIds[0]], assignees: [input.assignees[1]] }, directory, assignmentNow);
  assert.deepEqual(changed.collaborators.internal, first.collaborators.internal);
  assert.deepEqual(changed.collaborators.partner.map(p => p.id), [partner.id]);
  assert.deepEqual(changed.workOrders[1], first.workOrders[1]);
  assert.equal(canExecuteSpecificWorkOrder(changed, changed.workOrders[0], engineer), false);
});

test('原已派单缺少协作人时再次确认派单会补齐，失败不写入协作人', () => {
  const { project, directory, input } = assignmentFixture();
  const saved = assignWorkOrders(project, manager, input, directory, assignmentNow);
  const legacy = { ...saved, collaborators: {} };
  const repaired = assignWorkOrders(legacy, manager, input, directory, assignmentNow);
  assert.equal(repaired.collaborators.internal.length, 1);
  assert.equal(repaired.collaborators.partner.length, 1);
  assert.deepEqual(repaired.workOrders, legacy.workOrders);
  const before = structuredClone(legacy);
  assert.throws(() => assignWorkOrders(legacy, manager, { ...input, assignees: [{ id: 'pu2', group: 'partner' }] }, directory, assignmentNow));
  assert.deepEqual(legacy, before);
});


test('派单自动加入的协作人不能执行其他未指派工单，伙伴不因此获得项目管理权限', () => {
  const { project, directory, input } = assignmentFixture();
  project.collaborators = {};
  const saved = assignWorkOrders(project, manager, { ...input, orderIds: [input.orderIds[0]] }, directory, assignmentNow);
  for (const actor of [engineer, partner]) {
    assert.equal(canViewServiceProject(actor, saved), true);
    assert.equal(canExecuteSpecificWorkOrder(saved, saved.workOrders[0], actor), true);
    assert.equal(canExecuteSpecificWorkOrder(saved, saved.workOrders[1], actor), false);
  }
  assert.equal(canManageServiceProjects(partner, saved), false);
  for (const [group, person] of [['internal', engineer], ['partner', partner]]) {
    const edited = editProjectCollaborators(saved, group, [person.id], manager, directory);
    assert.equal(edited.collaborators[group][0].workOrderAssignmentOnly, true);
    assert.equal(canExecuteSpecificWorkOrder(edited, edited.workOrders[1], person), false);
  }
});

test('工程师执行和编辑基本信息必须同时满足对应组协作人及工单指派', () => {
  for (const [actor, group, otherGroup] of [[engineer, 'internal', 'partner'], [partner, 'partner', 'internal']]) {
    const p = start();
    const order = p.workOrders[0];
    order.assignees = [{ id: actor.id, name: actor.name, group }];
    assert.equal(canExecuteSpecificWorkOrder(p, order, actor), true);
    assert.equal(canEditWorkOrderBasicInfo(p, order, actor), true);
    for (const collaborators of [{}, { [otherGroup]: [{ id: actor.id, name: actor.name }] }]) {
      const missing = { ...p, collaborators };
      assert.equal(canViewServiceProject(actor, missing), false);
      assert.equal(canExecuteSpecificWorkOrder(missing, order, actor), false);
      assert.equal(canEditWorkOrderBasicInfo(missing, order, actor), false);
      assert.throws(() => applyWorkStep(missing, actor, act(missing, 'save')));
    }
    for (const assignees of [undefined, [], [{ id: 'someone-else', name: '其他人', group }], [{ id: actor.id, name: actor.name, group: otherGroup }]]) {
      const unassigned = { ...order, assignees, assignee: undefined };
      const changed = { ...p, workOrders: [unassigned] };
      assert.equal(canViewServiceProject(actor, changed), true);
      assert.equal(canExecuteSpecificWorkOrder(changed, unassigned, actor), false);
      assert.equal(canEditWorkOrderBasicInfo(changed, unassigned, actor), false);
      assert.throws(() => applyWorkStep(changed, actor, act(changed, 'save')), /未被指派/);
    }
    const legacy = { ...order, assignees: undefined, assignee: order.assignees[0] };
    assert.equal(canExecuteSpecificWorkOrder({ ...p, workOrders: [legacy] }, legacy, actor), true);
    for (const privileged of [manager, admin]) {
      assert.equal(canExecuteSpecificWorkOrder({ ...p, collaborators: {} }, { ...order, assignees: [] }, privileged), true);
    }
  }
});

test('保存事务重读协作关系，指派仍存在但协作人被移除时拒绝执行和基本信息修改', async t => {
  const { project, input, stores } = assignmentStores(); storage(t, stores);
  const assigned = await saveStoredWorkOrderAssignment(project.id, project.revision, manager, input);
  const row = stores.references.find(row => row.id === `service-project:${assigned.id}`);
  row.payload.collaborators.internal = row.payload.collaborators.internal.filter(person => person.id !== engineer.id);
  const before = structuredClone(row.payload);
  await assert.rejects(saveStoredWorkStep(assigned.id, assigned.revision, engineer, act(assigned, 'save')));
  await assert.rejects(saveStoredWorkOrderBasicInfo(assigned.id, assigned.revision, engineer, basicInfoInput(assigned)));
  assert.deepEqual(row.payload, before);
});


test('伙伴创建项目仅可派本服务方人员，派单和改派均拒绝内部工程师', () => {
  const { project, directory, input } = assignmentFixture();
  Object.assign(project, { createdSite: '合作伙伴中心', createdById: partner.id, serviceProviderId: 'partner:p1', collaborators: { internal: [{ ...manager, assignmentRoles: ['项目经理'] }], partner: [{ id: partner.id, name: partner.name }] } });
  directory.services.forEach(service => { service.certifications = []; });
  const internal = { orderIds: [input.orderIds[0]], assignees: [input.assignees[0]] };
  const own = { ...internal, assignees: [input.assignees[1]] };
  assert.equal(canAssignWorkOrders(project, partner), true);
  for (const createdSite of ['合作伙伴中心', '企业工作台', '客户中心']) {
    assert.deepEqual(assignmentCandidates({ ...project, createdSite }, directory, '2026-09-17').map(engineerKey), ['partner:pu1']);
    for (const actor of [manager, admin]) assert.throws(() => assignWorkOrders({ ...project, createdSite }, actor, internal, directory, assignmentNow), /可派范围/);
  }
  assert.throws(() => assignWorkOrders(project, partner, internal, directory, assignmentNow), /可派范围/);
  const saved = assignWorkOrders(project, partner, own, directory, assignmentNow);
  assert.deepEqual(assignedEngineers(saved.workOrders[0]), [{ id: partner.id, name: partner.name, group: 'partner' }]);
  assert.equal(canExecuteSpecificWorkOrder(saved, saved.workOrders[0], partner), true);
  assert.throws(() => assignWorkOrders(saved, partner, internal, directory, assignmentNow), /可派范围/);
  // Existing internal assignments do not make an internal engineer eligible for reassignment.
  const legacy = structuredClone(project);
  legacy.workOrders[0].assignees = [{ id: engineer.id, name: engineer.name, group: 'internal' }];
  assert.throws(() => assignWorkOrders(legacy, partner, internal, directory, assignmentNow), /可派范围/);
  assert.doesNotThrow(() => assignWorkOrders(legacy, partner, own, directory, assignmentNow));
  assert.throws(() => assignWorkOrders(project, { ...partner, id: 'pu2' }, own, directory, assignmentNow), /身份/);
  for (const status of ['待启动', '待复核', '待确认', '已完成', '已取消']) assert.equal(canAssignWorkOrders({ ...project, status }, partner), false);
});

test('伙伴仅派本企业工程师，认证不足或混入内部及跨企业人员时整批失败', () => {
  const { project, directory, input } = assignmentFixture();
  Object.assign(project, { createdSite: '合作伙伴中心', createdById: partner.id, serviceProviderId: 'partner:p1' });
  const original = structuredClone(project);
  const own = { ...input, assignees: [input.assignees[1]] };
  assert.throws(() => assignWorkOrders(project, partner, own, directory, assignmentNow), /SMTX OS/);
  assert.deepEqual(project, original);
  Object.assign(directory.serviceCertifications[0], { userId: partner.id, holderType: 'partner' });
  assert.doesNotThrow(() => assignWorkOrders(project, partner, own, directory, assignmentNow));
  for (const assignees of [input.assignees, [...own.assignees, { id: 'pu2', group: 'partner' }]])
    assert.throws(() => assignWorkOrders(project, partner, { ...input, assignees }, directory, assignmentNow), /可派范围/);
  directory.serviceCertifications[0].expiresOn = '2026-09-16';
  assert.throws(() => assignWorkOrders(project, partner, own, directory, assignmentNow), /SMTX OS/);
  assert.deepEqual(project, original);
});

test('派单事务重读服务方、认证及身份，非原厂服务方拒绝内部人员且保留数据', async t => {
  const { project, directory, input, stores } = assignmentStores();
  Object.assign(project, { createdSite: '合作伙伴中心', createdById: partner.id, serviceProviderId: 'partner:p1', collaborators: { internal: [{ ...manager, assignmentRoles: ['项目经理'] }], partner: [{ id: partner.id, name: partner.name }] } });
  storage(t, stores);
  const before = structuredClone(project);
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, partner, input), /可派范围/);
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, manager, input), /可派范围/);
  assert.deepEqual(stores.references.at(-1).payload, before);
  const own = { ...input, assignees: [input.assignees[1]] };
  Object.assign(directory.serviceCertifications[0], { userId: partner.id, holderType: 'partner', status: '停用' });
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, partner, own), /SMTX OS/);
  directory.serviceCertifications[0].status = '启用';
  directory.partnerUsers[0].status = '停用';
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, partner, own), /停用/);
  directory.partnerUsers[0].status = '启用';
  const saved = await saveStoredWorkOrderAssignment(project.id, project.revision, partner, own);
  assert.ok(!saved.collaborators.internal?.some(person => person.id === engineer.id));
  assert.equal(saved.workOrders.every(order => assignedEngineers(order).every(person => person.group === 'partner')), true);
  await assert.rejects(saveStoredWorkOrderAssignment(project.id, project.revision, partner, own), /已被其他页面/);
  const executed = await saveStoredWorkStep(saved.id, saved.revision, partner, act(saved, 'save'));
  assert.ok(executed.revision > saved.revision);
});


function completedReviewFixture() {
  const f = managedProject();
  withTestAssignees(f.project);
  for (const order of f.project.workOrders) {
    order.status = '已完成'; order.completedAt = '2026-09-18T01:00:00Z';
    for (const step of order.steps) { step.status = '已完成'; step.data.description = '已提交的执行记录'; }
  }
  return { ...f, project: submitProjectReview(f.project, engineer) };
}

test('提交复核后所有工单入口锁定，负责经理整体退回项目后恢复所有有效工单且保留内容', () => {
  const { project, config, dictionary } = completedReviewFixture();
  const order = project.workOrders[0], original = structuredClone(project);
  for (const actor of [manager, admin, engineer, partner]) {
    assert.equal(canExecuteSpecificWorkOrder(project, order, actor), false);
    assert.equal(canEditWorkOrderBasicInfo(project, order, actor), false);
    assert.equal(canAssignWorkOrders(project, actor), false);
    assert.equal(canChangeProjectWorkOrders(project, actor), false);
    assert.throws(() => applyWorkStep(project, actor, act(project, 'save')), /状态/);
  }
  assert.throws(() => assignWorkOrders(project, manager, { orderIds: [order.id], assignees: [{ id: engineer.id, group: 'internal' }] }, assignmentFixture().directory), /状态/);
  assert.throws(() => addProjectWorkOrder(project, manager, manualInput(), config, dictionary), /进行中/);
  assert.throws(() => cancelProjectWorkOrder(project, manager, order.id, '修改'), /进行中/);
  const returned = returnProjectReview(project, manager, { reason: '请补充实施记录' });
  assert.equal(returned.status, '进行中');
  assert.equal(returned.workOrders[0].status, '进行中');
  assert.equal(returned.workOrders[0].completedAt, undefined);
  assert.deepEqual(returned.workOrders[0].steps.map(step => step.data), order.steps.map(step => step.data));
  assert.deepEqual(returned.workOrders[0].assignees, order.assignees);
  assert.equal(returned.workOrders[1].status, '进行中');
  assert.deepEqual(returned.workOrders[1].steps.map(step => step.data), project.workOrders[1].steps.map(step => step.data));
  assert.equal(canEditWorkOrderBasicInfo(returned, returned.workOrders[0], engineer), true);
  assert.equal(canEditWorkOrderBasicInfo(returned, returned.workOrders[1], engineer), true);
  assert.throws(() => submitProjectReview(returned, engineer), /所有未取消/);
  const reopened = returned.workOrders[0].steps.at(-1);
  let completed = applyWorkStep(returned, engineer, { orderId: order.id, stepId: reopened.definition.id, type: 'complete', data: reopened.data });
  assert.equal(completed.workOrders[0].status, '已完成');
  assert.throws(() => submitProjectReview(completed, engineer), /所有未取消/);
  const second = completed.workOrders[1], secondStep = second.steps.at(-1);
  completed = applyWorkStep(completed, engineer, { orderId: second.id, stepId: secondStep.definition.id, type: 'complete', data: secondStep.data });
  assert.equal(submitProjectReview(completed, engineer).status, '待复核');
  assert.match(returned.operations.activities.at(-1).detail, /请补充实施记录/);
  assert.deepEqual(project, original);
});

test('退回执行仅限待复核负责经理和管理员，校验原因且禁止确认阶段退回', () => {
  const { project } = completedReviewFixture();
  const input = { reason: '修正交付' };
  for (const actor of [engineer, partner, customer, { ...manager, id: 'other-manager' }])
    assert.throws(() => returnProjectReview(project, actor, input), /仅负责/);
  for (const status of ['待启动', '进行中', '待确认', '已完成', '已取消'])
    assert.throws(() => returnProjectReview({ ...project, status }, manager, input), /待复核/);
  for (const patch of [{ reason: '' }, { reason: ' ' }, { reason: '字'.repeat(2001) }])
    assert.throws(() => returnProjectReview(project, manager, { ...input, ...patch }));
  const cancelled = structuredClone(project); cancelled.workOrders[0].status = '已取消';
  const returned = returnProjectReview(cancelled, manager, input);
  assert.deepEqual(returned.workOrders[0], cancelled.workOrders[0]);
  assert.equal(returned.workOrders[1].status, '进行中');
  const oldClient = returnProjectReview(project, manager, { ...input, orderIds: [project.workOrders[0].id] });
  assert.ok(oldClient.workOrders.every(order => order.status === '进行中'));
  const invalid = structuredClone(project); invalid.workOrders[1].steps = [];
  assert.throws(() => returnProjectReview(invalid, manager, input), /步骤缺失/);
  assert.throws(() => returnProjectReview({ ...project, createdSite: '合作伙伴中心' }, manager, input), /仅负责/);
  assert.equal(returnProjectReview(project, admin, input).status, '进行中');
});

test('退回执行事务校验最新版本与有效身份，失败回滚，成功保存工单和活动', async t => {
  const { project } = completedReviewFixture();
  const { stores, directory } = assignmentStores();
  stores.references.at(-1).payload = project;
  stores.references.at(-1).id = `service-project:${project.id}`;
  let fail = false; storage(t, stores, () => fail);
  const input = { reason: '补充交付' };
  await assert.rejects(returnStoredProjectReview(project.id, project.revision - 1, manager, input), /更新/);
  directory.users.find(user => user.id === manager.id).status = '停用';
  await assert.rejects(returnStoredProjectReview(project.id, project.revision, manager, input), /停用/);
  directory.users.find(user => user.id === manager.id).status = '启用';
  const before = structuredClone(stores);
  fail = true;
  await assert.rejects(returnStoredProjectReview(project.id, project.revision, manager, input));
  assert.deepEqual(stores, before);
  fail = false;
  const saved = await returnStoredProjectReview(project.id, project.revision, manager, input);
  assert.equal(saved.status, '进行中');
  assert.ok(stores.references.at(-1).payload.workOrders.every(order => order.status === '进行中'));
  await assert.rejects(saveStoredWorkStep(project.id, project.revision, engineer, act(saved, 'save')), /更新/);
});


test('完成最后一张工单仅完成工单，任意已指派执行工程师手动提交后才进入复核', () => {
  let project = withTestAssignees(managedProject().project);
  project.workOrders[0].assignees = [{ id: partner.id, name: partner.name, group: 'partner' }];
  project.workOrders[1].assignees = [{ id: engineer.id, name: engineer.name, group: 'internal' }];
  for (const [index, order] of project.workOrders.entries()) {
    for (const step of order.steps) {
      project = applyWorkStep(project, index === 0 ? partner : engineer, { orderId: order.id, stepId: step.definition.id, type: 'complete', data: { ...emptyWorkStepData(), description: '完成服务并提交交付结果' } });
      assert.equal(project.status, '进行中');
    }
  }
  assert.ok(project.workOrders.every(order => order.status === '已完成'));
  assert.ok(!project.operations.activities.some(activity => activity.title === '提交复核'));
  for (const actor of [engineer, partner]) {
    assert.equal(canSubmitProjectReview(project, actor), true);
    const submitted = submitProjectReview(project, actor);
    assert.equal(submitted.status, '待复核');
    assert.equal(submitted.operations.activities.at(-1).actorId, actor.id);
    assert.deepEqual(submitted.workOrders, project.workOrders);
    assert.equal(canSubmitProjectReview(submitted, actor), false);
    assert.throws(() => submitProjectReview(submitted, actor), /执行工程师/);
  }
  for (const actor of [manager, customer, { ...engineer, id: 'unassigned' }]) assert.equal(canSubmitProjectReview(project, actor), false);
  const collaboratorOnly = structuredClone(project); collaboratorOnly.workOrders[1].assignees = [];
  assert.equal(canSubmitProjectReview(collaboratorOnly, engineer), false);
  const wrongGroup = structuredClone(project); wrongGroup.workOrders[1].assignees[0].group = 'partner';
  assert.equal(canSubmitProjectReview(wrongGroup, engineer), false);
  assert.equal(canSubmitProjectReview({ ...project, collaborators: {} }, engineer), false);
  const cancelled = structuredClone(project); cancelled.workOrders[1].status = '已取消';
  assert.equal(canSubmitProjectReview(cancelled, engineer), false);
  const legacy = structuredClone(project); legacy.workOrders[1].assignee = legacy.workOrders[1].assignees[0]; delete legacy.workOrders[1].assignees;
  assert.equal(canSubmitProjectReview(legacy, engineer), true);
  assert.equal(canSubmitProjectReview({ ...project, createdSite: '合作伙伴中心' }, partner), false);
});

test('工程师提交复核事务重读完成状态、身份与指派关系，保存后锁定且拒绝重复提交', async t => {
  const { project, directory, stores } = assignmentStores();
  withTestAssignees(project);
  for (const order of project.workOrders) order.status = '已完成';
  storage(t, stores);
  const original = structuredClone(project);
  project.workOrders[1].status = '进行中';
  await assert.rejects(submitStoredProjectReview(project.id, project.revision, partner), /所有未取消/);
  project.workOrders[1].status = '已完成';
  for (const order of project.workOrders) order.assignees = order.assignees.filter(person => person.group !== 'partner');
  await assert.rejects(submitStoredProjectReview(project.id, project.revision, partner), /执行工程师/);
  withTestAssignees(project);
  directory.partnerUsers[0].status = '停用';
  await assert.rejects(submitStoredProjectReview(project.id, project.revision, partner), /停用/);
  directory.partnerUsers[0].status = '启用';
  directory.users.find(user => user.id === engineer.id).status = '停用';
  await assert.rejects(submitStoredProjectReview(project.id, project.revision, engineer), /停用/);
  directory.users.find(user => user.id === engineer.id).status = '启用';
  assert.deepEqual(stores.references.at(-1).payload, original);
  const submitted = await submitStoredProjectReview(project.id, project.revision, partner);
  assert.equal(submitted.status, '待复核');
  assert.equal(stores.references.at(-1).payload.status, '待复核');
  assert.equal(canExecuteSpecificWorkOrder(submitted, submitted.workOrders[0], engineer), false);
  await assert.rejects(submitStoredProjectReview(project.id, project.revision, engineer), /更新/);
  await assert.rejects(submitStoredProjectReview(project.id, submitted.revision, engineer), /执行工程师/);
});

test('暂停阻止工单执行，恢复后按原步骤继续完成工单', async () => {
  const { changeServiceProjectSuspension } = await import('./service-project-suspension.ts');
  const project = startAssigned();
  const data = { ...emptyWorkStepData(), description: '已完成工作' };
  const ongoing = applyWorkStep(project, engineer, act(project, 'complete', data));
  const paused = changeServiceProjectSuspension(ongoing, manager, users, 'pause', undefined, '等待客户窗口');
  assert.throws(() => applyWorkStep(paused, engineer, act(paused, 'complete', data, 1)), /项目状态不允许/);
  const resumed = changeServiceProjectSuspension(paused, manager, users, 'resume');
  assert.deepEqual(resumed.workOrders, ongoing.workOrders);
  const completed = applyWorkStep(resumed, engineer, act(resumed, 'complete', data, 1));
  assert.equal(completed.workOrders[0].status, '已完成');
  assert.equal(completed.status, '进行中');
});

import { changeProjectWorkOrderSuspension, canPauseProjectWorkOrder, canResumeProjectWorkOrder } from './service-work-orders.ts';
import { saveStoredWorkOrderSuspension } from './service-work-order-store.ts';

test('单独暂停工单保留进度且不影响其他工单，恢复后继续执行', () => {
  let project = withTestAssignees(managedProject().project);
  const data = { ...emptyWorkStepData(), description: '执行记录', attachments: [{ id: 'pause-file', name: '记录.txt', size: 3, blob: new Blob(['abc']) }] };
  project = applyWorkStep(project, engineer, act(project, 'complete', data));
  const original = structuredClone(project), order = project.workOrders[0];
  const paused = changeProjectWorkOrderSuspension(project, manager, order.id, 'pause');
  assert.equal(paused.status, '进行中');
  assert.equal(paused.workOrders[0].status, '已暂停');
  assert.equal(paused.workOrders[0].suspension.fromStatus, '进行中');
  assert.deepEqual(paused.workOrders[0].steps, order.steps);
  assert.deepEqual(paused.workOrders[1], project.workOrders[1]);
  assert.equal(canExecuteSpecificWorkOrder(paused, paused.workOrders[0], engineer), false);
  assert.equal(canExecuteSpecificWorkOrder(paused, paused.workOrders[0], manager), false);
  assert.throws(() => applyWorkStep(paused, engineer, act(paused, 'complete', data, 1)), /已暂停/);
  assert.throws(() => submitProjectReview(paused, engineer), /所有未取消工单完成/);
  assert.doesNotThrow(() => applyWorkStep(paused, engineer, { ...act(paused, 'complete', data), orderId: paused.workOrders[1].id }));
  const resumed = changeProjectWorkOrderSuspension(paused, manager, order.id, 'resume');
  assert.equal(resumed.workOrders[0].status, '进行中');
  assert.equal(resumed.workOrders[0].suspension, undefined);
  assert.deepEqual(resumed.workOrders[0].steps, order.steps);
  assert.equal(applyWorkStep(resumed, engineer, act(resumed, 'complete', data, 1)).workOrders[0].status, '已完成');
  assert.deepEqual(project, original);
  const unstarted = changeProjectWorkOrderSuspension(project, manager, project.workOrders[1].id, 'pause');
  assert.equal(changeProjectWorkOrderSuspension(unstarted, manager, project.workOrders[1].id, 'resume').workOrders[1].status, '待执行');
});

test('工单暂停权限与阶段校验，取消暂停工单后不可恢复', () => {
  const project = managedProject().project, order = project.workOrders[0];
  const paused = changeProjectWorkOrderSuspension(project, manager, order.id, 'pause');
  for (const actor of [engineer, partner, customer, { ...manager, id: 'other' }]) {
    assert.equal(canPauseProjectWorkOrder(project, actor, order), false);
    assert.equal(canResumeProjectWorkOrder(paused, actor, paused.workOrders[0]), false);
    assert.throws(() => changeProjectWorkOrderSuspension(project, actor, order.id, 'pause'), /仅项目经理/);
  }
  for (const status of ['待启动', '待复核', '待确认', '已完成', '已取消', '已暂停']) {
    assert.throws(() => changeProjectWorkOrderSuspension({ ...project, status }, manager, order.id, 'pause'), /仅项目经理/);
    assert.throws(() => changeProjectWorkOrderSuspension({ ...paused, status }, manager, order.id, 'resume'), /仅项目经理/);
  }
  for (const status of ['已完成', '已取消', '已暂停']) assert.equal(canPauseProjectWorkOrder(project, manager, { ...order, status }), false);
  assert.equal(canResumeProjectWorkOrder(paused, manager, { ...paused.workOrders[0], suspension: undefined }), false);
  assert.throws(() => changeProjectWorkOrderSuspension(project, manager, 'missing', 'pause'), /不存在/);
  const cancelled = cancelProjectWorkOrder(paused, manager, order.id, '不再交付');
  assert.equal(cancelled.workOrders[0].status, '已取消');
  assert.equal(cancelled.workOrders[0].suspension, undefined);
  assert.deepEqual(cancelled.workOrders[0].steps, order.steps);
  assert.throws(() => changeProjectWorkOrderSuspension(cancelled, manager, order.id, 'resume'), /仅项目经理/);
});

test('项目暂停恢复不自动恢复单独暂停的工单，项目取消会取消暂停工单', async () => {
  const { changeServiceProjectSuspension } = await import('./service-project-suspension.ts');
  const { cancelServiceProject } = await import('./service-project-cancellation.ts');
  const project = managedProject().project, id = project.workOrders[0].id;
  const pausedOrder = changeProjectWorkOrderSuspension(project, manager, id, 'pause');
  const pausedProject = changeServiceProjectSuspension(pausedOrder, manager, users, 'pause', undefined, '等待客户窗口');
  const restored = changeServiceProjectSuspension(pausedProject, manager, users, 'resume');
  assert.equal(restored.workOrders[0].status, '已暂停');
  assert.equal(restored.workOrders[1].status, '待执行');
  const cancelled = cancelServiceProject(pausedProject, manager, users, '终止项目').project;
  assert.ok(cancelled.workOrders.every(order => order.status === '已取消' && !order.suspension));
});

test('工单暂停事务校验最新权限和版本，失败回滚，重读可恢复', async t => {
  const { f, stores } = storesFixture();
  f.project.collaborators.internal.push({ ...manager, assignmentRoles: ['项目经理'] });
  let fail = false;
  storage(t, stores, () => fail);
  const project = await startStoredServiceProject(f.project.id, f.project.revision, manager);
  const id = project.workOrders[0].id;
  const before = structuredClone(stores);
  fail = true;
  await assert.rejects(saveStoredWorkOrderSuspension(project.id, project.revision, manager, id, 'pause'), /模拟存储失败/);
  assert.deepEqual(stores, before); fail = false;
  const paused = await saveStoredWorkOrderSuspension(project.id, project.revision, manager, id, 'pause');
  assert.equal(stores.references.find(row => row.id === `service-project:${project.id}`).payload.workOrders[0].status, '已暂停');
  await assert.rejects(saveStoredWorkOrderSuspension(project.id, project.revision, manager, id, 'resume'), /已被其他页面/);
  const workspace = () => stores.references.find(row => row.id === 'workspace').payload;
  workspace().users.find(user => user.id === manager.id).status = '停用';
  await assert.rejects(saveStoredWorkOrderSuspension(project.id, paused.revision, manager, id, 'resume'), /停用/);
  workspace().users.find(user => user.id === manager.id).status = '启用';
  const restored = await saveStoredWorkOrderSuspension(project.id, paused.revision, manager, id, 'resume');
  assert.equal(restored.workOrders[0].status, '待执行');
  assert.equal(restored.revision, project.revision + 2);
});
