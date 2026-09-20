import { projectConfirmationNotice } from './project-confirmation-notice.ts';
export const serviceMailTemplatesId = 'service-mail-templates';
export const mailTemplateKinds = ['daily', 'project', 'review'] as const;
export type MailTemplateKind = (typeof mailTemplateKinds)[number];
export const mailTemplateNames: Record<MailTemplateKind, string> = {
  daily: '服务日报',
  project: '项目报告',
  review: '项目报告（复核）',
};
export const mailTemplateUses: Record<MailTemplateKind, string> = {
  daily: '写日报 · 每日工作日报',
  project: '写日报 · 项目报告',
  review: '客户确认 · 发送报告并发起确认',
};
export const mailTemplateFields = [
  { key: 'subject', label: '邮件主题', max: 200, required: true },
  { key: 'greeting', label: '客户称呼', max: 500, required: true },
  { key: 'introduction', label: '开场语', max: 3000, required: true },
  {
    key: 'workContent',
    label: '工作内容 / 服务总结（默认内容）',
    max: 20000,
    required: false,
  },
  {
    key: 'nextPlan',
    label: '后续安排（默认内容）',
    max: 20000,
    required: false,
  },
  { key: 'closing', label: '结束语', max: 3000, required: true },
  {
    key: 'confirmationNotice',
    label: '客户确认正文',
    max: 3000,
    required: true,
  },
] as const;
export type MailTemplateField = (typeof mailTemplateFields)[number]['key'];
export type ServiceMailTemplate = Record<MailTemplateField, string> & {
  id: MailTemplateKind;
  version: number;
  updatedAt: string;
  updatedBy: string;
};
export type ServiceMailConfig = {
  revision: number;
  templates: ServiceMailTemplate[];
};
export type MailTemplateSnapshot = ServiceMailTemplate & {
  customerName: string;
};
export const mailTemplateVariables = [
  '项目名称',
  '服务项目编号',
  '客户名称',
  '报告日期',
  '客户技术人员',
  '项目经理',
  '实施工程师',
  '开始时间',
  '结束时间',
] as const;
export type MailTemplateValues = Record<
  (typeof mailTemplateVariables)[number],
  string
>;
export function renderMailText(text: string, values: MailTemplateValues) {
  return text.replace(
    /\{\{([^{}]+)\}\}/g,
    (_, key: keyof MailTemplateValues) => values[key] ?? '',
  );
}
export function defaultMailTemplate(id: MailTemplateKind): ServiceMailTemplate {
  return {
    id,
    version: 1,
    updatedAt: '',
    updatedBy: '系统初始化',
    subject: `【SmartX ${id === 'daily' ? '项目实施日报' : id === 'review' ? '项目实施报告及确认' : '项目实施报告'}】{{项目名称}}`,
    greeting: '{{客户名称}}的老师',
    introduction: `您好！感谢您对本次 {{项目名称}} 实施工作的支持。${id === 'daily' ? '以下为今日的项目实施日报，请查收。' : '以下为本次项目实施报告，请查收。'}`,
    workContent: '',
    nextPlan: '',
    closing: '如有任何问题，请随时与我们沟通。\n谢谢！',
    confirmationNotice: id === 'review' ? projectConfirmationNotice : '',
  };
}
export function mailTemplateIssue(
  template: ServiceMailTemplate,
): string | null {
  if (!mailTemplateKinds.includes(template.id)) return '模板类型无效。';
  for (const field of mailTemplateFields) {
    if (field.key === 'nextPlan' && template.id === 'review') continue;
    const value = template[field.key];
    if (typeof value !== 'string' || value.length > field.max)
      return `${field.label}不能超过 ${field.max} 字。`;
    if (
      field.required &&
      (field.key !== 'confirmationNotice' || template.id === 'review') &&
      !value.trim()
    )
      return `请填写${field.label}。`;
    if (['subject', 'greeting'].includes(field.key) && /[\r\n]/.test(value))
      return `${field.label}须为单行。`;
    for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
      if (!(mailTemplateVariables as readonly string[]).includes(match[1]))
        return `${field.label}引用了不支持的字段：${match[1]}`;
    }
    if (/[{}]/.test(value.replace(/\{\{([^{}]+)\}\}/g, '')))
      return `${field.label}的引用字段格式不完整。`;
  }
  if (template.id !== 'review' && template.confirmationNotice)
    return '客户确认正文仅适用于项目报告（复核）。';
  return null;
}
export class MailTemplateConflict extends Error {
  constructor() {
    super('邮件模板已被更新，请重新进入编辑后再保存。');
  }
}
export function parseMailConfig(value: unknown): ServiceMailConfig {
  if (value === undefined)
    return {
      revision: 0,
      templates: mailTemplateKinds.map(defaultMailTemplate),
    };
  const config = value as ServiceMailConfig;
  if (
    !config ||
    !Number.isSafeInteger(config.revision) ||
    config.revision < 0 ||
    !Array.isArray(config.templates) ||
    config.templates.length !== 3
  )
    throw new Error('邮件模板配置无效。');
  for (const id of mailTemplateKinds) {
    const entries = config.templates.filter((entry) => entry?.id === id);
    if (
      entries.length !== 1 ||
      !Number.isSafeInteger(entries[0].version) ||
      entries[0].version < 1 ||
      typeof entries[0].updatedBy !== 'string' ||
      typeof entries[0].updatedAt !== 'string' ||
      mailTemplateIssue(entries[0])
    )
      throw new Error('邮件模板配置无效。');
  }
  return structuredClone(config);
}
export function mailConfigFromRows(rows: { id: string; payload?: unknown }[]) {
  return parseMailConfig(
    rows.find((row) => row.id === serviceMailTemplatesId)?.payload,
  );
}
export function changeMailTemplate(
  config: ServiceMailConfig,
  template: ServiceMailTemplate,
  revision: number,
  author: string,
  now = new Date().toISOString(),
): ServiceMailConfig {
  if (config.revision !== revision) throw new MailTemplateConflict();
  const issue = mailTemplateIssue(template);
  if (issue) throw new Error(issue);
  const current = config.templates.find((item) => item.id === template.id)!;
  const content = Object.fromEntries(
    mailTemplateFields.map((field) => [field.key, template[field.key].trim()]),
  ) as Record<MailTemplateField, string>;
  const next = {
    ...content,
    nextPlan: template.id === 'review' ? '' : content.nextPlan,
    id: template.id,
    version: current.version + 1,
    updatedAt: now,
    updatedBy: author,
  };
  return {
    revision: config.revision + 1,
    templates: config.templates.map((item) =>
      item.id === next.id ? next : structuredClone(item),
    ),
  };
}
export function canonicalMailTemplate(
  config: ServiceMailConfig,
  id: MailTemplateKind,
  supplied?: MailTemplateSnapshot,
  customerName = '',
): MailTemplateSnapshot {
  const template = config.templates.find((item) => item.id === id)!;
  if (supplied && (supplied.id !== id || supplied.version !== template.version))
    throw new Error('邮件模板已更新，请关闭并重新打开邮件编辑。');
  return { ...structuredClone(template), customerName };
}
