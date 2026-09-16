import test from 'node:test';
import assert from 'node:assert/strict';
import { initialApplicationFields, isSystemApplicationField, normalizeApplicationFields } from './request-application-fields.ts';
import { backendSettingsSections } from './backend-settings.ts';
import { newRequest, newItem, defaultConfig, normalizeStoredRequest, normalizeCatalogRequestConfig, requestIdentityIssue, clearHiddenRequestFields, requestFieldIsVisible, requestFieldIsRequired, itemDisplayFields, itemSummaryFields } from './service-requests.ts';

test('旧配置导入五个申请基础字段，保留客户关联格式', () => {
  const fields = normalizeApplicationFields();
  assert.deepEqual(fields.map(field => [field.id, field.name, field.type]), [
    ['title', '申请主题', 'text'], ['requestType', '申请类型', 'single'], ['customerId', '客户', 'lookup'],
    ['expectedServiceDate', '期望服务日期', 'date'], ['description', '申请说明', 'textarea'],
  ]);
  assert.equal(fields.find(field => field.id === 'customerId').referenceTarget, 'customers');
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
  assert.equal(fields.length, 6);
  assert.deepEqual(fields.find(field => field.id === 'description'), { ...stored[0], type: 'textarea', referenceTarget: undefined });
  assert.deepEqual(fields.at(-1), stored[1]);
  assert.deepEqual(normalizeApplicationFields(fields), fields);
  fields.at(-1).options[0].value = '改名';
  fields[0].name = '改名';
  assert.deepEqual(stored, before);
  assert.equal(initialApplicationFields[0].name, '申请主题');
});

test('服务请求字段同时提供服务项字段与服务申请字段页签', () => {
  const forms = backendSettingsSections.find(section => section.key === 'forms');
  assert.equal(forms.label, '服务请求字段');
  assert.deepEqual(forms.tabs.map(tab => tab.label), ['服务项字段', '服务申请字段']);
});
