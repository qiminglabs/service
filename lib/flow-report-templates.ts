import type { ServiceFlow } from './service-flows';
import {
  defaultReportBindings,
  defaultReportTemplates,
  parseReportLibrary,
  parseReportTemplate,
  reportFields,
  validateReportSelection,
  stepFieldOptions,
  type ReportBindings,
  type ReportField,
  type ReportNode,
  type ReportTemplate,
} from './report-templates.ts';

export function updateReportField(
  body: ReportNode,
  id: string,
  patch: Partial<ReportField>,
): ReportNode {
  return {
    ...body,
    ...(body.type === 'reportField' && body.attrs?.id === id
      ? { attrs: { ...body.attrs, ...patch } }
      : {}),
    ...(body.content
      ? {
          content: body.content.map((node) =>
            updateReportField(node, id, patch),
          ),
        }
      : {}),
  };
}

export function localizeReportTemplate(
  template: ReportTemplate,
  flow: Pick<ServiceFlow, 'id' | 'steps'>,
  bindings?: ReportBindings,
): ReportTemplate {
  const next = structuredClone(template);
  next.scope = 'step';
  next.flowId = flow.id;
  const sources = bindings ?? defaultReportBindings(next, flow.steps);
  for (const field of reportFields(next.body).filter(
    (f) => f.scope === 'step',
  )) {
    const source = sources[field.id];
    next.body = updateReportField(next.body, field.id, {
      stepId: source?.stepId ?? null,
      fieldId: source?.fieldId ?? field.fieldId,
      formId: source
        ? (stepFieldOptions(flow.steps).find(
            (option) =>
              option.stepId === source.stepId &&
              option.fieldId === source.fieldId,
          )?.formId ?? null)
        : field.formId,
    });
  }
  return next;
}

// Adopt existing step snapshots once. Execution records are never rewritten.
export function withFlowReportTemplates(input: ServiceFlow): ServiceFlow {
  const flow = structuredClone(input);
  if (flow.reportTemplates !== undefined) return flow;
  flow.reportTemplates = [];
  for (const step of flow.steps)
    for (const doc of step.documents ?? []) {
      const selection = doc.reportTemplate;
      if (!selection) continue;
      const template = localizeReportTemplate(
        selection.template,
        flow,
        selection.bindings,
      );
      template.id = `flow-report-${flow.reportTemplates.length + 1}`;
      if (flow.reportTemplates.some((t) => t.name === template.name))
        template.name = `${template.name.slice(0, 100)}（${flow.reportTemplates.length + 1}）`;
      flow.reportTemplates.push(template);
      doc.reportTemplate = {
        template: structuredClone(template),
        bindings: defaultReportBindings(template, flow.steps),
      };
    }
  if (!flow.reportTemplates.length) {
    flow.reportTemplates.push(
      localizeReportTemplate(defaultReportTemplates().templates[1], flow),
    );
  }
  return flow;
}

export function validateFlowReportTemplates(flow: ServiceFlow) {
  const templates = parseReportLibrary({
    revision: 0,
    templates: flow.reportTemplates === undefined ? [] : flow.reportTemplates,
  }).templates;
  for (const template of templates) {
    if (template.scope !== 'step' || template.flowId !== flow.id)
      throw new Error(`「${template.name}」不属于当前服务流程。`);
    for (const field of reportFields(template.body).filter(
      (f) => f.scope === 'step',
    )) {
      if (!field.stepId)
        throw new Error(
          `模板「${template.name}」的「${field.label}」未绑定当前流程步骤。`,
        );
      if (
        !stepFieldOptions(flow.steps).some(
          (option) =>
            option.stepId === field.stepId && option.fieldId === field.fieldId,
        )
      ) {
        throw new Error(
          `模板「${template.name}」引用的「${field.label}」来源步骤或字段已不存在，请先调整模板引用。`,
        );
      }
    }
    try {
      validateReportSelection(
        { template, bindings: defaultReportBindings(template, flow.steps) },
        flow.steps,
      );
    } catch (error) {
      throw new Error(
        `模板「${template.name}」：${error instanceof Error ? error.message : '字段来源无效。'}`,
      );
    }
  }
  for (const step of flow.steps)
    for (const doc of step.documents ?? []) {
      if (!doc.reportTemplate) continue;
      const selected = doc.reportTemplate.template;
      const template = templates.find((t) => t.id === selected.id);
      if (
        !template ||
        selected.flowId !== flow.id ||
        JSON.stringify(template) !==
          JSON.stringify(parseReportTemplate(selected))
      ) {
        throw new Error(
          `步骤「${step.name}」的报告模板不属于当前流程或版本已失效，请重新选择。`,
        );
      }
      const expected = defaultReportBindings(template, flow.steps);
      if (
        Object.entries(expected).some(
          ([id, binding]) =>
            JSON.stringify(binding) !==
            JSON.stringify(doc.reportTemplate!.bindings[id]),
        )
      ) {
        throw new Error(`步骤「${step.name}」的报告字段来源与流程模板不一致。`);
      }
      validateReportSelection(doc.reportTemplate, flow.steps);
    }
}

export function setFlowReportTemplates(
  flow: ServiceFlow,
  templates: ReportTemplate[],
): ServiceFlow {
  const next = structuredClone(flow);
  next.reportTemplates = structuredClone(templates);
  for (const step of next.steps)
    for (const doc of step.documents ?? []) {
      if (!doc.reportTemplate) continue;
      const template = templates.find(
        (t) => t.id === doc.reportTemplate!.template.id,
      );
      if (!template)
        throw new Error(`模板已被步骤「${step.name}」引用，不能删除。`);
      doc.reportTemplate = {
        template: structuredClone(template),
        bindings: defaultReportBindings(template, next.steps),
      };
    }
  return next;
}

export function validateProjectReportTemplate(template: ReportTemplate) {
  if (
    template.scope !== 'project' ||
    template.flowId ||
    reportFields(template.body).some((field) => field.scope !== 'project')
  ) {
    throw new Error(
      '通用项目模板只能引用服务项目字段；步骤报告请在所属服务流程内配置。',
    );
  }
}
