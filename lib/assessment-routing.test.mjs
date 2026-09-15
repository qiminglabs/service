import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoutePredicate, emptyRoutingConfig, matchesRoute, routesOverlap, parseRoutingConfig, routingUsers, assessmentRoutingId } from './assessment-routing-schema.ts';
import { routeAssessmentOnSave, resolveAssessmentRoute, canPerformAssessmentRole } from './assessment-routing.ts';
import { compileAssessmentRouting } from './assessment-routing-compiler.ts';
import { saveRoutingPolicy, reassignRoutingRequest, routingTestKey } from './assessment-routing-store.ts';
import { localInternalUsers } from './internal-users.ts';
import { newRequest, newItem, defaultConfig, saveLocal, canEditRequestItems, canAccessRequest } from './service-requests.ts';
import { applyAssessmentAction, emptyAssessment } from './request-assessment.ts';
import { currentHardwareReview } from './request-hardware-assessment.ts';
const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
const manager = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const hardware = { id: 'USR-008', name: '沈川', role: 'SmartX 硬件产品经理' };
const sales = { id: 'USR-001', name: '王琪', role: 'SmartX 销售经理' };
const service = { id: 's1', name: '软件服务', priceUnit: '服务人天', deliveryMethods: ['远程', '现场'], status: '已启用', category: '交付' };
const hardwareService = { ...service, id: 'SC-IMP-008', name: '硬件兼容性测试' };
const customers = [{ id: 'c1', name: '甲公司', status: '启用', ownerUserId: sales.id }];
const contacts = [{ id: 'p1', name: '客户', customerId: 'c1', status: '启用' }];
const workspace = { customers, contacts, users: localInternalUsers, services: [service, hardwareService], assets: [], businessObjects: [] };
const access = actor => ({ actor, directory: localInternalUsers, contacts });
const condition = (field, value, operator = 'eq') => ({ field, value, operator });
const predicate = (conditions = [], items = []) => ({ version: 1, groups: [{ conditions, items }] });
const itemGroup = (conditions, mode = 'some') => ({ conditions, mode });
const internalOnly = predicate([condition('source', 'internal')]);
const hasHardware = predicate([], [itemGroup([condition('serviceId', hardwareService.id)])]);
const config = () => ({ ...emptyRoutingConfig(), revision: 1, manager: { defaultUserId: manager.id, rules: [] }, hardware: { defaultUserId: hardware.id, rules: [] } });
const item = s => newItem(s, { ...defaultConfig(s), fields: [], materials: [], basicFields: { description: { enabled: true, required: false } } });
function draft(withHardware = true) {
  const record = newRequest('路由测试', 'c1', sales.name, '', sales.id, sales.role, localInternalUsers[0]);
  record.businessImpact = '生产环境'; record.items = [item(withHardware ? hardwareService : service)];
  record.externalCollaborators = [{ contactId: 'p1', name: '客户', phone: '', email: '' }];
  record.internalParticipants.push({ userId: 'USR-002', name: '陈屿' });
  return record;
}
const submit = record => ({ ...record, status: '待评估', submittedAt: '2026-09-14T12:00:00Z', operations: { ...record.operations, assessment: emptyAssessment() } });
const assigned = (hasHardware = true) => { const d = draft(hasHardware); return routeAssessmentOnSave(submit(d), d, config(), localInternalUsers); };
const act = (r, action, actor) => applyAssessmentAction(r, action, actor, [], localInternalUsers, [], '2026-09-14T13:00:00Z', workspace.services, customers);
// Transactional in-memory adapter exercises actual IndexedDB save callbacks.
function storage(t, record, routing = config()) {
  const data = { requests: record ? [structuredClone(record)] : [], references: [{ id: 'workspace', payload: structuredClone(workspace) }, { id: assessmentRoutingId, payload: structuredClone(routing) }] };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = { open() { const req = {}; queueMicrotask(() => { req.result = { close() {}, transaction() {
    const staged = structuredClone(data); let pending = 0, aborted = false;
    const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore(name) {
      const run = fn => { const r = {}; pending++; queueMicrotask(() => { if (aborted) return; r.result = fn(); r.onsuccess?.(); pending--; if (!pending && !aborted) queueMicrotask(() => { if (!pending && !aborted) { Object.assign(data, staged); tx.oncomplete?.(); } }); }); return r; };
      return { get: id => run(() => staged[name].find(row => row.id === id)), getAll: () => run(() => staged[name]), put: record => run(() => { staged[name] = [...staged[name].filter(row => row.id !== record.id), structuredClone(record)]; }) };
    } }; return tx;
  } }; req.onsuccess?.(); }); return req; } };
  t.after(() => { globalThis.indexedDB = previous; }); return data;
}

test('同一申请项条件不能跨项拼接；多选服务方式只读取已选值', () => {
  const r = assigned(); r.items = [{ ...item(hardwareService), method: '远程' }, { ...item(service), method: '现场' }];
  const p = predicate([], [itemGroup([condition('serviceId', hardwareService.id), condition('method', '现场')])]);
  assert.equal(matchesRoute(r, p), false);
  r.items[0].method = '["现场","远程"]'; assert.equal(matchesRoute(r, p), true);
  r.items[0].method = '远程'; assert.equal(matchesRoute(r, p), false);
});
test('整单不包含、且、或与同一项匹配语义一致', () => {
  const r = assigned(false), none = predicate([], [itemGroup([condition('serviceId', hardwareService.id)], 'none')]);
  assert.equal(matchesRoute(r, none), true); r.items.push(item(hardwareService)); assert.equal(matchesRoute(r, none), false);
  assert.equal(matchesRoute(r, { version: 1, groups: [...predicate([condition('customerId', 'c2')]).groups, ...internalOnly.groups] }), true);
  assert.equal(matchesRoute(r, predicate([condition('customerId', 'c2'), condition('source', 'internal')])), false);
});
test('匹配白名单拒绝未知字段、客户、服务、方式和空条件', () => {
  for (const p of [predicate([condition('amount', '1')]), predicate([condition('customerId', 'unknown')]), predicate([], [itemGroup([condition('serviceId', 'unknown')])]), predicate([], [itemGroup([condition('method', '上门')])]), predicate()]) assert.throws(() => parseRoutePredicate(p, workspace));
  assert.deepEqual(parseRoutePredicate(hasHardware, workspace), hasHardware);
});
test('重叠检查识别互斥客户、否定冲突和硬件角色适用范围', () => {
  assert.equal(routesOverlap(internalOnly, hasHardware, 'hardware'), true);
  assert.equal(routesOverlap(predicate([condition('customerId', 'c1')]), predicate([condition('customerId', 'c2')]), 'manager'), false);
  const noHardware = predicate([], [itemGroup([condition('serviceId', hardwareService.id)], 'none')]);
  assert.equal(routesOverlap(noHardware, noHardware, 'manager'), true);
  assert.equal(routesOverlap(noHardware, noHardware, 'hardware'), true);
  assert.equal(routesOverlap(noHardware, noHardware, 'hardware', { enabled: true, serviceIds: [hardwareService.id] }), false);
  assert.equal(routesOverlap(hasHardware, noHardware, 'manager'), false);
});
test('按优先级首条命中，停用规则跳过，没有命中使用默认；停用人员不越级回退', () => {
  const c = config(), r = assigned();
  const rule = { id: 'r1', priority: 20, requirement: '内部申请', userId: manager.id, compiled: internalOnly, enabled: true };
  c.manager.rules = [rule, { ...rule, id: 'r2', priority: 10 }];
  assert.equal(resolveAssessmentRoute(r, 'manager', c, localInternalUsers).ruleId, 'r2');
  c.manager.rules[1].enabled = false; assert.equal(resolveAssessmentRoute(r, 'manager', c, localInternalUsers).ruleId, 'r1');
  c.manager.rules[0].compiled = predicate([condition('source', 'customer')]); assert.equal(resolveAssessmentRoute(r, 'manager', c, localInternalUsers).matchedBy, 'default');
  c.manager.rules[0].compiled = internalOnly; c.manager.rules[0].userId = hardware.id;
  assert.equal(resolveAssessmentRoute(r, 'manager', c, localInternalUsers).userId, '');
  assert.equal(resolveAssessmentRoute(assigned(false), 'hardware', c, localInternalUsers), undefined);
  assert.deepEqual(routingUsers(localInternalUsers, 'manager').map(u => u.id), [manager.id]);
  assert.throws(() => parseRoutingConfig({ ...c, manager: { ...c.manager, rules: [rule, { ...rule, id: 'dup' }] } }), /优先级/);
});
test('新提交分配两个角色；缺少配置进入待分配且不能绕过评估权限', async t => {
  const d = draft(), data = storage(t, d, emptyRoutingConfig());
  await saveLocal('requests', submit(d), access(sales));
  const pending = data.requests[0]; assert.equal(pending.status, '待评估');
  assert.equal(pending.operations.assessment.routing.manager.userId, ''); assert.equal(pending.operations.assessment.routing.hardware.userId, '');
  assert.equal(canEditRequestItems(pending, manager), false);
  assert.equal(canAccessRequest(pending, access(hardware)), false);
  assert.equal(canPerformAssessmentRole(pending, hardware, 'hardware', localInternalUsers), false);
  assert.throws(() => act(pending, { type: 'review', outcome: '需补充', opinion: '补充' }, manager), /负责/);
  assert.throws(() => act(pending, { type: 'hardware-review', outcome: '评估通过', opinion: '齐备' }, hardware));
  const forged = structuredClone(pending); forged.operations.assessment.routing.hardware.userId = hardware.id;
  await assert.rejects(saveLocal('requests', forged, access(admin)), /后台分配/);
});
test('真实保存闭环：新提交分配、硬件先通过、项目经理通过、冻结后禁止重分配', async t => {
  const d = draft(), data = storage(t, d);
  await saveLocal('requests', submit(d), access(sales)); let r = data.requests[0];
  assert.equal(r.operations.assessment.managerId, manager.id); assert.equal(r.operations.assessment.routing.hardware.userId, hardware.id);
  assert.equal(canAccessRequest(r, access(hardware)), true);
  assert.throws(() => act(r, { type: 'review', outcome: '评估通过', opinion: '通过' }, manager), /硬件产品经理/);
  await saveLocal('requests', act(r, { type: 'review', outcome: '需补充', opinion: '等待硬件' }, manager), access(manager)); r = data.requests[0];
  await saveLocal('requests', act(r, { type: 'hardware-review', outcome: '评估通过', opinion: '通过' }, hardware), access(hardware)); r = data.requests[0];
  await saveLocal('requests', act(r, { type: 'review', outcome: '评估通过', opinion: '通过' }, manager), access(manager)); r = data.requests[0];
  assert.equal(r.operations.assessment.rounds.at(-1).outcome, '评估通过');
  await assert.rejects(reassignRoutingRequest(admin, r.id, 'hardware', '调整', r.updatedAt, 1), /通过前/);
});
test('评估阶段新增硬件自动分配，删除后重加不复用旧结论；项目经理保持原分配', async t => {
  const r = assigned(false), data = storage(t, r), managerAllocation = r.operations.assessment.routing.manager.id;
  const added = structuredClone(r); added.items.push(item(hardwareService));
  await saveLocal('requests', added, access(manager)); let latest = data.requests[0];
  assert.equal(latest.operations.assessment.routing.hardware.userId, hardware.id);
  assert.equal(latest.operations.assessment.routing.manager.id, managerAllocation);
  await saveLocal('requests', act(latest, { type: 'hardware-review', outcome: '评估通过', opinion: '通过' }, hardware), access(hardware));
  latest = structuredClone(data.requests[0]); latest.items = latest.items.filter(i => i.serviceId !== hardwareService.id);
  await saveLocal('requests', latest, access(manager)); assert.equal(data.requests[0].operations.assessment.routing.hardware, undefined);
  latest = structuredClone(data.requests[0]); latest.items.push(item(hardwareService));
  await saveLocal('requests', latest, access(manager)); assert.equal(currentHardwareReview(data.requests[0]), undefined);
  assert.equal(data.requests[0].operations.assessment.routing.manager.id, managerAllocation);
});
test('配置修改不自动覆盖已有分配；管理员显式重新分配会归档并使硬件结论失效', async t => {
  const reviewed = act(assigned(), { type: 'hardware-review', outcome: '评估通过', opinion: '齐备' }, hardware), data = storage(t, reviewed);
  const oldId = reviewed.operations.assessment.routing.hardware.id;
  const c = await saveRoutingPolicy(admin, 'hardware', { defaultUserId: '', rules: [] }, 1);
  await saveLocal('requests', reviewed, access(manager)); assert.equal(data.requests[0].operations.assessment.routing.hardware.id, oldId);
  assert.equal(currentHardwareReview(data.requests[0]).outcome, '评估通过');
  await assert.rejects(reassignRoutingRequest(manager, reviewed.id, 'hardware', '调整', reviewed.updatedAt, c.revision), /管理员/);
  await assert.rejects(reassignRoutingRequest(admin, reviewed.id, 'hardware', '调整', 'stale', c.revision), /已变化/);
  const next = await reassignRoutingRequest(admin, reviewed.id, 'hardware', '重新确定负责人', reviewed.updatedAt, c.revision);
  assert.equal(next.operations.assessment.routing.hardware.userId, ''); assert.equal(currentHardwareReview(next), undefined);
  assert.equal(next.operations.assessment.routing.history.at(-1).allocation.id, oldId);
  assert.equal(next.operations.assessment.routing.manager.userId, manager.id);
  await assert.rejects(saveLocal('requests', reviewed, access(hardware)), /后台.*管理|后台分配/);
});
test('负责人停用后拒绝保存评估；路由权限校验不只依赖按钮', async t => {
  const r = assigned(), data = storage(t, r);
  const reviewed = act(r, { type: 'hardware-review', outcome: '评估通过', opinion: '齐备' }, hardware);
  data.references.find(r => r.id === 'workspace').payload.users.find(u => u.id === hardware.id).status = '停用';
  await assert.rejects(saveLocal('requests', reviewed, access(hardware)), /分配的硬件/);
  assert.equal(data.requests[0].operations.assessment.hardware, undefined);
  const managerReview = act(r, { type: 'review', outcome: '需补充', opinion: '补充' }, manager);
  await assert.rejects(saveLocal('requests', managerReview, access(admin)), /分配的项目经理/);
});
test('退回草稿归档分配记录，重新提交按最新配置分配', async t => {
  const r = assigned(), data = storage(t, r), originalId = r.operations.assessment.routing.manager.id;
  await saveLocal('requests', act(r, { type: 'return-draft', reason: '重新申请' }, manager), access(manager));
  const returned = data.requests[0]; assert.equal(returned.operations.assessment.routing, undefined);
  assert.equal(returned.operations.assessmentHistory.at(-1).routing.manager.id, originalId);
  await saveRoutingPolicy(admin, 'manager', { defaultUserId: '', rules: [] }, 1);
  await saveLocal('requests', submit(returned), access(sales));
  assert.equal(data.requests[0].operations.assessment.routing.manager.userId, '');
  assert.equal(data.requests[0].operations.assessment.routing.hardware.userId, hardware.id);
});
test('后台规则保存要求有效测试结果、当前版本和已启用管理员，两个页签互不覆盖', async t => {
  const data = storage(t, assigned());
  const rule = { id: 'test-rule', requirement: '内部申请', priority: 10, userId: manager.id, enabled: true, compiled: internalOnly };
  await assert.rejects(saveRoutingPolicy(admin, 'manager', { defaultUserId: manager.id, rules: [rule] }, 1), /转译并测试/);
  const receipt = { key: routingTestKey(rule), compiled: internalOnly };
  let saved = await saveRoutingPolicy(admin, 'manager', { defaultUserId: manager.id, rules: [rule] }, 1, receipt);
  assert.equal(saved.hardware.defaultUserId, hardware.id);
  await assert.rejects(saveRoutingPolicy(admin, 'hardware', saved.hardware, 1), /其他页面/);
  await assert.rejects(saveRoutingPolicy(sales, 'hardware', saved.hardware, 2), /管理员/);
  await assert.rejects(saveRoutingPolicy(admin, 'manager', { defaultUserId: hardware.id, rules: [rule] }, 2), /角色不符/);
  const changed = { ...rule, requirement: '客户申请' };
  await assert.rejects(saveRoutingPolicy(admin, 'manager', { defaultUserId: manager.id, rules: [changed] }, 2, receipt), /转译并测试/);
  saved = await saveRoutingPolicy(admin, 'manager', { ...saved.manager, rules: [{ ...rule, enabled: false }] }, 2);
  assert.equal(saved.manager.rules[0].enabled, false);
  data.references.find(r => r.id === 'workspace').payload.users.find(u => u.id === admin.id).status = '停用';
  await assert.rejects(saveRoutingPolicy(admin, 'hardware', saved.hardware, saved.revision), /已启用/);
  await assert.rejects(saveLocal('references', { id: assessmentRoutingId, payload: emptyRoutingConfig() }), /服务请求流程/);
});
for (const role of ['manager', 'hardware']) test(`${role} 分配规则支持停用、重新启用和删除，保留另一类配置及已分配请求`, async t => {
  const record = assigned();
  const data = storage(t, record);
  const userId = role === 'manager' ? manager.id : hardware.id;
  const other = role === 'manager' ? 'hardware' : 'manager';
  const rule = { id: `delete-${role}`, requirement: '内部申请', priority: 1, userId, enabled: true, compiled: internalOnly };
  let saved = await saveRoutingPolicy(admin, role, { defaultUserId: userId, rules: [rule] }, 1, { key: routingTestKey(rule), compiled: internalOnly });
  const otherPolicy = structuredClone(saved[other]);
  saved = await saveRoutingPolicy(admin, role, { ...saved[role], rules: [{ ...rule, enabled: false }] }, saved.revision);
  assert.equal(saved[role].rules[0].enabled, false);
  const staleRevision = saved.revision;
  saved = await saveRoutingPolicy(admin, role, { ...saved[role], rules: [rule] }, saved.revision);
  await assert.rejects(saveRoutingPolicy(admin, role, { ...saved[role], rules: [] }, staleRevision), /其他页面/);
  await assert.rejects(saveRoutingPolicy(sales, role, { ...saved[role], rules: [] }, saved.revision), /管理员/);
  assert.equal(data.references.find(ref => ref.id === assessmentRoutingId).payload[role].rules.length, 1);
  saved = await saveRoutingPolicy(admin, role, { ...saved[role], rules: [] }, saved.revision);
  assert.deepEqual(saved[role].rules, []);
  assert.equal(saved[role].defaultUserId, userId);
  assert.deepEqual(saved[other], otherPolicy);
  assert.deepEqual(data.requests[0], record);
});

test('AI 编译使用结构化输出并重新校验目录，未配置和无法表达均不保存', async () => {
  const input = { requirement: '内部提交的申请', dictionary: { customers, services: [service, hardwareService] } };
  const model = { key: 'test-key', model: 'test-model' }; let sent;
  const reply = payload => async (_url, options) => { sent = JSON.parse(options.body); return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }] }); };
  assert.equal((await compileAssessmentRouting(input, {})).status, 503);
  const result = await compileAssessmentRouting(input, model, reply({ supported: true, explanation: '内部申请', groups: internalOnly.groups }));
  assert.equal(result.status, 200); assert.deepEqual(result.compiled, internalOnly);
  assert.equal(sent.text.format.strict, true); assert.equal(sent.store, false); assert.equal(JSON.parse(sent.input).dictionary.users, undefined);
  const unknown = predicate([condition('customerId', 'missing')]);
  assert.equal((await compileAssessmentRouting(input, model, reply({ supported: true, explanation: '客户', groups: unknown.groups }))).status, 502);
  const unsupported = await compileAssessmentRouting(input, model, reply({ supported: false, explanation: '重要客户暂无明确字段', groups: [] }));
  assert.equal(unsupported.status, 422); assert.match(unsupported.error, /重要客户/);
  assert.equal((await compileAssessmentRouting(input, model, async () => Response.json({ status: 'incomplete', output: [] }))).status, 502);
});

test('提交预检和实际保存使用同一分配结果，未提交时不写入分配', async t => {
  const { checkSubmissionQueue } = await import('./submission-validation.ts');
  const { submissionRulesId } = await import('./submission-rule-schema.ts');
  const d = draft(), data = storage(t, d);
  const definition = { scope: 'all', events: ['submit'], requirement: '已分配项目经理', promptText: '请配置项目经理' };
  data.references.push({ id: submissionRulesId, payload: [{ ...definition, id: 'require-manager', revision: 1, status: 'ready', active: { ...definition, enabled: true, summary: '已分配项目经理', compiled: { version: 1, checks: [{ mode: 'all', conditions: [{ fact: 'managerAssigned', operator: 'eq', value: 'true' }], message: '缺少经理' }] } } }] });
  assert.equal((await checkSubmissionQueue(d, sales, ['submit'])).some(f => f.ruleId === 'require-manager'), false);
  assert.equal(data.requests[0].operations?.assessment?.routing, undefined);
  data.references.find(r => r.id === assessmentRoutingId).payload.manager.defaultUserId = '';
  assert.equal((await checkSubmissionQueue(d, sales, ['submit'])).some(f => f.ruleId === 'require-manager'), true);
  await assert.rejects(saveLocal('requests', submit(d), access(sales)), /请配置项目经理/);
  assert.equal(data.requests[0].status, '草稿');
});
test('额外未支持条件不能被静默丢弃', () => {
  assert.throws(() => parseRoutePredicate({ ...internalOnly, region: '华东' }), /不支持/);
  assert.throws(() => parseRoutePredicate(predicate([{ ...condition('source', 'internal'), customerTier: '重要' }])), /不支持/);
});

test('同名客户不能由 AI 猜测，必须提供明确编号', async () => {
  const input = { requirement: '甲公司的申请', dictionary: { customers: [...customers, { id: 'c2', name: '甲公司' }], services: [service] } };
  const transport = async () => Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ supported: true, explanation: '甲公司', groups: predicate([condition('customerId', 'c1')]).groups }) }] }] });
  const model = { key: 'test-key', model: 'test-model' };
  const ambiguous = await compileAssessmentRouting(input, model, transport);
  assert.equal(ambiguous.status, 422); assert.match(ambiguous.error, /同名/);
  assert.equal((await compileAssessmentRouting({ ...input, requirement: '客户编号 c1 的申请' }, model, transport)).status, 200);
});

test('客户负责团队动态匹配，新增客户也适用，缺失属性不匹配否定条件', () => {
  const financial = predicate([condition('customerTeam', '金融')]);
  const nonFinancial = predicate([condition('customerTeam', '金融', 'ne')]);
  const r = assigned();
  assert.deepEqual(parseRoutePredicate(financial, workspace), financial);
  assert.equal(matchesRoute(r, financial, [{ id: 'c1', name: '客户', team: '金融' }]), true);
  assert.equal(matchesRoute(r, financial, [{ id: 'c1', name: '客户', team: '商业' }]), false);
  assert.equal(matchesRoute(r, nonFinancial, [{ id: 'c1', name: '客户', team: '商业' }]), true);
  assert.equal(matchesRoute(r, financial, customers), false);
  assert.equal(matchesRoute(r, nonFinancial, customers), false);
  assert.equal(matchesRoute(r, nonFinancial, []), false);
  assert.equal(matchesRoute(r, nonFinancial, [{ id: 'c1', name: '客户', team: '未知' }]), false);
  assert.equal(matchesRoute({ ...r, customerId: 'future' }, financial, [{ id: 'future', name: '新客户', team: '金融' }]), true);
  assert.throws(() => parseRoutePredicate(predicate([condition('customerTeam', '互联网')])), /团队/);
  assert.throws(() => parseRoutePredicate(predicate([condition('industry', '金融')])), /不支持/);
});
test('团队条件的且或、互斥与规则重叠检查保持一致', () => {
  const financial = predicate([condition('customerTeam', '金融')]);
  const commercial = predicate([condition('customerTeam', '商业')]);
  const both = predicate([condition('customerTeam', '金融'), condition('customerTeam', '商业')]);
  assert.equal(routesOverlap(financial, commercial, 'manager'), false);
  assert.equal(routesOverlap(both, both, 'hardware'), false);
  assert.equal(routesOverlap(financial, internalOnly, 'hardware'), true);
  const either = { version: 1, groups: [...financial.groups, ...commercial.groups] };
  assert.equal(matchesRoute(assigned(), either, [{ id: 'c1', name: '客户', team: '商业' }]), true);
});
test('团队分配从存储中的最新客户资料读取，两个角色、预检与重新分配均适用', async t => {
  const { checkSubmissionQueue } = await import('./submission-validation.ts');
  const { submissionRulesId } = await import('./submission-rule-schema.ts');
  const d = draft(), c = config();
  const financial = predicate([condition('customerTeam', '金融')]);
  const rule = { id: 'financial', priority: 10, requirement: '所属团队为金融', userId: manager.id, enabled: true, compiled: financial };
  c.manager = { defaultUserId: '', rules: [rule] };
  c.hardware = { defaultUserId: '', rules: [{ ...rule, userId: hardware.id }] };
  const data = storage(t, d, c);
  data.references.find(r => r.id === 'workspace').payload.customers[0].team = '金融';
  const definition = { scope: 'all', events: ['submit'], requirement: '已分配项目经理', promptText: '请配置项目经理' };
  data.references.push({ id: submissionRulesId, payload: [{ ...definition, id: 'require-manager', revision: 1, status: 'ready', active: { ...definition, enabled: true, summary: '已分配项目经理', compiled: { version: 1, checks: [{ mode: 'all', conditions: [{ fact: 'managerAssigned', operator: 'eq', value: 'true' }], message: '缺少经理' }] } } }] });
  assert.equal((await checkSubmissionQueue(d, sales, ['submit'])).some(f => f.ruleId === 'require-manager'), false);
  await saveLocal('requests', submit(d), access(sales));
  let latest = data.requests[0];
  assert.equal(latest.operations.assessment.routing.manager.ruleId, 'financial');
  assert.equal(latest.operations.assessment.routing.hardware.ruleId, 'financial');
  data.references.find(r => r.id === 'workspace').payload.customers[0].team = '商业';
  await saveLocal('requests', latest, access(manager));
  assert.equal(data.requests[0].operations.assessment.routing.manager.userId, manager.id);
  latest = await reassignRoutingRequest(admin, latest.id, 'hardware', '按最新客户团队重新分配', latest.updatedAt, 1);
  assert.equal(latest.operations.assessment.routing.hardware.userId, '');
});
test('评估阶段新增硬件项也按客户负责团队分配', async t => {
  const r = assigned(false), c = config();
  c.hardware = { defaultUserId: '', rules: [{ id: 'hardware-financial', priority: 10, requirement: '金融团队', userId: hardware.id, enabled: true, compiled: predicate([condition('customerTeam', '金融')]) }] };
  const data = storage(t, r, c);
  data.references.find(r => r.id === 'workspace').payload.customers[0].team = '金融';
  const next = structuredClone(r); next.items.push(item(hardwareService));
  await saveLocal('requests', next, access(manager));
  assert.equal(data.requests[0].operations.assessment.routing.hardware.ruleId, 'hardware-financial');
});
test('AI 转译字典和输出协议包含负责团队，输出保留属性条件', async () => {
  const { parseRoutingDictionary, describeRoute } = await import('./assessment-routing-schema.ts');
  const dictionary = { customers: [{ id: 'c1', name: '客户', team: '金融' }], services: [service] };
  assert.equal(parseRoutingDictionary(dictionary).customers[0].team, '金融');
  let sent;
  const compiled = predicate([condition('customerTeam', '金融')]);
  const result = await compileAssessmentRouting({ requirement: '所有团队为金融', dictionary }, { key: 'test-key', model: 'test-model' }, async (_, options) => {
    sent = JSON.parse(options.body);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ supported: true, explanation: '负责团队为金融', groups: compiled.groups }) }] }] });
  });
  assert.equal(result.status, 200); assert.deepEqual(result.compiled, compiled);
  assert.equal(JSON.parse(sent.input).dictionary.customers[0].team, '金融');
  assert.ok(sent.text.format.schema.properties.groups.items.properties.conditions.items.properties.field.enum.includes('customerTeam'));
  assert.match(result.summary, /客户负责团队为「金融」/);
  assert.match(describeRoute(compiled, dictionary), /客户负责团队/);
});

test('旧分配配置迁移出可编辑触发条件，默认只来自初始配置', async () => {
  const { defaultHardwareAssessmentTrigger, parseHardwareAssessmentTrigger } = await import('./hardware-assessment-trigger.ts');
  const migrated = parseRoutingConfig(config());
  assert.deepEqual(migrated.hardware.trigger, defaultHardwareAssessmentTrigger());
  assert.deepEqual(parseRoutingConfig({ ...config(), hardware: { ...config().hardware, trigger: { enabled: false, serviceIds: [] } } }).hardware.trigger, { enabled: false, serviceIds: [] });
  assert.throws(() => parseHardwareAssessmentTrigger({ enabled: true, serviceIds: [] }), /至少一个/);
  assert.throws(() => parseHardwareAssessmentTrigger({ enabled: true, serviceIds: [service.id, service.id] }));
});
test('后台更换触发服务后普通服务可加入硬件评估，原硬件服务不再自动触发', async t => {
  const d = draft(false), data = storage(t, d);
  const c = await saveRoutingPolicy(admin, 'hardware', { ...config().hardware, trigger: { enabled: true, serviceIds: [service.id] } }, 1);
  assert.deepEqual(c.hardware.trigger.serviceIds, [service.id]);
  const originalHardware = draft(true);
  assert.equal(resolveAssessmentRoute(submit(originalHardware), 'hardware', c, localInternalUsers), undefined);
  await saveLocal('requests', submit(d), access(sales));
  let r = data.requests[0];
  assert.deepEqual(r.operations.assessment.hardwareRequirement.serviceIds, [service.id]);
  assert.equal(r.operations.assessment.routing.hardware.userId, hardware.id);
  assert.equal(canAccessRequest(r, access(hardware)), true);
  assert.throws(() => act(r, { type: 'review', outcome: '评估通过', opinion: '通过' }, manager), /硬件产品经理/);
  await saveLocal('requests', act(r, { type: 'hardware-review', outcome: '评估通过', opinion: '普通服务专项评估通过' }, hardware), access(hardware));
  r = data.requests[0];
  assert.deepEqual(r.operations.assessment.hardware.rounds.at(-1).itemIds, [r.items[0].id]);
  await saveLocal('requests', act(r, { type: 'review', outcome: '评估通过', opinion: '整体通过' }, manager), access(manager));
});
test('关闭触发后含原硬件服务的新请求不加硬件评估，项目经理可直接评估通过', async t => {
  const d = draft(), data = storage(t, d);
  const c = await saveRoutingPolicy(admin, 'hardware', { ...config().hardware, trigger: { enabled: false, serviceIds: [hardwareService.id] } }, 1);
  assert.equal(c.hardware.trigger.enabled, false);
  await saveLocal('requests', submit(d), access(sales));
  const r = data.requests[0];
  assert.deepEqual(r.operations.assessment.hardwareRequirement.serviceIds, []);
  assert.equal(r.operations.assessment.routing.hardware, undefined);
  assert.equal(canAccessRequest(r, access(hardware)), false);
  assert.throws(() => act(r, { type: 'hardware-review', outcome: '评估通过', opinion: '通过' }, hardware), /未命中/);
  await saveLocal('requests', act(r, { type: 'review', outcome: '评估通过', opinion: '整体通过' }, manager), access(manager));
  assert.equal(data.requests[0].operations.assessment.rounds.at(-1).outcome, '评估通过');
});
test('配置更新不改变已有请求的本轮触发条件，增删服务项按本轮条件重新匹配', async t => {
  const d = draft(false), initial = config(); initial.hardware.trigger = { enabled: true, serviceIds: [hardwareService.id] };
  const data = storage(t, d, initial);
  await saveLocal('requests', submit(d), access(sales));
  const original = structuredClone(data.requests[0].operations.assessment.hardwareRequirement);
  await saveRoutingPolicy(admin, 'hardware', { ...initial.hardware, trigger: { enabled: false, serviceIds: [] } }, 1);
  let r = structuredClone(data.requests[0]); r.items.push(item(hardwareService));
  await saveLocal('requests', r, access(manager)); r = data.requests[0];
  assert.deepEqual(r.operations.assessment.hardwareRequirement, original);
  assert.equal(r.operations.assessment.routing.hardware.userId, hardware.id);
  const forged = structuredClone(r); forged.operations.assessment.hardwareRequirement.serviceIds = [];
  await assert.rejects(saveLocal('requests', forged, access(manager)), /后台流程管理/);
  r = structuredClone(r); r.items = r.items.filter(item => item.serviceId !== hardwareService.id);
  await saveLocal('requests', r, access(manager));
  assert.equal(data.requests[0].operations.assessment.routing.hardware, undefined);
});
test('已有请求显式应用当前配置可添加或取消硬件评估，保留评估和分配历史', async t => {
  const r = assigned(false), data = storage(t, r);
  let c = await saveRoutingPolicy(admin, 'hardware', { ...config().hardware, trigger: { enabled: true, serviceIds: [service.id] } }, 1);
  let latest = await reassignRoutingRequest(admin, r.id, 'hardware', '增加专项评估', r.updatedAt, c.revision);
  assert.equal(latest.operations.assessment.routing.hardware.userId, hardware.id);
  assert.throws(() => act(latest, { type: 'review', outcome: '评估通过', opinion: '通过' }, manager), /硬件产品经理/);
  await saveLocal('requests', act(latest, { type: 'hardware-review', outcome: '评估通过', opinion: '通过' }, hardware), access(hardware));
  latest = data.requests[0];
  c = await saveRoutingPolicy(admin, 'hardware', { ...c.hardware, trigger: { enabled: false, serviceIds: [] } }, c.revision);
  const oldOwner = latest.operations.assessment.routing.hardware.id;
  latest = await reassignRoutingRequest(admin, latest.id, 'hardware', '取消专项评估', latest.updatedAt, c.revision);
  assert.deepEqual(latest.operations.assessment.hardwareRequirement.serviceIds, []);
  assert.equal(latest.operations.assessment.routing.hardware, undefined);
  assert.equal(latest.operations.assessment.routing.history.at(-1).allocation.id, oldOwner);
  assert.equal(latest.operations.assessment.hardware.rounds.length, 1);
  assert.ok(latest.operations.assessment.hardware.rounds[0].invalidatedAt);
  await saveLocal('requests', act(latest, { type: 'review', outcome: '评估通过', opinion: '整体通过' }, manager), access(manager));
  c = await saveRoutingPolicy(admin, 'hardware', { ...c.hardware, trigger: { enabled: true, serviceIds: [service.id] } }, c.revision);
  await assert.rejects(reassignRoutingRequest(admin, latest.id, 'hardware', '不能改变已通过流程', data.requests[0].updatedAt, c.revision), /通过前/);
});
test('触发配置保存检查权限、版本和服务存在性，旧客户端不能覆盖新触发条件', async t => {
  const data = storage(t, assigned());
  const policy = { ...config().hardware, trigger: { enabled: true, serviceIds: [service.id, hardwareService.id] } };
  await assert.rejects(saveRoutingPolicy(manager, 'hardware', policy, 1), /管理员/);
  await assert.rejects(saveRoutingPolicy(admin, 'hardware', { ...policy, trigger: { enabled: true, serviceIds: ['missing'] } }, 1), /不存在/);
  const c = await saveRoutingPolicy(admin, 'hardware', policy, 1);
  await assert.rejects(saveRoutingPolicy(admin, 'hardware', config().hardware, 1), /其他页面/);
  const updated = await saveRoutingPolicy(admin, 'hardware', config().hardware, c.revision);
  assert.deepEqual(updated.hardware.trigger, policy.trigger);
  data.references.find(r => r.id === 'workspace').payload.users.find(u => u.id === hardware.id).status = '停用';
  const disabled = await saveRoutingPolicy(admin, 'hardware', { ...updated.hardware, trigger: { enabled: false, serviceIds: [] } }, updated.revision);
  assert.equal(disabled.hardware.trigger.enabled, false);
});
test('多服务触发按任一项匹配，规则重叠检查读取所选服务而非固定硬件ID', () => {
  const c = config(); c.hardware.trigger = { enabled: true, serviceIds: [service.id, hardwareService.id] };
  assert.ok(resolveAssessmentRoute(assigned(false), 'hardware', c, localInternalUsers));
  assert.ok(resolveAssessmentRoute(assigned(), 'hardware', c, localInternalUsers));
  const noOriginalHardware = predicate([], [itemGroup([condition('serviceId', hardwareService.id)], 'none')]);
  assert.equal(routesOverlap(noOriginalHardware, noOriginalHardware, 'hardware', c.hardware.trigger), true);
  assert.equal(routesOverlap(noOriginalHardware, noOriginalHardware, 'hardware', { enabled: true, serviceIds: [hardwareService.id] }), false);
  assert.equal(routesOverlap(internalOnly, internalOnly, 'hardware', { enabled: false, serviceIds: [] }), false);
});

test('分配成功即添加评估负责人，无需等待填写评估；标记固定且拒绝直接移除', async t => {
  const { fixedInternalCollaboratorLabel, hardwareCollaboratorId } = await import('./request-collaboration.ts');
  const d = draft(), data = storage(t, d);
  assert.equal(d.internalParticipants.some(person => person.userId === hardware.id), false);
  await saveLocal('requests', submit(d), access(sales));
  const record = data.requests[0];
  assert.equal(record.operations.assessment.hardware, undefined);
  assert.equal(record.internalParticipants.filter(person => person.userId === hardware.id).length, 1);
  assert.equal(fixedInternalCollaboratorLabel(hardware.id, undefined, undefined, hardwareCollaboratorId(record)), '硬件产品经理');
  const removed = { ...record, internalParticipants: record.internalParticipants.filter(person => person.userId !== hardware.id) };
  for (const actor of [sales, manager, admin, hardware]) await assert.rejects(saveLocal('requests', removed, access(actor)), /硬件产品经理.*不允许移除/);
  assert.deepEqual(data.requests[0], record);
});
test('硬件待分配不加人，管理员补充分配时加入；重复分配不重复添加', async t => {
  const d = draft(), data = storage(t, d, emptyRoutingConfig());
  await saveLocal('requests', submit(d), access(sales));
  assert.equal(data.requests[0].internalParticipants.some(person => person.userId === hardware.id), false);
  const saved = await saveRoutingPolicy(admin, 'hardware', config().hardware, 0);
  await reassignRoutingRequest(admin, d.id, 'hardware', '补充分配', data.requests[0].updatedAt, saved.revision);
  assert.equal(data.requests[0].internalParticipants.filter(person => person.userId === hardware.id).length, 1);
  await reassignRoutingRequest(admin, d.id, 'hardware', '再次分配', data.requests[0].updatedAt, saved.revision);
  assert.equal(data.requests[0].internalParticipants.filter(person => person.userId === hardware.id).length, 1);
});
test('评估阶段新增触发服务项后分配并加入硬件产品经理', async t => {
  const d = draft(false), data = storage(t, d);
  await saveLocal('requests', submit(d), access(sales));
  assert.equal(data.requests[0].internalParticipants.some(person => person.userId === hardware.id), false);
  const changed = { ...data.requests[0], items: [...data.requests[0].items, item(hardwareService)] };
  await saveLocal('requests', changed, access(manager));
  assert.equal(data.requests[0].operations.assessment.routing.hardware.userId, hardware.id);
  assert.equal(data.requests[0].internalParticipants.filter(person => person.userId === hardware.id).length, 1);
});
test('客户提交硬件申请时系统分配并加入协作人，后续客户保存不视为修改内部协作人', async t => {
  const actor = { id: 'p1', name: '客户', role: '客户' };
  const d = { ...draft(), createdById: actor.id, createdBy: actor.name, owner: actor.name, createdByAudience: 'customer' };
  const data = storage(t, d);
  const customerAccess = { ...access(actor), customerId: 'c1' };
  await saveLocal('requests', submit(d), customerAccess);
  assert.equal(data.requests[0].internalParticipants.filter(person => person.userId === hardware.id).length, 1);
  await saveLocal('requests', data.requests[0], customerAccess);
  assert.equal(data.requests[0].internalParticipants.filter(person => person.userId === hardware.id).length, 1);
});
