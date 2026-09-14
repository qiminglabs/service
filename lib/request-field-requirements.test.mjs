import test from 'node:test';
import assert from 'node:assert/strict';
import { editionFeatureFields, withEditionFieldDependency, fieldOptionsIssue } from './request-field-requirements.ts';
import { defaultConfig, newItem, itemBasicIssues, itemDisplayFields, itemSummaryFields, requestFieldIsVisible, requestFieldIsRequired } from './service-requests.ts';

const service = { id: 'test', name: '测试服务', category: '产品实施交付', deliveryMethods: ['远程'], status: '已启用', priceUnit: '人天' };
function config() {
  return withEditionFieldDependency({
    ...defaultConfig(service),
    basicFields: { description: { enabled: false, required: false }, businessObjects: { enabled: false, required: false } },
    fields: editionFeatureFields.map(field => field.id),
    fieldOrder: ['method', ...editionFeatureFields.map(field => field.id)],
    fieldRequiredWhen: Object.fromEntries(editionFeatureFields.map(field => [field.id, field.requirement])),
    fieldOptions: Object.fromEntries(editionFeatureFields.map(field => [field.id, ['是', '否']])),
    materials: [],
  }, ['基础版', '敏捷版', '标准版', '企业版']);
}

test('版本条件同步控制显示、必填和齐套检查，标准版两项、企业版三项', () => {
  for (const [edition, expected] of [['', []], ['基础版', []], ['敏捷版', []], ['标准版', ['trafficVisualization', 'installSfs']], ['企业版', editionFeatureFields.map(f => f.id)]]) {
    const item = newItem(service, config());
    item.values.edition = edition;
    for (const field of editionFeatureFields) {
      assert.equal(requestFieldIsVisible(item.config, field.id, item.method, item.values), expected.includes(field.id));
      assert.equal(requestFieldIsRequired(item.config, field.id, item.method, item.values), expected.includes(field.id));
    }
    const issues = itemBasicIssues(item);
    for (const field of editionFeatureFields) assert.equal(issues.includes(field.name), expected.includes(field.id));
    for (const id of expected) item.values[id] = '否';
    assert.equal(itemBasicIssues(item).length, edition ? 0 : 1);
  }
});

test('切换版本后隐藏值不出现在详情、摘要和校验，已创建快照不被新配置影响', () => {
  const template = config();
  const item = newItem(service, template);
  item.values = { edition: '企业版', trafficVisualization: '是', installSfs: '否', installSks: '是' };
  assert.ok(itemDisplayFields(item).some(field => field.key === 'installSks'));
  item.values.edition = '标准版';
  assert.ok(!itemDisplayFields(item).some(field => field.key === 'installSks'));
  assert.ok(!itemSummaryFields(item).some(field => field.key === 'installSks'));
  assert.deepEqual(itemBasicIssues(item), []);
  item.values.edition = '基础版';
  assert.deepEqual(itemBasicIssues(item), []);
  assert.ok(!itemSummaryFields(item).some(field => editionFeatureFields.some(f => f.id === field.key)));
  template.fieldRequiredWhen.installSks = 'standard-or-enterprise';
  assert.equal(item.config.fieldRequiredWhen.installSks, 'enterprise');
});

test('特殊要求可切回普通必填或选填，现场地址条件不受版本影响', () => {
  const item = newItem(service, config());
  item.values.edition = '基础版';
  delete item.config.fieldRequiredWhen.installSks;
  item.config.fieldRequired.installSks = false;
  assert.equal(requestFieldIsVisible(item.config, 'installSks', item.method, item.values), true);
  assert.equal(requestFieldIsRequired(item.config, 'installSks', item.method, item.values), false);
  item.config.fieldRequired.installSks = true;
  assert.ok(itemBasicIssues(item).includes('是否安装容器管理平台（SKS）'));
  item.config.fieldRequiredWhen.address = 'onsite';
  assert.equal(requestFieldIsVisible(item.config, 'address', '远程', item.values), false);
  assert.equal(requestFieldIsRequired(item.config, 'address', '现场', item.values), true);
});

test('条件字段自动补入必填授权版本，重复操作不重复添加并保留原选项及布局', () => {
  const initial = config();
  assert.deepEqual(initial.fieldOrder, ['method', 'edition', ...editionFeatureFields.map(field => field.id)]);
  assert.equal(initial.fieldRequired.edition, true);
  const again = withEditionFieldDependency(initial, ['不同选项']);
  assert.deepEqual(again, initial);
  const plain = { ...initial, fieldRequiredWhen: {} };
  assert.equal(withEditionFieldDependency(plain, []), plain);
});

test('编辑选项允许合法改名及停用，禁止空名称、空列表和重复含停用值', () => {
  const options = values => values.map(value => ({ value, enabled: true }));
  assert.equal(fieldOptionsIssue(options(['需要', '不需要'])), null);
  assert.equal(fieldOptionsIssue([{ value: '是', enabled: false }, { value: '否', enabled: true }]), null);
  assert.match(fieldOptionsIssue([]), /至少/);
  assert.match(fieldOptionsIssue(options([' ', '否'])), /不能为空/);
  assert.match(fieldOptionsIssue([{ value: '是', enabled: false }, { value: ' 是 ', enabled: true }]), /已存在/);
});
