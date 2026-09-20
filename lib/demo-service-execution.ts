import { withDemoWorkOrderReport } from './demo-work-order-reports.ts';
import { renderReport } from './report-templates.ts';
import { withWorkOrderCollaboratorRoles } from './project-work-order-collaborators.ts';
import {
  newServiceFlowStep,
  type ServiceFlowStep,
} from './service-flow-steps.ts';
import {
  parseServiceFlowConfig,
  serviceFlowConfigId,
  type FlowDictionary,
  type ServiceFlow,
  type ServiceFlowRule,
} from './service-flows.ts';
import {
  bindExecutionForms,
  parseExecutionForms,
  executionFormsId,
  type ExecutionForm,
} from './service-execution-forms.ts';
import {
  applyWorkStep,
  emptyWorkStepData,
  workStepForm,
  type WorkStepData,
} from './service-work-orders.ts';
import { stepDocuments, stepFiles } from './service-step-deliverables.ts';
import type { ServiceProjectRecord } from './service-projects';
import type { OperationActor } from './request-operations';
import type { StoredFile } from './service-requests';

export function demoExecutionFile(
  id: string,
  name: string,
  content: string,
  at: string,
  actorId = 'USR-004',
): StoredFile {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  return {
    id,
    name,
    size: blob.size,
    blob,
    uploadedAt: at,
    uploadedById: actorId,
    ...(actorId.startsWith('USR-')
      ? { uploaderAudience: 'internal' as const }
      : {}),
  };
}
export function demoServiceExecution(dictionary: FlowDictionary, at: string) {
  const fields: ExecutionForm['fields'] = [
    {
      id: 'cluster',
      name: '集群名称',
      type: 'text',
      required: true,
      options: [],
    },
    {
      id: 'nodes',
      name: '节点数量',
      type: 'integer',
      required: true,
      options: [],
    },
    {
      id: 'ready',
      name: '备份已验证',
      type: 'boolean',
      required: true,
      options: [],
    },
    { id: 'date', name: '检查日期', type: 'date', required: true, options: [] },
    {
      id: 'health',
      name: '健康检查结果',
      type: 'single',
      required: true,
      options: ['通过', '需处理'],
    },
    {
      id: 'checks',
      name: '已检查项目',
      type: 'multiple',
      required: true,
      options: ['计算', '存储', '网络'],
    },
    {
      id: 'latency',
      name: '存储延迟（毫秒）',
      type: 'decimal',
      required: false,
      options: [],
    },
    {
      id: 'notes',
      name: '环境检查记录',
      type: 'textarea',
      required: false,
      options: [],
    },
  ];
  const form: ExecutionForm = {
    id: 'demo-execution-environment',
    name: '实施前环境检查',
    description: '',
    fields,
    layout: {
      order: fields.map((field) => field.id),
      widths: { checks: 'full', notes: 'full' },
      rowStarts: [],
    },
    updatedAt: at,
    updatedBy: '系统初始化',
  };
  const verification: ExecutionForm = {
    id: 'demo-execution-verification',
    name: '服务结果验证',
    description: '',
    fields: [
      {
        id: 'passed',
        name: '验证通过',
        type: 'boolean',
        required: true,
        options: [],
      },
      {
        id: 'date',
        name: '验证日期',
        type: 'date',
        required: true,
        options: [],
      },
      {
        id: 'notes',
        name: '验证记录',
        type: 'textarea',
        required: true,
        options: [],
      },
    ],
    layout: {
      order: ['passed', 'date', 'notes'],
      widths: { notes: 'full' },
      rowStarts: [],
    },
    updatedAt: at,
    updatedBy: '系统初始化',
  };
  const library = parseExecutionForms({
    version: 1,
    revision: 1,
    forms: [form, verification],
  });
  const buildFlow = (
    id: string,
    name: string,
    executionName: string,
  ): ServiceFlow => {
    const make = (
      sequence: number,
      name: string,
      type: ServiceFlowStep['type'],
      phaseId: string,
    ): ServiceFlowStep => ({
      ...newServiceFlowStep(sequence),
      id: `${id}-step-${sequence}`,
      name,
      type,
      phaseId,
      formFields: [],
    });
    const environment = {
      ...make(1, '实施前环境检查', 'form', 'prepare'),
      executionFormId: form.id,
      materials: [
        {
          id: `${id}-environment-note`,
          kind: 'text' as const,
          content: '核对集群健康状态、资源容量、备份恢复结果和维护窗口。',
        },
      ],
    };
    const plan = {
      ...make(2, '准备实施方案', 'document', 'prepare'),
      documents: [
        {
          id: `${id}-plan`,
          name: '实施方案',
          instructions: '填写实施范围、操作步骤、风险及回退方案。',
          required: true,
          deliverToCustomer: false,
          onlineTemplateUrl: '',
          template: demoExecutionFile(
            `${id}-plan-template`,
            '实施方案模板.md',
            '# 实施方案\n\n## 服务范围\n\n## 操作步骤\n\n## 风险与回退\n',
            at,
          ),
        },
        {
          id: `${id}-window`,
          name: '服务窗口确认单',
          instructions: '记录客户确认的维护窗口。',
          required: false,
          deliverToCustomer: true,
          onlineTemplateUrl: '',
          template: demoExecutionFile(
            `${id}-window-template`,
            '服务窗口确认单模板.md',
            '# 服务窗口确认单\n\n开始时间：\n结束时间：\n客户联系人：\n',
            at,
          ),
        },
      ],
    };
    const execution = {
      ...make(3, executionName, 'combined', 'execute'),
      generalDescription:
        '按已确认方案执行，记录关键操作、实际结果及异常处理。',
      recordRequired: true,
      attachmentRequired: false,
    };
    const evidence = {
      ...make(4, '上传实施记录', 'upload', 'execute'),
      files: [
        {
          id: `${id}-log`,
          name: '执行日志',
          instructions: '上传关键操作及检查日志。',
          required: true,
          deliverToCustomer: false,
          minFiles: 1,
          formats: '.txt,.log,.md',
        },
        {
          id: `${id}-evidence`,
          name: '结果证明材料',
          instructions: '上传结果截图或验证记录。',
          required: true,
          deliverToCustomer: true,
          minFiles: 1,
          formats: '.png,.jpg,.pdf,.md',
        },
      ],
    };
    const verify = {
      ...make(5, '验证服务结果', 'form', 'delivery'),
      executionFormId: verification.id,
    };
    const optional = {
      ...make(6, '现场操作交接', 'combined', 'delivery'),
      required: false,
      recordRequired: true,
      generalDescription: '如需现场交接，记录交接对象及内容。',
    };
    const report = {
      ...make(7, '提交服务报告', 'document', 'delivery'),
      documents: [
        {
          id: `${id}-report`,
          name: '服务报告',
          instructions: '汇总服务内容、验证结果及后续建议。',
          required: true,
          deliverToCustomer: true,
          onlineTemplateUrl: '',
        },
      ],
    };
    return {
      id,
      name,
      enabled: true,
      description: '',
      phases: [
        { id: 'prepare', name: '服务准备' },
        { id: 'execute', name: '服务执行' },
        { id: 'delivery', name: '验证与交付' },
      ],
      steps: [environment, plan, execution, evidence, verify, optional, report],
    };
  };
  const flows = [
    buildFlow('demo-flow-general', '通用服务交付流程', '执行服务'),
    buildFlow('demo-flow-upgrade', '集群升级交付流程', '执行集群升级'),
    buildFlow('demo-flow-inspection', '集群巡检交付流程', '执行集群巡检'),
  ];
  const rules: ServiceFlowRule[] = [];
  for (const [key, pattern, priority] of [
    ['upgrade', '升级', 10],
    ['inspection', '巡检', 20],
  ] as const) {
    const services = dictionary.services.filter((service) =>
      service.name.includes(pattern),
    );
    if (!services.length) continue;
    rules.push({
      id: `demo-flow-rule-${key}`,
      name: `${pattern}服务分配`,
      enabled: true,
      priority,
      match: 'any',
      flowId: `demo-flow-${key}`,
      conditions: services.map((service) => ({
        field: 'serviceId',
        operator: 'eq',
        value: service.id,
      })),
      serviceScope: {
        mode: 'selected',
        serviceIds: services.map((service) => service.id),
      },
    });
  }
  const bound = bindExecutionForms(
      {
        version: 1,
        revision: 1,
        flows,
        assignment: { defaultFlowId: flows[0].id, rules },
        updatedAt: at,
        updatedBy: '系统初始化',
      },
      library,
    );
  const config = parseServiceFlowConfig({ ...bound, flows: bound.flows.map(flow => withDemoWorkOrderReport(flow, at)) });
  return {
    config,
    library,
    references: [
      { id: serviceFlowConfigId, payload: config },
      { id: executionFormsId, payload: library },
    ],
  };
}

// Submit through the normal execution validator so sample values are usable records.
export function populateDemoWorkOrders(
  project: ServiceProjectRecord,
  actor: OperationActor,
  mode: 'progress' | 'complete' | 'cancel',
  at: string,
) {
  const group = actor.role === '合作伙伴服务工程师' ? 'partner' as const : 'internal' as const;
  let next: ServiceProjectRecord = { ...project, workOrders: project.workOrders?.map(order => ({ ...order, assignees: [{ id: actor.id, name: actor.name, group }] })) };
  next = withWorkOrderCollaboratorRoles(next);
  let tick = 0;
  for (const [orderIndex, order] of (project.workOrders ?? []).entries()) {
    if (mode !== 'complete' && orderIndex > 0) continue;
    const count =
      mode === 'complete' ? order.steps.length : mode === 'cancel' ? 2 : 3;
    for (let index = 0; index < count; index++) {
      const definition = order.steps[index].definition;
      const time = new Date(Date.parse(at) + ++tick * 60000).toISOString();
      const data: WorkStepData = emptyWorkStepData();
      if (definition.type === 'form') {
        const form = workStepForm(definition);
        for (const field of form.fields)
          data.values[field.id] =
            field.type === 'boolean'
              ? true
              : field.type === 'date'
                ? time.slice(0, 10)
                : field.type === 'integer'
                  ? '4'
                  : field.type === 'decimal'
                    ? '0.8'
                    : field.type === 'single'
                      ? field.options[0]
                      : field.type === 'multiple'
                        ? JSON.stringify(field.options)
                        : field.type === 'textarea'
                          ? '已完成健康检查及业务验证，未发现异常。'
                          : `${order.customerName}生产集群`;
      } else if (definition.type === 'combined') {
        data.description =
          mode === 'progress'
            ? '已完成实施前核对，正在按方案逐节点操作。目前集群健康状态正常。'
            : order.flowId.includes('upgrade')
              ? '已完成升级前环境与备份核对，按确认的变更方案逐节点执行升级；升级后复查核心服务及业务访问，具体操作证据见执行记录。'
              : order.flowId.includes('inspection')
                ? '已完成计算、存储和网络检查，核对集群健康告警及关键业务访问；检查范围与观测数据见环境基线，具体证据见执行记录。'
                : '已按确认方案完成环境准备和服务实施，复查核心服务及业务访问；执行范围、过程证据与结果验证均已归档。';
        data.attachments = [
          demoExecutionFile(
            `${order.id}-${definition.id}-record`,
            '执行记录.md',
            `# 执行记录\n\n${data.description}`,
            time,
            actor.id,
          ),
        ];
      } else {
        for (const item of definition.type === 'document'
          ? stepDocuments(definition)
          : stepFiles(definition)) {
          data.deliverables[item.id] = [
            demoExecutionFile(
              `${order.id}-${item.id}-result`,
              `${item.name}.md`,
              `# ${item.name}\n\n项目：${project.name}\n服务目录：${order.item.serviceName}\n服务工程师：${actor.name}\n\n已完成范围确认、环境核对及结果验证。`,
              time,
              actor.id,
            ),
          ];
        }
      }
      if (definition.type === 'document') {
        for (const item of stepDocuments(definition)) {
          for (const file of data.deliverables[item.id] ?? []) {
            if (item.reportTemplate) {
              const rendered = renderReport(item.reportTemplate.template, { project: next, orderId: order.id, customerName: order.customerName }, item.reportTemplate.bindings);
              if (rendered.missing.length) throw new Error(`演示报告缺少字段：${rendered.missing.join('、')}`);
              rendered.source.generatedAt = time;
              file.onlineDocument = { title: item.name, content: rendered.content, richText: rendered.body as Record<string, unknown>, reportSource: rendered.source, source: 'template' };
              file.name = `${item.name}.txt`;
              file.blob = new Blob([rendered.content], { type: 'text/plain;charset=utf-8' });
              file.size = file.blob.size;
            } else {
              file.onlineDocument = {
                title: file.name.replace(/\.md$/, ''),
                content: `# ${item.name}\n\n项目：${project.name}\n服务目录：${order.item.serviceName}\n服务工程师：${actor.name}\n\n已完成范围确认、环境核对及结果验证。`,
                source: 'template',
              };
            }
          }
        }
      }
      next = applyWorkStep(
        next,
        actor,
        {
          orderId: order.id,
          stepId: definition.id,
          type: !definition.required
            ? 'skip'
            : mode !== 'complete' && index === count - 1
              ? 'save'
              : 'complete',
          data,
          reason: '本次交付范围不包含现场操作交接。',
        },
        time,
      );
    }
  }
  return next;
}
