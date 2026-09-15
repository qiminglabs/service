import test from 'node:test';
import assert from 'node:assert/strict';
import { initialApplicationFields, isSystemApplicationField, normalizeApplicationFields } from './request-application-fields.ts';
import { backendSettingsSections } from './backend-settings.ts';
import { newRequest, newItem, defaultConfig, normalizeStoredRequest, normalizeCatalogRequestConfig, requestIdentityIssue, clearHiddenRequestFields, requestFieldIsVisible, requestFieldIsRequired, itemDisplayFields, itemSummaryFields } from './service-requests.ts';

test('旧配置导入四个申请基础字段，保留客户关联格式', () => {
  const fields = normalizeApplicationFields();
  assert.deepEqual(fields.map(field => [field.id, field.name, field.type]), [
    ['title', '申请主题', 'text'], ['customerId', '客户', 'lookup'],
    ['expectedServiceDate', '期望服务日期', 'date'], ['description', '申请说明', 'textarea'],
  ]);
  assert.equal(fields[1].referenceTarget, 'customers');
  assert.equal(isSystemApplicationField('description'), true);
  assert.equal(isSystemApplicationField('edition'), false);
  assert.equal(isSystemApplicationField('field-custom'), false);
  assert.deepEqual(normalizeApplicationFields(fields), fields);
});

test('重复加载保留改名、修改记录及自定义选项，补齐缺失预置且不修改输入', () => {
  const stored = [
    { id: 'description', name: '整体需求', type: 'single', options: [], updatedAt: '2026-09-14T10:00:00Z', updatedBy: '管理员' },
    { id: 'field-custom', name: '优先级', type: 'single', options: [{ value: '紧急', enabled: true }, { value: '普通', enabled: false }] },
  ];
  const before = structuredClone(stored);
  const fields = normalizeApplicationFields(stored);
  assert.equal(fields.length, 5);
  assert.deepEqual(fields.find(field => field.id === 'description'), { ...stored[0], type: 'textarea', referenceTarget: undefined });
  assert.deepEqual(fields.at(-1), stored[1]);
  assert.deepEqual(normalizeApplicationFields(fields), fields);
  fields.at(-1).options[0].value = '改名';
  fields[0].name = '改名';
  assert.deepEqual(stored, before);
  assert.equal(initialApplicationFields[0].name, '申请主题');
});

test('期望服务商从申请项字段库移除，刷新后不再导入，其他自定义字段保留', () => {
  const fields = normalizeApplicationFields([
    { id: 'expectedProvider', name: '指定服务商', type: 'lookup', referenceTarget: 'partners', options: [] },
    { id: 'custom', name: '自定义', type: 'text', options: [] },
  ]);
  assert.ok(!fields.some(field => field.id === 'expectedProvider'));
  assert.equal(isSystemApplicationField('expectedProvider'), false);
  assert.equal(fields.at(-1).id, 'custom');
  assert.deepEqual(normalizeApplicationFields(fields), fields);
});

const service = { id: 's', name: '部署', deliveryMethods: ['远程'], priceUnit: '服务人天' };
const legacyConfig = () => ({ ...defaultConfig(service), versionFieldDefaultRemoved: true,
  fields: ['expectedProvider', 'nodes'], fieldOrder: ['expectedProvider', 'nodes'],
  fieldNames: { expectedProvider: '期望服务商', nodes: '节点数' }, fieldOptions: { expectedProvider: ['伙伴A'], nodes: [] },
  fieldRequired: { expectedProvider: true }, fieldRequiredWhen: { expectedProvider: 'onsite' },
  fieldColumns: { expectedProvider: 'left' }, fieldWidths: { expectedProvider: 'half' }, fieldRowStarts: ['expectedProvider'],
});
test('当前服务表单和新建服务项移除期望服务商，旧快照保持不变', () => {
  const config = legacyConfig();
  const before = structuredClone(config);
  for (const next of [normalizeCatalogRequestConfig(config), newItem(service, config).config]) {
    assert.ok(!next.fields.includes('expectedProvider'));
    assert.ok(!next.fieldOrder.includes('expectedProvider'));
    for (const key of ['fieldNames', 'fieldOptions', 'fieldRequired', 'fieldRequiredWhen', 'fieldColumns', 'fieldWidths']) assert.equal(next[key]?.expectedProvider, undefined);
    assert.ok(!next.fieldRowStarts.includes('expectedProvider'));
  }
  assert.deepEqual(config, before);
});

test('暂时移除服务商时读取保留历史，不展示或要求填写，保存时统一清理隐藏值', () => {
  const record = newRequest('申请', 'c', '销售');
  assert.equal(record.expectedProvider, undefined);
  record.expectedProvider = '伙伴A';
  record.items = [{ ...newItem(service, defaultConfig(service)), config: legacyConfig(), values: { expectedProvider: '伙伴A', nodes: '3' } }];
  const before = structuredClone(record);
  assert.equal(normalizeStoredRequest(record), record);
  assert.equal(requestFieldIsVisible(record.items[0].config, 'expectedProvider', '现场'), false);
  assert.equal(requestFieldIsRequired(record.items[0].config, 'expectedProvider', '现场'), false);
  for (const display of [itemDisplayFields, itemSummaryFields]) assert.ok(!display(record.items[0]).some(field => field.key === 'expectedProvider'));
  const saved = clearHiddenRequestFields(record);
  assert.equal(saved.expectedProvider, undefined);
  assert.equal(saved.items[0].values.expectedProvider, undefined);
  assert.equal(saved.items[0].values.nodes, '3');
  assert.deepEqual(record, before);
});

test('期望服务商按申请基本信息权限处理，提交后禁止修改', () => {
  const actor = { id: 'USR-001', name: '销售', role: 'SmartX 销售经理' };
  const record = newRequest('申请', 'c', actor.name, '', actor.id, actor.role);
  assert.equal(requestIdentityIssue({ ...record, expectedProvider: '伙伴A' }, record, actor), null);
  const submitted = { ...record, status: '待评估' };
  assert.match(requestIdentityIssue({ ...submitted, expectedProvider: '伙伴A' }, submitted, actor), /基本信息只读/);
});

test('服务请求表单同时提供服务项字段与申请项字段页签', () => {
  const forms = backendSettingsSections.find(section => section.key === 'forms');
  assert.equal(forms.label, '服务请求表单');
  assert.deepEqual(forms.tabs.map(tab => tab.label), ['服务项字段', '申请项字段']);
});
