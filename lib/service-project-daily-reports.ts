import { activityMessage } from './activity-events.ts';
import { isDemoAdministrator } from './demo-permissions.ts';
import {
  defaultMailTemplate,
  mailTemplateIssue,
  renderMailText,
  type MailTemplateSnapshot,
  type MailTemplateValues,
} from './service-mail-templates.ts';
import { type ConfirmationMail } from './project-confirmation-notice.ts';
import {
  projectMailDocumentIssue,
  projectMailBodyHtml,
  escapeReportHtml,
  type ProjectMailDocument,
} from './project-report-mail.ts';
import {
  resolveProjectReportFiles,
  customerProjectReportFiles,
  type ProjectReportFile,
  type ProjectReportFileSelection,
} from './project-report-files.ts';
import { reportText, type ReportNode } from './report-templates.ts';
import type { ServiceProjectRecord } from './service-projects';
import { canViewServiceProject } from './service-projects.ts';
import type { OperationActor } from './request-operations';
import { assignedEngineers } from './service-work-orders.ts';
import { appendProjectActivity } from './service-project-activity.ts';

export type DailyReportInput = {
  emailTemplate?: MailTemplateSnapshot;
  kind?: 'daily' | 'project';
  relatedFiles?: ProjectReportFileSelection[];
  projectDocument?: ProjectMailDocument;
  date: string;
  subject: string;
  to: string;
  cc: string;
  greeting: string;
  customerEngineers: string;
  projectManager: string;
  engineers: string;
  startTime: string;
  endTime: string;
  serviceNumber: string;
  workContent: string;
  nextPlan: string;
};
export type ProjectDailyReport = DailyReportInput & {
  confirmation?: ConfirmationMail;
  projectFiles?: ProjectReportFile[];
  projectId?: string;
  id: string;
  projectName: string;
  authorId: string;
  authorName: string;
  recordedAt: string;
  delivery: 'local';
};

export type ProjectDailyReportView = Omit<
  ProjectDailyReport,
  'authorId' | 'delivery'
> & { delivery: 'local' };

export function dailyReportHistory(reports: ProjectDailyReportView[], projectId?: string): ProjectDailyReportView[] {
  return reports.map(report => projectId ? { ...report, projectId } : report);
}

export function canSendProjectDailyReport(
  project: ServiceProjectRecord,
  actor: OperationActor,
) {
  if (isDemoAdministrator(actor)) return !['已完成', '已取消'].includes(project.status) && !!project.workOrders?.some(order => order.status !== '已取消');
  const group =
    actor.role === 'SmartX 服务工程师'
      ? 'internal'
      : actor.role === '合作伙伴服务工程师'
        ? 'partner'
        : undefined;
  return (
    !!group &&
    !!actor.id &&
    !['已完成', '已取消'].includes(project.status) &&
    canViewServiceProject(actor, project) &&
    !!project.workOrders?.some(
      (order) =>
        order.status !== '已取消' &&
        assignedEngineers(order).some(
          (person) => person.id === actor.id && person.group === group,
        ),
    )
  );
}

export function dailyReportEmails(value: string) {
  return [
    ...new Set(
      value
        .split(/[\s,;，；]+/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
export function dailyReportEmailValid(email: string) {
  return (
    email.length <= 254 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(
      email,
    )
  );
}
export function dailyReportTemplate(kind?: DailyReportInput['kind']) {
  return kind === 'project'
    ? {
        title: '项目报告',
        dateLabel: '报告日期',
        contentTitle: '报告内容',
        workLabel: '服务总结',
        workPlaceholder: '逐行填写项目实施成果与服务总结',
        introduction: '以下为本次项目实施报告，请查收。',
      }
    : {
        title: '每日工作日报',
        dateLabel: '日报日期',
        contentTitle: '日报内容',
        workLabel: '今日工作内容',
        workPlaceholder: '逐行填写今日完成的工作',
        introduction: '以下为今日的项目实施日报，请查收。',
      };
}

export function reportHasNextPlan(
  report: DailyReportInput & { confirmation?: ConfirmationMail },
) {
  return report.emailTemplate?.id !== 'review' && !report.confirmation;
}

export function dailyReportIssue(input: DailyReportInput): string | null {
  if (input.emailTemplate) {
    const issue = mailTemplateIssue(input.emailTemplate);
    if (issue) return issue;
  }
  if (input.kind !== undefined && !['daily', 'project'].includes(input.kind))
    return '请选择有效的报告类型。';
  const date = new Date(`${input.date}T12:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== input.date
  )
    return '请选择有效的日报日期。';
  if (!input.subject.trim()) return '请填写邮件主题。';
  if (input.subject.length > 200 || /[\r\n]/.test(input.subject))
    return '邮件主题须为单行，且不超过 200 字。';
  const to = dailyReportEmails(input.to),
    cc = dailyReportEmails(input.cc);
  if (!to.length) return '请填写至少一个收件人邮箱。';
  if (new Set([...to, ...cc]).size > 50)
    return '收件人和抄送人合计不能超过 50 个。';
  if ([...to, ...cc].some((email) => !dailyReportEmailValid(email)))
    return '请检查收件人和抄送人的邮箱格式。';
  if (!input.greeting.trim()) return '请填写客户称呼。';
  if (input.greeting.length > 500) return '客户称呼不能超过 500 字。';
  if (input.kind === 'project' && input.projectDocument)
    return projectMailDocumentIssue(input.projectDocument);
  if (!input.customerEngineers.trim()) return '请填写客户技术人员。';
  if (!input.engineers.trim()) return '请填写实施工程师。';
  if (
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime)
  )
    return '请填写有效的实施起止时间。';
  if (input.endTime <= input.startTime) return '实施结束时间须晚于开始时间。';
  if (!input.workContent.trim())
    return `请填写${dailyReportTemplate(input.kind).workLabel}。`;
  if (input.workContent.length > 10000) return '工作内容不能超过 10000 字。';
  if (reportHasNextPlan(input)) {
    if (!input.nextPlan.trim()) return '请填写后续安排。';
    if (input.nextPlan.length > 10000) return '后续安排不能超过 10000 字。';
  }
  if (
    [
      input.greeting,
      input.customerEngineers,
      input.engineers,
      input.projectManager,
      input.serviceNumber,
    ].some((text) => text.length > 500)
  )
    return '人员、称呼和服务编号各不能超过 500 字。';
  return null;
}

export function buildProjectDailyReport(
  project: ServiceProjectRecord,
  actor: OperationActor,
  input: DailyReportInput,
  now = new Date().toISOString(),
): ProjectDailyReport {
  const issue = dailyReportIssue(input);
  if (issue) throw new Error(issue);
  const to = dailyReportEmails(input.to);
  let projectDocument: ProjectMailDocument | undefined;
  let projectFiles: ProjectReportFile[] | undefined;
  if (input.kind === 'project' && input.projectDocument) {
    if (input.projectDocument!.reportSource!.projectId !== project.id)
      throw new Error('项目报告来源与当前项目不匹配。');
    projectFiles = resolveProjectReportFiles(
      project,
      input.projectDocument!.reportSource!.projectFiles ?? [],
    );
    projectDocument = structuredClone(input.projectDocument!);
    projectDocument.content = reportText(
      projectDocument.richText as ReportNode,
    ).trim();
  }
  if (!projectDocument && input.relatedFiles !== undefined) {
    projectFiles = resolveProjectReportFiles(project, input.relatedFiles);
  }
  // Explicit fields keep caller-provided metadata out of the immutable snapshot.
  const report: ProjectDailyReport = {
    ...(input.kind ? { kind: input.kind } : {}),
    ...(input.emailTemplate
      ? { emailTemplate: structuredClone(input.emailTemplate) }
      : {}),
    ...(projectDocument ? { projectDocument } : {}),
    ...(projectFiles ? { projectFiles } : {}),
    id: crypto.randomUUID(),
    projectName: project.name,
    projectId: project.id,
    authorId: actor.id,
    authorName: actor.name,
    recordedAt: now,
    delivery: 'local',
    date: input.date,
    subject: input.subject.trim(),
    to: to.join('; '),
    cc: dailyReportEmails(input.cc)
      .filter((email) => !to.includes(email))
      .join('; '),
    greeting: input.greeting.trim(),
    customerEngineers: input.customerEngineers.trim(),
    projectManager: input.projectManager.trim(),
    engineers: input.engineers.trim(),
    startTime: input.startTime,
    endTime: input.endTime,
    serviceNumber: project.id,
    workContent: input.workContent.trim(),
    nextPlan: reportHasNextPlan(input) ? input.nextPlan.trim() : '',
  };
  return report;
}

export function sendProjectDailyReport(
  project: ServiceProjectRecord,
  actor: OperationActor,
  input: DailyReportInput,
  now = new Date().toISOString(),
): ServiceProjectRecord {
  if (!canSendProjectDailyReport(project, actor))
    throw new Error('仅项目未关闭时的执行工程师可以发送日报。');
  const report = buildProjectDailyReport(project, actor, input, now);
  return appendProjectActivity(
    {
      ...project,
      dailyReports: [...(project.dailyReports ?? []), report],
      revision: project.revision + 1,
      updatedAt: now,
    },
    actor,
    '服务日报',
    (input.kind === 'project' ? activityMessage("发送项目报告（本地）") : activityMessage("发送服务日报（本地）")),
    activityMessage("{0} · {1}", [report.date, report.subject]),
    now,
    false,
  );
}

export function dailyReportDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime())
    ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日 周${'日一二三四五六'[date.getDay()]}`
    : '日报日期';
}
export function dailyReportLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^(?:\d+[.、．)]|[-•])\s*/, ''))
    .filter(Boolean);
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        char
      ]!,
  );
export function dailyReportHtml(
  report: DailyReportInput & {
    projectFiles?: ProjectReportFile[];
    projectId?: string;
    confirmation?: ConfirmationMail;
  },
  projectName: string,
) {
  if (report.kind === 'project' && report.projectDocument) {
    const e = escapeReportHtml;
    const files = report.projectFiles ?? [];
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body style="margin:0;background:#f2f5fa;color:#25354b;font:14px/1.8 Arial,sans-serif"><article style="max-width:720px;margin:24px auto;background:white;border:1px solid #e1e8f0;border-radius:12px;overflow:hidden"><header style="padding:28px 32px;border-top:5px solid #0096ff;border-bottom:1px solid #e1e8f0"><strong style="color:#0088eb">项目报告</strong><h1>${e(projectName)}</h1><p>${e(dailyReportDate(report.date))}</p></header><div style="padding:24px 32px;overflow-wrap:anywhere"><p>${e(report.greeting)}：</p>${report.projectDocument.richText ? projectMailBodyHtml(report.projectDocument.richText as ReportNode) : `<p>${e(report.projectDocument.content)}</p>`}<h2>项目文件</h2>${files.length ? `<ol>${files.map((item) => `<li><strong>${e(item.file.name)}</strong>${item.description ? `<p style="white-space:pre-wrap">文件说明：${e(item.description)}</p>` : ''}</li>`).join('')}</ol>` : '<p>暂无项目文件</p>'}</div></article></body></html>`;
  }
  const e = escapeHtml;
  const template = dailyReportTemplate(report.kind);
  const mailText = reportMailText(report, projectName);
  const confirmation = report.confirmation
    ? `<section style="margin-top:26px;padding:18px;background:#f0f7ff;border:1px solid #d5e7ff;border-radius:8px"><h2 style="font-size:17px;margin:0 0 12px">客户确认</h2><p style="white-space:pre-wrap">${e(report.confirmation.notice)}</p><a href="${e(dailyReportProjectUrl(report.projectId || report.serviceNumber))}" style="display:inline-block;margin-top:8px;padding:10px 24px;background:#0088eb;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600">去确认</a></section>`
    : '';

  const section = (title: string, content: string) =>
    `<h2 style="font-size:17px;color:#1d326c;margin:26px 0 12px">${title}</h2><ol style="padding:16px 24px 16px 40px;background:#f5f8fc;border-radius:8px;margin:0">${dailyReportLines(
      content,
    )
      .map(
        (line) =>
          `<li style="padding:5px 0;white-space:pre-wrap;overflow-wrap:anywhere">${e(line)}</li>`,
      )
      .join('')}</ol>`;
  const relatedFiles = report.projectFiles?.length
    ? `<h2 style="font-size:17px;color:#1d326c;margin:26px 0 12px">相关文件</h2><ol>${report.projectFiles.map((file) => `<li><strong>${e(file.file.name)}</strong>${file.description ? `<p style="white-space:pre-wrap">文件说明：${e(file.description)}</p>` : ''}</li>`).join('')}</ol>`
    : '';
  const rows = [
    ['客户技术人员', report.customerEngineers],
    ['项目经理', report.projectManager || '—'],
    ['实施工程师', report.engineers],
    ['实施时间', `${report.startTime} – ${report.endTime}`],
    ['服务项目编号', report.projectId || report.serviceNumber || '—'],
  ];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f2f5fa;color:#25354b;font:14px/1.8 Arial,sans-serif"><div style="max-width:720px;margin:24px auto;background:#fff;border:1px solid #e1e8f0;border-radius:12px;overflow:hidden"><div style="padding:28px 32px;border-top:5px solid #0096ff;border-bottom:1px solid #e1e8f0"><div style="color:#0088eb;font-weight:700;letter-spacing:2px">${e(template.title)}</div><h1 style="font-size:24px;line-height:1.5;color:#1d326c;margin:10px 0;overflow-wrap:anywhere">${e(projectName)}</h1><div style="color:#697990">${e(dailyReportDate(report.date))}</div></div><div style="padding:24px 32px;overflow-wrap:anywhere"><p>${e(report.greeting)}：</p><p style="white-space:pre-wrap">${e(mailText.introduction)}</p><h2 style="font-size:17px;color:#1d326c;margin-top:26px">实施信息</h2><table style="border-collapse:collapse;width:100%">${rows.map(([label, value]) => `<tr><th style="text-align:left;background:#f5f8fc;border-bottom:1px solid #e1e8f0;padding:10px 14px;width:110px;font-weight:500">${label}</th><td style="border-bottom:1px solid #e1e8f0;padding:10px 14px;white-space:pre-wrap">${label === '服务项目编号' && value !== '—' ? `<a href="${e(dailyReportProjectUrl(value))}" style="color:#0088eb;text-decoration:underline">${e(value)}</a>` : e(value)}</td></tr>`).join('')}</table>${section(template.workLabel, report.workContent)}${reportHasNextPlan(report) ? section('后续安排', report.nextPlan) : ''}${relatedFiles}${confirmation}<p style="margin-top:30px;color:#697990;white-space:pre-wrap">${e(mailText.closing)}</p></div></div></body></html>`;
}
function base64(value: string) {
  return btoa(
    Array.from(new TextEncoder().encode(value), (byte) =>
      String.fromCharCode(byte),
    ).join(''),
  );
}
export function dailyReportEml(report: ProjectDailyReportView) {
  // RFC 2047 words are split by Unicode code point to stay below the 75-character limit.
  const words: string[] = [];
  let chunk = '';
  for (const char of report.subject) {
    if (new TextEncoder().encode(chunk + char).length > 42) {
      words.push(`=?UTF-8?B?${base64(chunk)}?=`);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) words.push(`=?UTF-8?B?${base64(chunk)}?=`);
  const body = base64(dailyReportHtml(report, report.projectName))
    .match(/.{1,76}/g)!
    .join('\r\n');
  return [
    `X-Unsent: 1`,
    `To: ${dailyReportEmails(report.to).join(',\r\n ')}`,
    ...(report.cc
      ? [`Cc: ${dailyReportEmails(report.cc).join(',\r\n ')}`]
      : []),
    `Subject: ${words.join('\r\n ')}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    body,
    '',
  ].join('\r\n');
}

export function customerDailyReport(
  report: ProjectDailyReport,
): ProjectDailyReportView {
  const {
    id,
    projectName,
    projectId,
    authorName,
    recordedAt,
    delivery,
    date,
    subject,
    to,
    cc,
    greeting,
    customerEngineers,
    projectManager,
    engineers,
    startTime,
    endTime,
    serviceNumber,
    workContent,
    nextPlan,
    kind,
    projectDocument,
    projectFiles,
    confirmation,
    emailTemplate,
  } = report;
  return {
    id,
    projectName,
    ...(projectId ? { projectId } : {}),
    authorName,
    recordedAt,
    delivery,
    date,
    subject,
    to,
    cc,
    greeting,
    customerEngineers,
    projectManager,
    engineers,
    startTime,
    endTime,
    serviceNumber,
    workContent,
    nextPlan,
    ...(kind ? { kind } : {}),
    ...(emailTemplate ? { emailTemplate: structuredClone(emailTemplate) } : {}),
    ...(confirmation ? { confirmation: structuredClone(confirmation) } : {}),
    ...(projectFiles
      ? { projectFiles: customerProjectReportFiles(projectFiles) }
      : {}),
    ...(kind === 'project' && projectDocument
      ? {
          projectDocument: {
            title: projectDocument.title,
            source: 'template' as const,
            content: projectDocument.content,
            richText: structuredClone(projectDocument.richText),
          },
        }
      : {}),
  };
}

export async function dailyReportEmlWithFiles(report: ProjectDailyReportView) {
  const eml = dailyReportEml(report);
  if (!report.projectFiles?.length) return eml;
  const boundary = `report-${crypto.randomUUID()}`;
  const split = eml.indexOf('\r\n\r\n');
  const headers = eml
    .slice(0, split)
    .replace(
      'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
    );
  const parts = [
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    eml.slice(split + 4).trim(),
  ];
  for (const item of report.projectFiles) {
    const bytes = new Uint8Array(await item.file.blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const filename = encodeURIComponent(item.file.name).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    parts.push(
      `--${boundary}`,
      'Content-Type: application/octet-stream',
      `Content-Disposition: attachment; filename*=UTF-8''${filename}`,
      'Content-Transfer-Encoding: base64',
      '',
      btoa(binary)
        .match(/.{1,76}/g)
        ?.join('\r\n') ?? '',
    );
  }
  parts.push(`--${boundary}--`, '');
  return `${headers}\r\n\r\n${parts.join('\r\n')}`;
}

export function dailyReportProjectUrl(
  projectId: string,
  origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://localhost:53221',
) {
  return `${origin}/?project=${encodeURIComponent(projectId)}`;
}

export function reportMailValues(
  report: DailyReportInput,
  projectName: string,
): MailTemplateValues {
  return {
    项目名称: projectName,
    服务项目编号: report.serviceNumber,
    客户名称: report.emailTemplate?.customerName ?? '',
    报告日期: report.date,
    客户技术人员: report.customerEngineers,
    项目经理: report.projectManager,
    实施工程师: report.engineers,
    开始时间: report.startTime,
    结束时间: report.endTime,
  };
}
export function reportMailText(report: DailyReportInput, projectName: string) {
  const template =
    report.emailTemplate ??
    defaultMailTemplate(report.kind === 'project' ? 'project' : 'daily');
  const values = reportMailValues(report, projectName);
  return {
    introduction: renderMailText(template.introduction, values),
    closing: renderMailText(template.closing, values),
    confirmationNotice: renderMailText(template.confirmationNotice, values),
  };
}
export function applyMailTemplate(
  input: DailyReportInput,
  snapshot: MailTemplateSnapshot,
  projectName: string,
): DailyReportInput {
  const report = { ...input, emailTemplate: structuredClone(snapshot) };
  const values = reportMailValues(report, projectName);
  return {
    ...report,
    subject: renderMailText(snapshot.subject, values),
    greeting: renderMailText(snapshot.greeting, values),
    workContent: renderMailText(snapshot.workContent, values),
    nextPlan:
      snapshot.id === 'review' ? '' : renderMailText(snapshot.nextPlan, values),
  };
}
