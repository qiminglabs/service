import {
  readExecutionFormData,
  saveExecutionForms,
} from './service-execution-form-store.ts';
import { emptyExecutionForms, executionFormsId } from './service-execution-forms.ts';
import { validateGeneralStepSubmission } from './service-step-general.ts';
import {
  stepDocuments,
  stepFiles,
  stepDeliverySummary,
  newStepDocument,
  newStepFile,
} from './service-step-deliverables.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyServiceFlowConfig,
  parseServiceFlowConfig,
  resolveServiceFlow,
} from './service-flows.ts';
import {
  readServiceFlowData,
  saveServiceFlowConfig,
} from './service-flow-store.ts';
import { localInternalUsers } from './internal-users.ts';
import { compileAssessmentRouting } from './assessment-routing-compiler.ts';
import { parseServiceFlowPredicate } from './service-flow-conditions.ts';
import {
  serviceStepTypes,
  moveServiceStep,
  newServiceFlowStep,
  parseServiceFlowSteps,
} from './service-flow-steps.ts';

const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };

test('步骤重排后顺序连续，预览排除停用步骤并保留可选和客户交付标志', () => {
  const config = parseServiceFlowConfig(fixture());
  const steps = config.flows[0].steps;
  steps[0].enabled = false;
  steps[1].required = false;
  steps[1].deliverToCustomer = true;
  steps[1].type = 'document';
  const moved = moveServiceStep(steps, 'deliver', 1);
  assert.deepEqual(
    moved.map((step) => [step.id, step.sequence]),
    [
      ['deliver', 1],
      ['prepare', 2],
    ],
  );
  assert.deepEqual(
    steps.map((step) => step.sequence),
    [1, 2],
  );
  config.flows[0].steps = moved;
  const result = resolveServiceFlow(config, context);
  assert.deepEqual(
    result.steps.map((step) => step.id),
    ['deliver'],
  );
  assert.equal(result.steps[0].required, false);
  assert.equal(result.steps[0].deliverToCustomer, true);
});

test('通用类型校验字段、文件要求、链接安全、顺序和启停值', () => {
  const step = newServiceFlowStep(1);
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.formFields = [];
  assert.throws(() => parseServiceFlowSteps([step]), /表单字段/);
  step.type = 'upload';
  step.upload.formats = '.pdf,.docx';
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.upload.minFiles = 0;
  assert.throws(() => parseServiceFlowSteps([step]), /文件数量/);
  step.upload.minFiles = 1;
  step.type = 'combined';
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.checklist = ['确认完成'];
  step.materials = [
    { id: 'link', kind: 'link', title: '指引', url: 'javascript:alert(1)' },
  ];
  assert.throws(() => parseServiceFlowSteps([step]), /说明链接/);
  step.materials[0].url = 'https://example.com/guide';
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.enabled = '启用';
  assert.throws(() => parseServiceFlowSteps([step]), /步骤配置无效/);
  step.enabled = true;
  step.sequence = 2;
  assert.throws(() => parseServiceFlowSteps([step]), /步骤配置无效/);
});

test('说明附件字节、类型配置和交付标志保存后重读保持一致', async (t) => {
  storage(t);
  const config = parseServiceFlowConfig(fixture()),
    step = config.flows[0].steps[0];
  step.type = 'document';
  step.required = false;
  step.deliverToCustomer = true;
  step.documentTemplate = '一、实施结果\n二、遗留事项';
  step.materials.push({
    id: 'attachment',
    kind: 'attachment',
    name: 'guide.txt',
    blob: new Blob(['真实说明附件内容']),
  });
  await saveServiceFlowConfig(config, admin);
  const loaded = (await readServiceFlowData()).config.flows[0].steps[0];
  assert.equal(await loaded.materials[1].blob.text(), '真实说明附件内容');
  assert.equal(loaded.documentTemplate, step.documentTemplate);
  assert.equal(loaded.required, false);
  assert.equal(loaded.deliverToCustomer, true);
  loaded.name = '本地编辑';
  assert.notEqual(
    (await readServiceFlowData()).config.flows[0].steps[0].name,
    loaded.name,
  );
});
const flow = (id) => ({
  id,
  name: id,
  description: '',
  enabled: true,
  steps: [
    {
      ...newServiceFlowStep(1),
      type: 'combined',
      materials: [{ id: 'instruction', kind: 'text', content: '确认服务范围' }],
      generalDescription: '环境已就绪',
      id: 'prepare',
      name: '环境确认',
      phase: '调研设计',
      subtitle: '',
      instructions: '确认服务范围',
      checklist: ['环境已就绪'],
      recordRequired: true,
      attachmentRequired: false,
    },
    {
      ...newServiceFlowStep(2),
      type: 'combined',
      id: 'deliver',
      name: '交付',
      phase: '收尾',
      subtitle: '',
      instructions: '',
      checklist: [],
      recordRequired: false,
      attachmentRequired: true,
    },
  ],
});
const condition = (field, value, operator = 'eq') => ({
  field,
  value,
  operator,
});
const rule = (id, priority, conditions, match = 'all') => ({
  id,
  name: id,
  priority,
  conditions,
  match,
  enabled: true,
  flowId: 'onsite',
});
const context = {
  serviceId: 'service',
  customerId: 'customer',
  customerTeam: '金融',
  method: '现场',
};
function fixture() {
  return {
    ...emptyServiceFlowConfig(),
    flows: [flow('standard'), flow('onsite')],
    assignment: { defaultFlowId: 'standard', rules: [] },
  };
}

test('按优先级选第一条命中规则，保留所有匹配明细，预览不修改数据', () => {
  const config = fixture();
  config.assignment.rules = [
    rule('later', 20, [condition('method', '现场')]),
    rule('first', 10, [
      condition('serviceId', 'service'),
      condition('customerTeam', '金融'),
    ]),
  ];
  const before = structuredClone(config);
  const result = resolveServiceFlow(config, context);
  assert.equal(result.rule.id, 'first');
  assert.equal(result.flow.id, 'onsite');
  assert.deepEqual(
    result.trace.map((row) => [row.rule.id, row.matched]),
    [
      ['first', true],
      ['later', true],
    ],
  );
  assert.deepEqual(config, before);
});
test('且、或、不等于、停用规则与默认回退正确处理', () => {
  const config = fixture();
  const conditions = [
    condition('method', '远程'),
    condition('customerId', 'customer'),
  ];
  config.assignment.rules = [
    rule('all', 10, conditions),
    rule('any', 20, conditions, 'any'),
  ];
  assert.equal(resolveServiceFlow(config, context).rule.id, 'any');
  config.assignment.rules[1].enabled = false;
  assert.equal(resolveServiceFlow(config, context).source, 'default');
  config.assignment.rules[0].conditions = [condition('method', '远程', 'ne')];
  assert.equal(resolveServiceFlow(config, context).source, 'rule');
  assert.equal(
    resolveServiceFlow(config, { ...context, method: '' }).source,
    'default',
  );
  config.assignment.defaultFlowId = '';
  assert.equal(
    resolveServiceFlow(config, { ...context, method: '' }).source,
    'unassigned',
  );
});
test('默认引用、启用规则引用阻止停用，停用规则也阻止删除流程', () => {
  const config = fixture();
  config.flows[0].enabled = false;
  assert.throws(() => parseServiceFlowConfig(config), /默认流程/);
  config.flows[0].enabled = true;
  config.assignment.rules = [rule('r', 10, [condition('method', '现场')])];
  config.flows[1].enabled = false;
  assert.throws(() => parseServiceFlowConfig(config), /停用流程/);
  config.assignment.rules[0].enabled = false;
  assert.doesNotThrow(() => parseServiceFlowConfig(config));
  config.flows.pop();
  assert.throws(() => parseServiceFlowConfig(config), /流程不存在/);
});
test('拒绝重复优先级、空步骤、无效条件和损坏配置；步骤顺序保留', () => {
  assert.deepEqual(parseServiceFlowConfig(undefined), emptyServiceFlowConfig());
  assert.throws(() => parseServiceFlowConfig(null), /格式无效/);
  const config = fixture();
  config.assignment.rules = [
    rule('one', 10, [condition('method', '现场')]),
    rule('two', 10, [condition('method', '现场')]),
  ];
  assert.throws(() => parseServiceFlowConfig(config), /优先级重复/);
  config.assignment.rules.pop();
  config.assignment.rules[0].conditions = [];
  assert.throws(() => parseServiceFlowConfig(config), /1–20/);
  config.assignment.rules[0].conditions = [condition('method', 'invalid')];
  assert.throws(() => parseServiceFlowConfig(config), /服务方式/);
  config.assignment.rules = [];
  config.flows[0].steps.reverse().forEach((step, index) => { step.sequence = index + 1; });
  assert.deepEqual(
    parseServiceFlowConfig(config).flows[0].steps.map((step) => step.id),
    ['deliver', 'prepare'],
  );
  config.flows[0].steps = [];
  assert.throws(() => parseServiceFlowConfig(config), /1–100/);
});

function storage(t) {
  const data = {
    references: [
      {
        id: 'workspace',
        payload: {
          users: structuredClone(localInternalUsers),
          customers: [{ id: 'customer', name: '客户', team: '金融' }],
          services: [{ id: 'service', name: '实施' }],
        },
      },
      { id: 'unrelated', payload: { preserved: true } },
      {
        id: 'service-project:p',
        payload: {
          id: 'p',
          name: '项目',
          customerId: 'customer',
          items: [{ id: 'i', serviceId: 'service', method: '现场' }],
        },
      },
    ],
  };
  const previous = globalThis.indexedDB;
  globalThis.indexedDB = {
    open() {
      const req = {};
      queueMicrotask(() => {
        req.result = {
          close() {},
          transaction() {
            const staged = structuredClone(data);
            let pending = 0,
              aborted = false;
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(name) {
                const run = (fn) => {
                  const r = {};
                  pending++;
                  queueMicrotask(() => {
                    if (aborted) return;
                    r.result = fn();
                    r.onsuccess?.();
                    pending--;
                    if (!pending && !aborted)
                      queueMicrotask(() => {
                        if (!pending && !aborted) {
                          Object.assign(data, staged);
                          tx.oncomplete?.();
                        }
                      });
                  });
                  return r;
                };
                return {
                  getAll: () => run(() => staged[name]),
                  put: (record) =>
                    run(() => {
                      staged[name] = [
                        ...staged[name].filter((row) => row.id !== record.id),
                        structuredClone(record),
                      ];
                    }),
                };
              },
            };
            return tx;
          },
        };
        req.onsuccess?.();
      });
      return req;
    },
  };
  t.after(() => {
    globalThis.indexedDB = previous;
  });
  return data;
}
test('保存、重读、项目预览数据正确；保留其他配置并拒绝过期覆盖', async (t) => {
  const data = storage(t),
    before = structuredClone(data.references),
    config = fixture();
  config.assignment.rules = [
    rule('r', 10, [condition('serviceId', 'service')]),
  ];
  const saved = await saveServiceFlowConfig(config, admin);
  assert.equal(saved.revision, 1);
  const loaded = await readServiceFlowData();
  assert.deepEqual(loaded.config, saved);
  assert.deepEqual(
    loaded.projects.map((project) => project.id),
    ['p'],
  );
  assert.deepEqual(data.references.slice(0, 3), before);
  await assert.rejects(saveServiceFlowConfig(config, admin), /其他页面修改/);
  assert.deepEqual((await readServiceFlowData()).config, saved);
});
test('拒绝无权限、停用管理员和失效条件引用，失败不写入', async (t) => {
  const data = storage(t),
    config = fixture();
  await assert.rejects(
    saveServiceFlowConfig(config, { ...admin, id: 'USR-001' }),
    /管理员/,
  );
  data.references[0].payload.users.find((user) => user.id === admin.id).status =
    '停用';
  await assert.rejects(saveServiceFlowConfig(config, admin), /停用/);
  data.references[0].payload.users.find((user) => user.id === admin.id).status =
    '启用';
  config.assignment.rules = [
    rule('r', 10, [condition('customerId', 'deleted')]),
  ];
  const before = structuredClone(data.references);
  await assert.rejects(saveServiceFlowConfig(config, admin), /已不存在/);
  assert.deepEqual(data.references, before);
});

const languageRule = (
  compiled,
  requirement = '金融团队且现场，或指定客户的远程服务',
) => ({
  ...rule('language', 5, []),
  naturalLanguage: { requirement, testedRequirement: requirement, compiled },
});
const languagePredicate = () => ({
  version: 1,
  groups: [
    {
      conditions: [condition('customerTeam', '金融')],
      items: [{ mode: 'some', conditions: [condition('method', '现场')] }],
    },
    {
      conditions: [condition('customerId', 'customer')],
      items: [{ mode: 'some', conditions: [condition('method', '远程')] }],
    },
  ],
});
test('自然语言条件保持嵌套且或关系、逐组预览，并拒绝编辑后的旧转译结果', () => {
  const config = fixture();
  config.assignment.rules = [languageRule(languagePredicate())];
  assert.equal(resolveServiceFlow(config, context).rule.id, 'language');
  assert.equal(
    resolveServiceFlow(config, {
      ...context,
      customerTeam: '商业',
      method: '远程',
    }).rule.id,
    'language',
  );
  assert.equal(
    resolveServiceFlow(config, {
      ...context,
      customerTeam: '商业',
      method: '现场',
    }).source,
    'default',
  );
  assert.equal(
    resolveServiceFlow(config, { ...context, method: '' }).source,
    'default',
  );
  assert.equal(resolveServiceFlow(config, context).trace[0].groups.length, 2);
  config.assignment.rules[0].naturalLanguage.requirement = '修改了条件';
  assert.equal(resolveServiceFlow(config, context).source, 'default');
  assert.throws(() => parseServiceFlowConfig(config), /先转译并测试/);
});
test('自然语言转译限定单服务项，不接受跨项条件、申请来源和相互矛盾条件', () => {
  const p = languagePredicate();
  p.groups[0].items[0].mode = 'none';
  assert.throws(() => parseServiceFlowPredicate(p), /当前服务项/);
  p.groups[0].items[0].mode = 'some';
  p.groups[0].items.push({
    mode: 'some',
    conditions: [condition('serviceId', 'service')],
  });
  assert.throws(() => parseServiceFlowPredicate(p), /当前服务项/);
  p.groups[0].items.pop();
  p.groups[0].conditions = [condition('source', 'internal')];
  assert.throws(() => parseServiceFlowPredicate(p), /当前服务项/);
  p.groups[0].conditions = [
    condition('customerTeam', '金融'),
    condition('customerTeam', '商业'),
  ];
  assert.throws(() => parseServiceFlowPredicate(p), /互相矛盾/);
});
test('服务流程编译模式保留严格结构，拒绝未知实体和不支持的要求', async () => {
  const input = {
    purpose: 'service-flow',
    requirement: '金融团队且现场，或指定客户的远程服务',
    dictionary: {
      customers: [{ id: 'customer', name: '指定客户' }],
      services: [{ id: 'service', name: '服务项' }],
    },
  };
  let sent;
  const reply = (payload) => async (_url, options) => {
    sent = JSON.parse(options.body);
    return Response.json({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(payload) }],
        },
      ],
    });
  };
  const result = await compileAssessmentRouting(
    input,
    { key: 'test', model: 'test' },
    reply({
      supported: true,
      explanation: '条件已转译',
      groups: languagePredicate().groups,
    }),
  );
  assert.equal(result.status, 200);
  assert.equal(sent.text.format.strict, true);
  assert.match(sent.instructions, /当前服务项/);
  assert.deepEqual(
    sent.text.format.schema.properties.groups.items.properties.conditions.items
      .properties.field.enum,
    ['customerId', 'customerTeam'],
  );
  assert.equal((await compileAssessmentRouting(input, {})).status, 503);
  const missing = languagePredicate();
  missing.groups[1].conditions[0].value = 'missing';
  assert.equal(
    (
      await compileAssessmentRouting(
        input,
        { key: 'test', model: 'test' },
        reply({ supported: true, explanation: 'test', groups: missing.groups }),
      )
    ).status,
    502,
  );
  assert.equal(
    (
      await compileAssessmentRouting(
        input,
        { key: 'test', model: 'test' },
        reply({ supported: false, explanation: '不支持金额条件', groups: [] }),
      )
    ).status,
    422,
  );
});
test('自然语言规则与新流程可原子保存，目录失效或未测试的条件不能写入', async (t) => {
  const data = storage(t),
    config = fixture();
  const newFlow = flow('new');
  config.flows.push(newFlow);
  const candidate = languageRule(languagePredicate());
  candidate.flowId = 'new';
  config.assignment.rules = [candidate];
  const saved = await saveServiceFlowConfig(config, admin);
  assert.equal(
    (await readServiceFlowData()).config.assignment.rules[0].flowId,
    'new',
  );
  assert.equal(saved.flows.at(-1).id, 'new');
  const before = structuredClone(data.references);
  saved.assignment.rules[0].naturalLanguage.requirement = '改过的文本';
  await assert.rejects(saveServiceFlowConfig(saved, admin), /先转译并测试/);
  assert.deepEqual(data.references, before);
  saved.assignment.rules[0] = languageRule(languagePredicate());
  saved.assignment.rules[0].naturalLanguage.compiled.groups[1].conditions[0].value =
    'deleted';
  await assert.rejects(saveServiceFlowConfig(saved, admin), /不存在/);
  assert.deepEqual(data.references, before);
});

test('适用目录与自然语言条件同时成立才分配，多个目录按任一匹配，范围外走默认', () => {
  const config = fixture();
  const candidate = languageRule(languagePredicate());
  candidate.serviceScope = {
    mode: 'selected',
    serviceIds: ['service', 'second'],
  };
  config.assignment.rules = [candidate];
  for (const serviceId of ['service', 'second'])
    assert.equal(
      resolveServiceFlow(config, { ...context, serviceId }).rule.id,
      candidate.id,
    );
  for (const serviceId of ['outside', '']) {
    const result = resolveServiceFlow(config, { ...context, serviceId });
    assert.equal(result.source, 'default');
    assert.equal(result.trace[0].scopeMatched, false);
    assert.equal(result.trace[0].matched, false);
  }
  assert.equal(
    resolveServiceFlow(config, {
      ...context,
      customerTeam: '商业',
      method: '现场',
    }).source,
    'default',
  );
  candidate.serviceScope = { mode: 'all', serviceIds: [] };
  assert.equal(
    resolveServiceFlow(config, { ...context, serviceId: 'new-service' }).rule
      .id,
    candidate.id,
  );
  delete candidate.serviceScope;
  assert.equal(
    resolveServiceFlow(config, { ...context, serviceId: 'new-service' }).rule
      .id,
    candidate.id,
  );
});
test('目录范围限制旧规则且不绕过优先级，空选、重复和畸形范围不保存', () => {
  const config = fixture();
  const selected = rule('selected', 1, [condition('method', '现场')]);
  const fallback = rule('fallback', 10, [condition('method', '现场')]);
  selected.serviceScope = { mode: 'selected', serviceIds: ['other'] };
  config.assignment.rules = [selected, fallback];
  assert.equal(resolveServiceFlow(config, context).rule.id, 'fallback');
  for (const scope of [
    null,
    { mode: 'selected', serviceIds: [] },
    { mode: 'selected', serviceIds: ['service', 'service'] },
    { mode: 'selected', serviceIds: [' '] },
    { mode: 'all', serviceIds: ['service'] },
    { mode: 'unknown', serviceIds: [] },
  ]) {
    selected.serviceScope = scope;
    assert.throws(() => parseServiceFlowConfig(config), /目录/);
  }
});
test('适用目录保存重读保持一致，失效目录引用不能写入，原数据保持不变', async (t) => {
  const data = storage(t),
    config = fixture();
  const candidate = languageRule(languagePredicate());
  candidate.serviceScope = { mode: 'selected', serviceIds: ['service'] };
  config.assignment.rules = [candidate];
  const saved = await saveServiceFlowConfig(config, admin);
  assert.deepEqual(
    (await readServiceFlowData()).config.assignment.rules[0].serviceScope,
    candidate.serviceScope,
  );
  const before = structuredClone(data.references);
  saved.assignment.rules[0].serviceScope.serviceIds = ['deleted'];
  await assert.rejects(saveServiceFlowConfig(saved, admin), /服务目录已不存在/);
  assert.deepEqual(data.references, before);
});

test('更换和清空默认流程保留历史快照，重复保存不重复归档且不能抹除历史', async (t) => {
  storage(t);
  let saved = await saveServiceFlowConfig(fixture(), admin);
  assert.deepEqual(saved.history, []);
  saved = await saveServiceFlowConfig(
    { ...saved, assignment: { ...saved.assignment, defaultFlowId: 'onsite' } },
    admin,
  );
  assert.equal(saved.history.length, 1);
  const archived = structuredClone(saved.history[0]);
  assert.equal(archived.kind, 'default');
  assert.equal(archived.flow.id, 'standard');
  assert.equal(archived.reason, '默认流程已更换');
  assert.equal(archived.disabledBy, admin.name);
  assert.ok(archived.disabledAt);
  const edit = structuredClone(saved);
  edit.history = [];
  edit.flows[0].steps[0].name = '后来修改的步骤';
  saved = await saveServiceFlowConfig(edit, admin);
  assert.deepEqual(saved.history, [archived]);
  saved = await saveServiceFlowConfig(saved, admin);
  assert.equal(saved.history.length, 1);
  saved = await saveServiceFlowConfig(
    { ...saved, assignment: { ...saved.assignment, defaultFlowId: '' } },
    admin,
  );
  assert.equal(saved.history.length, 2);
  assert.equal(saved.history[1].flow.id, 'onsite');
  assert.equal(saved.history[1].reason, '默认流程已清空');
  assert.deepEqual((await readServiceFlowData()).config.history[0], archived);
});

test('当前默认流程附件替换会归档原内容，包括名称及字节数相同的文件', async (t) => {
  storage(t);
  const config = parseServiceFlowConfig(fixture());
  config.flows[0].steps[0].materials = [
    {
      id: 'file',
      kind: 'attachment',
      name: 'guide.txt',
      size: 3,
      mime: 'text/plain',
      blob: new Blob(['old'], { type: 'text/plain' }),
    },
  ];
  const first = await saveServiceFlowConfig(config, admin);
  const edit = structuredClone(first);
  edit.flows[0].steps[0].materials[0].blob = new Blob(['new'], {
    type: 'text/plain',
  });
  const saved = await saveServiceFlowConfig(edit, admin);
  assert.equal(saved.history.length, 1);
  assert.equal(saved.history[0].reason, '默认流程配置更新');
  assert.equal(
    await saved.history[0].flow.steps[0].materials[0].blob.text(),
    'old',
  );
  assert.equal(await saved.flows[0].steps[0].materials[0].blob.text(), 'new');
  assert.equal((await saveServiceFlowConfig(saved, admin)).history.length, 1);
});

test('停用规则保留只读记录、允许优先级复用，不再参与分配且禁止删除或重新启用', async (t) => {
  storage(t);
  const config = fixture();
  config.assignment.rules = [rule('old', 10, [condition('method', '现场')])];
  let saved = await saveServiceFlowConfig(config, admin);
  const edit = structuredClone(saved);
  edit.assignment.rules[0].enabled = false;
  saved = await saveServiceFlowConfig(edit, admin);
  assert.equal(resolveServiceFlow(saved, context).source, 'default');
  assert.equal(saved.history[0].kind, 'rule');
  assert.equal(saved.history[0].rule.id, 'old');
  assert.equal(saved.history[0].reason, '规则停用');
  const next = structuredClone(saved);
  next.assignment.rules.push(rule('new', 10, [condition('method', '现场')]));
  next.flows[1].steps[0].name = '新步骤';
  saved = await saveServiceFlowConfig(next, admin);
  assert.equal(saved.history[0].flow.steps[0].name, '环境确认');
  assert.equal(resolveServiceFlow(saved, context).rule.id, 'new');
  const enable = structuredClone(saved);
  enable.assignment.rules.find((row) => row.id === 'old').enabled = true;
  enable.assignment.rules.find((row) => row.id === 'old').priority = 5;
  await assert.rejects(saveServiceFlowConfig(enable, admin), /只读/);
  const remove = structuredClone(saved);
  remove.assignment.rules = remove.assignment.rules.filter(
    (row) => row.id !== 'old',
  );
  await assert.rejects(saveServiceFlowConfig(remove, admin), /不能删除/);
  assert.deepEqual((await readServiceFlowData()).config, saved);
});

test('旧文档和文件配置迁移为独立条目，保留文本模板、数量格式和客户交付标记', () => {
  const document = newServiceFlowStep(1);
  document.type = 'document';
  document.documentTemplate = '实施报告正文';
  document.deliverToCustomer = true;
  const migratedDocument = parseServiceFlowSteps([document])[0];
  assert.equal(migratedDocument.documents.length, 1);
  assert.equal(migratedDocument.documents[0].initialContent, '实施报告正文');
  assert.equal(migratedDocument.documents[0].instructions, '实施报告正文');
  assert.equal(migratedDocument.documents[0].deliverToCustomer, true);
  const file = newServiceFlowStep(1);
  file.type = 'upload';
  file.upload = { minFiles: 3, formats: '.pdf,.zip' };
  file.deliverToCustomer = true;
  const migratedFile = parseServiceFlowSteps([file])[0];
  assert.equal(migratedFile.files[0].minFiles, 3);
  assert.equal(migratedFile.files[0].formats, '.pdf,.zip');
  assert.equal(migratedFile.files[0].deliverToCustomer, true);
  assert.equal(document.documents, undefined);
  assert.equal(file.files, undefined);
});

test('多文档和多文件分别保存模板字节、链接和交付配置，历史模板不随当前修改', async (t) => {
  storage(t);
  const config = parseServiceFlowConfig(fixture());
  const document = config.flows[0].steps[0];
  document.type = 'document';
  document.documents = [newStepDocument(1), newStepDocument(2)];
  document.documents[0].deliverToCustomer = true;
  document.documents[0].template = {
    id: 'template',
    name: '报告.txt',
    size: 3,
    uploadedAt: new Date().toISOString(),
    blob: new Blob(['old']),
  };
  document.documents[1].onlineTemplateUrl = 'https://example.com/template';
  document.documents[1].required = false;
  const file = config.flows[0].steps[1];
  file.type = 'upload';
  file.files = [newStepFile(1), newStepFile(2)];
  file.files[0].formats = '.zip';
  file.files[0].minFiles = 2;
  file.files[1].deliverToCustomer = true;
  const saved = await saveServiceFlowConfig(config, admin);
  const loaded = (await readServiceFlowData()).config;
  assert.deepEqual(loaded, saved);
  assert.deepEqual(
    loaded.flows[0].steps[0].documents.map((row) => row.deliverToCustomer),
    [true, false],
  );
  assert.deepEqual(
    loaded.flows[0].steps[1].files.map((row) => row.deliverToCustomer),
    [false, true],
  );
  assert.equal(
    loaded.flows[0].steps[0].documents[1].onlineTemplateUrl,
    'https://example.com/template',
  );
  assert.equal(
    await loaded.flows[0].steps[0].documents[0].template.blob.text(),
    'old',
  );
  loaded.flows[0].steps[0].documents[0].template.blob = new Blob(['new']);
  const updated = await saveServiceFlowConfig(loaded, admin);
  assert.equal(
    await updated.history[0].flow.steps[0].documents[0].template.blob.text(),
    'old',
  );
  assert.equal(
    await updated.flows[0].steps[0].documents[0].template.blob.text(),
    'new',
  );
});

test('预览按条目统计客户交付，非文档和文件类型不展示历史步骤级交付值', () => {
  const step = newServiceFlowStep(1);
  step.deliverToCustomer = true;
  assert.equal(stepDeliverySummary(step), '');
  step.type = 'document';
  step.documents = [newStepDocument(1), newStepDocument(2)];
  step.documents[0].deliverToCustomer = true;
  assert.equal(stepDeliverySummary(step), '2 项文档 · 1 项交付客户');
  step.type = 'upload';
  step.files = [newStepFile(1), newStepFile(2)];
  assert.equal(stepDeliverySummary(step), '2 项文件 · 内部使用');
  step.type = 'combined';
  assert.equal(stepDeliverySummary(step), '内部使用');
  assert.equal(stepDocuments(step).length, 2);
  assert.equal(stepFiles(step).length, 2);
});

test('拒绝空条目、重复标识、不安全模板链接及超限模板，避免损坏配置保存', () => {
  const step = newServiceFlowStep(1);
  step.type = 'document';
  step.documents = [];
  assert.throws(() => parseServiceFlowSteps([step]), /1–50/);
  step.documents = [newStepDocument(1)];
  step.documents[0].onlineTemplateUrl = 'javascript:alert(1)';
  assert.throws(() => parseServiceFlowSteps([step]), /http/);
  step.documents[0].onlineTemplateUrl = '';
  step.documents.push(structuredClone(step.documents[0]));
  assert.throws(() => parseServiceFlowSteps([step]), /标识/);
  step.documents.pop();
  step.documents[0].deliverToCustomer = 'true';
  assert.throws(() => parseServiceFlowSteps([step]), /交付要求/);
  step.documents[0].deliverToCustomer = false;
  step.documents[0].template = {
    id: 'template',
    name: 'too-big.txt',
    size: 20 * 1024 * 1024 + 1,
    blob: new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]),
  };
  assert.throws(() => parseServiceFlowSteps([step]), /20 MB/);
  step.documents[0].template = undefined;
  step.type = 'upload';
  step.files = [newStepFile(1)];
  step.files[0].formats = 'pdf';
  assert.throws(() => parseServiceFlowSteps([step]), /扩展名/);
  step.files[0].formats = '.pdf';
  step.files[0].minFiles = 0;
  assert.throws(() => parseServiceFlowSteps([step]), /文件数量/);
});

test('当前类型列表不接受已取消的确认清单步骤', () => {
  assert.equal(Object.hasOwn(serviceStepTypes, 'checklist'), false);
  const step = { ...newServiceFlowStep(1), type: 'checklist' };
  assert.throws(() => parseServiceFlowSteps([step]), /步骤配置无效/);
});

test('通用长文本及附件必填分别校验，全部可选时允许留空且附件固定不交付客户', () => {
  const step = newServiceFlowStep(1);
  step.type = 'combined';
  step.recordRequired = true;
  step.attachmentRequired = false;
  assert.throws(
    () => validateGeneralStepSubmission(step, '   ', []),
    /填写说明/,
  );
  assert.doesNotThrow(() => validateGeneralStepSubmission(step, '说明', []));
  step.recordRequired = false;
  step.attachmentRequired = true;
  assert.throws(() => validateGeneralStepSubmission(step, '', []), /至少上传/);
  const file = {
    id: 'attachment',
    name: '附件.txt',
    size: 4,
    blob: new Blob(['file']),
    uploadedAt: new Date().toISOString(),
    deliverToCustomer: true,
  };
  const result = validateGeneralStepSubmission(step, '', [file]);
  assert.equal(result.deliverToCustomer, false);
  assert.equal(result.attachments[0].deliverToCustomer, false);
  assert.equal(file.deliverToCustomer, true);
  step.recordRequired = true;
  assert.throws(
    () => validateGeneralStepSubmission(step, '', [file]),
    /填写说明/,
  );
  assert.doesNotThrow(() =>
    validateGeneralStepSubmission(step, '说明', [file]),
  );
  step.recordRequired = false;
  step.attachmentRequired = false;
  assert.doesNotThrow(() => validateGeneralStepSubmission(step, '', []));
  assert.throws(
    () =>
      validateGeneralStepSubmission(step, '', [
        { ...file, blob: new Blob([]), size: 0 },
      ]),
    /非空文件/,
  );
});

test('通用配置保存重读保留说明和独立必填值', async (t) => {
  storage(t);
  const config = parseServiceFlowConfig(fixture());
  const step = config.flows[0].steps[0];
  step.type = 'combined';
  step.generalDescription = '说明初始内容\n可以修改';
  step.recordRequired = false;
  step.attachmentRequired = true;
  step.deliverToCustomer = true;
  await saveServiceFlowConfig(config, admin);
  const loaded = (await readServiceFlowData()).config.flows[0].steps[0];
  assert.equal(loaded.generalDescription, step.generalDescription);
  assert.equal(loaded.recordRequired, false);
  assert.equal(loaded.attachmentRequired, true);
  assert.equal(loaded.deliverToCustomer, false);

});

function executionFormFixture() {
  return {
    id: 'execution-form',
    name: '交付执行记录',
    description: '供服务步骤使用',
    fields: [
      {
        id: 'notes',
        name: '执行说明',
        type: 'textarea',
        required: true,
        options: [],
      },
      {
        id: 'date',
        name: '执行日期',
        type: 'date',
        required: false,
        options: [],
      },
    ],
    layout: {
      order: ['date', 'notes'],
      widths: { date: 'half', notes: 'full' },
      rowStarts: [],
    },
  };
}

test('独立表单保存与流程引用、更新同步及历史快照在同一事务中保持一致', async (t) => {
  storage(t);
  let library = await saveExecutionForms(
    { ...emptyExecutionForms(), forms: [executionFormFixture()] },
    admin,
  );
  const config = parseServiceFlowConfig(fixture());
  config.flows[0].steps[0].type = 'form';
  config.flows[0].steps[0].executionFormId = library.forms[0].id;
  const savedFlow = await saveServiceFlowConfig(config, admin);
  assert.deepEqual(
    savedFlow.flows[0].steps[0].formFields.map((field) => field.id),
    ['date', 'notes'],
  );
  const oldSnapshot = structuredClone(
    savedFlow.flows[0].steps[0].executionForm,
  );
  const edit = structuredClone(library);
  edit.forms[0].fields[0].name = '新的执行说明';
  edit.forms[0].layout.order.reverse();
  library = await saveExecutionForms(edit, admin);
  const current = (await readServiceFlowData()).config;
  assert.equal(current.revision, savedFlow.revision + 1);
  assert.equal(
    current.flows[0].steps[0].executionForm.fields[0].name,
    '新的执行说明',
  );
  assert.deepEqual(
    current.flows[0].steps[0].formFields.map((field) => field.id),
    ['notes', 'date'],
  );
  assert.deepEqual(
    current.history.at(-1).flow.steps[0].executionForm,
    oldSnapshot,
  );
  assert.deepEqual((await readExecutionFormData()).library, library);
  await assert.rejects(saveServiceFlowConfig(savedFlow, admin), /其他页面修改/);
  await assert.rejects(saveExecutionForms(edit, admin), /其他页面修改/);
});

test('引用中的表单不可删除，无权限或停用管理员无法修改且失败不写入', async (t) => {
  const data = storage(t);
  const library = await saveExecutionForms(
    { ...emptyExecutionForms(), forms: [executionFormFixture()] },
    admin,
  );
  const config = parseServiceFlowConfig(fixture());
  config.flows[0].steps[0].type = 'form';
  config.flows[0].steps[0].executionFormId = library.forms[0].id;
  await saveServiceFlowConfig(config, admin);
  const before = structuredClone(data.references);
  await assert.rejects(
    saveExecutionForms({ ...library, forms: [] }, admin),
    /引用，不能删除/,
  );
  assert.deepEqual(data.references, before);
  await assert.rejects(
    saveExecutionForms(library, { ...admin, id: 'USR-001' }),
    /系统管理员/,
  );
  data.references[0].payload.users.find((user) => user.id === admin.id).status =
    '停用';
  const inactive = structuredClone(data.references);
  await assert.rejects(saveExecutionForms(library, admin), /已停用/);
  assert.deepEqual(data.references, inactive);
});
