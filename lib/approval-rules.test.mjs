import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAssessmentRouting } from './assessment-routing-compiler.ts';
import { newApprovalRule, approvalRuleIssue, approvalRulesId, readApprovalRulesPayload, testedApprovalConditions, nextApprovalPriority, resolveApprovalRule } from './approval-rules.ts';
import { approvalConfigId, emptyApprovalConfig, newApprovalNode } from './approval-flows.ts';
import { readApprovalRules, readApprovalData, saveApprovalRule, saveApprovalConfig, disableApprovalRule, deleteApprovalRule } from './approval-flow-store.ts';

const actor = { id: 'USR-006', role: 'SmartX 系统管理员', name: '管理员' };
const compiled = { version: 1, groups: [{ conditions: [{ field: 'source', operator: 'eq', value: 'internal' }], items: [] }] };
const conditions = { requirement: '内部申请', testedRequirement: '内部申请', compiled };
const legacy = { ...emptyApprovalConfig(), revision: 3, name: '原审批流程', nodes: [newApprovalNode()] };
function storage(t) {
  const original = globalThis.indexedDB;
  t.after(() => { if (original) globalThis.indexedDB = original; else delete globalThis.indexedDB; });
  let records = [{ id: 'workspace', payload: { users: [{ id: actor.id, status: '启用' }] } }, { id: approvalConfigId, payload: legacy }];
  globalThis.indexedDB = { open() {
    const request = { result: { close() {}, transaction() {
      const staged = structuredClone(records); let aborted = false;
      const tx = { abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); }, objectStore() { return {
        getAll() { const request = { result: structuredClone(staged) }; queueMicrotask(() => { request.onsuccess?.(); if (!aborted) { records = staged; tx.oncomplete?.(); } }); return request; },
        put(row) { const at = staged.findIndex(value => value.id === row.id); if (at < 0) staged.push(structuredClone(row)); else staged[at] = structuredClone(row); },
      }; } }; return tx;
    } } }; queueMicrotask(() => request.onsuccess()); return request;
  } };
  return () => records;
}

test('旧流程保留节点和版本；已迁移的空列表不恢复已删除流程', () => {
  const result = readApprovalRulesPayload(undefined, legacy);
  assert.deepEqual(result.rules[0].flow, legacy);
  assert.equal(result.rules[0].id, readApprovalRulesPayload(undefined, legacy).rules[0].id);
  result.rules[0].flow.nodes[0].name = '新名称';
  assert.notEqual(legacy.nodes[0].name, '新名称');
  assert.deepEqual(readApprovalRulesPayload({ version: 1, rules: [] }, legacy).rules, []);
  assert.throws(() => readApprovalRulesPayload({ version: 2, rules: [] }), /无法读取/);
});

test('自然语言条件不能为空，修改后必须重新测试，矛盾条件不能保存', () => {
  const rule = { ...newApprovalRule(), name: '测试规则' };
  assert.match(approvalRuleIssue(rule), /匹配条件/);
  rule.conditions = structuredClone(conditions);
  assert.equal(approvalRuleIssue(rule), null);
  const dictionary = { customers: [], services: [] };
  assert.deepEqual(testedApprovalConditions(conditions, dictionary), conditions);
  assert.throws(() => testedApprovalConditions({ ...conditions, requirement: '客户申请' }, dictionary), /转译并测试/);
  const contradictory = structuredClone(conditions);
  contradictory.compiled.groups[0].conditions.push({ field: 'source', operator: 'eq', value: 'customer' });
  assert.throws(() => testedApprovalConditions(contradictory, dictionary), /矛盾/);
});

test('旧规则条件转成自然语言，保留原有限制及独立流程', () => {
  const old = { ...newApprovalRule(), name: '旧规则', conditions: { scope: 'customer', minAmount: 100, maxAmount: 500, risk: 'high' }, flow: legacy };
  const next = readApprovalRulesPayload({ version: 1, rules: [old] }).rules[0];
  assert.equal(next.conditions.requirement, '客户申请，且申请金额不少于 100 元，且申请金额不超过 500 元，且高风险');
  assert.equal(next.conditions.compiled, undefined);
  assert.deepEqual(next.flow, legacy);
  assert.deepEqual(readApprovalRulesPayload({ version: 1, rules: [next] }).rules[0], next);
});

test('多流程独立持久化；条件编辑保留流程；拒绝过期覆盖、误删和无权限保存', async t => {
  const records = storage(t);
  const first = (await readApprovalRules()).collection.rules[0];
  const newRule = { ...newApprovalRule(), name: '内部申请审批', priority: 20, conditions: structuredClone(conditions) };
  await assert.rejects(saveApprovalRule(actor, { ...newRule, conditions: { requirement: '内部申请' } }, null), /转译并测试/);
  const added = await saveApprovalRule(actor, newRule, null);
  assert.equal(added.rules.length, 2);
  const second = added.rules[1];
  const flow = { ...second.flow, nodes: [newApprovalNode('org')] };
  const saved = await saveApprovalConfig(actor, second.id, flow, 0);
  assert.equal(saved.nodes[0].source, 'org');
  assert.deepEqual((await readApprovalData(first.id)).config, legacy);
  assert.deepEqual((await readApprovalData(second.id)).config, saved);
  await assert.rejects(saveApprovalConfig(actor, second.id, flow, 0), /其他页面/);
  await assert.rejects(saveApprovalRule(actor, second, second.revision), /修改或删除/);
  await assert.rejects(deleteApprovalRule(actor, second), /不能删除/);
  const latest = (await readApprovalData(second.id)).rule;
  const edited = await saveApprovalRule(actor, { ...latest, name: '修改规则名称', flow: emptyApprovalConfig() }, latest.revision);
  assert.deepEqual(edited.rules[1].flow, saved);
  await assert.rejects(saveApprovalRule({ ...actor, role: '销售' }, newRule, null), /管理员/);
  const before = structuredClone(records());
  await assert.rejects(saveApprovalConfig(actor, first.id, emptyApprovalConfig(), legacy.revision), /1–50/);
  assert.deepEqual(records(), before);
  await assert.rejects(deleteApprovalRule(actor, edited.rules[1]), /不能删除/);
  await disableApprovalRule(actor, edited.rules[1]);
  const disabled = (await readApprovalData(second.id)).rule;
  assert.equal(disabled.enabled, false);
  assert.deepEqual(disabled.flow, saved);
  assert.ok(disabled.history.every(version => version.enabled === false));
  assert.equal(disabled.history.length, 2);
  assert.deepEqual(disabled.history[1].flow, saved);
  await assert.rejects(saveApprovalConfig(actor, second.id, flow, saved.revision), /停用规则只读/);
  await assert.rejects(saveApprovalRule(actor, disabled, disabled.revision), /停用规则只读/);
  await assert.rejects(disableApprovalRule(actor, edited.rules[1]), /已被修改/);
  await assert.rejects(deleteApprovalRule(actor, first), /不能删除/);
  assert.equal((await readApprovalRules()).collection.rules.length, 2);
  assert.deepEqual(records().find(row => row.id === approvalConfigId).payload, legacy);
});

test('审批条件编译支持全部申请，沿用结构化条件校验', async () => {
  let prompt;
  const groups = ['internal', 'customer'].map(value => ({ conditions: [{ field: 'source', operator: 'eq', value }], items: [] }));
  const result = await compileAssessmentRouting({ requirement: '全部申请', purpose: 'approval', dictionary: { customers: [], services: [] } }, { key: 'test-key', model: 'test-model' }, async (_url, options) => {
    prompt = JSON.parse(options.body);
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ supported: true, explanation: '全部申请', groups }) }] }] });
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.compiled.groups, groups);
  assert.match(prompt.instructions, /特殊审批/);
  assert.match(prompt.instructions, /两个 OR 组/);
  assert.doesNotMatch(prompt.instructions, /所有申请都适用请提示使用默认负责人/);
});

test('优先级迁移保留已有数字，为旧规则依序分配空闲数字且不修改输入', () => {
  const base = { ...newApprovalRule(), name: '旧规则', conditions };
  const { priority: _priority, ...old } = base;
  const input = { version: 1, rules: [{ ...old, id: 'old-a' }, { ...base, id: 'existing', priority: 20 }, { ...old, id: 'old-b' }] };
  const before = structuredClone(input);
  const migrated = readApprovalRulesPayload(input);
  assert.deepEqual(migrated.rules.map(rule => [rule.id, rule.priority]), [['existing', 20], ['old-a', 30], ['old-b', 40]]);
  assert.deepEqual(readApprovalRulesPayload(migrated), migrated);
  assert.deepEqual(input, before);
  assert.equal(nextApprovalPriority([{ priority: 9999 }, { priority: 1 }]), 2);
  assert.equal(nextApprovalPriority(Array.from({ length: 9999 }, (_, i) => ({ priority: i + 1 }))), 0);
});

test('同时命中时按优先级选第一条，修改优先级改变结果，未测试规则不参与预览', () => {
  const a = { ...newApprovalRule(), id: 'a', name: '规则 A', priority: 20, conditions };
  const b = { ...newApprovalRule(), id: 'b', name: '规则 B', priority: 10, conditions };
  const request = { createdByAudience: 'internal', items: [] };
  assert.equal(resolveApprovalRule([a, b], request, [])?.id, 'b');
  assert.equal(resolveApprovalRule([{ ...a, priority: 1 }, b], request, [])?.id, 'a');
  assert.equal(resolveApprovalRule([a, { ...b, conditions: { requirement: '内部申请' } }], request, [])?.id, 'a');
  assert.equal(resolveApprovalRule([], request, []), undefined);
});

test('保存拒绝非法和重复优先级，包括另一页面先占用优先级的情况', async t => {
  storage(t);
  const candidate = { ...newApprovalRule(), name: '新规则', priority: 20, conditions };
  for (const priority of [0, -1, 1.5, 10000, NaN]) await assert.rejects(saveApprovalRule(actor, { ...candidate, priority }, null), /1–9999/);
  await assert.rejects(saveApprovalRule(actor, { ...candidate, priority: 10 }, null), /优先级重复/);
  const saved = await saveApprovalRule(actor, candidate, null);
  const other = { ...candidate, id: 'other' };
  await assert.rejects(saveApprovalRule(actor, other, null), /优先级重复/);
  const current = saved.rules.find(rule => rule.id === candidate.id);
  await assert.rejects(saveApprovalRule(actor, { ...current, priority: 10 }, current.revision), /优先级重复/);
  const changed = await saveApprovalRule(actor, { ...current, priority: 5 }, current.revision);
  assert.deepEqual(changed.rules.map(rule => rule.priority), [5, 10]);
  assert.equal((await readApprovalData(candidate.id)).rule.priority, 5);
});

test('编辑审批条件和节点均归档完整旧版本，停用后跳过匹配且不占用优先级', async t => {
  storage(t);
  const rule = { ...newApprovalRule(), name: '版本测试', priority: 20, conditions: structuredClone(conditions) };
  let collection = await saveApprovalRule(actor, rule, null);
  let current = collection.rules.find(item => item.id === rule.id);
  const first = structuredClone(current);
  collection = await saveApprovalRule(actor, { ...current, name: '版本二', history: [] }, current.revision);
  current = collection.rules.find(item => item.id === rule.id);
  assert.equal(current.version, 2);
  assert.equal(current.history[0].name, first.name);
  assert.equal(current.history[0].version, 1);
  assert.equal(current.history[0].enabled, false);
  const edited = structuredClone(current);
  await saveApprovalConfig(actor, current.id, { ...current.flow, nodes: [newApprovalNode()] }, current.flow.revision, current.revision);
  current = (await readApprovalData(rule.id)).rule;
  assert.equal(current.version, 3);
  assert.deepEqual(current.history[1].flow, edited.flow);
  assert.equal(current.history.length, 2);
  assert.ok(current.history.every(version => !version.enabled && !version.history));
  await assert.rejects(saveApprovalConfig(actor, current.id, current.flow, current.flow.revision, edited.revision), /其他页面/);
  const disabledCollection = await disableApprovalRule(actor, current);
  const disabled = disabledCollection.rules.find(item => item.id === current.id);
  assert.equal(disabled.version, 3);
  assert.equal(resolveApprovalRule([disabled], { createdByAudience: 'internal', items: [] }, []), undefined);
  const replacement = { ...rule, id: 'replacement', name: '新规则', priority: current.priority };
  await saveApprovalRule(actor, replacement, null);
  assert.deepEqual((await readApprovalData(rule.id)).rule.history, current.history);
});
