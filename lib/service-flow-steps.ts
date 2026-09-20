import {
  validateExecutionFormStep,
  type ExecutionForm,
} from './service-execution-forms.ts';
import {
  validateStepDeliverables,
  type StepDocument,
  type StepFile,
} from './service-step-deliverables.ts';
export const serviceStepTypes = {
  form: '表单',
  upload: '上传文件',
  document: '文档',
  combined: '通用',
} as const;
export type ServiceStepType = keyof typeof serviceStepTypes;
export type StepInstruction =
  | { id: string; kind: 'text'; content: string }
  | { id: string; kind: 'link'; title: string; url: string }
  | { id: string; kind: 'attachment'; name: string; blob: Blob };
export type StepFormField = {
  id: string;
  name: string;
  type: 'text' | 'textarea' | 'number';
  required: boolean;
};
export type ServiceFlowStep = {
  id: string;
  name: string;
  schemaVersion: 2;
  sequence: number;
  enabled: boolean;
  required: boolean;
  type: ServiceStepType;
  deliverToCustomer: boolean;
  materials: StepInstruction[];
  formFields: StepFormField[];
  executionFormId?: string;
  executionForm?: ExecutionForm;
  upload: { minFiles: number; formats: string };
  documentTemplate: string;
  documents?: StepDocument[];
  files?: StepFile[];
  phase: string;
  phaseId?: string;
  subtitle: string;
  instructions: string;
  checklist: string[];
  generalDescription?: string;
  recordRequired: boolean;
  attachmentRequired: boolean;
};
export const maxStepAttachmentBytes = 10 * 1024 * 1024;
export function newServiceFlowStep(sequence: number): ServiceFlowStep {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 2,
    name: '服务步骤',
    sequence,
    enabled: true,
    required: true,
    type: 'form',
    deliverToCustomer: false,
    materials: [],
    formFields: [
      {
        id: crypto.randomUUID(),
        name: '执行记录',
        type: 'textarea',
        required: true,
      },
    ],
    upload: { minFiles: 1, formats: '' },
    documentTemplate: '',
    phase: '',
    subtitle: '',
    instructions: '',
    checklist: [],
    recordRequired: true,
    attachmentRequired: false,
  };
}
export function safeStepLink(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function orderedServiceSteps(steps: ServiceFlowStep[]) {
  return [...steps].sort((a, b) => a.sequence - b.sequence);
}
export function moveServiceStep(
  steps: ServiceFlowStep[],
  id: string,
  position: number,
) {
  const ordered = orderedServiceSteps(steps),
    index = ordered.findIndex((step) => step.id === id);
  if (
    index < 0 ||
    !Number.isInteger(position) ||
    position < 1 ||
    position > steps.length
  )
    return steps;
  const [step] = ordered.splice(index, 1);
  ordered.splice(position - 1, 0, step);
  return ordered.map((item, i) => ({ ...item, sequence: i + 1 }));
}
// Upgrade only the original shape. Modern steps with missing fields must fail validation.
export function parseServiceFlowSteps(
  input: ServiceFlowStep[],
): ServiceFlowStep[] {
  const steps = structuredClone(input);
  const fail = (): never => {
    throw new Error('步骤配置无效，请检查名称、顺序、状态、类型及说明材料。');
  };
  const text = (value: unknown, max = 4000): value is string =>
    typeof value === 'string' && value.length <= max;
  const required = (value: unknown, max = 120) =>
    text(value, max) && !!value.trim();
  const unique = (rows: { id: string }[]) =>
    rows.every((row) => row && required(row.id)) &&
    new Set(rows.map((row) => row.id)).size === rows.length;
  if (
    !Array.isArray(steps) ||
    steps.length < 1 ||
    steps.length > 100 ||
    !unique(steps)
  )
    throw new Error('每个流程需配置 1–100 个有效步骤。');
  let totalBytes = 0;
  steps.forEach((step) => {
    if (
      !required(step.name) ||
      !text(step.phase, 120) ||
      !text(step.subtitle, 300) ||
      !text(step.instructions) ||
      !Array.isArray(step.checklist) ||
      step.checklist.length > 100 ||
      step.checklist.some((item) => !required(item, 500)) ||
      typeof step.recordRequired !== 'boolean' ||
      typeof step.attachmentRequired !== 'boolean'
    )
      fail();
    if (step.type === 'combined') {
      step.deliverToCustomer = false;
    }
    if (
      step.generalDescription !== undefined &&
      !text(step.generalDescription, 60000)
    )
      throw new Error('通用步骤说明不能超过 60000 字。');
    if (
      step.schemaVersion !== 2 ||
      !Number.isInteger(step.sequence) ||
      step.sequence < 1 ||
      step.sequence > steps.length ||
      typeof step.enabled !== 'boolean' ||
      typeof step.required !== 'boolean' ||
      typeof step.deliverToCustomer !== 'boolean' ||
      !Object.hasOwn(serviceStepTypes, step.type)
    )
      fail();
    if (
      !Array.isArray(step.materials) ||
      step.materials.length > 30 ||
      !unique(step.materials)
    )
      fail();
    for (const material of step.materials) {
      if (material.kind === 'text') {
        if (!required(material.content, 10000)) fail();
      } else if (material.kind === 'link') {
        if (
          !required(material.title, 300) ||
          !text(material.url, 2048) ||
          !safeStepLink(material.url)
        )
          throw new Error(
            '说明链接需填写标题及完整的 http:// 或 https:// 地址。',
          );
      } else if (material.kind === 'attachment') {
        if (
          !required(material.name, 300) ||
          !(material.blob instanceof Blob) ||
          material.blob.size === 0 ||
          material.blob.size > maxStepAttachmentBytes
        )
          throw new Error('说明附件须为非空文件，单个不超过 10 MB。');
        totalBytes += material.blob.size;
      } else fail();
    }
    if (
      !Array.isArray(step.formFields) ||
      step.formFields.length > 100 ||
      !unique(step.formFields) ||
      (step.type === 'form' && !step.formFields.length) ||
      step.formFields.some(
        (field) =>
          !required(field.name) ||
          !['text', 'textarea', 'number'].includes(field.type) ||
          typeof field.required !== 'boolean',
      )
    )
      throw new Error('表单字段需填写名称和类型，每个表单至少一个字段。');
    if (
      !step.upload ||
      !Number.isInteger(step.upload.minFiles) ||
      step.upload.minFiles < 1 ||
      step.upload.minFiles > 20 ||
      !text(step.upload.formats, 200) ||
      (step.upload.formats &&
        !/^\.[a-zA-Z0-9]+(\s*,\s*\.[a-zA-Z0-9]+)*$/.test(step.upload.formats))
    )
      throw new Error(
        '上传文件数量须为 1–20，格式以扩展名填写，例如 .pdf,.docx。',
      );
    if (!text(step.documentTemplate, 20000)) fail();
    validateExecutionFormStep(step);
    totalBytes += validateStepDeliverables(step);
    step.name = step.name.trim();
    step.phase = step.phase.trim();
    step.checklist = step.checklist.map((item) => item.trim());
  });
  if (totalBytes > 50 * 1024 * 1024)
    throw new Error('每个流程的说明附件和文档模板合计不能超过 50 MB。');
  if (new Set(steps.map((step) => step.sequence)).size !== steps.length)
    throw new Error('步骤顺序重复，请重新排序。');
  return orderedServiceSteps(steps);
}
