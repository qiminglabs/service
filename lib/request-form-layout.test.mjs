import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFormLayoutFields, requestFieldGridColumn, requestFieldWidth, moveRequestFormField } from './request-form-layout.ts';
import { requestFieldIsVisible } from './service-requests.ts';

const base = () => ({
  serviceId: 's1', revision: 1,
  fields: ['edition', 'address', 'installSks'],
  fieldOrder: ['method', 'description', 'edition', 'address', 'installSks'],
  fieldWidths: { description: 'half' },
  fieldNames: {}, fieldOptions: {}, materials: [],
  basicFields: { description: { enabled: true, required: false }, businessObjects: { enabled: false, required: false } },
});

test('拖到紧邻字段可向前或向后移动，拖回自身不修改顺序', () => {
  const order = ['method', 'edition', 'address'];
  assert.deepEqual(moveRequestFormField(order, 'method', 'edition'), ['edition', 'method', 'address']);
  assert.deepEqual(moveRequestFormField(order, 'edition', 'method'), ['edition', 'method', 'address']);
  assert.equal(moveRequestFormField(order, 'edition', 'edition'), order);
  assert.deepEqual(order, ['method', 'edition', 'address']);
});

test('跨多个字段拖动、拖到末尾及从字段库新增，不丢失或重复字段', () => {
  const order = ['method', 'edition', 'description', 'address'];
  assert.deepEqual(moveRequestFormField(order, 'method', 'description'), ['edition', 'description', 'method', 'address']);
  assert.deepEqual(moveRequestFormField(order, 'address', 'method'), ['address', 'method', 'edition', 'description']);
  assert.deepEqual(moveRequestFormField(order, 'edition'), ['method', 'description', 'address', 'edition']);
  assert.deepEqual(moveRequestFormField(order, 'nodes', 'description'), ['method', 'edition', 'nodes', 'description', 'address']);
  assert.deepEqual(moveRequestFormField(order, 'nodes'), [...order, 'nodes']);
});

test('旧左右列配置不再固定位置，所有半行字段按表单顺序自动排列', () => {
  const config = { ...base(), fieldColumns: { method: 'right', description: 'left', edition: 'right', address: 'right', installSks: 'right' } };
  const before = structuredClone(config);
  assert.deepEqual(requestFormLayoutFields(config), config.fieldOrder.map(id => ({ id, gridColumn: 'span 1' })));
  assert.deepEqual(requestFormLayoutFields(config), requestFormLayoutFields(base()));
  assert.deepEqual(config, before);
});

test('整行宽度和已有另起一行规则保留，左右独立排列不再生效', () => {
  const config = { ...base(), fieldWidths: { description: 'full', address: 'half' }, fieldColumns: { description: 'right', address: 'right' }, fieldRowStarts: ['address'] };
  assert.equal(requestFieldWidth(config, 'description'), 'full');
  assert.equal(requestFieldGridColumn(config, 'description'), '1 / -1');
  assert.equal(requestFieldGridColumn(config, 'address'), '1 / span 1');
  assert.equal(requestFieldGridColumn(config, 'installSks'), 'span 1');
});

test('隐藏条件字段和历史地址不占位置，其余字段按可见顺序自动填充', () => {
  const config = { ...base(), fieldWidths: { description: 'half', address: 'full' }, fieldRequiredWhen: { address: 'onsite', installSks: 'enterprise' } };
  const visible = config.fieldOrder.filter(id => requestFieldIsVisible(config, id, '远程', { edition: '标准版' }));
  assert.deepEqual(requestFormLayoutFields(config, visible), ['method', 'description', 'edition'].map(id => ({ id, gridColumn: 'span 1' })));
  assert.deepEqual(requestFormLayoutFields(config, []), []);
});

test('字段拖动只改变顺序，旧指定列不会在重新排序后留下空列', () => {
  const config = { ...base(), fieldColumns: { installSks: 'right' }, fieldOrder: ['installSks', 'method', 'description', 'edition', 'address'] };
  assert.deepEqual(requestFormLayoutFields(config).map(field => field.id), config.fieldOrder);
  assert.equal(requestFormLayoutFields(config)[0].gridColumn, 'span 1');
});
