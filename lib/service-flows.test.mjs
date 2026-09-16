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
import { moveServiceStep, newServiceFlowStep, parseServiceFlowSteps } from './service-flow-steps.ts';

const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };

test('旧步骤迁移保留说明、确认清单和完成要求，且不修改原数据', () => {
  const config = fixture(), before = structuredClone(config);
  const migrated = parseServiceFlowConfig(config).flows[0].steps[0];
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.type, 'combined');
  assert.equal(migrated.sequence, 1);
  assert.equal(migrated.enabled, true);
  assert.equal(migrated.required, true);
  assert.equal(migrated.deliverToCustomer, false);
  assert.equal(migrated.materials[0].content, '确认服务范围');
  assert.deepEqual(migrated.checklist, ['环境已就绪']);
  assert.equal(migrated.recordRequired, true);
  assert.deepEqual(config, before);
});

test('步骤重排后顺序连续，预览排除停用步骤并保留可选和客户交付标志', () => {
  const config = parseServiceFlowConfig(fixture());
  const steps = config.flows[0].steps;
  steps[0].enabled = false;
  steps[1].required = false; steps[1].deliverToCustomer = true; steps[1].type = 'document';
  const moved = moveServiceStep(steps, 'deliver', 1);
  assert.deepEqual(moved.map(step => [step.id, step.sequence]), [['deliver', 1], ['prepare', 2]]);
  assert.deepEqual(steps.map(step => step.sequence), [1, 2]);
  config.flows[0].steps = moved;
  const result = resolveServiceFlow(config, context);
  assert.deepEqual(result.steps.map(step => step.id), ['deliver']);
  assert.equal(result.steps[0].required, false);
  assert.equal(result.steps[0].deliverToCustomer, true);
});

test('通用类型校验字段、文件要求、链接安全、顺序和启停值', () => {
  const step = newServiceFlowStep(1);
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.formFields = [];
  assert.throws(() => parseServiceFlowSteps([step]), /表单字段/);
  step.type = 'upload'; step.upload.formats = '.pdf,.docx';
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.upload.minFiles = 0;
  assert.throws(() => parseServiceFlowSteps([step]), /文件数量/);
  step.upload.minFiles = 1; step.type = 'checklist';
  assert.throws(() => parseServiceFlowSteps([step]), /至少需要一个/);
  step.checklist = ['确认完成'];
  step.materials = [{ id: 'link', kind: 'link', title: '指引', url: 'javascript:alert(1)' }];
  assert.throws(() => parseServiceFlowSteps([step]), /说明链接/);
  step.materials[0].url = 'https://example.com/guide';
  assert.doesNotThrow(() => parseServiceFlowSteps([step]));
  step.enabled = '启用';
  assert.throws(() => parseServiceFlowSteps([step]), /步骤配置无效/);
  step.enabled = true; step.sequence = 2;
  assert.throws(() => parseServiceFlowSteps([step]), /步骤配置无效/);
});

test('说明附件字节、类型配置和交付标志保存后重读保持一致', async t => {
  storage(t);
  const config = parseServiceFlowConfig(fixture()), step = config.flows[0].steps[0];
  step.type = 'document'; step.required = false; step.deliverToCustomer = true;
  step.documentTemplate = '一、实施结果\n二、遗留事项';
  step.materials.push({ id: 'attachment', kind: 'attachment', name: 'guide.txt', blob: new Blob(['真实说明附件内容']) });
  await saveServiceFlowConfig(config, admin);
  const loaded = (await readServiceFlowData()).config.flows[0].steps[0];
  assert.equal(await loaded.materials[1].blob.text(), '真实说明附件内容');
  assert.equal(loaded.documentTemplate, step.documentTemplate);
  assert.equal(loaded.required, false);
  assert.equal(loaded.deliverToCustomer, true);
  loaded.name = '本地编辑';
  assert.notEqual((await readServiceFlowData()).config.flows[0].steps[0].name, loaded.name);
});
const flow = (id) => ({
  id,
  name: id,
  description: '',
  enabled: true,
  steps: [
    {
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
  config.flows[0].steps.reverse();
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
