import test from 'node:test';
import assert from 'node:assert/strict';
import { arrangeServiceFlow, assignServiceStepPhase, removeServiceFlowPhase, serviceFlowGroups, validateServiceFlowPhases } from './service-flow-phases.ts';
import { newServiceFlowStep } from './service-flow-steps.ts';
import {
  emptyServiceFlowConfig,
  parseServiceFlowConfig,
  resolveServiceFlow,
} from './service-flows.ts';

function fixture() {
  const steps = [
    newServiceFlowStep(1),
    newServiceFlowStep(2),
    newServiceFlowStep(3),
  ];
  steps.forEach((step, index) => {
    step.id = `step-${index}`;
    step.phase = index === 2 ? '交付' : '准备';
    step.phaseId = index === 2 ? 'delivery' : 'prepare';
  });
  return {
    id: 'flow',
    name: '服务流程',
    description: '',
    enabled: true,
    phases: [{ id: 'prepare', name: '准备' }, { id: 'delivery', name: '交付' }],
    steps,
  };
}
function config(flow) {
  return {
    ...emptyServiceFlowConfig(),
    flows: [flow],
    assignment: { defaultFlowId: flow.id, rules: [] },
  };
}

test('当前阶段分组完整保留步骤配置和附件且不改动原数据', () => {
  const flow = fixture();
  flow.steps[0].materials = [
    {
      id: 'file',
      kind: 'attachment',
      name: '说明.txt',
      blob: new Blob(['guide']),
    },
  ];
  const before = structuredClone(flow);
  const migrated = structuredClone(flow);
  assert.deepEqual(
    migrated.phases.map((row) => row.name),
    ['准备', '交付'],
  );
  assert.deepEqual(
    serviceFlowGroups(migrated).map((group) =>
      group.steps.map((step) => step.id),
    ),
    [['step-0', 'step-1'], ['step-2'], []],
  );
  assert.deepEqual(migrated.steps[0].materials, flow.steps[0].materials);
  assert.deepEqual(flow, before);
});

test('跨阶段移动及阶段重排使画布和实际执行顺序一致，保留空阶段', () => {
  let flow = fixture();
  flow.phases.push({ id: 'empty', name: '验收' });
  flow = assignServiceStepPhase(flow, 'step-0', flow.phases[1].id);
  assert.deepEqual(
    flow.steps.map((step) => step.id),
    ['step-1', 'step-2', 'step-0'],
  );
  assert.deepEqual(
    flow.steps.map((step) => step.sequence),
    [1, 2, 3],
  );
  flow = arrangeServiceFlow({
    ...flow,
    phases: [flow.phases[1], flow.phases[0], flow.phases[2]],
  });
  const saved = parseServiceFlowConfig(config(flow));
  assert.equal(saved.flows[0].phases[2].name, '验收');
  const result = resolveServiceFlow(saved, {
    serviceId: '',
    customerId: '',
    customerTeam: '',
    method: '',
  });
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['step-2', 'step-0', 'step-1'],
  );
  assert.deepEqual(
    result.steps.map((step) => step.phase),
    ['交付', '交付', '准备'],
  );
  assert.deepEqual(serviceFlowGroups(saved.flows[0])[2].steps, []);
});

test('阶段改名同步执行标签，删除阶段只取消分组而不删除步骤', () => {
  let flow = fixture();
  const id = flow.phases[0].id;
  flow.phases[0].name = '前期调研';
  flow = parseServiceFlowConfig(config(flow)).flows[0];
  assert.equal(flow.steps[0].phase, '前期调研');
  flow = removeServiceFlowPhase(flow, id);
  assert.equal(flow.steps.length, 3);
  assert.deepEqual(
    serviceFlowGroups(flow)
      .at(-1)
      .steps.map((step) => step.id),
    ['step-0', 'step-1'],
  );
  assert.equal(flow.steps.find((step) => step.id === 'step-0').phase, '');
  assert.doesNotThrow(() => parseServiceFlowConfig(config(flow)));
});

test('拒绝空名称、重复阶段和不存在的阶段引用，避免步骤丢失', () => {
  const flow = fixture();
  const blank = structuredClone(flow);
  blank.phases[0].name = ' ';
  assert.throws(() => validateServiceFlowPhases(blank), /阶段/);
  const duplicate = structuredClone(flow);
  duplicate.phases[1].id = duplicate.phases[0].id;
  assert.throws(() => validateServiceFlowPhases(duplicate), /阶段/);
  const missing = structuredClone(flow);
  missing.steps[0].phaseId = 'missing';
  assert.throws(() => parseServiceFlowConfig(config(missing)), /阶段不存在/);
  assert.throws(
    () => assignServiceStepPhase(flow, 'step-0', 'missing'),
    /阶段不存在/,
  );
});
