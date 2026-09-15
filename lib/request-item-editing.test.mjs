import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig, canEditRequestItems, canCheckRequestCompleteness, requestIdentityIssue } from './service-requests.ts';
const pm = { id: 'pm', name: '项目经理', role: 'SmartX 项目经理' };
const service = { id: 's1', name: '培训', deliveryMethods: ['远程'], priceCoefficient: 1, defaultQuantity: 1 };
function request() {
  return { ...newRequest('服务请求', 'c1', '销售', 'contact'), status: '待评估',
    items: [newItem(service, defaultConfig(service))],
    operations: { activities: [], assessment: { managerId: pm.id, manager: pm.name, rounds: [], tasks: [], plans: [], approvals: [] } } };
}
test('材料评估未通过时负责项目经理可修改、增删申请项并更新材料', () => {
  const original = request();
  assert.equal(canEditRequestItems(original, pm), true);
  const updated = structuredClone(original);
  updated.items[0].description = '补充培训范围';
  updated.items[0].materials = [{ requirementId: 'm', files: [{ id: 'file', name: '材料.txt', blob: new Blob(['材料']) }] }];
  assert.equal(requestIdentityIssue(updated, original, pm), null);
  assert.equal(requestIdentityIssue({ ...original, items: [...original.items, newItem(service, defaultConfig(service))] }, original, pm), null);
  assert.equal(requestIdentityIssue({ ...original, items: [] }, original, pm), null);
  original.operations.assessment.rounds.push({ outcome: '需补充' });
  assert.equal(canEditRequestItems(original, pm), true);
});
test('其他身份及非负责项目经理不能修改，原有草稿编辑不受影响', () => {
  const original = request();
  for (const actor of [undefined, { ...pm, id: '' }, { ...pm, id: 'other' }, ...['客户', 'SmartX 销售经理', 'SmartX 服务工程师', 'SmartX 系统管理员'].map(role => ({ ...pm, role }))]) {
    assert.equal(canEditRequestItems(original, actor), false);
    assert.match(requestIdentityIssue({ ...original, items: [] }, original, actor), /只读锁定/);
  }
  const draft = { ...original, status: '草稿' };
  assert.equal(canEditRequestItems(draft, { ...pm, role: 'SmartX 销售经理' }), true);
  assert.equal(requestIdentityIssue({ ...draft, items: [] }, draft), null);
});
test('通过即锁定，包括旧弹窗保存、伪造清空评估、同时通过与修改、客户拒绝后的请求', () => {
  const original = request();
  const passed = structuredClone(original);
  passed.operations.assessment.rounds.push({ outcome: '评估通过' });
  assert.equal(canEditRequestItems(passed, pm), false);
  assert.match(requestIdentityIssue({ ...original, items: [] }, passed, pm), /只读锁定/);
  assert.match(requestIdentityIssue({ ...passed, items: [] }, original, pm), /只读锁定/);
  for (const status of ['待评估', '待确认', '待受理', '已转服务项目', '已取消']) {
    const latest = { ...passed, status };
    assert.equal(canEditRequestItems(latest, pm), false);
    assert.match(requestIdentityIssue({ ...latest, items: [] }, latest, pm), /只读锁定/);
  }
  assert.equal(requestIdentityIssue(passed, original, pm), null);
});
test('开放申请项编辑不开放申请基本信息及既有活动修改', () => {
  const original = request();
  for (const patch of [{ title: '另一个主题' }, { contactId: 'other' }, { description: '其他说明' }, { expectedServiceDate: '2026-10-01' }, { expectedServiceDateUncertain: true }]) {
    assert.match(requestIdentityIssue({ ...original, ...patch }, original, pm), /基本信息只读/);
  }
  original.operations.activities.push({ id: 'event', title: '提交' });
  const changed = structuredClone(original);
  changed.items = [];
  changed.operations.activities = [];
  assert.match(requestIdentityIssue(changed, original, pm), /活动不支持/);
});


test('客户侧仅本人发起的申请显示齐套校验，非本人草稿也只读且不能提交', () => {
  const customer = { id: 'contact', name: '客户', role: '客户' };
  const internal = { ...request(), createdById: 'sales', status: '草稿' };
  const own = { ...internal, createdById: customer.id };
  for (const status of ['草稿', '待评估', '待确认', '待受理', '已转服务项目', '已取消']) {
    assert.equal(canCheckRequestCompleteness({ ...internal, status }, customer), false);
    assert.equal(canCheckRequestCompleteness({ ...own, status }, customer), true);
    assert.equal(canCheckRequestCompleteness({ ...internal, status }, pm), true);
  }
  assert.equal(canCheckRequestCompleteness({ ...own, createdById: 'other-customer' }, customer), false);
  assert.equal(canEditRequestItems(internal, customer), false);
  assert.equal(canEditRequestItems(own, customer), true);
  for (const patch of [{ items: [] }, { title: '修改' }, { description: '修改' }, { contactId: '其他' }, { status: '待评估' }]) {
    assert.match(requestIdentityIssue({ ...internal, ...patch }, internal, customer), /只读查看|仅创建人/);
  }
  assert.equal(requestIdentityIssue(internal, internal, customer), null);
  assert.equal(requestIdentityIssue({ ...own, description: '客户补充' }, own, customer), null);
});
