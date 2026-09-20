import type { ServiceFlowConfig } from './service-flows';
import type { ServiceFlowStep } from './service-flow-steps';

export const executionFormsId = 'service-execution-forms-v1';
export const executionFieldTypes = {
  text: '文本',
  textarea: '多行文本',
  integer: '整数',
  decimal: '小数',
  single: '单选',
  multiple: '多选',
  date: '日期',
  boolean: '布尔',
} as const;
export type ExecutionField = {
  id: string;
  name: string;
  type: keyof typeof executionFieldTypes;
  required: boolean;
  options: string[];
};
export type ExecutionForm = {
  id: string;
  name: string;
  description: string;
  fields: ExecutionField[];
  layout: {
    order: string[];
    widths: Record<string, 'full' | 'half'>;
    rowStarts: string[];
  };
  updatedAt?: string;
  updatedBy?: string;
};
export type ExecutionFormLibrary = {
  version: 1;
  revision: number;
  forms: ExecutionForm[];
};
export const emptyExecutionForms = (): ExecutionFormLibrary => ({
  version: 1,
  revision: 0,
  forms: [],
});
export function newExecutionForm(): ExecutionForm {
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    fields: [],
    layout: { order: [], widths: {}, rowStarts: [] },
  };
}
export function parseExecutionForm(input: ExecutionForm): ExecutionForm {
  const form = structuredClone(input);
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.length <= max;
  const name = (value: unknown, max = 120) =>
    text(value, max) && !!(value as string).trim();
  if (
    !form ||
    !name(form.id, 300) ||
    !name(form.name) ||
    !text(form.description, 4000) ||
    !Array.isArray(form.fields) ||
    !form.fields.length ||
    form.fields.length > 100
  )
    throw new Error('请填写表单名称，并创建 1–100 个字段。');
  const ids = new Set<string>();
  for (const field of form.fields) {
    if (
      !field ||
      !name(field.id, 120) ||
      ids.has(field.id) ||
      !name(field.name) ||
      !Object.hasOwn(executionFieldTypes, field.type) ||
      typeof field.required !== 'boolean' ||
      !Array.isArray(field.options) ||
      field.options.length > 100 ||
      field.options.some((option) => !name(option, 300)) ||
      new Set(field.options.map((option) => option.trim())).size !==
        field.options.length ||
      (['single', 'multiple'].includes(field.type) && !field.options.length)
    )
      throw new Error(
        '字段名称、类型或选项无效；单选和多选至少需要一个不重复选项。',
      );
    ids.add(field.id);
    field.name = field.name.trim();
    field.options = field.options.map((option) => option.trim());
  }
  if (
    !form.layout ||
    !Array.isArray(form.layout.order) ||
    !form.layout.order.length ||
    form.layout.order.some((id) => !ids.has(id)) ||
    new Set(form.layout.order).size !== form.layout.order.length ||
    !form.layout.widths ||
    Array.isArray(form.layout.widths) ||
    typeof form.layout.widths !== 'object' ||
    Object.entries(form.layout.widths).some(
      ([id, value]) => !ids.has(id) || !['full', 'half'].includes(value),
    ) ||
    !Array.isArray(form.layout.rowStarts) ||
    form.layout.rowStarts.some((id) => !form.layout.order.includes(id)) ||
    new Set(form.layout.rowStarts).size !== form.layout.rowStarts.length
  )
    throw new Error('表单布局无效，至少需要添加一个字段，且字段不能重复。');
  form.name = form.name.trim();
  return form;
}
export function parseExecutionForms(input: unknown): ExecutionFormLibrary {
  if (input === undefined) return emptyExecutionForms();
  const library = structuredClone(input) as ExecutionFormLibrary;
  if (
    !library ||
    library.version !== 1 ||
    !Number.isInteger(library.revision) ||
    library.revision < 0 ||
    !Array.isArray(library.forms) ||
    library.forms.length > 500
  )
    throw new Error('服务步骤表单数据格式无效。');
  library.forms = library.forms.map(parseExecutionForm);
  if (
    new Set(library.forms.map((form) => form.id)).size !==
      library.forms.length ||
    new Set(library.forms.map((form) => form.name)).size !==
      library.forms.length
  )
    throw new Error('表单名称或标识重复。');
  return library;
}
export function bindExecutionForms(
  config: ServiceFlowConfig,
  library: ExecutionFormLibrary,
): ServiceFlowConfig {
  return {
    ...config,
    flows: config.flows.map((flow) => ({
      ...flow,
      steps: flow.steps.map((step) => {
        if (step.type !== 'form') return step;
        const id =
          step.executionFormId;
        const form = library.forms.find((form) => form.id === id);
        if (!form)
          throw new Error(`步骤「${step.name}」请选择有效的服务步骤表单。`);
        return {
          ...step,
          executionFormId: id,
          executionForm: structuredClone(form),
          formFields: executionFormStepFields(form),
        };
      }),
    })),
  };
}
export function executionFormStepFields(form: ExecutionForm) {
  return form.layout.order.map((id) => {
    const field = form.fields.find((field) => field.id === id)!;
    return {
      id: field.id,
      name: field.name,
      type:
        field.type === 'textarea'
          ? ('textarea' as const)
          : ['integer', 'decimal'].includes(field.type)
            ? ('number' as const)
            : ('text' as const),
      required: field.required,
    };
  });
}
export function executionFormLayout(form: ExecutionForm) {
  return form.layout.order.map((id) => ({
    id,
    gridColumn:
      form.layout.widths[id] === 'full'
        ? '1 / -1'
        : form.layout.rowStarts.includes(id)
          ? '1 / span 1'
          : 'span 1',
  }));
}
export function validateExecutionFormStep(step: ServiceFlowStep) {
  if (
    step.executionFormId !== undefined &&
    (typeof step.executionFormId !== 'string' ||
      !step.executionFormId ||
      step.executionFormId.length > 300)
  )
    throw new Error('服务步骤表单引用无效。');
  if (step.executionForm !== undefined) {
    step.executionForm = parseExecutionForm(step.executionForm);
    if (step.executionForm.id !== step.executionFormId)
      throw new Error('服务步骤表单快照与引用不一致。');
  }
}
