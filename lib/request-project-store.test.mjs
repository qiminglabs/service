import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestSamples } from './demo-service-requests.ts';
import { localInternalUsers } from './internal-users.ts';
import { importedServiceCatalogSeeds } from '../app/service-catalog-import.ts';
import { readLocal, saveLocal, withRequestContact, requestCollaborationSaveIssue } from './service-requests.ts';
import { createServiceProjects } from './request-projects.ts';
import { defaultProjectMapping, requestProjectMappingId } from './request-project-mapping.ts';
import { saveProjectMapping, readProjectMapping } from './request-project-mapping-store.ts';
import { readServiceProjects } from './service-project-store.ts';

const actor = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
const sources = {
  services: importedServiceCatalogSeeds.map((s, i) => ({ id: `svc-${i}`, name: s.serviceName, category: s.serviceCategory, status: '已启用', deliveryMethods: ['远程', '现场'], priceUnit: s.pricingUnit ?? '服务人天', priceCoefficient: 1, defaultQuantity: 1 })),
  users: localInternalUsers, customers: [{ id: 'c1', name: '测试客户', status: '启用' }],
  contacts: [{ id: 'contact1', customerId: 'c1', name: '测试联系人', status: '启用', email: 'test@example.com' }],
  businessObjects: [{ id: 'obj1', customerId: 'c1', name: '生产集群', status: '启用', product: 'SMTX OS 系统', nodeCount: 4, upgradeEntitlement: 4, inspectionEntitlement: 4 }],
  assets: [], partners: [], partnerUsers: [],
};
// The same staged transaction harness used by demo initialization tests, with
// injected write failure to check rollback across both stores.
function setup(t) {
  const previous = globalThis.indexedDB;
  t.after(() => { if (previous) globalThis.indexedDB = previous; else delete globalThis.indexedDB; });
  const request = withRequestContact(buildRequestSamples(sources, [], [], [], new Date('2026-09-16T08:00:00Z'))[3], sources.contacts, sources.customers, sources.users);
  const state = { stores: { requests: [request], configs: [], references: [{ id: 'workspace', payload: structuredClone(sources) }] }, failProjectWrite: 0 };
  globalThis.indexedDB = { open() {
    const open = { result: { close() {}, transaction() {
      const staged = structuredClone(state.stores);
      let pending = 0, aborted = false, writes = 0;
      const tx = {
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore(name) {
          const read = value => {
            pending++;
            const req = { result: structuredClone(value) };
            queueMicrotask(() => {
              req.onsuccess?.();
              if (--pending === 0 && !aborted) { Object.assign(state.stores, staged); tx.oncomplete?.(); }
            });
            return req;
          };
          return { get: id => read(staged[name].find(row => row.id === id)), getAll: () => read(staged[name]),
            put(record) { if (state.failProjectPut && name === 'references' && record.id.startsWith('service-project:')) throw new Error('模拟取消写入失败'); staged[name] = [...staged[name].filter(row => row.id !== record.id), structuredClone(record)]; },
            add(record) {
              if (record.id.startsWith('service-project:') && ++writes === state.failProjectWrite) throw new Error('模拟磁盘写入失败');
              if (staged[name].some(row => row.id === record.id)) throw new Error('重复编号');
              staged[name].push(structuredClone(record));
            },
          };
        },
      };
      return tx;
    } } };
    queueMicrotask(() => open.onsuccess()); return open;
  } };
  return state;
}
function split(request) { return request.items.map((item, i) => ({ id: `integration-${i}`, name: `测试项目 ${i + 1}`, note: '', itemIds: [item.id] })); }
function access() { return { actor, customers: sources.customers, contacts: sources.contacts, users: sources.users }; }

test('请求保存事务将多个项目写入项目工作台，刷新读取包含附件，转换后拒绝再次保存或重复创建', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  const next = createServiceProjects(request, actor, split(request));
  await saveLocal('requests', next, access());
  const savedRequests = await readLocal('requests');
  const projects = await readServiceProjects(actor);
  assert.equal(savedRequests[0].status, '已转服务项目');
  assert.equal(projects.length, request.items.length);
  assert.equal(projects[0].sourceServiceRequestId, request.id);
  assert.ok(projects.every(project => project.items.length === 1));
  for (const project of projects) for (const material of project.items[0].materials) for (const file of material.files) assert.equal(file.blob.size, file.size);
  await assert.rejects(saveLocal('requests', next, access()), /全部信息只读/);
  assert.equal((await readServiceProjects(actor)).length, projects.length);
  await assert.rejects(saveLocal('requests', createServiceProjects(request, actor, split(request)), access()), /全部信息只读/);
});
test('第二个项目写入失败时，请求状态和第一个项目均回滚', async t => {
  const state = setup(t); state.failProjectWrite = 2;
  const before = structuredClone(state.stores);
  const request = state.stores.requests[0];
  await assert.rejects(saveLocal('requests', createServiceProjects(request, actor, split(request)), access()), /模拟磁盘写入失败/);
  assert.deepEqual(state.stores, before);
});
test('核定和服务依据副本随转换持久化，来源及项目后续编辑不重算副本', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  const next = createServiceProjects(request, actor, split(request));
  await saveLocal('requests', next, access());
  const projects = await readServiceProjects(actor);
  for (const project of projects) {
    const snapshot = project.requestConversion.assessmentSnapshot;
    assert.equal(snapshot.capturedAt, next.operations.projectCreation.at);
    assert.equal(snapshot.requestId, request.id);
    assert.deepEqual(snapshot.items.map(item => item.id), project.items.map(item => item.id));
    assert.ok(snapshot.effort.lines.every(line => project.items.some(item => item.id === line.itemId)));
  }
  const project = projects[0];
  const before = structuredClone(project.requestConversion.assessmentSnapshot);
  state.stores.requests[0].operations.assessment.effort.note = '模拟来源后续数据变化';
  const { updateStoredServiceProject } = await import('./service-project-store.ts');
  const updated = await updateStoredServiceProject(project.id, project.revision, { ...project, name: '调整项目名称', requestConversion: { assessmentSnapshot: { capturedAt: '伪造' } } }, actor);
  assert.deepEqual(updated.requestConversion.assessmentSnapshot, before);
  assert.deepEqual((await readServiceProjects(actor)).find(entry => entry.id === project.id).requestConversion.assessmentSnapshot, before);
});
test('拆分缺少核定明细时整个转换事务回滚', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  delete request.operations.assessment.effort.lines;
  const before = structuredClone(state.stores);
  await assert.rejects(saveLocal('requests', createServiceProjects(request, actor, split(request)), access()), /核定明细/);
  assert.deepEqual(state.stores, before);
});
test('映射保存核验管理员、停用状态及版本；旧创建方案不能按新配置执行', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  const next = createServiceProjects(request, actor, split(request));
  await assert.rejects(saveProjectMapping(defaultProjectMapping(), actor), /管理员/);
  const mapping = defaultProjectMapping(); mapping.fields.note = 'title';
  const saved = await saveProjectMapping(mapping, admin);
  assert.equal(saved.revision, 1);
  assert.equal((await readProjectMapping()).fields.note, 'title');
  await assert.rejects(saveProjectMapping(mapping, admin), /配置已更新/);
  await assert.rejects(saveLocal('requests', next, access()), /刷新后重新创建/);
  assert.equal(state.stores.requests[0].status, '待受理');
  await saveLocal('requests', createServiceProjects(request, actor, split(request), undefined, undefined, saved), access());
  assert.ok((await readServiceProjects(actor)).every(project => project.note === request.title));
  state.stores.references.find(row => row.id === 'workspace').payload.users.find(user => user.id === admin.id).status = '停用';
  await assert.rejects(saveProjectMapping(saved, admin), /已启用/);
  assert.ok(state.stores.references.some(row => row.id === requestProjectMappingId));
});
test('负责项目经理停用后，旧页面不能再创建项目', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  const next = createServiceProjects(request, actor, split(request));
  state.stores.references.find(row => row.id === 'workspace').payload.users.find(user => user.id === actor.id).status = '停用';
  const before = structuredClone(state.stores);
  await assert.rejects(saveLocal('requests', next, access()));
  assert.deepEqual(state.stores, before);
});

test('转项目后所有角色的协作人、内容、材料、工作记录及状态修改均被原子拦截', async t => {
  const state = setup(t);
  const initial = state.stores.requests[0];
  await saveLocal('requests', createServiceProjects(initial, actor, split(initial)), access());
  const converted = (await readLocal('requests'))[0];
  const before = structuredClone(state.stores);
  const edits = [
    request => { request.internalParticipants.push({ userId: 'USR-004', name: '新增内部协作人' }); },
    request => { request.internalParticipants = []; },
    request => { request.internalParticipants[0].name = '修改内部协作人'; },
    request => { request.externalCollaborators.push({ contactId: 'new', name: '新增客户协作人' }); },
    request => { request.externalCollaborators = []; },
    request => { request.externalCollaborators[0].name = '修改客户协作人'; },
    request => { request.title = '修改基本信息'; },
    request => { request.items[0].description = '修改服务项'; },
    request => { request.items[0].materials = []; },
    request => { request.items[0].materials[0].files[0].blob = new Blob(['替换文件']); },
    request => { request.operations.meetings = []; request.operations.worklogs = []; },
    request => { request.operations.activities.push({ id: 'new-activity' }); },
    request => { request.operations.supplements = []; },
    request => { request.status = '草稿'; delete request.operations.projectCreation; },
    request => { request.status = '已取消'; },
    request => { request.updatedAt = '2099-01-01T00:00:00Z'; },
  ];
  const people = [actor, admin, { id: 'USR-001', name: '销售', role: 'SmartX 销售经理' }, { id: 'contact1', name: '客户', role: '客户' }];
  for (const person of people) for (const edit of edits) {
    const next = structuredClone(converted); edit(next);
    await assert.rejects(saveLocal('requests', next, { ...access(), actor: person }), /全部信息只读/);
    assert.deepEqual(state.stores, before);
  }
  const stale = { ...initial, internalParticipants: [...initial.internalParticipants, { userId: 'USR-004', name: '过期页面新增' }] };
  await assert.rejects(saveLocal('requests', stale, access()), /全部信息只读/);
  assert.deepEqual(state.stores, before);
  assert.ok((await readServiceProjects(actor)).length > 0);
});

test('已转项目请求读取时不再自动追加客户所有人、申请人或评估协作人', async t => {
  const { withRequestCollaborators, withAssessmentCollaborators, withHardwareCollaborators } = await import('./request-collaboration.ts');
  const state = setup(t);
  const initial = state.stores.requests[0];
  await saveLocal('requests', createServiceProjects(initial, actor, split(initial)), access());
  const converted = (await readLocal('requests'))[0];
  const saved = { ...converted, internalParticipants: [], externalCollaborators: [] };
  const customers = [{ ...sources.customers[0], ownerUserId: 'USR-004' }];
  assert.equal(withRequestCollaborators(saved, sources.contacts, customers, sources.users), saved);
  assert.equal(withAssessmentCollaborators(saved, sources.users), saved);
  assert.equal(withHardwareCollaborators(saved, sources.users), saved);
  const changed = { ...converted, internalParticipants: [] };
  assert.match(requestCollaborationSaveIssue(changed, converted, sources, access()), /全部信息只读/);
  const old = { ...saved, status: '待评估' };
  assert.ok(withRequestCollaborators(old, sources.contacts, customers, sources.users).internalParticipants.some(person => person.userId === 'USR-004'));
});

test('分组保存只提交本容器的字段和只读设置，其余草稿不会写入，顺序保存保留已保存配置', async t => {
  setup(t);
  const draft = defaultProjectMapping();
  draft.fields.note = 'title';
  draft.fields.description = 'serviceName';
  draft.readonly = { note: true, description: true, materials: true };
  let saved = await saveProjectMapping(draft, admin, '请求字段');
  assert.equal(saved.fields.note, 'title');
  assert.equal(saved.readonly.note, true);
  assert.equal(saved.fields.description, 'description');
  assert.equal(saved.readonly.description, undefined);
  assert.equal(saved.readonly.materials, undefined);
  await assert.rejects(saveProjectMapping(draft, admin, '材料'), /配置已更新/);
  saved = await saveProjectMapping({ ...draft, revision: saved.revision }, admin, '服务项');
  assert.equal(saved.fields.note, 'title');
  assert.equal(saved.readonly.note, true);
  assert.equal(saved.fields.description, 'serviceName');
  assert.equal(saved.readonly.description, true);
  assert.equal(saved.readonly.materials, undefined);
  saved = await saveProjectMapping({ ...draft, revision: saved.revision }, admin, '材料');
  assert.equal(saved.readonly.materials, true);
  assert.deepEqual(await readProjectMapping(), saved);
  const cleared = await saveProjectMapping({ ...defaultProjectMapping(), revision: saved.revision }, admin, '请求字段');
  assert.equal(cleared.fields.note, 'description');
  assert.equal(cleared.readonly.note, undefined);
  assert.equal(cleared.readonly.description, true);
  assert.equal(cleared.readonly.materials, true);
});

test('新增请求和项目字段映射保存、转换和重新读取，独立副本执行只读快照；字段变更时事务回滚', async t => {
  const state = setup(t);
  const workspace = state.stores.references.find(row => row.id === 'workspace').payload;
  const source = { id: 'request-custom', name: '合同编号', type: 'text', options: [] };
  const target = { id: 'project-custom', name: '项目合同', type: 'text', options: [] };
  workspace.applicationFields = [source]; workspace.projectFields = [target];
  state.stores.requests[0].customValues = { [source.id]: 'HT-001' };
  const config = { ...defaultProjectMapping(), customFields: [{ source, target, readonly: true }] };
  const saved = await saveProjectMapping(config, admin, '请求字段');
  const request = state.stores.requests[0];
  const next = createServiceProjects(request, actor, split(request), undefined, undefined, saved);
  state.stores.references.find(row => row.id === 'workspace').payload.projectFields[0].type = 'date';
  await assert.rejects(saveLocal('requests', next, access()), /定义已变化/);
  assert.equal((await readServiceProjects(actor)).length, 0);
  assert.equal(state.stores.requests[0].status, '待受理');
  state.stores.references.find(row => row.id === 'workspace').payload.projectFields[0].type = 'text';
  await saveLocal('requests', next, access());
  const projects = await readServiceProjects(actor);
  assert.ok(projects.every(project => project.customValues[target.id] === 'HT-001'));
  const { updateStoredServiceProject } = await import('./service-project-store.ts');
  const project = projects[0];
  await assert.rejects(updateStoredServiceProject(project.id, project.revision, { ...project, customValues: {} }, actor), /只读/);
  const updated = await updateStoredServiceProject(project.id, project.revision, { ...project, note: '正常编辑说明' }, actor);
  assert.equal(updated.customValues[target.id], 'HT-001');
  assert.equal((await readLocal('requests'))[0].customValues[source.id], 'HT-001');
});

test('请求自定义字段可填写保存并重新读取，拒绝错误类型和未知字段', async t => {
  const state = setup(t);
  state.stores.references.find(row => row.id === 'workspace').payload.applicationFields = [{ id: 'request-quantity', name: '数量', type: 'integer', options: [] }];
  const request = structuredClone(state.stores.requests[0]);
  request.customValues = { 'request-quantity': '12' };
  await saveLocal('requests', request, access());
  assert.equal((await readLocal('requests'))[0].customValues['request-quantity'], '12');
  await assert.rejects(saveLocal('requests', { ...request, customValues: { 'request-quantity': '12.5' } }, access()), /类型/);
  await assert.rejects(saveLocal('requests', { ...request, customValues: { missing: '12' } }, access()), /不存在/);
  assert.equal((await readLocal('requests'))[0].customValues['request-quantity'], '12');
});

test('项目创建事务持久化自动协作人，转换分组均带入且读取不重复添加', async t => {
  const state = setup(t);
  const workspace = state.stores.references.find(row => row.id === 'workspace').payload;
  const request = state.stores.requests[0];
  workspace.customers[0].ownerUserId = 'USR-006';
  request.createdById = 'USR-004'; request.createdByAudience = 'internal';
  request.internalParticipants = [...(request.internalParticipants ?? []), { userId: 'USR-004', name: '申请人' }];
  const canonical = withRequestContact(request, workspace.contacts, workspace.customers, workspace.users);
  const next = createServiceProjects(canonical, actor, split(canonical));
  await saveLocal('requests', next, access());
  const projects = await readServiceProjects(actor);
  for (const project of projects) {
    for (const id of ['USR-006', actor.id, 'USR-004']) assert.ok(project.collaborators.internal.some(person => person.id === id));
    assert.ok(project.collaborators.customer.some(person => person.id === 'contact1'));
    assert.equal(new Set(project.collaborators.internal.map(person => person.id)).size, project.collaborators.internal.length);
  }
  const { saveProjectCollaborators, createStoredServiceProject } = await import('./service-project-store.ts');
  const project = projects[0];
  const fixedIds = project.collaborators.internal.map(person => person.id);
  await assert.rejects(saveProjectCollaborators(project.id, project.revision, 'internal', [actor.id], actor), /默认分配协作人/);
  await assert.rejects(saveProjectCollaborators(project.id, project.revision, 'customer', [], actor), /默认分配协作人/);
  const added = await saveProjectCollaborators(project.id, project.revision, 'internal', [...fixedIds, 'USR-002'], actor);
  const retained = await saveProjectCollaborators(project.id, added.revision, 'internal', fixedIds, actor);
  assert.ok(retained.collaborators.internal.every(person => person.assignmentRoles.length));
  const stored = state.stores.references.find(row => row.id === `service-project:${project.id}`).payload;
  delete stored.collaboratorAssignmentsVersion;
  for (const people of Object.values(stored.collaborators)) for (const person of people) delete person.assignmentRoles;
  const legacy = (await readServiceProjects(actor)).find(entry => entry.id === project.id);
  assert.ok(legacy.collaborators.internal.every(person => person.assignmentRoles.length));
  await assert.rejects(saveProjectCollaborators(project.id, stored.revision, 'internal', [], actor), /默认分配协作人/);
  const direct = await createStoredServiceProject({ name: '直接创建', customerId: 'c1', expectedServiceDate: '2026-09-20', note: '' }, actor);
  assert.deepEqual(direct.collaborators.internal.map(person => person.id), ['USR-006', actor.id]);
  assert.deepEqual(direct.collaborators.internal.find(person => person.id === actor.id).assignmentRoles, ['项目经理', '申请人']);
  await assert.rejects(saveProjectCollaborators(direct.id, direct.revision, 'internal', ['USR-006'], actor), /默认分配协作人/);
});

test('内部非项目经理直接创建时持久化申请人身份且禁止移除', async t => {
  setup(t);
  const { createStoredServiceProject, saveProjectCollaborators } = await import('./service-project-store.ts');
  const project = await createStoredServiceProject({ name: '管理员申请的项目', customerId: 'c1', expectedServiceDate: '2026-09-20', note: '' }, admin);
  const saved = (await readServiceProjects(admin)).find(entry => entry.id === project.id);
  assert.deepEqual(saved.collaborators.internal.map(person => ({ id: person.id, roles: person.assignmentRoles })), [{ id: admin.id, roles: ['申请人'] }]);
  await assert.rejects(saveProjectCollaborators(saved.id, saved.revision, 'internal', [], admin), /默认分配协作人/);
});


test('待启动项目取消原子保存解冻记录，重复或过期取消不重复释放，写入失败全部回滚', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  await saveLocal('requests', createServiceProjects(request, actor, split(request)), access());
  const { cancelStoredServiceProject } = await import('./service-project-store.ts');
  const project = (await readServiceProjects(actor))[0];
  assert.equal(project.status, '待启动');
  await assert.rejects(cancelStoredServiceProject(project.id, project.revision, '管理员取消', admin), /仅启用/);
  state.failProjectPut = true;
  const before = structuredClone(state.stores);
  await assert.rejects(cancelStoredServiceProject(project.id, project.revision, '需求取消', actor), /模拟取消写入失败/);
  assert.deepEqual(state.stores, before);
  state.failProjectPut = false;
  const cancelled = await cancelStoredServiceProject(project.id, project.revision, '需求取消', actor);
  assert.equal(cancelled.status, '已取消');
  assert.equal(cancelled.cancellation.reason, '需求取消');
  assert.equal(cancelled.cancellation.fromStatus, '待启动');
  const source = (await readLocal('requests'))[0];
  assert.equal(source.projectReservationReleases.length, 1);
  assert.equal(source.projectReservationReleases[0].projectId, project.id);
  assert.deepEqual(source.projectReservationReleases[0].assetAllocations, project.requestConversion.assessmentSnapshot.basis.allocations);
  assert.deepEqual(source.operations.assessment, before.requests[0].operations.assessment);
  const siblings = (await readServiceProjects(actor)).filter(entry => entry.id !== project.id);
  assert.ok(siblings.every(entry => entry.status === '待启动'));
  await assert.rejects(cancelStoredServiceProject(project.id, project.revision, '过期重试', actor), /已被更新/);
  await assert.rejects(cancelStoredServiceProject(project.id, cancelled.revision, '重复取消', actor), /仅启用/);
  assert.equal((await readLocal('requests'))[0].projectReservationReleases.length, 1);
});

test('普通请求保存不能伪造项目额度释放记录', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  const forged = { ...request, projectReservationReleases: [{ projectId: 'fake', assetAllocations: [], entitlementAllocations: [] }] };
  await assert.rejects(saveLocal('requests', forged, access()), /释放记录/);
  assert.equal(state.stores.requests[0].projectReservationReleases, undefined);
});

test('客户项目读取限定协作成员和企业，移除成员立即失去访问且不能写入', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  await saveLocal('requests', createServiceProjects(request, actor, split(request)), access());
  const { readCustomerServiceProjects, updateStoredServiceProject, saveProjectCollaborators } = await import('./service-project-store.ts');
  const customer = { id: 'contact1', name: '客户联系人', role: '客户' };
  const visible = await readCustomerServiceProjects(customer);
  assert.equal(visible.length, request.items.length);
  const row = state.stores.references.find(entry => entry.id === `service-project:${visible[0].id}`);
  const secondContact = { id: 'contact2', customerId: 'c1', status: '启用', name: '同企业其他联系人' };
  const workspace = state.stores.references.find(entry => entry.id === 'workspace').payload;
  workspace.contacts.push(secondContact);
  assert.deepEqual(await readCustomerServiceProjects({ ...customer, id: secondContact.id }), []);
  await assert.rejects(updateStoredServiceProject(row.payload.id, row.payload.revision, { ...row.payload, name: '客户篡改' }, customer), /无权/);
  await assert.rejects(saveProjectCollaborators(row.payload.id, row.payload.revision, 'customer', [], customer), /无权/);
  const currentProject = () => state.stores.references.find(entry => entry.id === `service-project:${visible[0].id}`).payload;
  currentProject().customerId = 'other-company';
  assert.ok((await readCustomerServiceProjects(customer)).every(project => project.id !== row.payload.id));
  currentProject().customerId = 'c1'; currentProject().collaborators.customer = [];
  assert.ok((await readCustomerServiceProjects(customer)).every(project => project.id !== row.payload.id));
  state.stores.references.find(entry => entry.id === 'workspace').payload.contacts.find(contact => contact.id === customer.id).status = '停用';
  await assert.rejects(readCustomerServiceProjects(customer), /不可用/);
});


test('已有草稿项目读取为待启动，启动保存后使用新状态且保留项目信息', async t => {
  const state = setup(t);
  const request = state.stores.requests[0];
  const created = createServiceProjects(request, actor, split(request));
  await saveLocal('requests', created, access());
  const stored = state.stores.references.find(row => row.id.startsWith('service-project:')).payload;
  stored.status = '草稿';
  const [project] = (await readServiceProjects(actor)).filter(entry => entry.id === stored.id);
  assert.equal(project.status, '待启动');
  assert.equal(project.name, stored.name);
  assert.deepEqual(project.items, stored.items);
  const { updateStoredServiceProject } = await import('./service-project-store.ts');
  const started = await updateStoredServiceProject(project.id, project.revision, { ...project, status: '进行中' }, actor);
  assert.equal(started.status, '进行中');
  assert.ok(started.submittedAt);
  assert.equal(started.operations.activities.at(-1).detail, '待启动 → 进行中');
});
