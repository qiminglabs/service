import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFile,
  defaultConfig,
  itemIssues,
  itemSummary,
  itemBasicIssues,
  newItem,
  newRequest,
  requestIssues,
  storedFile,
  businessObjectsEnabled,
  normalizeRequestConfig,
  requestIdentityIssue,
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
  services: [installation, inspection],
};
test('申请项摘要固定显示四个字段，空值隐藏，不显示编码或数量统计', () => {
  const item = newItem(installation, defaultConfig(installation));
  item.values = {
    edition: '企业版',
    nodes: '3',
    version: '6.3.0',
    other: '不显示',
  };
  assert.equal(
    itemSummary(item),
    '服务方式：远程 · 产品版本：企业版 · 节点数：3 · 产品版本号：6.3.0',
  );
  item.values = { edition: ' ', nodes: '', version: '6.3.0' };
  assert.equal(itemSummary(item), '服务方式：远程 · 产品版本号：6.3.0');
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
    contactId: 'p1',
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
    '产品版本号',
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

test('草稿可以不完整，提交必须有基本信息和至少一个申请项', () => {
  const draft = newRequest('', '', '客户');
  assert.equal(draft.status, '草稿');
  assert.equal(draft.items.length, 0);
  assert.ok(requestIssues(draft, refs).includes('至少添加一个申请项'));
  assert.ok(requestIssues(draft, refs).includes('选择有效客户'));
});
test('创建请求必须填写名称和客户，空白名称不能用默认名称绕过', () => {
  const request = newRequest('   ', '', '销售');
  assert.equal(request.title, '');
  assert.equal(requestIdentityIssue(request), '请填写服务请求名称。');
  request.title = '生产环境安装';
  assert.equal(requestIdentityIssue(request), '请选择客户。');
  request.customerId = 'c1';
  assert.equal(requestIdentityIssue(request), null);
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
test('安装类必须填写版本类型、版本号和正整数节点数', () => {
  const item = newItem(installation, defaultConfig(installation));
  assert.ok(itemIssues(item).includes('产品版本类型'));
  assert.ok(itemIssues(item).includes('产品版本号'));
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
  assert.equal(item.config.fields.length, 3);
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
  request.contactId = 'other-contact';
  assert.ok(requestIssues(request, refs).some((s) => s.includes('联系人')));
  request.contactId = 'p1';
  request.items[0].method = '不支持';
  assert.ok(requestIssues(request, refs).some((s) => s.includes('服务方式')));
  request.items[0].method = '现场';
  assert.ok(
    requestIssues(request, { ...refs, services: [] }).some((s) =>
      s.includes('停用或不存在'),
    ),
  );
});
