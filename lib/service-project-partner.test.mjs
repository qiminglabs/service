import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCustomerMentionUsers } from './service-project-supplements.ts';
import {
  defaultConfig,
  partnerRequestConfigId,
  customerRequestConfigId,
} from './service-requests.ts';
import {
  newProjectServiceItem,
  createStoredServiceProject,
  readServiceProjects,
  updateStoredServiceProject,
  saveProjectItems,
  saveProjectSupplement,
  saveProjectCollaborators,
  saveProjectOperation,
  saveCustomerProjectSupplement,
  readCustomerServiceProjects,
} from './service-project-store.ts';
import {
  newServiceProject,
  projectItemAudience,
  canManageServiceProjects,
} from './service-projects.ts';
const internal = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const partner = { id: 'pu1', name: '伙伴工程师甲', role: '合作伙伴服务工程师' };
const another = { id: 'pu2', name: '伙伴工程师乙', role: '合作伙伴服务工程师' };
const service = {
  id: 's1',
  name: '公共服务',
  category: '实施',
  status: '已启用',
  deliveryMethods: ['远程'],
  priceUnit: '人天',
  allowedInitiatorSites: ['内部系统', '合作伙伴中心'],
};
const customers = [{ id: 'c1', name: '客户甲', status: '启用' }];
const input = {
  name: '伙伴项目',
  expectedServiceDate: '2026-09-20',
  customerId: 'c1',
  serviceProviderId: 'partner:p1',
  note: '',
};
const base = {
  ...defaultConfig(service),
  basicFields: {
    description: { enabled: true, required: false },
    businessObjects: { enabled: false, required: false },
  },
  materials: [],
};
const internalConfig = {
  ...base,
  fields: ['nodes'],
  fieldNames: { nodes: '内部节点数' },
};
const partnerConfig = {
  ...base,
  fields: [],
  materials: [
    {
      id: 'partner-material',
      name: '伙伴模板',
      required: false,
      instructions: '',
    },
  ],
};
function fixture() {
  return {
    requests: [],
    configs: [internalConfig],
    references: [
      {
        id: 'workspace',
        payload: {
          services: [service],
          customers,
          users: [],
          contacts: [],
          businessObjects: [],
          partners: [
            { id: 'p1', name: '伙伴甲', status: '启用' },
            { id: 'p2', name: '伙伴乙', status: '启用' },
          ],
          partnerUsers: [
            {
              id: partner.id,
              name: partner.name,
              partnerId: 'p1',
              status: '启用',
            },
            {
              id: another.id,
              name: another.name,
              partnerId: 'p1',
              status: '启用',
            },
          ],
        },
      },
      {
        id: customerRequestConfigId(service.id),
        payload: { ...base, fields: ['edition'] },
      },
      { id: partnerRequestConfigId(service.id), payload: partnerConfig },
    ],
  };
}
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

test('客户可在所有未结束阶段发布补充，保留内部数据并拒绝越权、过期和结束后发布', async t => {
  const stores = fixture();
  const workspace = stores.references[0].payload;
  const customer = { id: 'contact', name: '伪造姓名', role: '客户' };
  workspace.contacts = [{ id: customer.id, name: '客户联系人', customerId: 'c1', status: '启用' }];
  workspace.users = [{ id: 'engineer', name: '工程师', status: '启用', email: 'private@example.com', department: '内部部门' }];
  const project = { ...newServiceProject(input, internal, customers, workspace.partners),
    collaborators: { customer: [{ id: customer.id, name: '客户联系人', details: '' }], internal: [{ id: 'engineer', name: '工程师', details: '' }] },
    supplements: [{ id: 'private', comment: '内部记录', files: [], mentions: [], externalVisible: false }],
  };
  stores.references.push({ id: `service-project:${project.id}`, payload: project });
  storage(t, stores);
  const submission = { comment: '@工程师 请确认服务窗口', mentions: [{ userId: 'engineer', name: '工程师', start: 0, end: 4 }],
    files: [{ id: 'customer-file', name: '窗口.txt', blob: new Blob(['abc']), size: 3, uploadedAt: new Date().toISOString() }], externalVisible: false };
  const stored = () => stores.references.find(row => row.id === `service-project:${project.id}`).payload;
  for (const status of ['待启动', '进行中', '待复核', '待确认']) {
    stored().status = status;
    const revision = stored().revision;
    const result = await saveCustomerProjectSupplement(project.id, revision, submission, customer);
    assert.equal(result.supplements.at(-1).author, '客户联系人');
    assert.equal(result.supplements.some(item => item.id === 'private'), false);
    assert.equal(result.operations, undefined);
    assert.deepEqual(result.supplements.at(-1).mentions, submission.mentions);
    assert.equal(await result.supplements.at(-1).files[0].blob.text(), 'abc');
    assert.deepEqual(result.supplementMentionUsers, [{ id: 'engineer', name: '工程师', email: 'private@example.com', companyName: '北京志凌海纳科技有限公司', isManager: false, group: 'internal' }]);
    assert.equal(JSON.stringify(result).includes('内部部门'), false);
    assert.equal(stored().supplements[0].comment, '内部记录');
    assert.equal(stored().supplements.at(-1).externalVisible, true);
    assert.equal(stored().operations.activities.at(-1).title, '发布补充信息');
    await assert.rejects(saveCustomerProjectSupplement(project.id, revision, submission, customer), /已被更新/);
  }
  assert.equal((await readCustomerServiceProjects(customer))[0].supplements.length, 4);
  for (const status of ['已完成', '已取消']) {
    stored().status = status;
    await assert.rejects(saveCustomerProjectSupplement(project.id, stored().revision, submission, customer), /不可发布/);
  }
  stored().status = '进行中';
  const currentWorkspace = () => stores.references.find(row => row.id === 'workspace').payload;
  currentWorkspace().users[0].status = '停用';
  assert.deepEqual((await readCustomerServiceProjects(customer))[0].supplementMentionUsers, []);
  await assert.rejects(saveCustomerProjectSupplement(project.id, stored().revision, submission, customer), /停用|可选范围/);
  currentWorkspace().users[0].status = '启用';
  const collaborators = structuredClone(stored().collaborators.internal);
  stored().collaborators.internal = [];
  await assert.rejects(saveCustomerProjectSupplement(project.id, stored().revision, submission, customer), /可选范围/);
  stored().collaborators.internal = collaborators;
  currentWorkspace().contacts[0].status = '停用';
  await assert.rejects(saveCustomerProjectSupplement(project.id, stored().revision, submission, customer), /不可用/);
  currentWorkspace().contacts[0].status = '启用';
  currentWorkspace().contacts[0].customerId = 'other';
  currentWorkspace().customers.push({ id: 'other', name: '其他企业', status: '启用' });
  await assert.rejects(saveCustomerProjectSupplement(project.id, stored().revision, submission, customer), /协作人/);
  currentWorkspace().contacts[0].customerId = 'c1';
  stored().collaborators.customer = [];
  await assert.rejects(saveCustomerProjectSupplement(project.id, stored().revision, submission, customer), /协作人/);
});

test('内部和伙伴在项目中可提及客户协作人，保存与候选均排除停用、移除及跨客户联系人', async t => {
  const stores = fixture();
  const contact = { id: 'contact', name: '客户甲', customerId: 'c1', status: '启用' };
  stores.references[0].payload.contacts = [contact, { ...contact, id: 'unrelated' }];
  storage(t, stores);
  const project = await createStoredServiceProject(input, partner, { customer: [{ id: contact.id, name: contact.name, details: '' }] });
  const stored = () => stores.references.find(row => row.id === `service-project:${project.id}`).payload;
  const workspace = () => stores.references.find(row => row.id === 'workspace').payload;
  const submission = { comment: '@客户甲 请确认', mentions: [{ userId: contact.id, name: contact.name, start: 0, end: 4 }], files: [], externalVisible: true };
  for (const actor of [internal, partner]) {
    assert.deepEqual(projectCustomerMentionUsers(stored(), actor, workspace().contacts).map(user => user.id), [contact.id]);
    const saved = await saveProjectSupplement(project.id, stored().revision, submission, actor);
    assert.deepEqual(saved.supplements.at(-1).mentions, submission.mentions);
  }
  assert.deepEqual(projectCustomerMentionUsers(stored(), { id: contact.id, role: '客户' }, workspace().contacts), []);
  const revision = stored().revision;
  for (const actor of [internal, partner]) {
    for (const patch of [{ status: '停用' }, { customerId: 'other' }]) {
      workspace().contacts[0] = { ...contact, ...patch };
      assert.deepEqual(projectCustomerMentionUsers(stored(), actor, workspace().contacts), []);
      await assert.rejects(saveProjectSupplement(project.id, revision, submission, actor), /可选范围/);
    }
    workspace().contacts[0] = { ...contact };
  }
  stored().collaborators.customer = [];
  for (const actor of [internal, partner])
    await assert.rejects(saveProjectSupplement(project.id, revision, submission, actor), /可选范围/);
  assert.equal(stored().revision, revision);
});

test('项目材料保存并重新打开，保留文件内容、上传人和操作记录，拦截过期与越权保存', async t => {
  const stores = fixture();
  storage(t, stores);
  const item = await newProjectServiceItem(service, partner);
  const project = await createStoredServiceProject(input, partner, {}, [item]);
  const change = { type: 'materials', id: item.id, material: { requirementId: 'partner-material', files: [
    { id: 'material-file', name: '交付.txt', size: 3, blob: new Blob(['abc']), uploadedAt: '2026-09-16T00:00:00Z' },
  ] } };
  await assert.rejects(saveProjectItems(project.id, project.revision, change, another), /无权/);
  const saved = await saveProjectItems(project.id, project.revision, change, partner);
  assert.equal(saved.operations.activities.at(-1).title, '保存项目材料');
  const reopened = (await readServiceProjects(partner))[0];
  const file = reopened.items[0].materials[0].files[0];
  assert.equal(file.uploadedById, partner.id);
  assert.equal(await file.blob.text(), 'abc');
  await assert.rejects(saveProjectItems(project.id, project.revision, change, partner), /已被更新/);
  assert.equal((await readServiceProjects(partner))[0].revision, saved.revision);
});

test('伙伴可创建项目并保存伙伴表单服务项，读取及重新打开保留创建站点与配置', async (t) => {
  const stores = fixture();
  storage(t, stores);
  const item = await newProjectServiceItem(service, partner);
  assert.deepEqual(item.config.fields, []);
  assert.equal(item.config.materials[0].name, '伙伴模板');
  const project = await createStoredServiceProject(input, partner, {}, [item]);
  assert.equal(project.createdSite, '合作伙伴中心');
  assert.equal(project.createdById, partner.id);
  assert.equal(project.status, '待启动');
  assert.equal(project.items.length, 1);
  const reopened = await readServiceProjects(partner);
  assert.deepEqual(reopened[0].items, project.items);
  const edited = await updateStoredServiceProject(
    project.id,
    project.revision,
    { ...input, name: '伙伴修改', status: '待启动' },
    partner,
  );
  assert.equal(edited.name, '伙伴修改');
  assert.equal(edited.createdSite, '合作伙伴中心');
});

test('伙伴只可访问本人创建或明确协作的项目，保存层拒绝越权，内部人员仍可管理', async (t) => {
  const stores = fixture();
  storage(t, stores);
  const project = await createStoredServiceProject(input, partner);
  assert.deepEqual(project.collaborators.partner.map(person => [person.id, person.assignmentRoles]), [[partner.id, ['申请人']]]);
  for (const actor of [partner, internal]) {
    await assert.rejects(saveProjectCollaborators(project.id, project.revision, 'partner', [], actor), /不允许移除/);
  }
  assert.deepEqual(await readServiceProjects(another), []);
  await assert.rejects(
    updateStoredServiceProject(
      project.id,
      project.revision,
      { ...input, status: '待启动' },
      another,
    ),
    /无权维护/,
  );
  const item = await newProjectServiceItem(service, another);
  await assert.rejects(
    saveProjectItems(
      project.id,
      project.revision,
      { type: 'save', item },
      another,
    ),
    /无权维护/,
  );
  await assert.rejects(
    saveProjectCollaborators(
      project.id,
      project.revision,
      'partner',
      [another.id],
      another,
    ),
    /无权维护/,
  );
  await assert.rejects(
    saveProjectSupplement(
      project.id,
      project.revision,
      { comment: '越权评论', files: [], mentions: [], externalVisible: true },
      another,
    ),
    /不可发布/,
  );
  const invited = await saveProjectCollaborators(
    project.id,
    project.revision,
    'partner',
    [partner.id, another.id],
    internal,
  );
  assert.equal((await readServiceProjects(another))[0].id, project.id);
  assert.equal((await readServiceProjects(internal))[0].id, project.id);
  const edited = await updateStoredServiceProject(
    invited.id,
    invited.revision,
    { ...input, name: '协作编辑', status: '待启动' },
    another,
  );
  assert.equal(edited.name, '协作编辑');
  assert.equal(edited.createdById, partner.id);
  assert.equal(canManageServiceProjects({ ...partner, role: '客户' }), false);
  stores.references.find(row => row.id === 'workspace').payload.partnerUsers.find(user => user.id === partner.id).status = '停用';
  const retained = await saveProjectCollaborators(edited.id, edited.revision, 'partner', [partner.id], internal);
  assert.deepEqual(retained.collaborators.partner.map(person => person.id), [partner.id]);
  assert.deepEqual(retained.collaborators.partner[0].assignmentRoles, ['申请人']);
});

test('配置随当前操作人切换而非项目来源，目录站点限制同时作用于选择与保存', async (t) => {
  const stores = fixture();
  storage(t, stores);
  const project = await createStoredServiceProject(input, partner);
  const partnerItem = await newProjectServiceItem(service, partner);
  const internalItem = await newProjectServiceItem(service, internal);
  assert.deepEqual(internalItem.config.fields, ['nodes']);
  assert.deepEqual(partnerItem.config.fields, []);
  internalItem.values.nodes = '2';
  let saved = await saveProjectItems(
    project.id,
    project.revision,
    { type: 'save', item: partnerItem },
    partner,
  );
  saved = await saveProjectItems(
    project.id,
    saved.revision,
    { type: 'save', item: internalItem },
    internal,
  );
  assert.equal(saved.createdSite, '合作伙伴中心');
  assert.deepEqual(
    saved.items.map((item) => item.config.fields),
    [[], ['nodes']],
  );
  const workspace = stores.references.find(
    (record) => record.id === 'workspace',
  ).payload;
  workspace.services[0].allowedInitiatorSites = ['内部系统'];
  await assert.rejects(
    newProjectServiceItem(workspace.services[0], partner),
    /不能添加/,
  );
  await assert.rejects(
    saveProjectItems(
      saved.id,
      saved.revision,
      { type: 'copy', id: partnerItem.id },
      partner,
    ),
    /不能复制/,
  );
  await assert.rejects(
    createStoredServiceProject(input, partner, {}, [partnerItem]),
    /未开放给当前站点/,
  );
  const edited = await saveProjectItems(
    saved.id,
    saved.revision,
    { type: 'save', item: internalItem },
    internal,
  );
  assert.equal(edited.items.length, 2);
  assert.equal(projectItemAudience(partner), 'partner');
  assert.equal(projectItemAudience(internal), 'internal');
  assert.equal(
    projectItemAudience({ id: 'c', role: '客户', name: '客户' }),
    'customer',
  );
});

test('伙伴用户或所属组织停用后不可读写，内部补充信息不会对伙伴展示或因伙伴编辑丢失', async (t) => {
  const stores = fixture();
  storage(t, stores);
  let project = await createStoredServiceProject(input, partner);
  project = await saveProjectSupplement(
    project.id,
    project.revision,
    { comment: '内部记录', files: [], mentions: [], externalVisible: false },
    internal,
  );
  assert.equal((await readServiceProjects(partner))[0].supplements.length, 0);
  const publicResult = await saveProjectSupplement(
    project.id,
    project.revision,
    { comment: '伙伴记录', files: [], mentions: [], externalVisible: false },
    partner,
  );
  assert.deepEqual(
    publicResult.supplements.map((item) => item.comment),
    ['伙伴记录'],
  );
  assert.equal(publicResult.supplements[0].externalVisible, true);
  assert.equal((await readServiceProjects(internal))[0].supplements.length, 2);
  const workspace = stores.references.find(
    (record) => record.id === 'workspace',
  ).payload;
  workspace.partnerUsers[0].status = '停用';
  await assert.rejects(readServiceProjects(partner), /已停用/);
  await assert.rejects(createStoredServiceProject(input, partner), /已停用/);
  workspace.partnerUsers[0].status = '启用';
  workspace.partners[0].status = '停用';
  await assert.rejects(
    saveProjectItems(
      project.id,
      publicResult.revision,
      { type: 'remove', id: 'anything' },
      partner,
    ),
    /已停用/,
  );
  assert.equal(
    newServiceProject({ ...input, serviceProviderId: '' }, internal, customers)
      .createdSite,
    '内部系统',
  );
});

test('会议和工时与活动原子保存，重新读取保留模块记录，过期版本不能覆盖其他更新', async (t) => {
  const stores = fixture();
  storage(t, stores);
  let project = await createStoredServiceProject(input, partner);
  assert.equal(project.operations.activities[0].title, '创建项目');
  const oldRevision = project.revision;
  const future = new Date(Date.now() + 3 * 86400000);
  const date = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
  project = await saveProjectOperation(
    project.id,
    project.revision,
    {
      type: 'meeting-schedule',
      title: '项目会议',
      scheduledDate: date,
      scheduledTime: '14:00',
      durationMinutes: 30,
    },
    partner,
  );
  assert.equal(project.operations.meetings.length, 1);
  assert.equal(project.operations.activities.at(-1).title, '预约模拟会议');
  await assert.rejects(
    saveProjectOperation(
      project.id,
      oldRevision,
      { type: 'meeting-start', id: project.operations.meetings[0].id },
      partner,
    ),
    /已被更新/,
  );
  project = await updateStoredServiceProject(
    project.id,
    project.revision,
    { ...input, name: '保存基本信息', status: '待启动' },
    partner,
  );
  assert.equal(project.operations.meetings.length, 1);
  project = await saveProjectOperation(
    project.id,
    project.revision,
    {
      type: 'worklog-add',
      date: '2026-01-01',
      startTime: '10:00',
      endTime: '11:30',
      category: '会议沟通',
      description: '沟通项目范围',
    },
    partner,
  );
  const [reopened] = await readServiceProjects(partner);
  assert.equal(reopened.operations.meetings.length, 1);
  assert.equal(reopened.operations.worklogs[0].hours, 1.5);
  assert.deepEqual(
    reopened.operations.activities.map((item) => item.title),
    ['创建项目', '预约模拟会议', '更新项目信息', '录入工时'],
  );
});

test('合作伙伴创建自动带入所属企业，拒绝冒用其他服务方，保存后各身份均不可改换', async t => {
  const stores = fixture(); storage(t, stores);
  for (const serviceProviderId of ['partner:p2', 'provider:smartx']) {
    await assert.rejects(createStoredServiceProject({ ...input, serviceProviderId }, partner), /只能是自己所属企业/);
  }
  assert.equal((await readServiceProjects(partner)).length, 0);
  const created = await createStoredServiceProject({ ...input, serviceProviderId: '' }, partner);
  assert.equal(created.serviceProviderId, 'partner:p1');
  assert.equal(created.serviceProviderName, '伙伴甲');
  for (const actor of [partner, internal]) for (const serviceProviderId of ['', 'partner:p2', 'provider:smartx']) {
    await assert.rejects(updateStoredServiceProject(created.id, created.revision, { ...created, serviceProviderId }, actor), /固定为所属企业/);
  }
  const updated = await updateStoredServiceProject(created.id, created.revision, { ...created, note: '更新说明' }, internal);
  assert.equal(updated.serviceProviderId, 'partner:p1');
  assert.equal((await readServiceProjects(partner))[0].note, '更新说明');
});
test('内部创建可选择和修改服务方，伙伴协作人不能借编辑内部项目切换服务方', async t => {
  const stores = fixture(); storage(t, stores);
  const created = await createStoredServiceProject(input, internal, { partner: [{ id: partner.id }] });
  await assert.rejects(updateStoredServiceProject(created.id, created.revision, { ...created, serviceProviderId: 'provider:smartx' }, partner), /仅内部人员/);
  const updated = await updateStoredServiceProject(created.id, created.revision, { ...created, serviceProviderId: 'partner:p2' }, internal);
  assert.equal(updated.serviceProviderId, 'partner:p2');
  assert.equal(updated.serviceProviderName, '伙伴乙');
  assert.deepEqual(updated.collaborators.partner, []);
});
