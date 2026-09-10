import test from 'node:test';
import assert from 'node:assert/strict';
import { newRequest, newItem, defaultConfig, saveLocal, withRequestContact, requestCollaborationSaveIssue } from './service-requests.ts';
import { localInternalUsers } from './internal-users.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
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
  return record;
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
for (const actor of [sales, customer]) {
  test(`${actor.role}一次创建保存基本信息、多申请项、材料和协作人`, async t => {
    const record = draft(actor);
    record.description = '统一填写申请说明';
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
test('保存层拒绝业务影响空白的新建或提交，旧草稿填写后可正常提交', async t => {
  const record = { ...draft(), businessImpact: '' };
  const data = storage(t);
  await assert.rejects(saveLocal('requests', record, access(sales)), /业务影响/);
  assert.equal(data.requests.length, 0);
  data.requests = [structuredClone(record)];
  await assert.rejects(saveLocal('requests', { ...record, status: '待评估' }, access(sales)), /业务影响/);
  assert.equal(data.requests[0].status, '草稿');
  await saveLocal('requests', { ...record, businessImpact: '测试环境', status: '待评估' }, access(sales));
  assert.equal(data.requests[0].businessImpact, '测试环境');
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
test('项目经理发起确认时再次校验客户协作人，不接受空名单或失效联系人', async t => {
  const record = { ...draft(), status: '待评估', externalCollaborators: [], operations: { activities: [], assessment: { managerId: pm.id, rounds: [], plans: [], approvals: [] } } };
  const data = storage(t, record);
  const pending = { ...record, status: '待确认', operations: { ...record.operations, assessment: { ...record.operations.assessment, confirmation: { planId: 'p' } } } };
  await assert.rejects(saveLocal('requests', pending, access(pm)), /至少添加/);
  data.requests[0].externalCollaborators = [{ contactId: 'p1', name: '客户' }];
  data.references[0].payload.contacts[0].status = '停用';
  await assert.rejects(saveLocal('requests', { ...pending, externalCollaborators: data.requests[0].externalCollaborators }, access(pm)), /已启用/);
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
