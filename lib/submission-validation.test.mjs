import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCompiledRule, parseRuleDefinition, submissionRulesId, ruleEvents } from './submission-rule-schema.ts';
import { runValidationQueue, validationEventsForTransition, submissionEvent } from './submission-validation.ts';
import { compileSubmissionRule, ruleCompilerRequest } from './submission-rule-compiler.ts';
import { newRequest, newItem, defaultConfig } from './service-requests.ts';
import { localInternalUsers } from './internal-users.ts';
const actor = { id: 'USR-001', name: '销售', role: 'SmartX 销售经理' };
const service = { id: 's', name: '培训', priceUnit: '服务人天', deliveryMethods: ['远程'], status: '已启用' };
const refs = { customers: [{ id: 'c1', name: '公司', status: '启用' }], contacts: [{ id: 'p1', customerId: 'c1', status: '启用' }], users: localInternalUsers, services: [service], businessObjects: [], currentActor: actor };
function request() {
  const record = newRequest('申请', 'c1', actor.name, '', actor.id, actor.role);
  record.businessImpact = '生产环境';
  record.internalParticipants.push({ userId: 'USR-002', name: '售前' });
  record.externalCollaborators = [{ contactId: 'p1', name: '客户' }];
  record.items = [newItem(service, { ...defaultConfig(service), fields: [], materials: [], basicFields: { description: { enabled: true, required: false } } })];
  return record;
}
const definition = { scope: 'all', events: ['submit', 'resubmit'], requirement: '必须填写申请说明。', promptText: '请填写申请说明。' };
const check = { mode: 'all', message: '请填写申请说明。', conditions: [{ fact: 'description', operator: 'not-empty', value: '' }] };
const compiled = { version: 1, checks: [check] };
const rule = { ...definition, id: 'custom-1', revision: 1, status: 'ready', updatedBy: '管理员', updatedAt: '2026-09-11T00:00:00Z', active: { ...definition, compiled, enabled: true, summary: definition.requirement } };

test('已移除的业务影响不能再转译；引用它的旧规则保留原文并停用，不阻止提交', async () => {
  const { normalizeStoredSubmissionRule, factCatalog } = await import('./submission-rule-schema.ts');
  assert.equal(Object.hasOwn(factCatalog, 'businessImpact'), false);
  const legacy = { ...rule, requirement: '业务影响必须为生产环境', active: { ...rule.active, compiled: { version: 1, checks: [{ ...check, conditions: [{ fact: 'businessImpact', operator: 'eq', value: '生产环境' }] }] } } };
  assert.throws(() => parseCompiledRule(legacy.active.compiled));
  const normalized = normalizeStoredSubmissionRule(legacy);
  assert.equal(normalized.active.enabled, false);
  assert.equal(normalized.requirement, legacy.requirement);
  assert.match(normalized.error, /字段已移除/);
  assert.deepEqual(normalizeStoredSubmissionRule(normalized), normalized);
  const record = request();
  delete record.businessImpact;
  assert.deepEqual(runValidationQueue(record, refs, ['submit'], [legacy]), []);
  assert.equal(legacy.active.enabled, true, '读取迁移不修改原始记录');
});

test('所有启用规则按范围、时机执行；汇总失败且不修改申请', () => {
  const r = request(), before = structuredClone(r);
  assert.deepEqual(runValidationQueue(r, refs, ['submit']), []);
  assert.deepEqual(runValidationQueue(r, refs, ['submit'], [rule]).map(f => f.message), ['请填写申请说明。']);
  assert.deepEqual(runValidationQueue(r, refs, ['submit'], [{ ...rule, active: { ...rule.active, scope: 'customer' } }]), []);
  assert.deepEqual(runValidationQueue(r, refs, ['customer-accept'], [rule]), []);
  assert.deepEqual(runValidationQueue(r, refs, ['submit'], [{ ...rule, active: { ...rule.active, enabled: false } }]), []);
  assert.deepEqual(runValidationQueue(r, refs, ['submit'], [{ ...rule, active: undefined, status: 'pending' }]), []);
  assert.equal(runValidationQueue(r, refs, ['submit'], [{ ...rule, status: 'error' }]).length, 1, '转译失败继续执行原版本');
  r.description = '说明'; assert.equal(runValidationQueue(r, refs, ['submit'], [rule]).length, 0);
  r.description = before.description; assert.deepEqual(r, before);
  r.title = ''; r.internalParticipants = []; r.externalCollaborators = [];
  const failures = runValidationQueue(r, refs, ['submit'], [rule]);
  assert.ok(failures.length >= 4); assert.ok(failures.some(f => f.ruleId === 'custom-1'));
});

test('规则校验器拒绝代码、未知字段、空检查和错配类型，损坏规则阻断而非放行', () => {
  assert.throws(() => parseCompiledRule({ version: 1, checks: [] }));
  for (const condition of [
    { fact: '__proto__', operator: 'eq', value: 'true' },
    { fact: 'description', operator: 'gt', value: '1' },
    { fact: 'itemCount', operator: 'gte', value: 'NaN' },
    { fact: 'isApplicant', operator: 'eq', value: 'yes' },
    { fact: 'description', operator: 'contains', value: '' },
  ]) assert.throws(() => parseCompiledRule({ version: 1, checks: [{ ...check, conditions: [condition] }] }));
  assert.throws(() => parseCompiledRule({ ...compiled, code: 'globalThis.evil = true' }));
  assert.throws(() => parseRuleDefinition({ ...definition, events: [] }));
  assert.ok(runValidationQueue(request(), refs, ['submit'], [{ ...rule, active: { ...rule.active, compiled: {} } }]).some(f => f.message.includes('无法执行')));
  assert.ok(runValidationQueue(request(), refs, ['submit'], {}).some(f => f.message.includes('损坏')));
});

test('条件分支、数值和缺失日期按确定性规则处理', () => {
  const conditional = { ...rule, active: { ...rule.active, compiled: { version: 1, checks: [{ mode: 'any', message: '现场服务需填写申请说明', conditions: [{ fact: 'hasOnsiteItem', operator: 'eq', value: 'false' }, ...check.conditions] }] } } };
  const r = request();
  assert.equal(runValidationQueue(r, refs, ['submit'], [conditional]).length, 0);
  r.items[0].method = '现场'; assert.ok(runValidationQueue(r, refs, ['submit'], [conditional]).some(f => f.ruleId === rule.id));
  const dateRule = { ...rule, active: { ...rule.active, compiled: { version: 1, checks: [{ ...check, conditions: [{ fact: 'expectedLeadDays', operator: 'gte', value: '3' }] }] } } };
  assert.ok(runValidationQueue(r, refs, ['submit'], [dateRule]).some(f => f.ruleId === rule.id));
});

test('首次提交和重新提交互斥；所有可选时机都有保存事件，普通保存不触发', () => {
  const r = request();
  assert.deepEqual(validationEventsForTransition(r, structuredClone(r)), []);
  assert.deepEqual(validationEventsForTransition({ ...r, status: '待评估' }, r), ['submit']);
  const returned = { ...r, operations: { draftReturns: [{ at: 'today' }] } };
  assert.equal(submissionEvent(returned), 'resubmit');
  assert.deepEqual(validationEventsForTransition({ ...returned, status: '待评估' }, returned), ['resubmit']);
  const assessed = { ...r, status: '待评估', operations: { assessment: { rounds: [{ id: 'round', outcome: '评估通过' }], effort: { days: 1 }, plans: [{ id: 'plan' }] } } };
  const found = new Set(['submit', 'resubmit', ...validationEventsForTransition(assessed, { ...r, status: '待评估' })]);
  validationEventsForTransition({ ...assessed, status: '待确认', operations: { assessment: { ...assessed.operations.assessment, confirmation: { at: 'today' } } } }, assessed).forEach(e => found.add(e));
  validationEventsForTransition({ ...r, status: '待受理' }, { ...r, status: '待确认' }).forEach(e => found.add(e));
  assert.deepEqual([...found].sort(), Object.keys(ruleEvents).sort());
  assert.deepEqual(validationEventsForTransition(assessed, structuredClone(assessed)), []);
});

const response = (result, status = 'completed') => new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }), { status: 200 });
test('AI 转译严格结构化输出；缺配置、拒绝、截断、未知事实均不激活', async () => {
  const config = { key: 'test-key', model: 'configured-model' };
  const success = await compileSubmissionRule(definition, config, async (_url, init) => {
    const payload = JSON.parse(init.body); assert.equal(payload.text.format.strict, true); assert.equal(payload.store, false); assert.equal(payload.model, config.model);
    return response({ supported: true, explanation: '申请说明不能为空。', checks: [check] });
  });
  assert.deepEqual(success.compiled, compiled);
  assert.ok((await compileSubmissionRule({ ...definition, promptText: '' }, config, async () => response({ supported: true, explanation: '申请说明不能为空。', checks: [check] }))).compiled, '转译不要求先填提示文本，保存时仍必填');
  assert.equal((await compileSubmissionRule(definition, {}, () => { throw new Error('must not call'); })).status, 503);
  assert.equal((await compileSubmissionRule(definition, config, async () => response({ supported: false, explanation: '附件正文判断暂不支持。', checks: [] }))).status, 422);
  assert.equal((await compileSubmissionRule(definition, config, async () => response({}, 'incomplete'))).compiled, undefined);
  assert.equal((await compileSubmissionRule(definition, config, async () => response({ supported: true, explanation: '解释', checks: [{ ...check, conditions: [{ fact: 'eval', operator: 'eq', value: 'true' }] }] }))).compiled, undefined);
  assert.equal((await compileSubmissionRule(definition, config, async () => new Response('{}', { status: 429 }))).status, 429);
  assert.ok(ruleCompilerRequest(definition, config.model).instructions.includes('不得只编译'));
});

test('客户发起的申请，齐套检查接受客户与内部补充的全部材料', () => {
  const r = request(); r.createdById = 'p1'; r.createdByAudience = 'customer';
  r.items[0].config.materials = [{ id: 'required', name: '需求材料', required: true }];
  r.items[0].materials = [{ requirementId: 'required', files: [{ id: 'file', name: '材料.txt', uploadedById: 'p1', uploaderAudience: 'customer' }] }];
  const materialRule = { ...rule, active: { ...rule.active, events: ['request-confirmation'], compiled: { version: 1, checks: [{ ...check, message: '请补充材料', conditions: [{ fact: 'requiredMaterialsComplete', operator: 'eq', value: 'true' }] }] } } };
  assert.deepEqual(runValidationQueue(r, { ...refs, currentActor: { id: 'USR-003', name: '经理', role: 'SmartX 项目经理' } }, ['request-confirmation'], [materialRule]), []);
  r.items[0].materials[0].files[0].uploadedById = 'other-customer';
  assert.deepEqual(runValidationQueue(r, refs, ['request-confirmation'], [materialRule]), []);
  r.items[0].materials[0].files[0].uploaderAudience = 'internal';
  assert.deepEqual(runValidationQueue(r, refs, ['request-confirmation'], [materialRule]), []);
  r.items[0].materials[0].files = [];
  assert.ok(runValidationQueue(r, refs, ['request-confirmation'], [materialRule]).some(f => f.ruleId === rule.id));
});

test('检验要求与提示文本均必填，失败使用管理员提示且每条规则仅展示一次', () => {
  for (const key of ['requirement', 'promptText']) {
    assert.throws(() => parseRuleDefinition({ ...definition, [key]: '   ' }));
    const missing = { ...definition }; delete missing[key];
    assert.throws(() => parseRuleDefinition(missing));
  }
  const custom = { ...rule, active: { ...rule.active, promptText: '请补齐说明后重试。', compiled: { version: 1, checks: [check, { ...check, message: 'AI 另一个提示' }] } } };
  assert.deepEqual(runValidationQueue(request(), refs, ['submit'], [custom]).map(f => f.message), ['请补齐说明后重试。']);
  assert.deepEqual(runValidationQueue(request(), refs, ['submit'], [{ ...custom, status: 'error', promptText: '未生效的新提示' }]).map(f => f.message), ['请补齐说明后重试。']);
});

test('旧规则未保存提示文本时沿用原提示，迁移不改变检查条件', () => {
  const legacy = structuredClone(rule); delete legacy.promptText; delete legacy.active.promptText;
  assert.deepEqual(runValidationQueue(request(), refs, ['submit'], [legacy]).map(f => f.message), ['请填写申请说明。']);
});
