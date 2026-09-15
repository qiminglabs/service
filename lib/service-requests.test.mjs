import test from 'node:test';
import assert from 'node:assert/strict';
import { itemDisplayFields, itemSummaryFields } from './service-requests.ts';
import { requestFieldLabel } from './request-field-labels.ts';
import { normalizeCatalogRequestConfig, resolveRequestConfig } from './service-requests.ts';
import {
  checkFile,
  defaultConfig,
  itemIssues,
  requestMaterialFiles,
  attributeMaterialFile,
  attributeRequestMaterials,
  customerMaterialSaveIssue,
  itemSummary,
  itemBasicIssues,
  newItem,
  newRequest,
  requestIssues,
  storedFile,
  businessObjectsEnabled,
  normalizeRequestConfig,
  requestIdentityIssue,
  requestCreationIssue,
  requestStatuses,
  normalizeStoredRequest,
  requestStatusTone,
  requestProgressSteps,
  contactDisplay,
  reconcileExternalCollaborators,
  reconcileParticipants,
  requestParticipantsIssue,
  withRequestContact,
  requestContactRemovalIssue,
  canAccessRequest,
  customerOwnerRemovalIssue,
  materialFiles,
  withMaterialFiles,
  saveMaterialFile,
  removeMaterialFile,
} from './service-requests.ts';

const installation = {
  id: 'SC-IMP-001',
  name: '核心平台新装',
  category: '产品实施交付',
  deliveryMethods: ['远程', '现场'],
  status: '已启用',
  priceUnit: '服务人天',
};
const inspection = {
  ...installation,
  id: 'SC-OPS-001',
  name: '基础巡检',
  category: '运维支持或培训',
};

test('版本号从旧目录表单一次移除，清理布局及必填配置，手动加回与历史申请不受影响', () => {
  const config = { ...defaultConfig(installation), fields: ['edition', 'version', 'nodes'],
    fieldOrder: ['edition', 'version', 'nodes'], fieldRowStarts: ['version'],
    fieldWidths: { version: 'half', nodes: 'half' }, fieldColumns: { version: 'left' },
    fieldRequired: { version: true }, fieldRequiredWhen: { version: 'required' }, fieldOptions: { version: ['5.0.1'] } };
  delete config.versionFieldDefaultRemoved;
  const before = structuredClone(config);
  const migrated = normalizeCatalogRequestConfig(config);
  assert.deepEqual(migrated.fields, ['edition', 'nodes']);
  assert.deepEqual(migrated.fieldOrder, ['edition', 'nodes']);
  assert.deepEqual(migrated.fieldRowStarts, []);
  for (const key of ['fieldRequired', 'fieldRequiredWhen', 'fieldOptions', 'fieldWidths', 'fieldColumns']) assert.equal(migrated[key].version, undefined);
  assert.deepEqual(resolveRequestConfig(installation, [config]).fields, ['edition', 'nodes']);
  assert.deepEqual(config, before);
  const readded = { ...migrated, fields: [...migrated.fields, 'version'], fieldRequired: { version: true } };
  assert.ok(normalizeCatalogRequestConfig(readded).fields.includes('version'));
  assert.ok(itemBasicIssues(newItem(installation, readded)).includes('版本号'));
  const historicalItem = newItem(installation, config);
  historicalItem.values.version = '5.0.1';
  assert.ok(historicalItem.config.fields.includes('version'));
  assert.equal(historicalItem.values.version, '5.0.1');
});

test('授权版本兼容旧配置和申请快照，不改选项、版本号或管理员自定义标签', () => {
  const config = defaultConfig(installation);
  config.fieldNames.edition = '产品版本类型';
  const before = structuredClone(config);
  const normalized = normalizeRequestConfig(config);
  assert.equal(normalized.fieldNames.edition, '授权版本');
  assert.deepEqual(normalized.fieldOptions, config.fieldOptions);
  assert.deepEqual(config, before);
  const item = newItem(installation, config);
  item.config.fieldNames.edition = '产品版本';
  item.values.edition = '企业版';
  assert.equal(itemDisplayFields(item).find(f => f.key === 'edition').label, '授权版本');
  assert.equal(itemSummaryFields(item).find(f => f.key === 'edition').label, '授权版本');
  assert.equal(item.values.edition, '企业版');
  item.values.edition = '';
  assert.ok(itemBasicIssues(item).includes('授权版本'));
  assert.equal(requestFieldLabel('version', '产品版本号'), '版本号');
  assert.equal(requestFieldLabel('edition', '许可档次'), '许可档次');
});
const refs = {
  customers: [{ id: 'c1', name: '客户一', status: '启用' }],
  contacts: [{ id: 'p1', name: '联系人', customerId: 'c1', status: '启用' }],
  businessObjects: [
    {
      id: 'o1',
      name: '集群一',
      customerId: 'c1',
      status: '启用',
      nodeCount: 3,
    },
    {
      id: 'o2',
      name: '集群二',
      customerId: 'c1',
      status: '启用',
      nodeCount: 5,
    },
    {
      id: 'o3',
      name: '其他客户集群',
      customerId: 'c2',
      status: '启用',
      nodeCount: 5,
    },
  ],
  users: [{ id: 'USR-002', name: '售前', status: '启用' }],
  services: [installation, inspection],
};
test('申请项摘要显示所有有值字段，空值隐藏', () => {
  const item = newItem(installation, defaultConfig(installation));
  item.values = {
    edition: '企业版',
    nodes: '3',
    version: '6.3.0',
    other: '新增值',
  };
  assert.equal(
    itemSummary(item),
    '服务方式：远程 · 授权版本：企业版 · 节点数：3 · 版本号：6.3.0 · other：新增值',
  );
  item.values = { edition: ' ', nodes: '', version: '6.3.0' };
  assert.equal(itemSummary(item), '服务方式：远程 · 版本号：6.3.0');
  item.method = ' ';
  item.values = {};
  assert.equal(itemSummary(item), '');
  item.method = '["远程","现场"]';
  item.values.edition = '[]';
  assert.equal(itemSummary(item), '服务方式：远程、现场');
});
function completeItem(service = installation) {
  const item = newItem(service, defaultConfig(service));
  item.description = '完成新集群部署和运维交接';
  item.values = { edition: '企业版', version: '6.3.0', nodes: '3' };
  item.materials = [
    {
      requirementId: 'requirements',
      versions: [storedFile(new File(['客户环境内容'], '完成材料.docx'))],
    },
  ];
  return item;
}
function completeRequest(items = [completeItem()]) {
  return {
    ...newRequest('安装申请', 'c1', '销售'),
    expectedServiceDate: '2099-10-01',
    businessImpact: '生产环境',
    createdById: 'sales',
    internalParticipants: [{ userId: 'sales', name: '销售' }, { userId: 'USR-002', name: '售前' }],
    externalCollaborators: [{ contactId: 'p1', name: '联系人', phone: '', email: '' }],
    description: '支持生产扩容',
    items,
  };
}

test('添加弹窗只校验基础字段，材料未上传可以保存申请项，但不能整单提交', () => {
  const item = completeItem();
  item.materials = [];
  assert.deepEqual(itemBasicIssues(item), []);
  assert.ok(itemIssues(item).some((issue) => issue.startsWith('上传')));
  assert.ok(
    requestIssues(completeRequest([item]), refs).some((issue) =>
      issue.includes('上传'),
    ),
  );
});

test('添加弹窗的基础字段缺失或节点数无效时不能通过保存校验', () => {
  const item = completeItem();
  item.values.version = '';
  item.values.nodes = '1.5';
  item.description = '   ';
  assert.deepEqual(itemBasicIssues(item), [
    '需求说明',
    '节点数（正整数）',
  ]);
});

test('在申请详情补齐材料后可以提交，选填材料不阻止基础信息保存', () => {
  const item = completeItem(inspection);
  item.config.materials[0].required = false;
  item.materials = [];
  assert.deepEqual(itemBasicIssues(item), []);
  assert.deepEqual(requestIssues(completeRequest([item]), refs), []);
  assert.deepEqual(requestIssues(completeRequest(), refs), []);
});

test('七种请求状态共用定义，待确认位于评估与受理之间，取消不伪造完成进度', () => {
  assert.deepEqual(requestStatuses, [
    '草稿',
    '待评估',
    '评估完成',
    '待确认',
    '待受理',
    '已转服务项目',
    '已取消',
  ]);
  for (const [index, status] of requestStatuses.filter(status => !['已取消', '评估完成'].includes(status)).entries()) {
    const steps = requestProgressSteps(status);
    assert.equal(steps.length, 5);
    assert.ok(steps.every((step) => step.label !== '已取消'));
    assert.equal(steps[index].label, status);
    assert.equal(steps.filter((step) => step.state === 'current').length, 1);
    assert.equal(
      steps.filter((step) => step.state === 'complete').length,
      index,
    );
    assert.equal(
      steps.filter((step) => step.state === 'upcoming').length,
      4 - index,
    );
  }
  assert.equal(requestProgressSteps('已取消').length, 5);
  assert.deepEqual(requestProgressSteps('已取消').map(step => step.state), ['current', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  assert.equal(requestStatusTone('已取消'), 'cancelled');
  assert.equal(requestStatusTone('已转服务项目'), 'green');
  assert.equal(requestStatusTone('草稿'), 'muted');
  assert.equal(requestStatusTone('待确认'), 'blue');
});
test('取消保留完整阶段条，仅替换取消前所在阶段，前面完成、后面未开始', () => {
  for (const [index, cancelledFromStatus] of requestStatuses.filter(status => !['已取消', '评估完成'].includes(status)).entries()) {
    const record = { ...completeRequest(), status: '已取消', cancelledFromStatus };
    const steps = requestProgressSteps(record);
    assert.equal(steps.length, 5);
    assert.equal(steps[index].label, '已取消');
    assert.equal(steps.filter(step => step.label === '已取消').length, 1);
    assert.deepEqual(steps.map(step => step.state), requestStatuses.filter(status => !['已取消', '评估完成'].includes(status)).map((_, i) => i < index ? 'complete' : i === index ? 'current' : 'upcoming'));
    assert.deepEqual(steps.filter((_, i) => i !== index).map(step => step.label), requestStatuses.filter(status => !['已取消', '评估完成'].includes(status)).filter((_, i) => i !== index));
  }
});
test('旧取消记录按最近一次流转恢复阶段，识别退回、重提及客户拒绝', () => {
  const record = { ...completeRequest(), status: '已取消', submittedAt: '2026-09-01T00:00:00Z', operations: { activities: [] } };
  const current = () => requestProgressSteps(record).findIndex(step => step.label === '已取消');
  assert.equal(current(), 1);
  record.operations.assessment = { confirmation: { at: '2026-09-02T00:00:00Z' } };
  assert.equal(current(), 2);
  record.operations.customerDecisions = [{ at: '2026-09-03T00:00:00Z', accepted: true }];
  assert.equal(current(), 3);
  record.operations.customerDecisions.push({ at: '2026-09-04T00:00:00Z', accepted: false });
  assert.equal(current(), 1);
  record.operations.draftReturns = [{ at: '2026-09-05T00:00:00Z' }];
  assert.equal(current(), 0);
  record.submittedAt = '2026-09-06T00:00:00Z';
  assert.equal(current(), 1);
  record.operations.activities.push({ at: '2026-09-07T00:00:00Z', title: '发起客户确认' });
  assert.equal(current(), 2);
  record.cancelledFromStatus = '草稿';
  assert.equal(current(), 0);
});
test('草稿可以不完整，提交必须有基本信息和至少一个申请项', () => {
  const draft = newRequest('', '', '客户');
  assert.equal(draft.status, '草稿');
  assert.equal(draft.items.length, 0);
  assert.ok(requestIssues(draft, refs).includes('至少添加一个申请项'));
  assert.ok(requestIssues(draft, refs).includes('选择有效客户'));
});
test('请求名称和客户不能为空，联系人通过协作人维护，空白名称不能用默认名称绕过', () => {
  const request = newRequest('   ', '', '销售');
  assert.equal(request.title, '');
  assert.equal(requestIdentityIssue(request), '请填写服务请求名称。');
  request.title = '生产环境安装';
  assert.equal(requestIdentityIssue(request), '请选择客户。');
  request.customerId = 'c1';
  assert.equal(requestIdentityIssue(request), null);
  request.externalCollaborators = [{ contactId: 'p1' }];
  assert.equal(requestIdentityIssue(request), null);
});
test('新建草稿无需联系人，旧联系人参数不再写入请求或自动加入协作人', () => {
  const record = newRequest('生产环境安装', 'c1', '销售', 'p1');
  record.businessImpact = '生产环境';
  assert.equal(record.contactId, '');
  assert.deepEqual(record.externalCollaborators, []);
  assert.equal(requestCreationIssue(record, { ...refs, contacts: [] }), null);
  assert.equal(requestCreationIssue(record, { ...refs, customers: [] }), '请选择有效且已启用的客户。');
});
test('移除业务影响后新建不再写入，空白和历史值都不阻止创建或提交', () => {
  const fresh = newRequest('申请', 'c1', '销售');
  assert.equal(Object.hasOwn(fresh, 'businessImpact'), false);
  const record = completeRequest();
  for (const businessImpact of ['', undefined, '其他环境', '生产环境']) {
    assert.equal(requestCreationIssue({ ...fresh, businessImpact }, refs), null);
    assert.deepEqual(requestIssues({ ...record, businessImpact }, refs), []);
  }
  const legacy = { ...record, businessImpact: '测试环境' };
  assert.equal(normalizeStoredRequest(legacy).businessImpact, '测试环境');
});
test('联系人统一展示姓名、手机号和邮箱，缺失时不伪造联系方式', () => {
  const contact = {
    ...refs.contacts[0],
    phone: ' 138 0013 8000 ',
    email: ' contact@example.com ',
  };
  assert.deepEqual(contactDisplay(contact), {
    name: contact.name,
    phone: '138 0013 8000',
    email: 'contact@example.com',
    inactive: false,
  });
  assert.equal(contactDisplay({ ...contact, email: ' ' }).email, '未填写');
  assert.equal(contactDisplay(refs.contacts[0]).phone, '未填写');
  assert.equal(contactDisplay({ ...contact, status: '停用' }).inactive, true);
  const saved = reconcileExternalCollaborators([contact]);
  assert.equal(saved[0].contactId, contact.id);
});
test('客户协作人按联系人编号去重并保存联系方式快照', () => {
  const contact = {
    id: 'p2',
    name: '外部联系人',
    customerId: 'c1',
    phone: '13800138000',
    email: 'external@example.com',
    status: '启用',
  };
  assert.deepEqual(reconcileExternalCollaborators([contact, contact]), [
    {
      contactId: 'p2',
      name: '外部联系人',
      phone: '13800138000',
      email: 'external@example.com',
    },
  ]);
});
test('内部协作人按用户去重，只保存用户编号和姓名，空列表格式有效', () => {
  const users = [
    {
      id: 'u1',
      name: '同名用户',
      email: 'one@example.com',
      department: '销售',
      status: '启用',
    },
    {
      id: 'u2',
      name: '同名用户',
      email: 'two@example.com',
      department: '售前',
      status: '启用',
    },
  ];
  const first = reconcileParticipants([users[0], users[0]]);
  assert.equal(first.length, 1);
  assert.deepEqual(first[0], { userId: 'u1', name: '同名用户' });
  const both = reconcileParticipants(users);
  assert.deepEqual(reconcileParticipants([users[1]]), [both[1]]);
  assert.deepEqual(reconcileParticipants([]), []);
  const record = { ...completeRequest(), internalParticipants: both };
  assert.deepEqual(structuredClone(record).internalParticipants, both);
  assert.equal(requestIdentityIssue(record), null);
  assert.equal(first.length, 1);
});
test('内部协作人无需角色，兼容旧角色字段，拒绝重复或无效用户', () => {
  assert.equal(
    requestParticipantsIssue([{ userId: 'u1', name: '用户' }]),
    null,
  );
  assert.equal(
    requestParticipantsIssue([{ userId: 'u1', name: '用户', role: '销售' }]),
    null,
  );
  const duplicate = Array.from({ length: 2 }, () => ({
    userId: 'u1',
    name: '用户',
  }));
  assert.equal(requestParticipantsIssue(duplicate), '内部协作人不能重复。');
  assert.ok(requestParticipantsIssue([{ userId: '', name: '用户' }]));
  assert.ok(
    requestIdentityIssue({
      ...completeRequest(),
      internalParticipants: duplicate,
    }),
  );
  assert.equal(requestParticipantsIssue(), null);
});
test('创建人及创建时间固定，保存和提交可更新对应时间，兼容历史创建人', () => {
  const original = completeRequest();
  assert.equal(original.createdBy, '销售');
  assert.equal(original.externalCollaborators[0].contactId, 'p1');
  assert.equal(original.internalParticipants[0].userId, 'sales');
  const saved = { ...original, updatedAt: '2026-09-09T02:00:00.000Z' };
  assert.equal(requestIdentityIssue(saved, original), null);
  const submitted = {
    ...saved,
    status: '待评估',
    submittedAt: '2026-09-09T03:00:00.000Z',
  };
  assert.equal(requestIdentityIssue(submitted, saved, { id: 'sales', role: 'SmartX 销售经理' }), null);
  assert.equal(submitted.createdAt, original.createdAt);
  assert.equal(submitted.createdBy, original.createdBy);
  assert.ok(
    requestIdentityIssue({ ...original, createdBy: '其他人' }, original),
  );
  assert.ok(
    requestIdentityIssue({ ...original, createdAt: saved.updatedAt }, original),
  );
  const legacy = { ...original };
  delete legacy.createdBy;
  delete legacy.internalParticipants;
  assert.equal(
    requestIdentityIssue({ ...legacy, title: '补充历史申请' }, legacy),
    null,
  );
  assert.equal(legacy.createdBy ?? legacy.owner, '销售');
});
test('历史缺少联系人的草稿仍能保存，不强行迁移或锁定联系人', () => {
  const legacy = { ...completeRequest(), contactId: '' };
  assert.equal(requestIdentityIssue(legacy, legacy), null);
  assert.equal(
    requestIdentityIssue({ ...legacy, contactId: 'p1' }, legacy),
    null,
  );
});
test('创建后客户不可变，保存其他字段不改变客户或关联信息', () => {
  const original = completeRequest();
  assert.equal(
    requestIdentityIssue({ ...original, customerId: 'c2' }, original),
    '服务请求创建后不支持修改客户。',
  );
  assert.equal(
    requestIdentityIssue({ ...original, customerId: '' }, original),
    '服务请求创建后不支持修改客户。',
  );
  assert.equal(
    requestIdentityIssue({ ...original, title: '修改名称' }, original),
    null,
  );
  const legacy = { ...original, customerId: '' };
  assert.equal(
    requestIdentityIssue({ ...legacy, customerId: 'c1' }, legacy),
    '服务请求创建后不支持修改客户。',
  );
});
test('安装类默认要求授权版本和正整数节点数，不要求版本号', () => {
  const item = newItem(installation, defaultConfig(installation));
  assert.ok(itemIssues(item).includes('授权版本'));
  assert.ok(!itemIssues(item).includes('版本号'));
  for (const invalid of [
    '',
    '0',
    '-2',
    '1.5',
    'Infinity',
    '9007199254740992',
  ]) {
    item.values.nodes = invalid;
    assert.ok(itemIssues(item).includes('节点数（正整数）'), invalid);
  }
});
test('非安装服务不需要通用数量或安装参数', () => {
  const item = completeItem(inspection);
  item.values = { edition: '', version: '', nodes: '' };
  assert.deepEqual(itemIssues(item), []);
});
test('业务对象允许零个、同客户多个，拒绝跨客户对象', () => {
  const request = completeRequest();
  request.items[0].config.basicFields.businessObjects.enabled = true;
  assert.deepEqual(requestIssues(request, refs), []);
  request.items[0].businessObjectIds = ['o1', 'o2'];
  assert.deepEqual(requestIssues(request, refs), []);
  request.items[0].businessObjectIds = ['o3'];
  assert.ok(
    requestIssues(request, refs).some((s) => s.includes('不属于当前客户')),
  );
});
test('业务对象未配置或取消勾选时隐藏，隐藏字段不参与必填和关联校验', () => {
  const item = completeItem();
  assert.equal(businessObjectsEnabled(item.config), false);
  delete item.config.basicFields;
  assert.equal(businessObjectsEnabled(item.config), false);
  item.config.basicFields = {
    businessObjects: { enabled: false, required: true },
  };
  item.config.fields.push('businessObjects');
  assert.equal(businessObjectsEnabled(item.config), false);
  assert.deepEqual(itemBasicIssues(item), []);
  item.businessObjectIds = ['no-longer-valid'];
  assert.deepEqual(requestIssues(completeRequest([item]), refs), []);
  const normalized = normalizeRequestConfig(item.config);
  assert.equal(businessObjectsEnabled(normalized), false);
  assert.ok(!normalized.fields.includes('businessObjects'));
});
test('勾选业务对象后显示，必填与选填规则分别生效', () => {
  const item = completeItem();
  item.config.basicFields.businessObjects = { enabled: true, required: true };
  assert.equal(businessObjectsEnabled(item.config), true);
  assert.ok(itemBasicIssues(item).includes('业务对象'));
  item.businessObjectIds = ['o1'];
  assert.deepEqual(requestIssues(completeRequest([item]), refs), []);
  item.config.basicFields.businessObjects.required = false;
  item.businessObjectIds = [];
  assert.deepEqual(itemBasicIssues(item), []);
});
test('旧字段列表勾选迁移为业务对象配置，不生成重复通用字段', () => {
  const config = defaultConfig(installation);
  delete config.basicFields;
  config.fields.push('businessObjects');
  const item = newItem(installation, config);
  assert.equal(businessObjectsEnabled(item.config), true);
  assert.ok(!item.config.fields.includes('businessObjects'));
  assert.ok(!Object.hasOwn(item.values, 'businessObjects'));
  assert.ok(config.fields.includes('businessObjects'));
});
test('支持一个、多个以及重复目录申请项，不再固定两个', () => {
  for (const count of [1, 2, 5]) {
    const request = completeRequest(
      Array.from({ length: count }, () => completeItem()),
    );
    assert.deepEqual(requestIssues(request, refs), []);
    assert.equal(new Set(request.items.map((i) => i.id)).size, count);
  }
});
test('必填材料保存文件后即可提交，不再依赖填写确认，兼容历史未勾选记录', () => {
  const item = completeItem();
  item.materials = [];
  assert.ok(itemIssues(item).some((s) => s.startsWith('上传')));
  item.materials = [
    {
      requirementId: 'requirements',
      versions: [storedFile(new File(['已填写'], '材料.docx'))],
      completed: false,
    },
  ];
  assert.deepEqual(itemIssues(item), []);
  assert.deepEqual(requestIssues(completeRequest([item]), refs), []);
  delete item.materials[0].completed;
  assert.deepEqual(itemIssues(item), []);
});
test('旧版本全部保留为独立文件，转换保存保留真实字节且不再写版本字段', async () => {
  const first = storedFile(new File(['第一份材料'], '材料.txt'));
  const second = storedFile(new File(['第二份材料'], '材料.txt'));
  const legacy = { requirementId: 'requirements', versions: [first, second] };
  const migrated = withMaterialFiles(legacy, materialFiles(legacy));
  assert.equal('versions' in migrated, false);
  assert.deepEqual(
    materialFiles(migrated).map((file) => file.id),
    [first.id, second.id],
  );
  assert.deepEqual(
    await Promise.all(
      structuredClone(migrated).files.map((file) => file.blob.text()),
    ),
    ['第一份材料', '第二份材料'],
  );
  assert.equal(legacy.versions.length, 2);
});
test('同名上传及在线新建均新增独立文件，只有明确选中编辑的文件才修改', async () => {
  const first = storedFile(new File(['上传一'], '材料.txt'));
  const second = storedFile(new File(['上传二'], '材料.txt'));
  const online = {
    ...storedFile(new File(['正文'], '材料.txt')),
    onlineDocument: { title: '材料', content: '正文', source: 'blank' },
  };
  let material = { requirementId: 'requirements', files: [] };
  for (const file of [first, second, online])
    material = saveMaterialFile(material, file);
  assert.equal(material.files.length, 3);
  assert.equal(new Set(material.files.map((file) => file.id)).size, 3);
  const edited = {
    ...storedFile(new File(['编辑后'], '材料.txt')),
    onlineDocument: { ...online.onlineDocument, content: '编辑后' },
  };
  const saved = saveMaterialFile(material, edited, online.id);
  assert.equal(saved.files.length, 3);
  assert.equal(saved.files[2].id, online.id);
  assert.deepEqual(
    await Promise.all(saved.files.map((file) => file.blob.text())),
    ['上传一', '上传二', '编辑后'],
  );
  assert.throws(() => saveMaterialFile(material, edited, 'missing'), /不存在/);
});
test('按文件标识删除不影响同名文件，删除最后一份必填材料后阻止提交', () => {
  const item = completeItem();
  const first = storedFile(new File(['一'], '同名.txt'));
  const second = storedFile(new File(['二'], '同名.txt'));
  const original = { requirementId: 'requirements', versions: [first, second] };
  item.materials = [removeMaterialFile(original, first.id)];
  assert.deepEqual(
    materialFiles(item.materials[0]).map((file) => file.id),
    [second.id],
  );
  assert.deepEqual(itemIssues(item), []);
  assert.equal(original.versions.length, 2);
  item.materials = [removeMaterialFile(item.materials[0], second.id)];
  assert.ok(itemIssues(item).some((issue) => issue.startsWith('上传')));
  assert.ok(requestIssues(completeRequest([item]), refs).length > 0);
  assert.deepEqual(materialFiles({ ...original, files: [] }), []);
});
test('选填材料未上传不阻止提交', () => {
  const item = completeItem();
  item.config.materials[0].required = false;
  item.materials = [];
  assert.deepEqual(itemIssues(item), []);
});
test('配置快照独立于目录后续修改', () => {
  const config = defaultConfig(installation);
  const item = newItem(installation, config);
  config.fields = [];
  config.materials[0].name = '新模板';
  assert.deepEqual(item.config.fields, ['edition', 'nodes']);
  assert.equal(item.config.materials[0].name, '售前向交付移交材料');
});
test('选项子集只保存在当前目录配置并随申请项形成快照', () => {
  const firstConfig = defaultConfig(installation);
  firstConfig.fieldOptions = { edition: ['企业版'] };
  const secondConfig = defaultConfig({ ...installation, id: 'SC-IMP-002' });
  secondConfig.fieldOptions = { edition: ['基础版', '标准版'] };
  const item = newItem(installation, firstConfig);
  firstConfig.fieldOptions.edition.push('标准版');
  assert.deepEqual(item.config.fieldOptions.edition, ['企业版']);
  assert.deepEqual(secondConfig.fieldOptions.edition, ['基础版', '标准版']);
});
test('上传保存真实字节，克隆后仍可读取', async () => {
  const file = storedFile(new File(['环境说明：三个节点'], '环境说明.txt'));
  const cloned = structuredClone(file);
  assert.equal(await cloned.blob.text(), '环境说明：三个节点');
  assert.equal(cloned.name, '环境说明.txt');
});
test('拒绝空文件、超限文件和不支持的类型', () => {
  assert.ok(checkFile(new File([], '空.docx')));
  assert.ok(
    checkFile(new File([new Uint8Array(20 * 1024 * 1024 + 1)], '大.pdf')),
  );
  assert.ok(checkFile(new File(['x'], '执行.exe')));
  assert.equal(checkFile(new File(['x'], '材料.DOCX')), null);
});
test('停用目录、失效联系人或无效服务方式不能提交', () => {
  const request = completeRequest();
  request.externalCollaborators = [{ contactId: 'other-contact' }];
  assert.ok(requestIssues(request, refs).some((s) => s.includes('联系人')));
  request.externalCollaborators = [{ contactId: 'p1' }];
  request.items[0].method = '不支持';
  assert.ok(requestIssues(request, refs).some((s) => s.includes('服务方式')));
  request.items[0].method = '现场';
  assert.ok(
    requestIssues(request, { ...refs, services: [] }).some((s) =>
      s.includes('停用或不存在'),
    ),
  );
});

test('申请说明选填，内部与客户申请均可留空，其他必填校验保留', () => {
  for (const audience of ['internal', 'customer']) {
    for (const description of ['', '   ']) {
      const currentActor = { id: 'p1', name: '客户', role: '客户' };
      const request = attributeRequestMaterials({ ...completeRequest(), description }, undefined, currentActor);
      assert.deepEqual(requestIssues(request, { ...refs, audience, currentActor }), []);
      assert.ok(requestIssues({ ...request, title: '' }, { ...refs, audience, currentActor }).includes('填写申请主题'));
    }
  }
});

test('项目拆分卡片展示配置字段和业务对象，排除需求说明，格式化多选', async () => {
  const { itemDisplayFields } = await import('./service-requests.ts');
  const item = {
    method: '远程', description: '不应展示的需求说明', businessObjectIds: ['object1'],
    config: { fields: ['edition', 'version', 'nodes', 'custom', 'description', 'businessObjects'], fieldNames: { custom: '部署区域' } },
    values: { edition: '["企业版","标准版"]', version: '5.0.3', nodes: '0', custom: '华北', description: '不应展示', hidden: '未配置字段' },
  };
  const fields = itemDisplayFields(item, {}, [{ id: 'object1', name: '生产集群' }]);
  assert.deepEqual(fields.map(field => field.key), ['method', 'edition', 'version', 'nodes', 'custom', 'businessObjects']);
  assert.equal(fields.find(field => field.key === 'edition').value, '企业版、标准版');
  assert.equal(fields.find(field => field.key === 'nodes').value, '0');
  assert.equal(fields.find(field => field.key === 'custom').label, '部署区域');
  assert.equal(fields.find(field => field.key === 'businessObjects').value, '生产集群');
  assert.equal(itemDisplayFields({ ...item, values: {} })[1].value, '未填写');
});


test('legacy converted requests keep their data and completed progress after status rename', () => {
  const legacy = { ...newRequest('旧请求', 'c1', '项目经理'), status: '已转工单', operations: { activities: [{ title: '创建服务项目' }] } };
  const normalized = normalizeStoredRequest(legacy);
  assert.equal(normalized.status, '已转服务项目');
  assert.deepEqual(normalized, { ...legacy, status: '已转服务项目' });
  assert.equal(legacy.status, '已转工单');
  assert.equal(normalized.operations, legacy.operations);
  assert.equal(requestStatusTone(normalized.status), 'green');
  assert.deepEqual(requestProgressSteps(normalized.status).map(step => step.state), ['complete', 'complete', 'complete', 'complete', 'current']);
  assert.equal(normalizeStoredRequest(normalized), normalized);
  for (const status of requestStatuses) {
    const record = { ...normalized, status };
    assert.equal(normalizeStoredRequest(record), record);
  }
});


test('当前客户所有人已在内部协作人中时不可移除，其他成员仍可移除', () => {
  const owner = { userId: 'owner', name: '客户所有人' };
  const other = { userId: 'other', name: '协作人' };
  const customers = [{ id: 'customer', ownerUserId: owner.userId }];
  for (const status of requestStatuses) {
    const before = { ...newRequest('请求', 'customer', '发起人'), status, internalParticipants: [owner, other] };
    assert.match(customerOwnerRemovalIssue({ ...before, internalParticipants: [other] }, before, customers), /不允许移除/);
    assert.match(customerOwnerRemovalIssue({ ...before, internalParticipants: undefined }, before, customers), /不允许移除/);
    assert.equal(customerOwnerRemovalIssue({ ...before, internalParticipants: [owner] }, before, customers), null);
    assert.equal(customerOwnerRemovalIssue(before, before, customers), null);
    // 读取当前客户资料，不以旧所有人或其他客户的所有人锁定成员。
    assert.equal(customerOwnerRemovalIssue({ ...before, internalParticipants: [other] }, before, [{ id: 'customer', ownerUserId: other.userId }]), null);
    assert.equal(customerOwnerRemovalIssue({ ...before, internalParticipants: [] }, before, [{ id: 'another', ownerUserId: owner.userId }]), null);
  }
  const legacy = { ...newRequest('旧请求', 'customer', '发起人'), internalParticipants: [other] };
  assert.equal(customerOwnerRemovalIssue(legacy, legacy, customers), null);
});


test('旧联系人字段不再自动添加或固定，客户申请人自动加入且不可移除', () => {
  const contacts = [{ id: 'contact', name: '客户', customerId: 'customer', status: '启用', phone: '123', email: 'a@example.com' }];
  const internal = newRequest('请求', 'customer', '销售', 'contact', 'sales', 'SmartX 销售经理');
  assert.deepEqual(withRequestContact(internal, contacts).externalCollaborators, []);
  const customer = newRequest('请求', 'customer', '客户', '', 'contact', '客户');
  const record = withRequestContact(customer, contacts);
  assert.equal(record.externalCollaborators[0].contactId, 'contact');
  assert.deepEqual(withRequestContact(record, contacts), record);
  assert.match(requestContactRemovalIssue({ ...record, externalCollaborators: [] }, record), /不允许移除/);
  assert.equal(requestContactRemovalIssue(record, record), null);
});

test('材料按申请来源整体可见，文件来源保留且查看权限不扩大编辑权限', () => {
  const customer = { id: 'c1', name: '客户甲', role: '客户' };
  const other = { id: 'c2', name: '客户乙', role: '客户' };
  const pm = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
  const file = name => storedFile(new File([name], name));
  const mine = attributeMaterialFile(file('我的文件'), customer);
  const theirs = attributeMaterialFile(file('其他客户文件'), other);
  const internal = attributeMaterialFile({ ...file('内部在线文档'), onlineDocument: { title: '内部', content: '内部正文', source: 'blank' } }, pm);
  const legacy = file('无上传人记录的旧文件');
  const material = { requirementId: 'requirements', files: [mine, theirs, internal, legacy] };
  const item = { ...newItem(installation, defaultConfig(installation)), materials: [material] };
  const record = { ...newRequest('请求', '客户', '客户甲', '', 'c1', '客户'), items: [item] };
  assert.deepEqual(requestMaterialFiles(record, material, 'customer'), [mine, theirs, internal, legacy]);
  assert.deepEqual(requestMaterialFiles({ ...record, createdByAudience: 'internal' }, material, 'customer'), []);
  assert.equal(requestMaterialFiles(record, material).length, 4);
  const added = attributeMaterialFile(file('新增文件'), customer);
  const next = structuredClone(record);
  next.items[0].materials[0].files.push(added);
  assert.equal(customerMaterialSaveIssue(next, record, customer), null);
  const saved = attributeRequestMaterials(next, record, customer);
  assert.equal(saved.items[0].materials[0].files.length, 5);
  assert.equal(saved.items[0].materials[0].files[2], internal);
  const deletedHidden = structuredClone(next);
  deletedHidden.items[0].materials[0].files = [mine, added];
  assert.match(customerMaterialSaveIssue(deletedHidden, record, customer), /只能修改自己上传/);
  const forged = structuredClone(next);
  forged.items[0].materials[0].files[2].uploadedById = customer.id;
  forged.items[0].materials[0].files[2].uploaderAudience = 'customer';
  assert.match(customerMaterialSaveIssue(forged, record, customer), /只能修改自己上传/);
  const deletedMine = structuredClone(next);
  deletedMine.items[0].materials[0].files = deletedMine.items[0].materials[0].files.filter(entry => entry.id !== mine.id);
  assert.equal(customerMaterialSaveIssue(deletedMine, record, customer), null);
  // 新上传文件的归属由保存身份确定，不能伪装为另一客户。
  added.uploadedById = other.id;
  const assigned = attributeRequestMaterials({ ...record, items: [{ ...item, materials: [{ ...material, files: [...material.files, added] }] }] }, record, customer);
  assert.equal(assigned.items[0].materials[0].files.at(-1).uploadedById, customer.id);
});

test('摘要包含新增字段、业务对象和完整地址，排除需求说明并标记地址独立成行', async () => {
  const { itemSummaryFields } = await import('./service-requests.ts');
  const item = newItem(installation, defaultConfig(installation));
  item.description = '仅在悬停时查看';
  item.values = { productForm: '一体机', tibCount: '0', clusterCount: '2', instanceCount: '8', expectedProvider: '合作伙伴甲', description: '不在摘要直接显示', address: JSON.stringify({kind:'address', province:'浙江省',city:'杭州市',detail:'文三路 100 号'}) };
  item.businessObjectIds = ['obj-1'];
  const fields = itemSummaryFields(item, {}, [{id:'obj-1',name:'生产集群'}]);
  assert.equal(fields.find(field => field.key === 'tibCount').value, '0');
  assert.equal(fields.find(field => field.key === 'businessObjects').value, '生产集群');
  assert.equal(fields.find(field => field.key === 'address').value, '浙江省 杭州市 文三路 100 号');
  assert.equal(fields.find(field => field.key === 'address').address, true);
  assert.ok(!fields.some(field => field.key === 'description'));
  assert.equal(fields.find(field => field.key === 'productForm').value, '一体机');
});

test('地址支持必填、选填及现场时显示且必填，切换方式同步控制表单、摘要和校验', async () => {
  const { requestFieldIsRequired, requestFieldIsVisible, itemSummaryFields, itemDisplayFields } = await import('./service-requests.ts');
  const item = newItem(installation, defaultConfig(installation));
  item.description = '部署';
  item.config.fields = ['address'];
  item.config.fieldNames.address = '地址';
  item.methods = ['远程', '现场'];
  item.method = '远程';
  item.values = { address: '' };
  item.config.fieldRequired = { address: true };
  assert.equal(requestFieldIsVisible(item.config, 'address', '远程'), true);
  assert.ok(itemBasicIssues(item).includes('地址'));
  item.config.fieldRequired.address = false;
  assert.equal(requestFieldIsVisible(item.config, 'address', '远程'), true);
  assert.ok(!itemBasicIssues(item).includes('地址'));
  item.config.fieldRequiredWhen = { address: 'onsite' };
  assert.equal(requestFieldIsRequired(item.config, 'address', '远程'), false);
  assert.equal(requestFieldIsVisible(item.config, 'address', '远程'), false);
  assert.equal(requestFieldIsVisible(item.config, 'address', ''), false);
  assert.equal(requestFieldIsVisible(item.config, 'address', '["远程"]'), false);
  assert.ok(!itemBasicIssues(item).includes('地址'));
  item.method = '现场';
  assert.equal(requestFieldIsRequired(item.config, 'address', '现场'), true);
  assert.equal(requestFieldIsVisible(item.config, 'address', '现场'), true);
  assert.ok(itemBasicIssues(item).includes('地址'));
  assert.equal(requestFieldIsRequired(item.config, 'address', '["远程","现场"]'), true);
  assert.equal(requestFieldIsVisible(item.config, 'address', '["远程","现场"]'), true);
  item.values.address = JSON.stringify({ kind: 'address', province: '', city: '', detail: '软件园 A 座' });
  assert.deepEqual(itemBasicIssues(item), []);
  assert.ok(itemSummaryFields(item).some(field => field.key === 'address'));
  assert.ok(itemDisplayFields(item).some(field => field.key === 'address'));
  item.method = '远程';
  assert.ok(!itemSummaryFields(item).some(field => field.key === 'address'));
  assert.ok(!itemDisplayFields(item).some(field => field.key === 'address'));
  // A partially filled onsite address must not block saving after switching to remote.
  item.values.address = JSON.stringify({ kind: 'address', province: '北京市', city: '', detail: '' });
  assert.deepEqual(itemBasicIssues(item), []);
  item.method = '现场';
  assert.ok(itemBasicIssues(item).some(issue => issue.includes('详细地址')));
  const snapshot = newItem(installation, item.config);
  item.config.fieldRequiredWhen = {};
  assert.equal(snapshot.config.fieldRequiredWhen.address, 'onsite');
  assert.equal(requestFieldIsRequired({ ...item.config, fieldRequired: {} }, 'address', '远程'), true);
});
