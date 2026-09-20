import type { ServiceProjectRecord } from './service-projects';
import type { ServiceWorkOrder } from './service-work-orders';
import type { ServiceFlowStep } from './service-flow-steps';
import {
  workOrderFieldValue,
  workOrderVisibleFields,
} from './work-order-form.ts';

export const reportTemplatesId = 'report-templates-v1';
export type ReportField = {
  id: string;
  label: string;
  scope: 'project' | 'order' | 'step';
  fieldId: string;
  formId?: string | null;
  stepId?: string | null;
  emptyPolicy?: 'block' | 'blank' | 'default' | null;
  defaultText?: string | null;
};
export type ReportNode = {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ReportNode[];
};
export type ReportTemplate = {
  id: string;
  name: string;
  scope: 'project' | 'step';
  version: number;
  enabled: boolean;
  body: ReportNode;
  updatedAt?: string;
  flowId?: string;
};
export type ReportTemplateLibrary = {
  revision: number;
  templates: ReportTemplate[];
};
export type ReportBindings = Record<
  string,
  { stepId: string; fieldId: string }
>;
export type ReportTemplateSelection = {
  template: ReportTemplate;
  bindings: ReportBindings;
};
export type ReportSource = {
  template: ReportTemplate;
  projectId: string;
  orderId?: string;
  bindings: ReportBindings;
  values: Record<string, string>;
  generatedAt: string;
  projectFiles?: import('./project-report-files').ProjectReportFileSelection[];
};
export type ReportContext = {
  project: ServiceProjectRecord;
  orderId?: string;
  customerName?: string;
};
export const projectReportFields = [
  ['name', '项目名称'],
  ['id', '项目编号'],
  ['customerId', '客户名称'],
  ['serviceProviderId', '服务方'],
  ['status', '项目状态'],
  ['expectedServiceDate', '计划执行日期'],
  ['plannedCompletionDate', '计划完成日期'],
  ['note', '项目说明'],
  ['createdBy', '创建人'],
  ['createdAt', '创建时间'],
];
export const orderReportFields = [
  ['id', '工单编号'],
  ['serviceName', '服务名称'],
  ['status', '工单状态'],
  ['method', '服务方式'],
  ['description', '服务说明'],
  ['customerName', '客户名称'],
  ['providerName', '服务方'],
  ['expectedServiceDate', '计划执行日期'],
  ['plannedCompletionDate', '计划完成日期'],
  ['engineers', '执行工程师'],
  ['contactName', '联系人'],
  ['contactPhone', '联系电话'],
];
export function reportFieldNode(field: ReportField): ReportNode {
  return { type: 'reportField', attrs: { ...field } };
}
export function reportFields(body: ReportNode): ReportField[] {
  const result = new Map<string, ReportField>();
  const walk = (node: ReportNode) => {
    if (node.type === 'reportField')
      result.set(String(node.attrs?.id), node.attrs as ReportField);
    node.content?.forEach(walk);
  };
  walk(body);
  return [...result.values()];
}
export function reportFieldLabel(node: ReportNode): string {
  return typeof node.attrs?.label === 'string' ? node.attrs.label : '引用字段';
}
export function reportText(node: ReportNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'reportField') return `【${reportFieldLabel(node)}】`;
  if (node.type === 'hardBreak') return '\n';
  const text = (node.content ?? []).map(reportText).join('');
  return ['paragraph', 'heading', 'listItem'].includes(node.type)
    ? text + '\n'
    : text;
}
export function parseReportTemplate(input: ReportTemplate): ReportTemplate {
  const t = structuredClone(input);
  if (
    !t ||
    typeof t.id !== 'string' ||
    !t.id ||
    t.id.length > 180 ||
    typeof t.name !== 'string' ||
    !t.name.trim() ||
    t.name.length > 120 ||
    !['project', 'step'].includes(t.scope) ||
    typeof t.enabled !== 'boolean' ||
    !Number.isInteger(t.version) ||
    t.version < 1
  )
    throw new Error('请填写有效的模板名称和适用范围。');
  if (
    t.flowId !== undefined &&
    (typeof t.flowId !== 'string' || !t.flowId.trim() || t.flowId.length > 180)
  )
    throw new Error('模板所属流程无效。');
  if (JSON.stringify(t.body ?? {}).length > 200000)
    throw new Error('模板正文过长。');
  let count = 0;
  const ids = new Map<string, string>();
  const walk = (n: ReportNode, depth = 0) => {
    if (
      !n ||
      depth > 20 ||
      ++count > 5000 ||
      ![
        'doc',
        'paragraph',
        'heading',
        'text',
        'bulletList',
        'orderedList',
        'listItem',
        'blockquote',
        'hardBreak',
        'horizontalRule',
        'codeBlock',
        'reportField',
      ].includes(n.type)
    )
      throw new Error('模板正文格式无效。');
    if (n.type === 'text' && (typeof n.text !== 'string' || !n.text))
      throw new Error('模板文字格式无效。');
    if (
      n.marks?.some(
        (m) =>
          !['bold', 'italic', 'underline', 'strike', 'code'].includes(m.type),
      )
    )
      throw new Error('模板文字样式无效。');
    if (n.type === 'reportField') {
      const f = n.attrs as ReportField;
      if (
        !f ||
        !['project', 'order', 'step'].includes(f.scope) ||
        ![f.id, f.fieldId, f.label].every(
          (v) => typeof v === 'string' && !!v.trim() && v.length <= 300,
        ) ||
        (f.formId != null &&
          (typeof f.formId !== 'string' || f.formId.length > 300))
      )
        throw new Error('模板引用字段无效。');
      if (
        (f.stepId != null &&
          (typeof f.stepId !== 'string' || f.stepId.length > 300)) ||
        (f.emptyPolicy != null &&
          !['block', 'blank', 'default'].includes(f.emptyPolicy)) ||
        (f.defaultText != null &&
          (typeof f.defaultText !== 'string' || f.defaultText.length > 1000)) ||
        (f.emptyPolicy === 'default' && !f.defaultText?.trim())
      )
        throw new Error('请配置有效的字段空值处理方式和默认文本。');
      if (
        f.scope === 'project' &&
        !projectReportFields.some(([id]) => id === f.fieldId) &&
        !f.fieldId.startsWith('custom:')
      )
        throw new Error('不支持的项目字段。');
      if (
        f.scope === 'order' &&
        !orderReportFields.some(([id]) => id === f.fieldId) &&
        !f.fieldId.startsWith('item:')
      )
        throw new Error('不支持的工单字段。');
      const signature = JSON.stringify(f);
      if (ids.has(f.id) && ids.get(f.id) !== signature)
        throw new Error('同一引用字段的定义不一致。');
      ids.set(f.id, signature);
    }
    if (n.content !== undefined && !Array.isArray(n.content))
      throw new Error('模板正文格式无效。');
    n.content?.forEach((child) => walk(child, depth + 1));
  };
  if (t.body?.type !== 'doc') throw new Error('模板正文格式无效。');
  walk(t.body);
  if (!reportText(t.body).trim()) throw new Error('请填写模板正文。');
  t.name = t.name.trim();
  return t;
}
export function defaultReportTemplates(): ReportTemplateLibrary {
  const field = (scope: ReportField['scope'], fieldId: string, label: string) =>
    reportFieldNode({ id: `${scope}:${fieldId}`, scope, fieldId, label });
  const p = (...content: ReportNode[]): ReportNode => ({
    type: 'paragraph',
    content,
  });
  const text = (value: string): ReportNode => ({ type: 'text', text: value });
  return {
    revision: 0,
    templates: [
      {
        id: 'report-project-default',
        name: '项目服务报告',
        scope: 'project',
        version: 1,
        enabled: true,
        body: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [
                field('project', 'name', '项目名称'),
                text(' · 服务报告'),
              ],
            },
            p(text('项目编号：'), field('project', 'id', '项目编号')),
            p(text('客户：'), field('project', 'customerId', '客户名称')),
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [text('服务总结')],
            },
            p(text('请填写服务总结。')),
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [text('后续安排')],
            },
            p(text('请填写后续安排。')),
          ],
        },
      },
      {
        id: 'report-step-default',
        name: '工单服务报告',
        scope: 'step',
        version: 1,
        enabled: true,
        body: {
          type: 'doc',
          content: [
            {
              type: 'heading',
              attrs: { level: 1 },
              content: [
                field('order', 'serviceName', '服务名称'),
                text(' · 服务报告'),
              ],
            },
            p(text('项目：'), field('project', 'name', '项目名称')),
            p(text('工单编号：'), field('order', 'id', '工单编号')),
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [text('执行结果')],
            },
            p(text('请填写执行结果。')),
          ],
        },
      },
    ],
  };
}
export function parseReportLibrary(
  input?: ReportTemplateLibrary,
): ReportTemplateLibrary {
  if (!input) return defaultReportTemplates();
  if (
    !Number.isInteger(input.revision) ||
    input.revision < 0 ||
    !Array.isArray(input.templates) ||
    input.templates.length > 200
  )
    throw new Error('报告模板库格式无效。');
  const templates = input.templates.map(parseReportTemplate);
  if (
    new Set(templates.map((t) => t.id)).size !== templates.length ||
    new Set(templates.map((t) => t.name)).size !== templates.length
  )
    throw new Error('模板名称或标识重复。');
  return { revision: input.revision, templates };
}
export function stepFieldOptions(steps: ServiceFlowStep[]) {
  return steps
    .filter((s) => ['form', 'combined'].includes(s.type) && s.enabled !== false)
    .flatMap((s) => {
      if (s.type === 'combined')
        return [
          {
            stepId: s.id,
            fieldId: 'general:description',
            formId: undefined,
            label: `${s.name} → 执行说明`,
          },
          {
            stepId: s.id,
            fieldId: 'general:attachments',
            formId: undefined,
            label: `${s.name} → 附件名称`,
          },
        ];
      const form = s.executionForm;
      const fields = form
        ? form.fields.filter((f) => form.layout.order.includes(f.id))
        : s.formFields;
      return fields.map((f) => ({
        stepId: s.id,
        fieldId: f.id,
        formId: s.executionFormId,
        label: `${s.name} → ${f.name}`,
      }));
    });
}
export function defaultReportBindings(
  template: ReportTemplate,
  steps: ServiceFlowStep[],
): ReportBindings {
  const options = stepFieldOptions(steps),
    bindings: ReportBindings = {};
  for (const f of reportFields(template.body).filter(
    (f) => f.scope === 'step',
  )) {
    const matches = options.filter(
      (o) =>
        o.fieldId === f.fieldId &&
        (!f.formId || o.formId === f.formId) &&
        (!f.stepId || o.stepId === f.stepId),
    );
    if (matches.length === 1)
      bindings[f.id] = {
        stepId: matches[0].stepId,
        fieldId: matches[0].fieldId,
      };
  }
  return bindings;
}
export function validateReportSelection(
  selection: ReportTemplateSelection,
  steps?: ServiceFlowStep[],
) {
  const template = parseReportTemplate(selection.template);
  if (
    template.scope !== 'step' ||
    !selection.bindings ||
    typeof selection.bindings !== 'object'
  )
    throw new Error('请选择工单文档模板。');
  for (const f of reportFields(template.body).filter(
    (f) => f.scope === 'step',
  )) {
    const b = selection.bindings[f.id];
    if (
      !b ||
      typeof b.stepId !== 'string' ||
      typeof b.fieldId !== 'string' ||
      !b.stepId ||
      !b.fieldId
    )
      throw new Error(`请绑定「${f.label}」的来源。`);
    if (
      steps &&
      !stepFieldOptions(steps).some(
        (o) => o.stepId === b.stepId && o.fieldId === b.fieldId,
      )
    )
      throw new Error(`「${f.label}」的来源字段已不存在，请重新绑定。`);
  }
}
function display(value: unknown): string {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) return value.map(display).join('、');
  if (typeof value === 'string' && value.startsWith('[')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.map(display).join('、');
    } catch {}
  }
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}
function fieldValue(
  f: ReportField,
  ctx: ReportContext,
  order: ServiceWorkOrder | undefined,
  bindings: ReportBindings,
): string {
  const p = ctx.project;
  if (f.scope === 'project') {
    if (f.fieldId.startsWith('custom:'))
      return display(p.customValues?.[f.fieldId.slice(7)]);
    if (f.fieldId === 'customerId')
      return ctx.customerName || order?.customerName || '';
    if (f.fieldId === 'serviceProviderId')
      return p.serviceProviderName || order?.providerName || '';
    return projectReportFields.some(([id]) => id === f.fieldId)
      ? display(p[f.fieldId as keyof ServiceProjectRecord])
      : '';
  }
  if (!order) return '';
  if (f.scope === 'order') {
    if (f.fieldId.startsWith('item:')) {
      const id = f.fieldId.slice(5);
      if (!workOrderVisibleFields(order.item).includes(id)) return '';
      const value = workOrderFieldValue(order.item, id);
      return ['—', '未填写', '未关联'].includes(value) ? '' : display(value);
    }
    if (f.fieldId === 'engineers')
      return (order.assignees ?? (order.assignee ? [order.assignee] : []))
        .map((a) => a.name)
        .join('、');
    if (['serviceName', 'description', 'method'].includes(f.fieldId))
      return display(order.item[f.fieldId as keyof typeof order.item]);
    return orderReportFields.some(([id]) => id === f.fieldId)
      ? display(order[f.fieldId as keyof ServiceWorkOrder])
      : '';
  }
  const b = bindings[f.id];
  if (!b) return '';
  const step = order.steps.find((s) => s.definition.id === b.stepId);
  if (
    !step ||
    step.status === '已跳过' ||
    !stepFieldOptions([step.definition]).some((o) => o.fieldId === b.fieldId)
  )
    return '';
  if (step.definition.type === 'combined') {
    if (b.fieldId === 'general:description')
      return step.data.description?.trim() ? step.data.description : '';
    if (b.fieldId === 'general:attachments')
      return (step.data.attachments ?? [])
        .map((file) => file.name)
        .filter(Boolean)
        .join('\n');
    return '';
  }
  return display(step.data.values[b.fieldId]);
}
export function renderReport(
  templateInput: ReportTemplate,
  ctx: ReportContext,
  bindings: ReportBindings = {},
) {
  const template = parseReportTemplate(templateInput);
  const order = ctx.project.workOrders?.find(
    (o) => o.id === ctx.orderId && o.status !== '已取消',
  );
  const fields = reportFields(template.body),
    values: Record<string, string> = {},
    missing: string[] = [];
  const blockedIds = new Set<string>();
  for (const f of fields) {
    values[f.id] = fieldValue(f, ctx, order, bindings);
    if (!values[f.id]) {
      const binding = bindings[f.id];
      const sourceInvalid =
        f.scope !== 'project' &&
        (!order ||
          (f.scope === 'step' &&
            (!binding ||
              !stepFieldOptions(order.steps.map((s) => s.definition)).some(
                (option) =>
                  option.stepId === binding.stepId &&
                  option.fieldId === binding.fieldId,
              ))));
      if (sourceInvalid || !f.emptyPolicy || f.emptyPolicy === 'block') {
        missing.push(f.label);
        blockedIds.add(f.id);
      } else if (f.emptyPolicy === 'default') values[f.id] = f.defaultText!;
    }
  }
  const walk = (n: ReportNode): ReportNode | null => {
    if (n.type === 'reportField') {
      const value =
        values[String(n.attrs?.id)] ||
        (blockedIds.has(String(n.attrs?.id))
          ? `【未填写：${reportFieldLabel(n)}】`
          : '');
      return value
        ? {
            type: 'text',
            text: value,
            ...(n.marks ? { marks: n.marks } : {}),
          }
        : null;
    }
    return {
      ...n,
      ...(n.content
        ? {
            content: n.content
              .map(walk)
              .filter((node): node is ReportNode => !!node),
          }
        : {}),
    };
  };
  const body = walk(template.body)!;
  return {
    body,
    content: reportText(body).trim(),
    missing,
    source: {
      template,
      projectId: ctx.project.id,
      orderId: order?.id,
      bindings: structuredClone(bindings),
      values,
      generatedAt: new Date().toISOString(),
    } as ReportSource,
  };
}
