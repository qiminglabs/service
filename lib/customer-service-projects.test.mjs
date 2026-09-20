import test from 'node:test';
import assert from 'node:assert/strict';
import { canViewCustomerProject, customerServiceProject } from './customer-service-projects.ts';
import { canManageServiceProjects } from './service-projects.ts';
import { itemSummaryFields } from './service-requests.ts';
import { resolvePortalContext } from './portal-context.ts';
const actor = { id: 'contact', name: '客户', role: '客户' };
const directory = { customers: [{ id: 'c1', status: '启用', name: '企业' }], contacts: [{ id: 'contact', customerId: 'c1', status: '启用' }, { id: 'other', customerId: 'c1', status: '启用' }], users: [], partners: [], partnerUsers: [] };
const project = { id: 'p', name: '项目', customerId: 'c1', status: '待启动', collaborators: { customer: [{ id: 'contact', name: '客户', details: '电话', assignmentRoles: ['请求申请人'] }] } };
test('客户始终看到合作伙伴协作人区域，仅展示当前服务方中已关联的用户', () => {
  const refs = { ...directory, partners: [{ id: 'p1', name: '服务合作伙伴', status: '启用' }], partnerUsers: [
    { id: 'partner-user', name: '伙伴申请人', partnerId: 'p1', phone: '13800000000', email: 'partner@example.com', status: '启用' },
    { id: 'other-user', name: '其他企业人员', partnerId: 'p2', phone: '13900000000', email: 'other@example.com', status: '启用' },
  ] };
  const source = { ...project, serviceProviderId: 'partner:p1', collaborators: { ...project.collaborators,
    partner: [{ id: 'partner-user', name: '旧名', assignmentRoles: ['申请人'] }, { id: 'other-user', name: '其他企业人员' }] } };
  const visible = customerServiceProject(source, refs);
  assert.equal(visible.showPartnerCollaborators, true);
  assert.deepEqual(visible.supplementMentionUsers.filter(person => person.group === 'partner'), [{ id: 'partner-user', name: '伙伴申请人', email: 'partner@example.com', companyName: '服务合作伙伴', group: 'partner', isManager: false }]);
  assert.deepEqual(visible.partnerCollaborators, [{ id: 'partner-user', name: '伙伴申请人', phone: '13800000000', email: 'partner@example.com', roles: ['申请人'] }]);
  assert.equal(JSON.stringify(visible).includes('other@example.com'), false);
  for (const serviceProviderId of ['', undefined, 'provider:smartx']) {
    const hidden = customerServiceProject({ ...source, serviceProviderId }, refs);
    assert.equal(hidden.showPartnerCollaborators, true);
    assert.deepEqual(hidden.partnerCollaborators, []);
  }
  const empty = customerServiceProject({ ...source, collaborators: {} }, refs);
  assert.equal(empty.showPartnerCollaborators, true);
  assert.deepEqual(empty.partnerCollaborators, []);
});
test('客户项目入口开放，仅本人协作且同企业的项目可见，不授予维护权限', () => {
  assert.deepEqual(resolvePortalContext(actor, directory).views, ['requests', 'projects']);
  for (const status of ['待启动', '进行中', '待复核', '待确认', '已完成', '已取消']) assert.equal(canViewCustomerProject({ ...project, status }, actor, directory), true);
  assert.equal(canViewCustomerProject(project, { ...actor, id: 'other' }, directory), false);
  assert.equal(canViewCustomerProject({ ...project, customerId: 'other-company' }, actor, directory), false);
  assert.equal(canViewCustomerProject(project, { ...actor, role: '合作伙伴服务工程师' }, directory), false);
  assert.equal(canViewCustomerProject(project, actor, { ...directory, contacts: [{ ...directory.contacts[0], status: '停用' }] }), false);
  assert.equal(canViewCustomerProject(project, actor, { ...directory, customers: [{ ...directory.customers[0], status: '停用' }] }), false);
  assert.equal(canViewCustomerProject({ ...project, collaborators: {} }, actor, directory), false);
  assert.equal(canManageServiceProjects(actor, project), false);
});
test('客户返回数据只含公开项目信息，过滤内部补充、评估、工时、材料及私有活动', () => {
  const source = { ...project, expectedServiceDate: '', note: '说明', createdAt: '', updatedAt: '',
    requestConversion: { assessmentSnapshot: { approvals: ['内部特批'] } }, customValues: { private: '内部字段' },
    items: [{ id: 'item', serviceId: 'svc', serviceName: '服务', methods: ['远程', '现场'], method: '远程', description: '交付', businessObjectIds: [],
      config: { serviceId: 'svc', revision: 1, fields: ['edition', 'nodes', 'custom'], fieldNames: { custom: '部署位置' }, fieldOptions: {}, materials: ['内部材料要求'] },
      values: { edition: '企业版', nodes: '8', custom: '生产区', internal: '内部' }, materials: ['内部文件'] }],
    supplements: [{ id: 'public', externalVisible: true, files: [], comment: '公开说明' }, { id: 'private', externalVisible: false, files: ['内部文件'] }],
    operations: { worklogs: ['内部工时'], activities: [{ id: 'visible', title: '公开活动', externalVisible: true }, { id: 'hidden', title: '内部活动', externalVisible: false }, { id: 'unspecified', title: '未指定活动' }] } };
  const result = customerServiceProject(source);
  assert.deepEqual(result.supplements.map(item => item.id), ['public']);
  assert.equal(result.activities, undefined);
  assert.equal(result.requestConversion, undefined);
  assert.equal(result.customValues, undefined);
  assert.equal(result.operations, undefined);
  assert.equal(result.customerId, source.customerId);
  assert.equal(result.items[0].serviceName, '服务');
  assert.deepEqual(result.items[0].values, { edition: '企业版', nodes: '8', custom: '生产区' });
  assert.deepEqual(itemSummaryFields(result.items[0]), itemSummaryFields(source.items[0]).filter(field => field.key !== 'internal'));
  assert.deepEqual(result.items[0].materials, []);
  assert.deepEqual(result.items[0].config.materials, []);
  assert.equal(JSON.stringify(result).includes('内部文件'), false);
  assert.deepEqual(result.collaborators, [{ id: 'contact', name: '客户', phone: '', email: '', roles: ['请求申请人'] }]);
  result.items[0].description = '独立副本';
  assert.equal(source.items[0].description, '交付');
});


test('客户详情展示全部 SmartX 协作人，与内部统一身份标签且不包含未关联用户', () => {
  const refs = { ...directory, customers: [{ ...directory.customers[0], ownerUserId: 'owner' }], users: [
    { id: 'owner', name: '客户经理', phone: '13800000000', email: 'owner@example.com', status: '启用' },
    { id: 'pm', name: '项目经理', phone: '', email: 'pm@example.com', status: '启用' },
    { id: 'engineer', name: '工程师', phone: '', email: 'engineer@example.com', status: '启用' },
    { id: 'unrelated', name: '其他员工', phone: '', email: 'private@example.com', status: '启用' },
  ] };
  const source = { ...project, collaborators: { ...project.collaborators, internal: [
    { id: 'owner', name: '旧名称', assignmentRoles: ['客户所有人', '请求申请人'] },
    { id: 'pm', name: '项目经理', assignmentRoles: ['项目经理'] },
    { id: 'engineer', name: '工程师' },
  ] } };
  const result = customerServiceProject(source, refs);
  assert.equal(result.smartxContacts, undefined);
  assert.equal(result.supplementMentionUsers.some(person => person.id === 'engineer'), true);
  assert.deepEqual(result.supplementMentionUsers.filter(person => person.group === 'internal').map(person => person.id), result.internalCollaborators.map(person => person.id));
  assert.deepEqual(result.internalCollaborators.map(person => person.id), ['owner', 'pm', 'engineer']);
  assert.deepEqual(result.internalCollaborators[0].roles, ['客户经理', '请求申请人']);
  assert.equal(result.internalCollaborators[0].phone, '');
  assert.equal(result.internalCollaborators[0].name, '旧名称');
  assert.equal(JSON.stringify(result).includes('private@example.com'), false);
  assert.equal(source.collaborators.internal[0].name, '旧名称');
});

test('客户服务项保留已选业务对象快照，详情不混入其他对象或其他客户数据', () => {
  const object = { id: 'obj', customerId: 'c1', name: '生产集群', nodeCount: 8, sn: 'SN-001', status: '启用' };
  const item = { id: 'item', serviceId: 'svc', serviceName: '升级', methods: ['远程'], method: '远程', description: '说明',
    businessObjectIds: ['obj'], values: {}, materials: [],
    config: { serviceId: 'svc', revision: 1, fields: ['businessObjects'], fieldNames: {}, fieldOptions: {}, materials: [] },
    businessObjectSnapshot: { savedAt: '2026-09-16T00:00:00Z', objects: [
      { object, entitlement: { name: '升级权益', available: 8, required: 8, insufficient: false } },
      { object: { ...object, id: 'not-selected', name: '未选择对象' }, entitlement: {} },
      { object: { ...object, customerId: 'c2', name: '其他客户对象' }, entitlement: {} },
    ] } };
  const result = customerServiceProject({ ...project, items: [item] });
  assert.equal(result.items[0].businessObjectSnapshot.objects.length, 1);
  assert.deepEqual(itemSummaryFields(result.items[0]), itemSummaryFields(item));
  assert.equal(result.items[0].businessObjectSnapshot.objects[0].object.sn, 'SN-001');
  result.items[0].businessObjectSnapshot.objects[0].object.name = '副本';
  assert.equal(object.name, '生产集群');
});

test('客户可查看历史日报正文及导出字段，不携带作者账号、附加内部字段或原始项目记录', () => {
  const report = { id: 'report-1', projectName: '日报项目快照', authorId: 'private-user-id', authorName: '工程师', recordedAt: '2026-09-18T09:00:00Z', delivery: 'local', date: '2026-09-18', subject: '服务日报', to: 'customer@example.com', cc: 'manager@example.com', greeting: '客户老师', customerEngineers: '客户技术人员', projectManager: '经理', engineers: '工程师', startTime: '09:00', endTime: '18:00', serviceNumber: 'PS 001', workContent: '完成配置检查', nextPlan: '提交实施资料', internalNote: '内部信息' };
  for (const status of ['进行中', '已暂停', '待复核', '待确认', '已完成', '已取消']) {
    const source = { ...project, status, dailyReports: [report] };
    const result = customerServiceProject(source, directory);
    assert.equal(result.dailyReports.length, 1);
    const { authorId, internalNote, ...expected } = report;
    assert.deepEqual(result.dailyReports[0], expected);
    assert.equal(result.dailyReports[0].authorId, undefined);
    assert.equal(result.dailyReports[0].internalNote, undefined);
    result.dailyReports[0].workContent = '副本';
    assert.equal(report.workContent, '完成配置检查');
  }
  assert.deepEqual(customerServiceProject(project, directory).dailyReports, []);
});

test('客户可查看暂停和取消原因，暂停元数据只公开原因及原状态', () => {
  const paused = customerServiceProject({ ...project, status: '已暂停', suspension: { reason: '客户维护窗口延期', fromStatus: '进行中', actorId: 'internal', actor: '经理', at: '2026-09-20' } });
  assert.equal(paused.suspensionReason, '客户维护窗口延期');
  assert.equal(paused.pausedFromStatus, '进行中');
  assert.equal(paused.suspension, undefined);
  const cancelled = customerServiceProject({ ...project, status: '已取消', cancellation: { reason: '需求取消', fromStatus: '进行中' } });
  assert.equal(cancelled.cancellationReason, '需求取消');
  assert.equal(cancelled.suspensionReason, undefined);
});
