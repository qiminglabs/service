import test from 'node:test';
import assert from 'node:assert/strict';
import { copyExecutionFlow, copyExecutionStep, newExecutionStep, emptyExecutionConfig, executionConfigIssue, matchExecutionFlow, executionFlowSnapshot } from './execution-flows.ts';
const services = [{ id: 'catalog-1' }];
const flow = () => ({ id: 'flow-1', name: '安装流程', description: '', enabled: true, steps: [{ ...newExecutionStep(), name: '提交报告', type: 'upload' }] });
const rule = (extra = {}) => ({ id: 'rule-1', name: '默认', serviceId: 'catalog-1', customerTeams: [], flowId: 'flow-1', priority: 0, enabled: true, ...extra });
test('按目录与团队匹配，优先级较高覆盖兜底，未匹配明确返回空', () => {
  const config = { ...emptyExecutionConfig(), flows: [flow(), { ...flow(), id: 'flow-2' }], assignments: [rule(), rule({ id: 'rule-2', customerTeams: ['金融'], flowId: 'flow-2', priority: 10 })] };
  assert.equal(matchExecutionFlow(config, 'catalog-1', '金融').flow.id, 'flow-2');
  assert.equal(matchExecutionFlow(config, 'catalog-1', '商业').flow.id, 'flow-1');
  assert.equal(matchExecutionFlow(config, 'missing', '金融'), undefined);
  config.flows[1].enabled = false;
  assert.equal(matchExecutionFlow(config, 'catalog-1', '金融').flow.id, 'flow-1');
});
test('同优先级且团队交叠阻止保存，不相交团队允许相同优先级', () => {
  const config = { ...emptyExecutionConfig(), flows: [flow()], assignments: [rule({ customerTeams: ['金融'] }), rule({ id: 'rule-2', customerTeams: ['商业'] })] };
  assert.equal(executionConfigIssue(config, services), undefined);
  config.assignments[1].customerTeams = [];
  assert.match(executionConfigIssue(config, services), /条件重叠/);
  config.assignments[1].enabled = false;
  assert.equal(executionConfigIssue(config, services), undefined);
});
test('步骤和流程复制完全独立；快照排除停用步骤且不随模板变化', () => {
  const original = flow(); original.steps[0].links = ['https://example.com'];
  original.steps.push({ ...newExecutionStep(), name: '可选步骤', enabled: false });
  const copied = copyExecutionFlow(original), step = copyExecutionStep(original.steps[0]), snapshot = executionFlowSnapshot(original);
  assert.notEqual(copied.id, original.id); assert.notEqual(step.id, original.steps[0].id); assert.equal(copied.enabled, false);
  copied.steps[0].links.push('https://example.org');
  original.steps[0].name = '已修改';
  assert.equal(snapshot.steps.length, 1); assert.equal(snapshot.steps[0].name, '提交报告'); assert.equal(step.links.length, 1);
});
test('阻止空流程启用、无效链接和已分配流程停用', () => {
  const config = { ...emptyExecutionConfig(), flows: [flow()], assignments: [rule()] };
  config.flows[0].enabled = false;
  assert.match(executionConfigIssue(config, services), /先停用/);
  config.assignments = []; config.flows[0].enabled = true; config.flows[0].steps = [];
  assert.match(executionConfigIssue(config, services), /至少需要/);
  config.flows = [flow()]; config.flows[0].steps[0].links = ['javascript:alert(1)'];
  assert.match(executionConfigIssue(config, services), /http/);
});
