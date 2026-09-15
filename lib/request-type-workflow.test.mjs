import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig, normalizeStoredRequest, requestIdentityIssue, requestProgressSteps } from './service-requests.ts';
import { requestTypes, requestTypeOf } from './request-types.ts';
import { requestTypeSaveIssue, convertAssessmentToDelivery, deliveryConversionIssue } from './request-type-workflow.ts';
import { applyAssessmentAction, emptyAssessment } from './request-assessment.ts';
import { requestNextStep } from './request-next-step.ts';
import { normalizeApplicationFields } from './request-application-fields.ts';
import { requestCompletenessIssues } from './request-validation-builtins.ts';
import { localInternalUsers } from './internal-users.ts';
import { activeEntitlementAllocations } from './request-entitlement-reservations.ts';

const users = localInternalUsers;
const pm = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理' };
const customer = { id: 'contact', name: '客户', role: '客户' };
const service = { id: 'type-test-service', name: '咨询', status: '已启用', category: '咨询', deliveryMethods: ['远程'], priceUnit: '服务人天', priceCoefficient: 1, defaultQuantity: 0.1 };
const customers = [{ id: 'c1', name: '客户', status: '启用', ownerUserId: sales.id }];
const now = '2026-09-16T05:00:00.000Z';
function request(type = '售前评估') {
  return { ...newRequest('申请', 'c1', sales.name, '', sales.id, sales.role), requestType: type, status: '待评估',
    items: [newItem(service, { ...defaultConfig(service), fields: [], materials: [] })],
    operations: { assessment: { ...emptyAssessment(), managerId: pm.id, manager: pm.name }, activities: [] } };
}
const act = (r, action, actor = pm) => applyAssessmentAction(r, action, actor, [], users, [], now, [service], customers);
const review = r => act(r, { type: 'review', outcome: '评估通过', opinion: '材料齐备' });
const effort = r => act(r, { type: 'effort', items: [{ itemId: r.items[0].id, estimatedDays: 2 }] });

test('历史请求默认服务交付，不修改原记录；所有申请均要求有效类型', () => {
  const legacy = request(); delete legacy.requestType;
  assert.equal(requestTypeOf(legacy), '服务交付');
  assert.equal(normalizeStoredRequest(legacy).requestType, '服务交付');
  assert.equal(legacy.requestType, undefined);
  for (const type of ['', '未知类型']) {
    const r = { ...newRequest('申请', 'c1', '申请人'), requestType: type };
    assert.match(requestIdentityIssue(r), /申请类型/);
    assert.ok(requestCompletenessIssues(r, { customers, contacts: [], businessObjects: [], services: [service] }).includes('选择申请类型'));
  }
  const options = normalizeApplicationFields([{ id: 'requestType', type: 'text', options: [{ value: '其他', enabled: true }] }]).find(field => field.id === 'requestType');
  assert.equal(options.type, 'single');
  assert.deepEqual(options.options.map(option => option.value), requestTypes);
});

test('沿用评估人权限，售前评估核定后结束，服务交付继续原流程', () => {
  const original = review(request());
  assert.throws(() => act(original, { type: 'effort', items: [{ itemId: original.items[0].id, estimatedDays: 2 }] }, sales), /项目经理/);
  const done = effort(original);
  assert.equal(done.status, '评估完成');
  assert.equal(requestTypeSaveIssue(done, original, pm, users), null);
  assert.equal(done.operations.assessment.effort.days, 2);
  assert.equal(done.operations.activities.at(-1).title, '人天核定 · 评估完成');
  assert.deepEqual(activeEntitlementAllocations(done), []);
  assert.deepEqual(requestProgressSteps(done).map(step => [step.label, step.state]), [['草稿', 'complete'], ['待评估', 'complete'], ['评估完成', 'current']]);
  const delivery = effort(review(request('服务交付')));
  assert.equal(delivery.status, '待评估');
  assert.ok(!requestProgressSteps(delivery).some(step => step.label === '评估完成'));
});

test('转换保留同一请求、评估、材料、人员和核定结果，记录转换人及时间', () => {
  const done = effort(review(request()));
  const before = structuredClone(done);
  const converted = act(done, { type: 'convert-to-delivery' });
  assert.equal(requestTypeSaveIssue(converted, done, pm, users), null);
  assert.equal(converted.id, done.id);
  assert.equal(converted.requestType, '服务交付');
  assert.equal(converted.status, '待评估');
  assert.deepEqual(converted.items, done.items);
  assert.deepEqual(converted.operations.assessment, done.operations.assessment);
  assert.deepEqual(converted.internalParticipants, done.internalParticipants);
  assert.equal(converted.operations.activities.at(-1).actorId, pm.id);
  assert.equal(converted.operations.activities.at(-1).at, now);
  assert.equal(converted.operations.activities.at(-1).title, '转为服务交付');
  assert.deepEqual(done, before);
  assert.match(requestNextStep(converted, users, customers, []).action, /关联/);
  const plan = act(converted, { type: 'plan', allocations: [], salesId: sales.id }, sales);
  assert.equal(plan.operations.assessment.plans.length, 1);
  assert.throws(() => convertAssessmentToDelivery(converted, pm, users), /仅评估完成/);
});

test('售前评估不进入交付环节，拒绝跳步、越权、停用负责人、直接改类型和篡改结果', () => {
  const pending = review(request());
  const done = effort(pending);
  for (const type of ['plan', 'gap-submit', 'gap-decide', 'confirm']) assert.throws(() => act(pending, { type }), /转为服务交付/);
  for (const actor of [sales, customer]) {
    assert.throws(() => act(done, { type: 'convert-to-delivery' }, actor), /负责本请求/);
    const forged = act(done, { type: 'convert-to-delivery' });
    assert.match(requestTypeSaveIssue(forged, done, actor, users), /负责本请求/);
  }
  assert.match(deliveryConversionIssue(done, pm, users.map(user => user.id === pm.id ? { ...user, status: '停用' } : user)), /负责本请求/);
  assert.throws(() => act(pending, { type: 'convert-to-delivery' }), /仅评估完成/);
  assert.ok(requestTypeSaveIssue({ ...pending, status: '评估完成' }, pending, pm, users));
  assert.ok(requestTypeSaveIssue({ ...pending, requestType: '服务交付' }, pending, pm, users));
  assert.match(requestIdentityIssue({ ...pending, requestType: '服务交付' }, pending, pm), /不可直接修改/);
  const converted = structuredClone(act(done, { type: 'convert-to-delivery' }));
  converted.operations.assessment.effort.days = 99;
  assert.match(requestTypeSaveIssue(converted, done, pm, users), /沿用/);
  assert.ok(requestTypeSaveIssue({ ...done, status: '待评估' }, done, pm, users));
  const fake = { ...done, requestType: '服务交付', status: '待评估' };
  assert.match(requestTypeSaveIssue(fake, done, pm, users), /转为服务交付/);
  const draft = { ...pending, status: '草稿', operations: undefined };
  assert.equal(requestTypeSaveIssue({ ...draft, requestType: '服务交付' }, draft, sales, users), null);
});
