import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig, saveLocal, withRequestContact, requestCollaborationSaveIssue } from './service-requests.ts';
import { localInternalUsers } from './internal-users.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { applyAssessmentAction } from './request-assessment.ts';
import { hardwareCompatibilityServiceId, currentHardwareReview } from './request-hardware-assessment.ts';

test('硬件共同评估保存闭环：直接评估、材料变更失效、重评、项目经理通过与核定', async t => {
  const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
  const hardwareService = { ...service, id: hardwareCompatibilityServiceId, name: '硬件兼容性测试', priceCoefficient: 1, defaultQuantity: 1 };
  const workspace = { ...refs, services: [hardwareService] };
  const record = { ...draft(), status: '待评估', submittedAt: '2026-09-14T08:00:00Z' };
  record.items = [newItem(hardwareService, { ...defaultConfig(hardwareService), materials: [], fields: [], basicFields: { description: { enabled: true, required: false } } })];
  const data = storage(t, record, workspace);
  const act = (record, action, actor) => applyAssessmentAction(record, action, actor, [], workspace.users, [], '2026-09-14T10:00:00Z', workspace.services, workspace.customers);
  const professional = { type: 'hardware-review', outcome: '评估通过', opinion: '材料齐备' };
  const reviewed = act(data.requests[0], professional, hardware);
  await assert.rejects(saveLocal('requests', reviewed, access(pm)), /仅已启用/);
  await assert.rejects(saveLocal('requests', reviewed), /仅待评估/);
  await saveLocal('requests', reviewed, access(hardware));
  assert.equal(currentHardwareReview(data.requests[0])?.outcome, '评估通过');
  assert.ok(data.requests[0].internalParticipants.some(person => person.userId === hardware.id));
  assert.equal(data.requests[0].operations.assessment.managerId, '');
  const stalePass = act(data.requests[0], { type: 'review', opinion: '汇总通过', outcome: '评估通过' }, pm);
  const updated = structuredClone(data.requests[0]); updated.items[0].description = '增加网卡测试';
  await saveLocal('requests', updated, access(pm));
  assert.equal(currentHardwareReview(data.requests[0]), undefined);
  assert.ok(data.requests[0].operations.assessment.hardware.rounds.at(-1).invalidatedAt);
  await assert.rejects(saveLocal('requests', stalePass, access(pm)));
  const forgedPass = structuredClone(data.requests[0]);
  forgedPass.operations.assessment.rounds = stalePass.operations.assessment.rounds;
  await assert.rejects(saveLocal('requests', forgedPass, access(pm)), /尚未通过/);
  const reReviewed = act(data.requests[0], professional, hardware);
  data.references[0].payload.users.find(user => user.id === hardware.id).status = '停用';
  await assert.rejects(saveLocal('requests', reReviewed, access(hardware)), /已启用/);
  data.references[0].payload.users.find(user => user.id === hardware.id).status = '启用';
  await saveLocal('requests', reReviewed, access(hardware));
  await saveLocal('requests', act(data.requests[0], { type: 'review', opinion: '汇总通过', outcome: '评估通过' }, pm), access(pm));
  const passed = structuredClone(data.requests[0]);
  const effort = act(passed, { type: 'effort', items: [{ itemId: passed.items[0].id, estimatedDays: 3 }] }, pm);
  await assert.rejects(saveLocal('requests', effort, access(hardware)), /项目经理/);
  await saveLocal('requests', effort, access(pm));
  assert.equal(data.requests[0].operations.assessment.effort.days, 3);
  const returned = act(data.requests[0], { type: 'return-draft', reason: '重新明确测试范围' }, pm);
  await saveLocal('requests', returned, access(pm));
  assert.equal(data.requests[0].status, '草稿');
  assert.equal(data.requests[0].operations.assessment.hardware, undefined);
  assert.equal(data.requests[0].operations.assessmentHistory.at(-1).hardware.rounds.length, 2);
});

test('专业评估保存使用当前资料和历史：并发结论不能覆盖，新补充资料使结论失效', async t => {
  const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
  const record = { ...draft(), status: '待评估' }; record.items[0].serviceId = hardwareCompatibilityServiceId;
  const act = (record, action, actor) => applyAssessmentAction(record, action, actor, [], refs.users);
  const professional = { type: 'hardware-review', outcome: '评估通过', opinion: '齐备' };
  const reviewed = act(record, professional, hardware);
  const data = storage(t, reviewed);
  const next = act(reviewed, { ...professional, outcome: '需补充' }, hardware);
  const stale = act(reviewed, professional, hardware);
  await saveLocal('requests', next, access(hardware));
  await assert.rejects(saveLocal('requests', stale, access(hardware)));
  assert.equal(currentHardwareReview(data.requests[0]).outcome, '需补充');
  const current = act(data.requests[0], professional, hardware);
  await saveLocal('requests', current, access(hardware));
  const supplement = { ...data.requests[0], operations: { ...data.requests[0].operations, supplements: [{ id: 'extra', authorId: sales.id, author: sales.name, at: '2026-09-14T11:00:00Z', comment: '新增测试要求', files: [], externalVisible: false }] } };
  await saveLocal('requests', supplement, access(sales));
  assert.equal(currentHardwareReview(data.requests[0]), undefined);
});
const sales = { id: 'USR-001', name: '销售', role: 'SmartX 销售经理' };
const pm = { id: 'USR-003', name: '经理', role: 'SmartX 项目经理' };
const customer = { id: 'p1', name: '客户', role: '客户' };
const contacts = [{ id: 'p1', name: '客户', customerId: 'c1', status: '启用' }];
const service = { id: 's', name: '培训', priceUnit: '服务人天', deliveryMethods: ['远程'], status: '已启用' };
const refs = { customers: [{ id: 'c1', name: '客户公司', status: '启用', ownerUserId: 'USR-001' }], contacts, users: localInternalUsers, services: [service], assets: [], businessObjects: [] };
const access = actor => ({ actor, customerId: 'c1', contacts, directory: localInternalUsers });
function draft(actor = sales) {
  const record = newRequest('申请', 'c1', actor.name, '', actor.id, actor.role, localInternalUsers[0]);
  record.businessImpact = '生产环境';
  record.items = [newItem(service, { ...defaultConfig(service), materials: [], basicFields: { description: { enabled: true, required: false } } })];
  if (actor === sales) {
    record.externalCollaborators = [{ contactId: 'p1', name: '客户', phone: '', email: '' }];
    record.internalParticipants.push({ userId: 'USR-002', name: '售前' });
  }
  return withRequestContact(record, contacts, refs.customers, refs.users);
}
// Minimal asynchronous transactional storage: rejected writes cannot change persisted rows.
function storage(t, record, workspace = refs) {
  const data = { requests: record ? [structuredClone(record)] : [], references: [{ id: 'workspace', payload: structuredClone(workspace) }] };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open() {
    const req = {};
    queueMicrotask(() => { req.result = { close() {}, transaction() {
      const staged = structuredClone(data); let pending = 0; let aborted = false;
      const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore(name) {
        const run = fn => { const r = {}; pending++; queueMicrotask(() => { if (aborted) return; r.result = fn(); r.onsuccess?.(); pending--; if (!pending && !aborted) queueMicrotask(() => { if (!pending && !aborted) { Object.assign(data, staged); tx.oncomplete?.(); } }); }); return r; };
        return { get: id => run(() => staged[name].find(row => row.id === id)), getAll: () => run(() => staged[name]), put: record => run(() => { staged[name] = [...staged[name].filter(row => row.id !== record.id), structuredClone(record)]; }) };
      } }; return tx;
    } }; req.onsuccess?.(); }); return req;
  } };
  t.after(() => { globalThis.indexedDB = previous; });
  return data;
}
for (const creator of [sales, customer]) test(`${creator.role}发起的申请：保存层仅允许${creator === sales ? '内部申请人' : '客户所有人'}关联依据及发起确认`, async t => {
  const asset = { id: 'a', customerId: 'c1', name: '远程人天', status: '启用', balanceDays: 5 };
  const workspace = { ...refs, services: [{ ...service, defaultQuantity: 1, priceCoefficient: 1 }], assets: [asset] };
  const act = (record, action, actor) => applyAssessmentAction(record, action, actor, workspace.assets, workspace.users, [], '2026-09-14T10:00:00Z', workspace.services, workspace.customers);
  let record = { ...draft(creator), status: '待评估' };
  record = act(record, { type: 'review', outcome: '评估通过', opinion: '齐备' }, pm);
  record = act(record, { type: 'effort', items: [{ itemId: record.items[0].id, estimatedDays: 1 }] }, pm);
  const data = storage(t, record, workspace);
  const linked = act(record, { type: 'plan', allocations: [{ assetId: asset.id, days: 1 }], salesId: sales.id }, sales);
  const permission = creator === sales ? /内部申请人/ : /客户所有人/;
  await assert.rejects(saveLocal('requests', linked, access(pm)), permission);
  await assert.rejects(saveLocal('requests', linked), permission);
  assert.deepEqual(data.requests[0], record);
  await saveLocal('requests', linked, access(sales));
  const confirmed = act(linked, { type: 'confirm' }, sales);
  await assert.rejects(saveLocal('requests', confirmed, access(pm)), permission);
  assert.equal(data.requests[0].status, '待评估');
  await saveLocal('requests', confirmed, access(sales));
  assert.equal(data.requests[0].status, '待确认');
});
test('保存层拦截非创建人提交，并用当前角色目录检查售前，失败不落库', async t => {
  const record = draft(); const data = storage(t, record);
  const submitted = { ...record, status: '待评估', submittedAt: '2026-09-10T10:00:00Z' };
  await assert.rejects(saveLocal('requests', submitted, access(pm)), /仅创建人/);
  assert.equal(data.requests[0].status, '草稿');
  data.references[0].payload.users.find(u => u.id === 'USR-002').status = '停用';
  await assert.rejects(saveLocal('requests', submitted, access(sales)), /售前/);
  data.references[0].payload.users.find(u => u.id === 'USR-002').status = '启用';
  await saveLocal('requests', submitted, access(sales));
  assert.equal(data.requests[0].status, '待评估');
});
test('客户创建及提交不需要售前，不能带入内部协作人或移除申请人', async t => {
  const record = draft(customer); const data = storage(t);
  await saveLocal('requests', record, access(customer));
  await assert.rejects(saveLocal('requests', { ...record, externalCollaborators: [] }, access(customer)), /申请人/);
  await assert.rejects(saveLocal('requests', { ...record, internalParticipants: [...record.internalParticipants, { userId: 'USR-003', name: '经理' }] }, access(customer)), /不能修改内部/);
  await saveLocal('requests', { ...record, status: '待评估' }, access(customer));
  assert.equal(data.requests[0].status, '待评估');
});
for (const actor of [sales, customer, { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' }]) {
  test(`${actor.role}一次创建保存基本信息、多申请项、材料和协作人`, async t => {
    const record = draft(actor);
    record.description = '统一填写申请说明';
    record.expectedProvider = '合作伙伴A';
    record.expectedServiceDate = '2026-10-12';
    record.items.push({ ...structuredClone(record.items[0]), id: 'second-item', description: '第二项服务需求' });
    record.items[0].materials = [{ requirementId: 'requirements', files: [{ id: 'file-1', name: '说明.txt', size: 6, type: 'text/plain', blob: new Blob(['材料']) }] }];
    const data = storage(t);
    assert.equal(data.requests.length, 0);
    await saveLocal('requests', record, access(actor));
    assert.equal(data.requests.length, 1);
    const saved = data.requests[0];
    assert.equal(saved.status, '草稿');
    assert.equal(saved.description, record.description);
    assert.equal(saved.expectedProvider, undefined);
    assert.equal(saved.expectedServiceDate, record.expectedServiceDate);
    assert.equal(saved.businessImpact, record.businessImpact);
    assert.equal(saved.items.length, 2);
    assert.equal(saved.items[1].description, '第二项服务需求');
    assert.deepEqual(saved.externalCollaborators, record.externalCollaborators);
    assert.deepEqual(saved.internalParticipants, record.internalParticipants);
    const file = saved.items[0].materials[0].files[0];
    assert.equal(await file.blob.text(), '材料');
    assert.equal(file.uploadedById, actor.id);
    assert.equal(file.uploaderAudience, actor === customer ? 'customer' : 'internal');
  });
}
test('保存层允许无业务影响字段的新建和提交', async t => {
  const record = draft();
  delete record.businessImpact;
  const data = storage(t);
  await saveLocal('requests', record, access(sales));
  assert.equal(data.requests.length, 1);
  assert.equal(data.requests[0].businessImpact, undefined);
  await saveLocal('requests', { ...record, status: '待评估' }, access(sales));
  assert.equal(data.requests[0].status, '待评估');
  assert.equal(data.requests[0].businessImpact, undefined);
});
for (const status of ['草稿', '待评估', '待受理']) {
  test(`从${status}取消时保存实际来源阶段，后续保存不能篡改`, async t => {
    const record = { ...draft(), status };
    const data = storage(t, record);
    await saveLocal('requests', { ...record, status: '已取消', cancelledFromStatus: '已转服务项目' }, access(sales));
    assert.equal(data.requests[0].cancelledFromStatus, status);
    await saveLocal('requests', { ...data.requests[0], cancelledFromStatus: '已转服务项目' }, access(sales));
    assert.equal(data.requests[0].cancelledFromStatus, status);
  });
}
test('新建和保存均校验当前客户联系人，旧页面缓存不能添加停用成员或跨客户成员', async t => {
  const record = draft(); const data = storage(t, record);
  data.references[0].payload.contacts[0].status = '停用';
  await assert.rejects(saveLocal('requests', { ...record, status: '待评估' }, access(sales)), /已启用/);
  const foreign = { ...record, externalCollaborators: [{ contactId: 'foreign' }] };
  await assert.rejects(saveLocal('requests', foreign, access(sales)), /当前客户/);
  assert.equal(data.requests[0].externalCollaborators[0].contactId, 'p1');
});
test('固定所有人和申请人保存层不可移除，客户不能伪造内部成员', () => {
  const record = draft();
  assert.match(requestCollaborationSaveIssue({ ...record, internalParticipants: record.internalParticipants.slice(1) }, record, refs, access(pm)), /申请人|所有人/);
  const customerRecord = draft(customer);
  assert.match(requestCollaborationSaveIssue({ ...customerRecord, internalParticipants: [{ userId: pm.id, name: pm.name }] }, undefined, refs, access(customer)), /不能指定/);
});
test('待确认及后续不能绕过页面增删客户协作人，非协作客户不能确认', async t => {
  const record = { ...draft(), status: '待确认', operations: { activities: [], assessment: { plans: [], rounds: [], approvals: [], confirmation: { planId: 'p' } } } };
  storage(t, record);
  await assert.rejects(saveLocal('requests', { ...record, externalCollaborators: [] }, access(pm)), /当前阶段/);
  assert.throws(() => applyCustomerDecision(record, { ...customer, id: 'other' }, 'c1', true), /客户协作人/);
});
test('旧待确认请求兼容来源和固定协作人补齐，客户确认后正常保存', async t => {
  const legacy = { ...draft(), status: '待确认', operations: { activities: [], assessment: { plans: [], rounds: [], approvals: [], confirmation: { planId: 'p' } } } };
  delete legacy.createdByAudience;
  const data = storage(t, legacy);
  const view = withRequestContact(legacy, contacts, refs.customers, refs.users);
  const decided = applyCustomerDecision(view, customer, 'c1', true);
  await saveLocal('requests', decided, access(customer));
  assert.equal(data.requests[0].status, '待受理');
});
test('内部申请人发起确认时再次校验客户协作人，不接受空名单或失效联系人', async t => {
  const record = { ...draft(), status: '待评估', externalCollaborators: [], operations: { activities: [], assessment: { managerId: pm.id, rounds: [], plans: [], approvals: [] } } };
  const data = storage(t, record);
  const pending = { ...record, status: '待确认', operations: { ...record.operations, assessment: { ...record.operations.assessment, confirmation: { planId: 'p' } } } };
  await assert.rejects(saveLocal('requests', pending, access(sales)), /至少添加/);
  data.requests[0].externalCollaborators = [{ contactId: 'p1', name: '客户' }];
  data.references[0].payload.contacts[0].status = '停用';
  await assert.rejects(saveLocal('requests', { ...pending, externalCollaborators: data.requests[0].externalCollaborators }, access(sales)), /已启用/);
  assert.equal(data.requests[0].status, '待评估');
});
test('@非协作员工先保存加入协作，再发布留言，两次保存都通过权限校验', async t => {
  const { addMentionCollaborator } = await import('./supplement-mentions.ts');
  const { addSupplement } = await import('./request-supplements.ts');
  const record = draft(); const data = storage(t, record);
  const user = refs.users.find(user => user.id === pm.id);
  const joined = addMentionCollaborator(record, sales, user, true);
  await saveLocal('requests', joined, access(sales));
  assert.ok(data.requests[0].internalParticipants.some(person => person.userId === pm.id));
  const text = `@${user.name} 请核对`;
  const supplement = { id: 'mention', authorId: sales.id, author: sales.name, at: '2026-09-10T10:00:00Z', comment: text, files: [], externalVisible: false, mentions: [{ userId: user.id, name: user.name, start: 0, end: user.name.length + 1 }] };
  const posted = addSupplement(joined, sales, undefined, supplement, refs.users);
  await saveLocal('requests', posted, access(sales));
  assert.equal(data.requests[0].operations.supplements[0].mentions[0].userId, pm.id);
});

test('独立队列使用事务内最新规则拦截直接提交；失败不写入申请', async t => {
  const { submissionRulesId } = await import('./submission-rule-schema.ts');
  const { SubmissionValidationError, checkSubmissionQueue } = await import('./submission-validation.ts');
  const record = draft(), data = storage(t, record);
  const definition = { scope: 'all', events: ['submit', 'resubmit'], requirement: '必须填写申请说明', promptText: '请填写申请说明。' };
  const rule = { ...definition, id: 'custom', revision: 1, status: 'ready', active: { ...definition, enabled: true, summary: definition.requirement, compiled: { version: 1, checks: [{ mode: 'all', message: '请填写申请说明。', conditions: [{ fact: 'description', operator: 'not-empty', value: '' }] }] } } };
  assert.deepEqual(await checkSubmissionQueue(record, sales, ['submit']), []);
  data.references.push({ id: submissionRulesId, payload: [rule] });
  await assert.rejects(saveLocal('requests', { ...record, status: '待评估' }, access(sales)), error => error instanceof SubmissionValidationError && error.failures[0].ruleId === 'custom');
  assert.equal(data.requests[0].status, '草稿');
  await saveLocal('requests', record, access(sales)); // Ordinary draft saves do not trigger submission rules.
  await saveLocal('requests', { ...record, description: '已填写', status: '待评估' }, access(sales));
  assert.equal(data.requests[0].status, '待评估');
});

test('客户确认通过也经过自定义队列，失败不改变状态或客户决定', async t => {
  const { submissionRulesId } = await import('./submission-rule-schema.ts');
  const record = { ...draft(customer), status: '待确认', operations: { activities: [], assessment: { managerId: pm.id, rounds: [], plans: [], approvals: [], confirmation: { planId: 'p', at: '2026-09-11T00:00:00Z' } } } };
  const data = storage(t, record);
  const definition = { scope: 'customer', events: ['customer-accept'], requirement: '必须填写申请说明', promptText: '请补充申请说明。' };
  data.references.push({ id: submissionRulesId, payload: [{ ...definition, id: 'accept-check', status: 'ready', active: { ...definition, enabled: true, compiled: { version: 1, checks: [{ mode: 'all', message: '请补充申请说明。', conditions: [{ fact: 'description', operator: 'not-empty', value: '' }] }] } } }] });
  await assert.rejects(saveLocal('requests', applyCustomerDecision(record, customer, 'c1', true), access(customer)), /请补充申请说明/);
  assert.equal(data.requests[0].status, '待确认');
  assert.equal(data.requests[0].operations.customerDecisions, undefined);
});

test('规则持久化限制管理员、拒绝旧转译结果，并保留失败前的生效版本', async t => {
  const { saveRuleDraft, finishRuleCompilation, readSubmissionRules, toggleSubmissionRule } = await import('./submission-rule-store.ts');
  const data = storage(t, draft());
  const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
  const definition = { scope: 'all', events: ['submit'], requirement: '必须填写申请说明', promptText: '请填写申请说明。' };
  await assert.rejects(saveRuleDraft(sales, definition), /管理员/);
  await assert.rejects(saveRuleDraft({ ...sales, role: admin.role }, definition), /管理员/);
  const initial = await saveRuleDraft(admin, definition);
  const compiled = { version: 1, checks: [{ mode: 'all', message: '请填写申请说明。', conditions: [{ fact: 'description', operator: 'not-empty', value: '' }] }] };
  await finishRuleCompilation(admin, initial, { compiled, summary: definition.requirement });
  const active = (await readSubmissionRules())[0];
  assert.equal(active.active.enabled, true);
  const pending = await saveRuleDraft(admin, { ...definition, requirement: '新的要求' }, active);
  const newer = await saveRuleDraft(admin, { ...definition, requirement: '更新的要求' }, pending);
  await assert.rejects(finishRuleCompilation(admin, pending, { compiled, summary: '旧结果' }), /旧转译结果/);
  await finishRuleCompilation(admin, newer, { error: '无法表达' });
  const failed = (await readSubmissionRules())[0];
  assert.equal(failed.status, 'error'); assert.equal(failed.active.requirement, definition.requirement);
  assert.equal((await toggleSubmissionRule(admin, failed))[0].active.enabled, false);
  data.references.find(r => r.id === 'workspace').payload.users.find(u => u.id === admin.id).status = '停用';
  await assert.rejects(saveRuleDraft(admin, definition), /停用/);
});

test('自定义校验规则删除持久化并退出队列，拦截越权与旧版本，预置规则不可删除', async t => {
  const { saveRuleDraft, finishRuleCompilation, readSubmissionRules, toggleSubmissionRule, deleteSubmissionRule } = await import('./submission-rule-store.ts');
  const { runValidationQueue } = await import('./submission-validation.ts');
  const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
  const record = draft();
  const data = storage(t, record);
  const definition = { scope: 'all', events: ['submit'], requirement: '填写申请说明', promptText: '请填写申请说明。' };
  const pending = await saveRuleDraft(admin, definition);
  const compiled = { version: 1, checks: [{ mode: 'all', conditions: [{ fact: 'description', operator: 'not-empty', value: '' }], message: definition.promptText }] };
  await finishRuleCompilation(admin, pending, { compiled, summary: definition.requirement });
  const active = (await readSubmissionRules())[0];
  const fails = rules => runValidationQueue(record, { ...refs, currentActor: sales }, ['submit'], rules).some(failure => failure.ruleId === active.id);
  assert.equal(fails([active]), true);
  const disabled = (await toggleSubmissionRule(admin, active))[0];
  assert.equal(fails([disabled]), false);
  const enabled = (await toggleSubmissionRule(admin, disabled))[0];
  assert.equal(fails([enabled]), true);
  await assert.rejects(deleteSubmissionRule(sales, enabled), /管理员/);
  await assert.rejects(deleteSubmissionRule(admin, active), /其他页面/);
  await assert.rejects(deleteSubmissionRule(admin, { id: 'builtin-completeness', revision: 1 }), /系统预置/);
  const remaining = await deleteSubmissionRule(admin, enabled);
  assert.deepEqual(remaining, []);
  assert.deepEqual(await readSubmissionRules(), []);
  assert.equal(fails(remaining), false);
  await assert.rejects(finishRuleCompilation(admin, enabled, { compiled, summary: definition.requirement }), /已被移除/);
  const fresh = await saveRuleDraft(admin, definition);
  assert.deepEqual(await deleteSubmissionRule(admin, fresh), []);
  assert.deepEqual(data.requests[0], record);
});

test('测试后一次保存生效；拒绝未测试或内容变更，不重复调用 AI', async t => {
  const { saveTestedSubmissionRule, readSubmissionRules } = await import('./submission-rule-store.ts');
  const { testSubmissionRule } = await import('./submission-rule-conflicts.ts');
  storage(t, draft());
  const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
  const definition = { scope: 'all', events: ['submit'], requirement: '提前三天', promptText: '请提前三天预约' };
  const compiled = { version: 1, checks: [{ mode: 'all', message: '提示', conditions: [{ fact: 'expectedLeadDays', operator: 'gte', value: '3' }] }] };
  const tested = testSubmissionRule(definition, compiled, '至少提前3天', []);
  assert.deepEqual(await readSubmissionRules(), []);
  await assert.rejects(saveTestedSubmissionRule(admin, definition, undefined), /重新转译并测试/);
  await assert.rejects(saveTestedSubmissionRule(admin, { ...definition, requirement: '提前五天' }, tested), /重新转译并测试/);
  await assert.rejects(saveTestedSubmissionRule(admin, { ...definition, promptText: '' }, tested), /提示文本/);
  await assert.rejects(saveTestedSubmissionRule(sales, definition, tested), /管理员/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('保存不得调用 AI'); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const [saved] = await saveTestedSubmissionRule(admin, { ...definition, promptText: '新的提示' }, tested);
  assert.equal(saved.status, 'ready'); assert.equal(saved.revision, 1);
  assert.equal(saved.active.promptText, '新的提示');
  assert.deepEqual(saved.active.compiled, compiled);
  const [edited] = await saveTestedSubmissionRule(admin, definition, tested, saved);
  assert.equal(edited.revision, 2);
  await assert.rejects(saveTestedSubmissionRule(admin, definition, tested, saved), /其他页面修改/);
  assert.equal((await readSubmissionRules()).length, 1);
});

test('保存事务重查新增冲突，保留原版；停用规则重新启用也不能带入冲突', async t => {
  const { saveTestedSubmissionRule, toggleSubmissionRule, readSubmissionRules } = await import('./submission-rule-store.ts');
  const { testSubmissionRule, RuleConflictError } = await import('./submission-rule-conflicts.ts');
  storage(t, draft());
  const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
  const definition = { scope: 'all', events: ['submit'], requirement: '提前三天', promptText: '请调整日期' };
  const compile = operator => ({ version: 1, checks: [{ mode: 'all', message: '提示', conditions: [{ fact: 'expectedLeadDays', operator, value: '3' }] }] });
  const early = { ...definition, requirement: '少于三天' };
  const tested = testSubmissionRule(definition, compile('gte'), '至少三天', []);
  const earlyTest = testSubmissionRule(early, compile('lt'), '少于三天', []);
  const [saved] = await saveTestedSubmissionRule(admin, definition, tested);
  const before = await readSubmissionRules();
  await assert.rejects(saveTestedSubmissionRule(admin, early, earlyTest), e => e instanceof RuleConflictError && e.conflicts.length > 0);
  assert.deepEqual(await readSubmissionRules(), before);
  const [disabled] = await toggleSubmissionRule(admin, saved);
  await saveTestedSubmissionRule(admin, early, earlyTest);
  await assert.rejects(toggleSubmissionRule(admin, disabled), RuleConflictError);
  assert.equal((await readSubmissionRules())[0].active.enabled, false);
});

function withHiddenFields(record) {
  const item = record.items[0];
  item.config.fields = ['edition', 'installSfs', 'legacy-address'];
  item.config.fieldRequiredWhen = { installSfs: 'standard-or-enterprise', 'legacy-address': 'onsite' };
  item.values = { edition: '基础版', installSfs: '是', 'legacy-address': '历史地址' };
  return record;
}
test('直接保存和提交均在落库前清除隐藏字段，编辑输入保持原值', async t => {
  const record = withHiddenFields(draft());
  const data = storage(t, record);
  await saveLocal('requests', record, access(sales));
  assert.deepEqual(data.requests[0].items[0].values, { edition: '基础版' });
  assert.equal(record.items[0].values.installSfs, '是');
  await saveLocal('requests', { ...record, status: '待评估' }, access(sales));
  assert.deepEqual(data.requests[0].items[0].values, { edition: '基础版' });
  assert.equal(data.requests[0].status, '待评估');
});
test('保存校验失败时隐藏值仍留在编辑输入和原数据库中', async t => {
  const record = withHiddenFields(draft());
  const data = storage(t, record);
  const attempted = structuredClone(record);
  attempted.items[0].values.edition = '';
  attempted.status = '待评估';
  await assert.rejects(saveLocal('requests', attempted, access(sales)), /授权版本/);
  assert.equal(attempted.items[0].values.installSfs, '是');
  assert.equal(data.requests[0].items[0].values.installSfs, '是');
  assert.equal(data.requests[0].status, '草稿');
});
test('历史锁定请求可在合法保存时清理隐藏值，但不能借清理绕过字段修改权限', async t => {
  const record = { ...withHiddenFields(draft()), status: '待评估' };
  const data = storage(t, record);
  const tampered = structuredClone(record);
  tampered.items[0].values.installSfs = '篡改隐藏值';
  await assert.rejects(saveLocal('requests', tampered, access(sales)), /申请项/);
  assert.equal(data.requests[0].items[0].values.installSfs, '是');
  await saveLocal('requests', record, access(sales));
  assert.deepEqual(data.requests[0].items[0].values, { edition: '基础版' });
  await saveLocal('requests', structuredClone(data.requests[0]), access(sales));
});

for (const creator of [sales, customer]) test(`${creator.role}新建、加载和保存普通申请不自动添加硬件产品经理`, async t => {
  const record = draft(creator), data = storage(t);
  assert.equal(record.internalParticipants.some(person => person.userId === 'USR-008'), false);
  await saveLocal('requests', record, access(creator));
  assert.equal(data.requests[0].internalParticipants.some(person => person.userId === 'USR-008'), false);
  assert.equal(withRequestContact(data.requests[0], contacts, refs.customers, refs.users).internalParticipants.some(person => person.userId === 'USR-008'), false);
});
test('未分配评估的硬件产品经理作为普通协作人可移除，申请人和所有人身份仍固定', async t => {
  const { fixedInternalCollaboratorLabel } = await import('./request-collaboration.ts');
  assert.equal(fixedInternalCollaboratorLabel('USR-008'), undefined);
  assert.equal(fixedInternalCollaboratorLabel('USR-008', 'USR-008', 'USR-008'), '客户所有人 · 申请人');
  const record = draft();
  record.internalParticipants.push({ userId: 'USR-008', name: '沈川' });
  const data = storage(t, record);
  await saveLocal('requests', { ...record, internalParticipants: record.internalParticipants.filter(person => person.userId !== 'USR-008') }, access(sales));
  assert.equal(data.requests[0].internalParticipants.some(person => person.userId === 'USR-008'), false);
});
