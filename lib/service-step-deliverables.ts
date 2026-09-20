import { validateReportSelection, type ReportTemplateSelection } from './report-templates.ts';
import type { StoredFile } from './service-requests';
import type { ServiceFlowStep } from './service-flow-steps';

export type StepDeliverable = {
  id: string;
  name: string;
  instructions: string;
  required: boolean;
  deliverToCustomer: boolean;
};
export type StepDocument = StepDeliverable & {
  reportTemplate?: ReportTemplateSelection;
  template?: StoredFile;
  onlineTemplateUrl: string;
  initialContent?: string;
};
export type StepFile = StepDeliverable & {
  minFiles: number;
  formats: string;
};
export function stepDocuments(step: ServiceFlowStep): StepDocument[] {
  return (
    step.documents ?? [
      {
        id: `${step.id}-document`,
        name: '文档 1',
        instructions: step.documentTemplate,
        initialContent: step.documentTemplate,
        required: true,
        deliverToCustomer: step.deliverToCustomer,
        onlineTemplateUrl: '',
      },
    ]
  );
}
export function stepFiles(step: ServiceFlowStep): StepFile[] {
  return (
    step.files ?? [
      {
        id: `${step.id}-file`,
        name: '文件 1',
        instructions: '',
        required: true,
        deliverToCustomer: step.deliverToCustomer,
        ...step.upload,
      },
    ]
  );
}
export function newStepDocument(index: number): StepDocument {
  return {
    id: crypto.randomUUID(),
    name: `文档 ${index}`,
    instructions: '',
    required: true,
    deliverToCustomer: false,
    onlineTemplateUrl: '',
  };
}
export function newStepFile(index: number): StepFile {
  return {
    id: crypto.randomUUID(),
    name: `文件 ${index}`,
    instructions: '',
    required: true,
    deliverToCustomer: false,
    minFiles: 1,
    formats: '',
  };
}
export function stepDeliverySummary(step: ServiceFlowStep) {
  if (step.type === 'combined') return '内部使用';
  const items =
    step.type === 'document'
      ? stepDocuments(step)
      : step.type === 'upload'
        ? stepFiles(step)
        : undefined;
  if (!items) return '';
  const count = items.filter((item) => item.deliverToCustomer).length;
  return `${items.length} 项${step.type === 'document' ? '文档' : '文件'} · ${count ? `${count} 项交付客户` : '内部使用'}`;
}
export function validOnlineTemplateUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function validateStepDeliverables(step: ServiceFlowStep): number {
  if (step.type === 'document' && step.documents === undefined)
    step.documents = stepDocuments(step);
  if (step.type === 'upload' && step.files === undefined)
    step.files = stepFiles(step);
  let bytes = 0;
  for (const [kind, items] of [
    ['文档', step.documents],
    ['文件', step.files],
  ] as const) {
    if (items === undefined) continue;
    if (
      !Array.isArray(items) ||
      items.length < 1 ||
      items.length > 50 ||
      new Set(items.map((item) => item?.id)).size !== items.length
    )
      throw new Error(`每个步骤需配置 1–50 项${kind}，标识不能重复。`);
    for (const item of items) {
      if (
        !item ||
        typeof item.id !== 'string' ||
        !item.id.trim() ||
        item.id.length > 180 ||
        typeof item.name !== 'string' ||
        !item.name.trim() ||
        item.name.length > 120 ||
        typeof item.instructions !== 'string' ||
        item.instructions.length > 20000 ||
        typeof item.required !== 'boolean' ||
        typeof item.deliverToCustomer !== 'boolean'
      )
        throw new Error(`${kind}配置无效，请填写名称、说明及交付要求。`);
      item.name = item.name.trim();
      if (kind === '文档') {
        const document = item as StepDocument;
        if (document.reportTemplate) validateReportSelection(document.reportTemplate);
        if (
          typeof document.onlineTemplateUrl !== 'string' ||
          document.onlineTemplateUrl.length > 2048 ||
          (document.onlineTemplateUrl.trim() &&
            !validOnlineTemplateUrl(document.onlineTemplateUrl.trim()))
        )
          throw new Error('在线文档模板链接须为有效的 http 或 https 地址。');
        document.onlineTemplateUrl = document.onlineTemplateUrl.trim();
        if (
          document.initialContent !== undefined &&
          (typeof document.initialContent !== 'string' ||
            document.initialContent.length > 20000)
        )
          throw new Error('原文档模板内容无效。');
        if (document.template) {
          const template = document.template;
          if (
            typeof template.id !== 'string' ||
            !template.id ||
            typeof template.name !== 'string' ||
            !template.name.trim() ||
            template.name.length > 300 ||
            !(template.blob instanceof Blob) ||
            !template.blob.size ||
            template.blob.size > 20 * 1024 * 1024 ||
            template.size !== template.blob.size
          )
            throw new Error('文档模板须为非空文件，单个不超过 20 MB。');
          bytes += template.blob.size;
        }
      } else {
        const file = item as StepFile;
        if (
          !Number.isInteger(file.minFiles) ||
          file.minFiles < 1 ||
          file.minFiles > 20 ||
          typeof file.formats !== 'string' ||
          file.formats.length > 200 ||
          (file.formats &&
            !/^\.[a-zA-Z0-9]+(\s*,\s*\.[a-zA-Z0-9]+)*$/.test(file.formats))
        )
          throw new Error(
            '文件数量须为 1–20，格式以扩展名填写，例如 .pdf,.docx。',
          );
      }
    }
  }
  return bytes;
}
