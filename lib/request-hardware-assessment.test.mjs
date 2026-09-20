import test from 'node:test';
import assert from 'node:assert/strict';
import { importedServiceCatalogSeeds } from '../app/service-catalog-import.ts';
import { newRequest, newItem, defaultConfig, canAccessRequest, requestIdentityIssue } from './service-requests.ts';
import { localInternalUsers } from './internal-users.ts';
import { applyAssessmentAction, assessmentOf } from './request-assessment.ts';
import { hardwareCompatibilityServiceId, hardwareItems, currentHardwareReview, hardwareAssessmentSaveIssue, invalidateHardwareReview, hardwarePassIssue } from './request-hardware-assessment.ts';

const pm = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理' };
const service = { id: hardwareCompatibilityServiceId, name: '硬件兼容性测试', deliveryMethods: ['远程'], priceUnit: '服务人天', priceCoefficient: 1, defaultQuantity: 1 };
const now = '2026-09-14T10:00:00Z';
const review = { type: 'review', outcome: '评估通过', opinion: '汇总通过' };
const professional = { type: 'hardware-review', outcome: '评估通过', opinion: '材料齐备，可开展测试' };
function request() {
  return { ...newRequest('硬件测试请求', 'c1', sales.name, sales.id, sales.role), status: '待评估', submittedAt: now,
    items: [newItem(service, { ...defaultConfig(service), fields: [], materials: [] })] };
}
const act = (record, action, actor = pm, users = localInternalUsers) => applyAssessmentAction(record, action, actor, [], users, [], now, [service]);
const ready = () => act(request(), professional, hardware);
const issue = (next, previous, actor = pm, users = localInternalUsers) => hardwareAssessmentSaveIssue(next, previous, actor, users);

test('历史请求保留原默认触发服务，改名仍需会评，普通服务不受影响', () => {
  assert.equal(importedServiceCatalogSeeds.filter(seed => seed.serviceCategory === '产品实施交付')[7].serviceName, service.name);
  const renamed = request(); renamed.items[0].serviceName = '修改后的名称';
  assert.equal(hardwareItems(renamed).length, 1);
  assert.throws(() => act(renamed, review), /硬件产品经理/);
  const ordinary = request(); ordinary.items[0].serviceId = 'other';
  assert.equal(hardwareItems(ordinary).length, 0);
  assert.equal(assessmentOf(act(ordinary, review)).rounds.length, 1);
  assert.throws(() => act(ordinary, professional, hardware), /未命中本轮硬件评估/);
});
test('硬件产品经理直接评估并自动记录实际人员，两份结论均通过后锁定', () => {
  const original = request();
  assert.equal(canAccessRequest(original, { actor: hardware, directory: localInternalUsers }), true);
  const reviewed = act(original, professional, hardware);
  assert.equal(issue(reviewed, original, hardware), null);
  assert.equal(assessmentOf(reviewed).managerId, '');
  assert.equal(assessmentOf(reviewed).rounds.length, 0);
  assert.equal(assessmentOf(reviewed).hardware.reviewerId, hardware.id);
  assert.ok(reviewed.internalParticipants.some(person => person.userId === hardware.id));
  assert.equal(currentHardwareReview(reviewed).opinion, professional.opinion);
  for (const key of ['scope', 'risks', 'effortNote']) assert.equal(Object.hasOwn(currentHardwareReview(reviewed), key), false);
  const passed = act(reviewed, review);
  assert.equal(issue(passed, reviewed), null);
  assert.equal(assessmentOf(passed).managerId, pm.id);
  assert.throws(() => act(passed, professional, hardware), /已锁定/);
  const estimated = act(passed, { type: 'effort', items: [{ itemId: passed.items[0].id, estimatedDays: 3 }] });
  assert.equal(issue(estimated, passed), null);
  assert.match(issue(estimated, passed, hardware), /项目经理/);
});
test('项目经理可先记录需补充，硬件产品经理直接接续，需补充阻止整体通过', () => {
  const preliminary = act(request(), { ...review, outcome: '需补充' });
  const reviewed = act(preliminary, { ...professional, outcome: '需补充' }, hardware);
  assert.equal(issue(reviewed, preliminary, hardware), null);
  assert.equal(assessmentOf(reviewed).managerId, pm.id);
  assert.throws(() => act(reviewed, review), /尚未通过/);
  const passed = act(reviewed, professional, hardware);
  assert.equal(issue(passed, reviewed, hardware), null);
  assert.equal(issue(act(passed, review), passed), null);
});
test('仅启用的硬件产品经理可评估，旧指定操作失效，普通协作人不得代评', () => {
  const original = request();
  for (const actor of [pm, sales, { ...hardware, id: 'other' }, { ...pm, role: 'SmartX 硬件产品经理' }]) assert.throws(() => act(original, professional, actor), /仅已启用/);
  assert.throws(() => act(original, { type: 'hardware-assign', reviewerId: hardware.id }), /不支持/);
  assert.throws(() => act(original, review, hardware), /项目经理/);
  const disabled = localInternalUsers.map(user => user.id === hardware.id ? { ...user, status: '停用' } : user);
  assert.throws(() => act(original, professional, hardware, disabled), /已启用/);
  assert.throws(() => act(ready(), review, pm, disabled), /已启用/);
  assert.throws(() => act(original, { ...professional, opinion: '  ' }, hardware), /评估意见/);
  const ordinary = request(); ordinary.items[0].serviceId = 'other';
  assert.equal(canAccessRequest(ordinary, { actor: hardware, directory: localInternalUsers }), false);
  assert.equal(canAccessRequest({ ...original, status: '草稿' }, { actor: hardware, directory: localInternalUsers }), false);
});
test('相关材料、范围、增删硬件项、线上内容及补充资料变化后失效，恢复旧值也不复活', () => {
  const original = ready();
  const mutations = [
    record => { record.items[0].description = '变更测试范围'; },
    record => { record.items[0].values.nodes = '2'; },
    record => { record.items[0].materials = [{ requirementId: 'm', files: [{ id: 'v2', uploadedAt: now, onlineDocument: { content: '新版内容' } }] }]; },
    record => { record.items.push({ ...record.items[0], id: 'second' }); },
    record => { record.items = []; },
    record => { record.operations.supplements = [{ id: 's1', comment: '补充测试范围' }]; },
  ];
  for (const mutate of mutations) {
    const changed = structuredClone(original); mutate(changed);
    assert.equal(issue(changed, original), null);
    const saved = invalidateHardwareReview(changed, original, now);
    assert.equal(currentHardwareReview(saved), undefined);
    assert.ok(saved.operations.assessment.hardware.rounds[0].invalidatedAt);
    const restored = { ...saved, items: original.items, operations: { ...saved.operations, supplements: original.operations.supplements } };
    assert.equal(currentHardwareReview(restored), undefined);
  }
  const other = structuredClone(original); other.items.push({ ...other.items[0], id: 'ordinary', serviceId: 'other' });
  assert.equal(currentHardwareReview(invalidateHardwareReview(other, original))?.outcome, '评估通过');
});
test('一份结论覆盖同单全部硬件测试项，项目经理记录意见不使专业结论失效', () => {
  const record = request(); record.items.push({ ...record.items[0], id: 'second' });
  const reviewed = act(record, professional, hardware);
  assert.deepEqual(currentHardwareReview(reviewed).itemIds, record.items.map(item => item.id));
  const noted = act(reviewed, { ...review, outcome: '需补充' });
  assert.equal(currentHardwareReview(noted).id, currentHardwareReview(reviewed).id);
});
test('兼容旧指定记录，直接评估不要求重新指定或锁定协作人', () => {
  const original = ready();
  Object.assign(original.operations.assessment.hardware.rounds[0], { scope: '历史测试范围', risks: '历史风险', effortNote: '历史工作量建议' });
  const historicRound = structuredClone(original.operations.assessment.hardware.rounds[0]);
  original.operations.assessment.hardware.reviewerId = 'former-reviewer';
  original.operations.assessment.hardware.reviewer = '原评估人';
  const reviewed = act(original, professional, hardware);
  assert.equal(issue(reviewed, original, hardware), null);
  assert.equal(reviewed.operations.assessment.hardware.rounds.length, 2);
  assert.deepEqual(reviewed.operations.assessment.hardware.rounds[0], historicRound);
  assert.equal(currentHardwareReview(reviewed).authorId, hardware.id);
  const removed = { ...reviewed, internalParticipants: reviewed.internalParticipants.filter(person => person.userId !== hardware.id) };
  assert.equal(issue(removed, reviewed), null);
  const reassigned = structuredClone(reviewed); reassigned.operations.assessment.hardware.reviewerId = pm.id;
  assert.ok(issue(reassigned, reviewed, pm));
});
test('保存层阻止伪造整体通过、覆盖专业历史、代评、过期专业结论与同时改写人天', () => {
  const assigned = act(request(), { ...review, outcome: '需补充' }), reviewed = act(assigned, professional, hardware);
  const passed = act(reviewed, review);
  const forged = { ...assigned, operations: { ...assigned.operations, assessment: { ...assigned.operations.assessment, rounds: passed.operations.assessment.rounds } } };
  assert.match(issue(forged, assigned), /完成评估/);
  assert.match(issue(reviewed, assigned, pm), /仅已启用/);
  assert.match(hardwareAssessmentSaveIssue(reviewed, assigned, undefined, localInternalUsers), /仅待评估/);
  const spoof = structuredClone(reviewed); spoof.operations.assessment.effort = { days: 3 };
  assert.match(issue(spoof, assigned, hardware), /项目经理/);
  const latest = act(reviewed, { ...professional, outcome: '需补充' }, hardware);
  assert.ok(issue(reviewed, latest, hardware));
  assert.ok(issue(passed, latest));
  const changed = structuredClone(assigned); changed.items[0].description = '新范围';
  assert.match(issue(reviewed, changed, hardware), /材料已变化/);
  const deleted = structuredClone(reviewed); delete deleted.operations.assessment.hardware;
  assert.ok(issue(deleted, reviewed));
});
test('退回归档双方评估，新周期重新评估；历史已通过请求保持原结论', () => {
  const reviewed = ready(), passed = act(reviewed, review);
  const returned = act(passed, { type: 'return-draft', reason: '修改范围' });
  assert.equal(requestIdentityIssue(returned, passed, pm), null);
  assert.equal(issue(returned, passed), null);
  assert.equal(returned.operations.assessment.hardware, undefined);
  assert.deepEqual(returned.operations.assessmentHistory.at(-1).hardware, passed.operations.assessment.hardware);
  const resubmitted = { ...returned, status: '待评估', submittedAt: '2026-09-15T10:00:00Z' };
  assert.throws(() => act(resubmitted, review), /硬件产品经理/);
  const legacy = structuredClone(passed); delete legacy.operations.assessment.hardware;
  assert.equal(issue(legacy, legacy), null);
  assert.equal(hardwarePassIssue(legacy, localInternalUsers)?.includes('完成评估'), true);
  const estimated = act(legacy, { type: 'effort', items: [{ itemId: legacy.items[0].id, estimatedDays: 3 }] });
  assert.equal(issue(estimated, legacy), null);
});
