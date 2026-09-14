import test from 'node:test';
import assert from 'node:assert/strict';
import { requestFormSections, requestFieldPlacements, setRequestFieldPlacement } from './request-form-layout.ts';
import { newItem, requestFieldIsVisible } from './service-requests.ts';

const base = () => ({
  serviceId: 's1', revision: 1,
  fields: ['edition', 'address', 'installSks'],
  fieldOrder: ['method', 'description', 'edition', 'address', 'installSks'],
  fieldWidths: { description: 'half' },
  fieldNames: {}, fieldOptions: {}, materials: [],
  basicFields: { description: { enabled: true, required: false }, businessObjects: { enabled: false, required: false } },
});

test('左右列独立保存字段序列，可一侧一项另一侧多项，不生成占位字段', () => {
  const config = { ...base(), fieldColumns: { method: 'right', description: 'left', edition: 'right', address: 'right', installSks: 'right' } };
  const sections = requestFormSections(config);
  assert.deepEqual(sections, [{ kind: 'columns', key: 'start', left: ['description'], right: ['method', 'edition', 'address', 'installSks'] }]);
  assert.deepEqual(requestFormSections({ ...config, fieldColumns: Object.fromEntries(config.fieldOrder.map(id => [id, 'right'])) })[0].left, []);
});

test('调整某字段所在列或宽度，不改变其他字段的已有位置，也不修改传入配置', () => {
  const config = base();
  const before = structuredClone(config);
  const placements = requestFieldPlacements(config);
  const next = setRequestFieldPlacement(config, 'method', 'right');
  assert.deepEqual(config, before);
  assert.equal(next.fieldWidths.method, 'half');
  for (const id of config.fieldOrder.filter(id => id !== 'method'))
    assert.equal(requestFieldPlacements(next)[id], placements[id]);
  const full = setRequestFieldPlacement(next, 'description', 'full');
  assert.equal(requestFieldPlacements(full).description, 'full');
  for (const id of config.fieldOrder.filter(id => id !== 'description' && id !== 'method'))
    assert.equal(requestFieldPlacements(full)[id], placements[id]);
});

test('整行字段分隔两列区段，字段拖入区段末尾时保留下一整行位置', () => {
  const config = { ...base(), fieldWidths: { address: 'full', description: 'half' }, fieldColumns: { method: 'left', description: 'left', edition: 'right', installSks: 'right' } };
  assert.deepEqual(requestFormSections(config), [
    { kind: 'columns', key: 'start', left: ['method', 'description'], right: ['edition'], before: 'address' },
    { kind: 'full', key: 'full:address', field: 'address' },
    { kind: 'columns', key: 'after:address', left: [], right: ['installSks'] },
  ]);
});

test('隐藏地址和版本条件字段收起，隐藏整行不保留分隔或空行，剩余字段列不变', () => {
  const config = {
    ...base(),
    fieldWidths: { description: 'half', address: 'full' },
    fieldColumns: { method: 'left', description: 'left', edition: 'right', installSks: 'right' },
    fieldRequiredWhen: { address: 'onsite', installSks: 'enterprise' },
  };
  const visible = config.fieldOrder.filter(id => requestFieldIsVisible(config, id, '远程', { edition: '标准版' }));
  assert.deepEqual(requestFormSections(config, visible), [
    { kind: 'columns', key: 'start', left: ['method', 'description'], right: ['edition'] },
  ]);
  assert.deepEqual(requestFormSections(config, []), []);
});

test('旧半宽、全宽和另起一行配置可推导列位置，新布局随申请项快照独立保存', () => {
  const config = { ...base(), fieldRowStarts: ['description'] };
  assert.equal(requestFieldPlacements(config).description, 'left');
  assert.equal(requestFieldPlacements(config).edition, 'right');
  const saved = setRequestFieldPlacement(config, 'address', 'right');
  const item = newItem({ id: 's1', name: '服务', category: '产品实施交付', deliveryMethods: ['现场'], priceUnit: '人天', status: '已启用' }, saved);
  const snapshot = structuredClone(item.config);
  saved.fieldColumns.address = 'left';
  assert.equal(item.config.fieldColumns.address, 'right');
  assert.deepEqual(requestFormSections(item.config), requestFormSections(snapshot));
});
