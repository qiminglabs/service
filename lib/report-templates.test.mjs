import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reportFieldNode,
  defaultReportTemplates,
  parseReportTemplate,
  parseReportLibrary,
  renderReport,
  defaultReportBindings,
  validateReportSelection,
  reportFields,
  stepFieldOptions,
} from './report-templates.ts';
import { newServiceFlowStep } from './service-flow-steps.ts';
import {
  parseServiceFlowConfig,
  emptyServiceFlowConfig,
} from './service-flows.ts';


import { saveReportTemplates } from './report-template-store.ts';
const engineer = { id: 'USR-004', name: '工程师', role: 'SmartX 服务工程师' },
  admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
function fixture() {
  const form = {
    ...newServiceFlowStep(1),
    id: 'step-a',
    name: '环境采集',
    formFields: [
      { id: 'cluster', name: '集群名称', type: 'text', required: true },
      { id: 'flag', name: '检查结果', type: 'text', required: true },
      { id: 'number', name: '数量', type: 'number', required: true },
    ],
  };
  const project = {
    id: 'SP-1',
    name: '项目 A',
    customerId: 'c1',
    revision: 1,
    status: '进行中',
    customValues: { site: '机房 A' },
    collaborators: { internal: [engineer] },
    workOrders: [
      {
        id: 'wo1',
        status: '进行中',
        assignees: [{ ...engineer, group: 'internal' }],
        item: { serviceName: '集群部署' },
        customerName: '客户 A',
        steps: [
          {
            definition: form,
            status: '已完成',
            data: { values: { cluster: '集群 A', flag: false, number: '0' } },
          },
        ],
      },
    ],
  };
  const fields = [
    { id: 'p', scope: 'project', fieldId: 'name', label: '项目名称' },
    { id: 'c', scope: 'project', fieldId: 'custom:site', label: '地点' },
    { id: 'w', scope: 'order', fieldId: 'serviceName', label: '服务名称' },
    ...['cluster', 'flag', 'number'].map((id) => ({
      id,
      scope: 'step',
      fieldId: id,
      label: id,
    })),
  ];
  const template = {
    id: 'test-template',
    name: '综合报告',
    scope: 'step',
    enabled: true,
    version: 1,
    body: {
      type: 'doc',
      content: fields.map((f) => ({
        type: 'paragraph',
        content: [reportFieldNode(f)],
      })),
    },
  };
  return { project, form, template };
}
function fileFor(project, customerName = '客户 A') {
  const template = defaultReportTemplates().templates[0],
    resolved = renderReport(template, { project, customerName });
  const blob = new Blob([resolved.content]);
  return {
    id: 'file1',
    name: '报告.txt',
    size: blob.size,
    blob,
    uploadedAt: '2026-09-19T00:00:00Z',
    onlineDocument: {
      title: '报告',
      content: resolved.content,
      source: 'template',
      richText: resolved.body,
      reportSource: resolved.source,
    },
  };
}
test('统一取项目、工单和步骤字段；保留 false、0 及格式，不按字段名称匹配', () => {
  const { project, template, form } = fixture(),
    bindings = defaultReportBindings(template, [form]);
  form.name = '更名后的步骤';
  form.formFields[0].name = '更名后的字段';
  const result = renderReport(template, { project, orderId: 'wo1' }, bindings);
  assert.deepEqual(result.missing, []);
  assert.match(result.content, /项目 A\n机房 A\n集群部署\n集群 A\n否\n0/);
  assert.equal(reportFields(result.body).length, 0);
  assert.equal(result.body.content[0].content[0].type, 'text');
  assert.equal(project.workOrders[0].steps[0].data.values.flag, false);
});
test('同一表单出现两次时要求明确绑定；改绑到不同字段可复用模板', () => {
  const { project, template, form } = fixture(),
    second = { ...structuredClone(form), id: 'step-b', name: '复测' };
  assert.deepEqual(defaultReportBindings(template, [form, second]), {});
  assert.throws(
    () => validateReportSelection({ template, bindings: {} }, [form, second]),
    /绑定/,
  );
  const bindings = defaultReportBindings(template, [form]);
  bindings.cluster = { stepId: 'step-b', fieldId: 'cluster' };
  project.workOrders[0].steps.push({
    definition: second,
    status: '已完成',
    data: { values: { cluster: '复测值' } },
  });
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).source.values
      .cluster,
    '复测值',
  );
});
test('缺失、停用、跳过或取消的来源明确提示，不回退到其他同名字段', () => {
  const { project, template, form } = fixture(),
    bindings = defaultReportBindings(template, [form]);
  delete project.workOrders[0].steps[0].data.values.cluster;
  assert.ok(
    renderReport(
      template,
      { project, orderId: 'wo1' },
      bindings,
    ).missing.includes('cluster'),
  );
  project.workOrders[0].steps[0].status = '已跳过';
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).missing
      .length,
    3,
  );
  project.workOrders[0].status = '已取消';
  assert.ok(
    renderReport(
      template,
      { project, orderId: 'wo1' },
      bindings,
    ).missing.includes('服务名称'),
  );
  form.enabled = false;
  assert.throws(
    () => validateReportSelection({ template, bindings }, [form]),
    /不存在/,
  );
});
test('解析拒绝非法字段、重复模板和脚本节点，插入值始终是文本', () => {
  const { template, project, form } = fixture();
  const invalid = structuredClone(template);
  invalid.body.content[0].content[0].attrs.fieldId = 'review';
  assert.throws(() => parseReportTemplate(invalid), /不支持/);
  assert.throws(
    () => parseReportLibrary({ revision: 0, templates: [template, template] }),
    /重复/,
  );
  assert.throws(
    () =>
      parseReportTemplate({
        ...template,
        body: { type: 'doc', content: [{ type: 'script' }] },
      }),
    /格式/,
  );
  project.name = '<img src=x onerror=alert(1)>';
  const result = renderReport(
    template,
    { project, orderId: 'wo1' },
    defaultReportBindings(template, [form]),
  );
  assert.equal(result.body.content[0].content[0].text, project.name);
});
test('流程保存检查绑定来源，旧工单的模板快照不被模板更新影响', () => {
  const { template, form } = fixture(),
    report = {
      ...newServiceFlowStep(2),
      id: 'report-step',
      type: 'document',
      documents: [
        {
          id: 'd',
          name: '报告',
          required: true,
          deliverToCustomer: true,
          instructions: '',
          onlineTemplateUrl: '',
          reportTemplate: {
            template: structuredClone(template),
            bindings: defaultReportBindings(template, [form]),
          },
        },
      ],
    };
  const config = {
    ...emptyServiceFlowConfig(),
    flows: [
      {
        id: 'flow',
        name: '部署流程',
        description: '',
        enabled: true,
        steps: [form, report],
      },
    ],
  };
  assert.doesNotThrow(() => parseServiceFlowConfig(config));
  const snapshot = structuredClone(config.flows[0]);
  template.name = '新报告';
  template.version = 2;
  assert.equal(
    snapshot.steps[1].documents[0].reportTemplate.template.version,
    1,
  );
  config.flows[0].steps[0].formFields = [];
  assert.throws(() => parseServiceFlowConfig(config), /来源|字段/);
});

function storage(t, stores, failPut = () => false) {
  const old = globalThis.indexedDB;
  const oldWindow = globalThis.window;
  t.after(() => {
    if (old) globalThis.indexedDB = old;
    else delete globalThis.indexedDB;
    if (oldWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  });
  globalThis.window = { dispatchEvent() {} };
  globalThis.indexedDB = {
    open() {
      const open = {
        result: {
          close() {},
          transaction(names, mode) {
            const staged = structuredClone(stores);
            let pending = 0;
            let aborted = false;
            let scheduled = false;
            const complete = () => {
              if (scheduled) return;
              scheduled = true;
              queueMicrotask(() => {
                scheduled = false;
                if (aborted || pending) return;
                if (mode === 'readwrite') Object.assign(stores, staged);
                tx.oncomplete?.();
              });
            };
            const request = (result) => {
              pending++;
              const req = { result: structuredClone(result) };
              queueMicrotask(() => {
                if (aborted) return;
                req.onsuccess?.();
                pending--;
                complete();
              });
              return req;
            };
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(name) {
                return {
                  getAll() {
                    return request(staged[name]);
                  },
                  get(id) {
                    return request(
                      staged[name].find(
                        (record) => (record.id ?? record.serviceId) === id,
                      ),
                    );
                  },
                  put(record) {
                    if (failPut(record)) throw new Error('模拟存储失败');
                    assert.equal(mode, 'readwrite');
                    const id = record.id ?? record.serviceId;
                    const index = staged[name].findIndex(
                      (value) => (value.id ?? value.serviceId) === id,
                    );
                    if (index >= 0)
                      staged[name][index] = structuredClone(record);
                    else staged[name].push(structuredClone(record));
                    complete();
                  },
                };
              },
            };
            return tx;
          },
        },
      };
      queueMicrotask(() => open.onsuccess());
      return open;
    },
  };
}

function storesFor(t, fail = false) {
  const { project } = fixture();
  const stores = {
    references: [
      {
        id: 'workspace',
        payload: {
          users: [
            { ...engineer, name: '实际工程师', status: '启用' },
            { ...admin, status: '启用' },
          ],
        },
      },
      { id: 'service-project:SP-1', payload: project },
    ],
  };
  storage(t, stores, () => fail);
  return { stores, project };
}
test('模板库限制管理员、校验并发保存并递增版本', async (t) => {
  const { stores } = storesFor(t);
  const library = defaultReportTemplates();
  await assert.rejects(saveReportTemplates(library, engineer), /管理员/);
  library.templates[0].name = '更新模板';
  const saved = await saveReportTemplates(library, admin);
  assert.equal(saved.revision, 1);
  assert.equal(saved.templates[0].version, 2);
  assert.equal(saved.templates[1].version, 1);
  await assert.rejects(saveReportTemplates(library, admin), /其他页面/);
  stores.references[0].payload.users[1].status = '停用';
  await assert.rejects(saveReportTemplates(saved, admin), /停用/);
});

// Flow-local templates use concrete step IDs rather than guessing by form name.
const {
  withFlowReportTemplates,
  localizeReportTemplate,
  validateFlowReportTemplates,
  setFlowReportTemplates,
  updateReportField,
  validateProjectReportTemplate,
} = await import('./flow-report-templates.ts');
function reportFlowFixture() {
  const { form, template, project } = fixture();
  const selection = {
    template,
    bindings: defaultReportBindings(template, [form]),
  };
  const flow = {
    id: 'flow-a',
    name: '部署流程',
    description: '',
    enabled: true,
    steps: [
      form,
      {
        ...newServiceFlowStep(2),
        id: 'report',
        type: 'document',
        documents: [
          {
            id: 'report-doc',
            name: '服务报告',
            required: true,
            deliverToCustomer: true,
            instructions: '',
            onlineTemplateUrl: '',
            reportTemplate: selection,
          },
        ],
      },
    ],
  };
  return { flow, project };
}
test('旧步骤模板迁入所属流程，迁移幂等且不修改输入和历史快照', () => {
  const { flow } = reportFlowFixture();
  const original = structuredClone(flow);
  const migrated = withFlowReportTemplates(flow);
  assert.deepEqual(flow, original);
  assert.equal(migrated.reportTemplates.length, 1);
  assert.equal(migrated.reportTemplates[0].flowId, flow.id);
  assert.equal(
    reportFields(migrated.reportTemplates[0].body).find(
      (f) => f.scope === 'step',
    ).stepId,
    'step-a',
  );
  assert.deepEqual(withFlowReportTemplates(migrated), migrated);
  assert.doesNotThrow(() => validateFlowReportTemplates(migrated));
  assert.deepEqual(
    parseServiceFlowConfig({ ...emptyServiceFlowConfig(), flows: [flow] })
      .flows[0].reportTemplates,
    migrated.reportTemplates,
  );
});
test('不同流程模板隔离，拒绝跨流程选择和在步骤内篡改来源', () => {
  const { flow } = reportFlowFixture();
  const first = withFlowReportTemplates(flow);
  const second = withFlowReportTemplates({
    ...structuredClone(flow),
    id: 'flow-b',
  });
  second.steps[1].documents[0].reportTemplate = structuredClone(
    first.steps[1].documents[0].reportTemplate,
  );
  assert.throws(() => validateFlowReportTemplates(second), /不属于/);
  first.steps[1].documents[0].reportTemplate.bindings.cluster.stepId = 'other';
  assert.throws(() => validateFlowReportTemplates(first), /不一致/);
});
test('流程内同一表单的不同步骤按明确步骤取值，改名不影响引用', () => {
  const { flow, project } = reportFlowFixture();
  const migrated = withFlowReportTemplates(flow);
  const another = {
    ...structuredClone(flow.steps[0]),
    id: 'other',
    name: '复测',
  };
  migrated.steps.push(another);
  project.workOrders[0].steps.push({
    definition: another,
    status: '已完成',
    data: { values: { cluster: '其他值' } },
  });
  migrated.steps[0].name = '改名后的步骤';
  const template = migrated.reportTemplates[0];
  const result = renderReport(
    template,
    { project, orderId: 'wo1' },
    defaultReportBindings(template, migrated.steps),
  );
  assert.equal(result.source.values.cluster, '集群 A');
  assert.doesNotThrow(() => validateFlowReportTemplates(migrated));
});
test('删除或停用被引用的步骤、删除字段均阻止保存，并明确指出模板', () => {
  const { flow } = reportFlowFixture();
  for (const change of [
    (f) => {
      f.steps = f.steps.slice(1);
    },
    (f) => {
      f.steps[0].enabled = false;
    },
    (f) => {
      f.steps[0].formFields = [];
    },
  ]) {
    const migrated = withFlowReportTemplates(flow);
    change(migrated);
    assert.throws(
      () => validateFlowReportTemplates(migrated),
      /综合报告.*来源步骤或字段/,
    );
  }
});
test('流程模板修改同步配置内引用，已有执行快照保持原版本；引用中的模板不可删除', () => {
  const { flow } = reportFlowFixture();
  const migrated = withFlowReportTemplates(flow);
  const oldExecution = structuredClone(
    migrated.steps[1].documents[0].reportTemplate,
  );
  const updated = structuredClone(migrated.reportTemplates);
  updated[0].version++;
  updated[0].body = updateReportField(updated[0].body, 'cluster', {
    emptyPolicy: 'default',
    defaultText: '待补充',
  });
  const next = setFlowReportTemplates(migrated, updated);
  assert.equal(next.steps[1].documents[0].reportTemplate.template.version, 2);
  assert.equal(oldExecution.template.version, 1);
  assert.equal(
    reportFields(oldExecution.template.body).find((f) => f.id === 'cluster')
      .emptyPolicy,
    undefined,
  );
  assert.doesNotThrow(() => validateFlowReportTemplates(next));
  assert.throws(() => setFlowReportTemplates(migrated, []), /引用/);
});
test('空值策略支持留空和默认文本，但无法绕过失效的步骤来源', () => {
  const { flow, project } = reportFlowFixture();
  const template = withFlowReportTemplates(flow).reportTemplates[0];
  delete project.workOrders[0].steps[0].data.values.cluster;
  const bindings = defaultReportBindings(template, flow.steps);
  assert.ok(
    renderReport(
      template,
      { project, orderId: 'wo1' },
      bindings,
    ).missing.includes('cluster'),
  );
  template.body = updateReportField(template.body, 'cluster', {
    emptyPolicy: 'blank',
  });
  let result = renderReport(template, { project, orderId: 'wo1' }, bindings);
  assert.deepEqual(result.missing, []);
  assert.doesNotThrow(() =>
    parseReportTemplate({ ...template, body: result.body }),
  );
  assert.doesNotMatch(result.content, /未填写/);
  template.body = updateReportField(template.body, 'cluster', {
    emptyPolicy: 'default',
    defaultText: '暂无数据',
  });
  result = renderReport(template, { project, orderId: 'wo1' }, bindings);
  assert.equal(result.source.values.cluster, '暂无数据');
  project.workOrders[0].steps = [];
  result = renderReport(template, { project, orderId: 'wo1' }, bindings);
  assert.ok(result.missing.includes('cluster'));
  assert.equal(result.source.values.cluster, '');
});
test('通用项目模板拒绝工单和步骤字段，旧模板可显式导入流程并重新绑定', () => {
  const { template, form } = fixture();
  assert.throws(
    () => validateProjectReportTemplate({ ...template, scope: 'project' }),
    /只能引用/,
  );
  const imported = localizeReportTemplate(template, {
    id: 'new-flow',
    steps: [form],
  });
  assert.equal(imported.flowId, 'new-flow');
  assert.equal(
    reportFields(imported.body).find((f) => f.id === 'cluster').stepId,
    form.id,
  );
  assert.doesNotThrow(() =>
    validateProjectReportTemplate(defaultReportTemplates().templates[0]),
  );
});
test('相同标签的独立字段空值策略互不影响；非法默认值拒绝保存', () => {
  const { template, project, form } = fixture();
  const fields = ['cluster', 'flag'].map((id) => ({
    id,
    scope: 'step',
    fieldId: id,
    label: '结果',
    emptyPolicy: id === 'cluster' ? 'block' : 'blank',
  }));
  template.body = {
    type: 'doc',
    content: fields.map((f) => ({
      type: 'paragraph',
      content: [reportFieldNode(f)],
    })),
  };
  project.workOrders[0].steps[0].data.values = {};
  const result = renderReport(
    template,
    { project, orderId: 'wo1' },
    defaultReportBindings(template, [form]),
  );
  assert.equal(result.body.content[1].content.length, 0);
  assert.equal(result.missing.length, 1);
  template.body = updateReportField(template.body, 'cluster', {
    emptyPolicy: 'default',
  });
  assert.throws(() => parseReportTemplate(template), /默认文本/);
});

function generalReportFixture() {
  const { project } = fixture();
  const step = {
    ...newServiceFlowStep(1),
    id: 'general-step',
    name: '实施记录',
    type: 'combined',
    generalDescription: '配置中的初始说明',
    recordRequired: false,
    attachmentRequired: false,
  };
  const template = {
    id: 'general-template',
    name: '通用步骤报告',
    scope: 'step',
    flowId: 'general-flow',
    enabled: true,
    version: 1,
    body: {
      type: 'doc',
      content: stepFieldOptions([step]).map((option) => ({
        type: 'paragraph',
        content: [
          reportFieldNode({ ...option, scope: 'step', id: option.fieldId }),
        ],
      })),
    },
  };
  const execution = {
    definition: step,
    status: '已完成',
    data: {
      description: '已完成集群部署。\n验证结果正常。',
      values: { 'general:description': '错误的表单取值' },
      attachments: [
        {
          name: '验收截图.png',
          blob: new Blob(['image']),
          deliverToCustomer: false,
        },
        {
          name: '部署记录.txt',
          blob: new Blob(['notes']),
          deliverToCustomer: false,
        },
      ],
    },
  };
  project.workOrders[0].steps.push(execution);
  return {
    project,
    step,
    template,
    execution,
    bindings: defaultReportBindings(template, [step]),
  };
}
test('工单文档模板可引用通用步骤执行说明和附件名称，保留换行并使用执行值', () => {
  const { project, step, template, execution, bindings } =
    generalReportFixture();
  const result = renderReport(template, { project, orderId: 'wo1' }, bindings);
  assert.deepEqual(result.missing, []);
  assert.equal(
    result.source.values['general:description'],
    '已完成集群部署。\n验证结果正常。',
  );
  assert.equal(
    result.source.values['general:attachments'],
    '验收截图.png\n部署记录.txt',
  );
  assert.doesNotMatch(result.content, /初始说明|错误的表单取值/);
  assert.equal(execution.data.attachments[0].deliverToCustomer, false);
  assert.doesNotThrow(() =>
    validateFlowReportTemplates({
      id: 'general-flow',
      steps: [step],
      reportTemplates: [template],
    }),
  );
});
test('通用步骤无执行值时遵循空值策略，不回退到配置初始内容；失效来源仍阻断', () => {
  const { project, step, template, execution, bindings } =
    generalReportFixture();
  execution.data.description = '  \n';
  execution.data.attachments = [];
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).missing
      .length,
    2,
  );
  template.body = updateReportField(template.body, 'general:description', {
    emptyPolicy: 'default',
    defaultText: '暂无说明',
  });
  template.body = updateReportField(template.body, 'general:attachments', {
    emptyPolicy: 'blank',
  });
  const result = renderReport(template, { project, orderId: 'wo1' }, bindings);
  assert.deepEqual(result.missing, []);
  assert.equal(result.source.values['general:description'], '暂无说明');
  assert.equal(result.body.content[1].content.length, 0);
  step.enabled = false;
  assert.deepEqual(stepFieldOptions([step]), []);
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).missing
      .length,
    2,
  );
  assert.throws(
    () =>
      validateFlowReportTemplates({
        id: 'general-flow',
        steps: [step],
        reportTemplates: [template],
      }),
    /来源步骤或字段/,
  );
});
test('多个通用步骤按步骤标识绑定，跳过或改型后不会误取其他步骤内容', () => {
  const { project, step, template, execution } = generalReportFixture();
  const other = {
    ...structuredClone(step),
    id: 'another-general',
    name: step.name,
  };
  project.workOrders[0].steps.push({
    definition: other,
    status: '已完成',
    data: { description: '另一步骤说明', attachments: [], values: {} },
  });
  const bindings = defaultReportBindings(template, [other, step]);
  assert.equal(bindings['general:description'].stepId, step.id);
  step.name = '重新命名';
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).source.values[
      'general:description'
    ],
    execution.data.description,
  );
  execution.status = '已跳过';
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).missing
      .length,
    2,
  );
  execution.status = '已完成';
  step.type = 'document';
  assert.deepEqual(stepFieldOptions([step]), []);
  assert.equal(
    renderReport(template, { project, orderId: 'wo1' }, bindings).missing
      .length,
    2,
  );
});

const { projectDeliverables } =
  await import('./service-project-deliverables.ts');
const { resolveProjectReportFiles } = await import('./project-report-files.ts');
function projectWithReportFiles(project) {
  const customerFile = {
    id: 'customer-file',
    name: '部署结果.pdf',
    blob: new Blob(['customer file bytes']),
    uploadedAt: '2026-09-20T00:00:00Z',
    onlineDocument: {
      title: '内部元数据',
      content: '不可透出',
      source: 'blank',
    },
  };
  customerFile.size = customerFile.blob.size;
  project.workOrders[0].steps.push({
    definition: {
      ...newServiceFlowStep(2),
      id: 'delivery-step',
      type: 'upload',
      files: [
        {
          id: 'public',
          name: '客户部署文件',
          required: false,
          deliverToCustomer: true,
          minFiles: 1,
          formats: '',
        },
        {
          id: 'private',
          name: '内部文件',
          required: false,
          deliverToCustomer: false,
          minFiles: 1,
          formats: '',
        },
      ],
    },
    status: '已完成',
    data: {
      values: {},
      attachments: [],
      deliverables: {
        public: [
          customerFile,
          {
            ...customerFile,
            id: 'customer-file-two',
            blob: new Blob(['second file bytes']),
            name: customerFile.name,
          },
        ],
        private: [
          { ...customerFile, id: 'private-file', name: '内部记录.txt' },
        ],
      },
    },
  });
  return projectDeliverables(project);
}
test('项目报告文件选择拒绝内部文件、其他项目文件、重复选择及超长说明', () => {
  const { project } = fixture();
  const available = projectWithReportFiles(project);
  const choice = { deliverableId: available[0].id, description: '' };
  assert.equal(resolveProjectReportFiles(project, [choice])[0].description, '');
  assert.throws(
    () => resolveProjectReportFiles(project, [choice, choice]),
    /重复/,
  );
  assert.throws(
    () =>
      resolveProjectReportFiles(project, [
        { ...choice, description: '字'.repeat(2001) },
      ]),
    /2000/,
  );
  assert.throws(
    () =>
      resolveProjectReportFiles(project, [
        {
          deliverableId: JSON.stringify([
            'wo1',
            'delivery-step',
            'private',
            'private-file',
          ]),
          description: '',
        },
      ]),
    /客户交付物/,
  );
  assert.throws(
    () => resolveProjectReportFiles(fixture().project, [choice]),
    /客户交付物/,
  );
  const selection = [choice];
  project.workOrders[0].steps.at(-1).definition.files[0].deliverToCustomer =
    false;
  assert.throws(
    () => resolveProjectReportFiles(project, selection),
    /客户交付物/,
  );
  project.workOrders[0].steps.at(-1).definition.files[0].deliverToCustomer =
    true;
  project.workOrders[0].status = '已取消';
  assert.throws(
    () => resolveProjectReportFiles(project, selection),
    /客户交付物/,
  );
});

test('工单预览仅匹配流程编号，排除取消工单，保留不同项目同编号工单', async () => {
  const { reportPreviewOrders } = await import('./report-template-preview.ts');
  const { project } = fixture();
  project.workOrders[0].flowId = 'flow-a';
  const other = structuredClone(project);
  other.id = 'SP-2';
  project.workOrders.push({ ...structuredClone(project.workOrders[0]), id: 'other-flow', flowId: 'flow-b' });
  project.workOrders.push({ ...structuredClone(project.workOrders[0]), id: 'cancelled', status: '已取消' });
  const matches = reportPreviewOrders([project, other], 'flow-a');
  assert.equal(matches.length, 2);
  assert.notEqual(matches[0].key, matches[1].key);
  assert.deepEqual(reportPreviewOrders([project], 'missing'), []);
});

test('预览使用当前模板草稿和所选工单快照的实际值，不修改输入，缺失来源明确标注', async () => {
  const { renderWorkOrderPreview } = await import('./report-template-preview.ts');
  const { flow, project } = reportFlowFixture();
  const template = withFlowReportTemplates(flow).reportTemplates[0];
  project.workOrders[0].flowId = flow.id;
  const before = structuredClone({ project, template });
  const preview = renderWorkOrderPreview(template, project, 'wo1');
  assert.equal(preview.source.values.cluster, '集群 A');
  assert.deepEqual({ project, template }, before);
  assert.throws(() => renderWorkOrderPreview({ ...template, flowId: 'wrong' }, project, 'wo1'), /当前流程/);
  project.workOrders[0].steps = [];
  assert.ok(renderWorkOrderPreview(template, project, 'wo1').missing.includes('cluster'));
  project.workOrders[0].status = '已取消';
  assert.throws(() => renderWorkOrderPreview(template, project, 'wo1'), /有效工单/);
});

test('引用步骤按步骤去重，停用步骤的绑定仍计入，解绑后才能停用', async () => {
  const { reportTemplateSteps } = await import('./flow-report-templates.ts');
  const { flow, project } = reportFlowFixture();
  const migrated = withFlowReportTemplates(flow);
  migrated.steps[1].documents.push({ ...structuredClone(migrated.steps[1].documents[0]), id: 'second-doc' });
  migrated.steps[1].enabled = false;
  const before = structuredClone(migrated);
  const template = migrated.reportTemplates[0];
  assert.deepEqual(reportTemplateSteps(migrated, template.id).map(step => step.id), ['report']);
  assert.deepEqual(reportTemplateSteps(migrated, 'missing'), []);
  assert.throws(() => setFlowReportTemplates(migrated, [{ ...template, enabled: false }]), /引用.*替换或解除绑定/);
  assert.deepEqual(migrated, before);
  const original = structuredClone(migrated.steps[1].documents[0].reportTemplate);
  migrated.steps[1].documents.forEach(doc => delete doc.reportTemplate);
  const next = setFlowReportTemplates(migrated, [{ ...template, enabled: false, version: template.version + 1 }]);
  assert.doesNotThrow(() => validateFlowReportTemplates(next));
  assert.equal(next.reportTemplates[0].enabled, false);
  assert.equal(original.template.enabled, true);
  assert.equal(renderReport(original.template, { project, orderId: 'wo1' }, original.bindings).source.values.cluster, '集群 A');
});

test('流程保存事务拒绝停用引用中模板，保持配置和已有工单，解绑后允许保存', async t => {
  const { saveServiceFlowConfig } = await import('./service-flow-store.ts');
  const { serviceFlowConfigId } = await import('./service-flows.ts');
  const { stores } = storesFor(t);
  const { flow } = reportFlowFixture();
  let prepared = withFlowReportTemplates(flow);
  prepared.steps[0].type = 'combined';
  prepared = setFlowReportTemplates(prepared, prepared.reportTemplates.map(template => ({ ...template, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '服务报告' }] }] } })));
  const saved = await saveServiceFlowConfig({ ...emptyServiceFlowConfig(), flows: [prepared] }, admin);
  const before = structuredClone(stores);
  const invalid = structuredClone(saved);
  invalid.flows[0].reportTemplates[0].enabled = false;
  invalid.flows[0].steps[1].documents[0].reportTemplate.template.enabled = false;
  await assert.rejects(saveServiceFlowConfig(invalid, admin), /引用.*替换或解除绑定/);
  assert.deepEqual(stores, before);
  delete invalid.flows[0].steps[1].documents[0].reportTemplate;
  const updated = await saveServiceFlowConfig(invalid, admin);
  assert.equal(updated.flows[0].reportTemplates[0].enabled, false);
  assert.equal(stores.references.find(row => row.id === serviceFlowConfigId).payload.revision, updated.revision);
  assert.deepEqual(stores.references.find(row => row.id === 'service-project:SP-1'), before.references.find(row => row.id === 'service-project:SP-1'));
});

test('历史停用绑定仍可读取且不破坏已有快照，但禁止新增停用模板绑定', async () => {
  const { validateFlowTemplateChanges } = await import('./flow-report-templates.ts');
  const { flow } = reportFlowFixture();
  const legacy = withFlowReportTemplates(flow);
  legacy.reportTemplates[0].enabled = false;
  legacy.steps[1].documents[0].reportTemplate.template.enabled = false;
  assert.doesNotThrow(() => validateFlowReportTemplates(legacy));
  assert.doesNotThrow(() => validateFlowTemplateChanges(legacy, structuredClone(legacy)));
  const changed = structuredClone(legacy);
  changed.steps[1].documents.push({ ...structuredClone(changed.steps[1].documents[0]), id: 'new-binding' });
  assert.throws(() => validateFlowTemplateChanges(legacy, changed), /引用/);
});
