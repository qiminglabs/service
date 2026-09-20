'use client';
import { ConfirmationMailNotice } from '@/components/confirmation-mail-notice';
import { type ConfirmationMail } from '@/lib/project-confirmation-notice';
import type { ProjectConfirmation } from '@/lib/service-project-review';

import { useState, type ReactNode } from 'react';
import { CalendarDays, Download, Mail } from 'lucide-react';
import { ReportBody } from '@/components/report-body';
import { ProjectReportFilesSection } from '@/components/project-report-files';
import type { ReportNode } from '@/lib/report-templates';
import type { ProjectReportFile } from '@/lib/project-report-files';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import {
  dailyReportDate,
  dailyReportLines,
  dailyReportEmlWithFiles,
  dailyReportHistory,
  dailyReportTemplate,
  reportMailText,
  reportHasNextPlan,
  dailyReportProjectUrl,
  type DailyReportInput,
  type ProjectDailyReportView,
} from '@/lib/service-project-daily-reports';

export function ReportPreview({
  report,
  projectName,
}: {
  report: DailyReportInput & {
    projectFiles?: ProjectReportFile[];
    projectId?: string;
    confirmation?: ConfirmationMail;
  };
  projectName: string;
}) {
  if (report.kind === 'project' && report.projectDocument)
    return (
      <article className="daily-report-paper" aria-label="项目报告邮件预览">
        <header>
          <span className="daily-report-eyebrow">项目报告</span>
          <h3>{projectName}</h3>
          <p>
            <CalendarDays size={14} />
            {dailyReportDate(report.date)}
          </p>
        </header>
        <div className="daily-report-paper-body">
          {report.greeting && <p>{report.greeting}：</p>}
          {report.projectDocument?.richText ? (
            <ReportBody body={report.projectDocument.richText as ReportNode} />
          ) : (
            <p className="whitespace-pre-wrap">
              {report.projectDocument?.content || '选择模板后填写项目报告正文'}
            </p>
          )}
          <ProjectReportFilesSection files={report.projectFiles ?? []} />
        </div>
      </article>
    );
  const template = dailyReportTemplate(report.kind);
  const mailText = reportMailText(report, projectName);
  const rows = [
    ['客户技术人员', report.customerEngineers],
    ['项目经理', report.projectManager],
    ['实施工程师', report.engineers],
    ['实施时间', `${report.startTime || '—'} – ${report.endTime || '—'}`],
    ['服务项目编号', report.projectId || report.serviceNumber],
  ];
  return (
    <article className="daily-report-paper" aria-label="日报正文预览">
      <header>
        <span className="daily-report-eyebrow">{template.title}</span>
        <h3>{projectName}</h3>
        <p>
          <CalendarDays size={14} />
          {dailyReportDate(report.date)}
        </p>
      </header>
      <div className="daily-report-paper-body">
        <p>{report.greeting || '客户称呼'}：</p>
        <p className="whitespace-pre-wrap">{mailText.introduction}</p>
        <h4>实施信息</h4>
        <dl>
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                {label === '服务项目编号' && value ? (
                  <a
                    className="daily-report-project-number"
                    href={dailyReportProjectUrl(value)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {value}
                  </a>
                ) : (
                  value || '—'
                )}
              </dd>
            </div>
          ))}
        </dl>
        {(
          [
            [template.workLabel, report.workContent],
            ...(reportHasNextPlan(report)
              ? [['后续安排', report.nextPlan] as const]
              : []),
          ] as const
        ).map(([title, content]) => (
          <section key={title}>
            <h4>{title}</h4>
            {dailyReportLines(content).length ? (
              <ol>
                {dailyReportLines(content).map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
            ) : (
              <p className="daily-report-placeholder">{`待填写${title}`}</p>
            )}
          </section>
        ))}
        {!!report.projectFiles?.length && (
          <ProjectReportFilesSection
            title="相关文件"
            files={report.projectFiles}
          />
        )}
        {report.confirmation && (
          <ConfirmationMailNotice
            confirmation={report.confirmation}
            projectId={report.projectId || report.serviceNumber}
          />
        )}
        <footer className="whitespace-pre-wrap">{mailText.closing}</footer>
      </div>
    </article>
  );
}
async function exportReport(report: ProjectDailyReportView) {
  const url = URL.createObjectURL(
    new Blob([await dailyReportEmlWithFiles(report)], {
      type: 'message/rfc822',
    }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${report.date}-${report.projectName.replace(/[\\/:*?"<>|]/g, '_')}-${report.kind === 'project' ? '项目报告' : '服务日报'}.eml`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DailyReportsPanel({
  reports: records,
  showCustomerVisibility = false,
  action,
  notice,
  confirmations = [],
}: {
  reports: ProjectDailyReportView[];
  confirmations?: Pick<ProjectConfirmation, 'id' | 'state' | 'invalidatedAt'>[];
  showCustomerVisibility?: boolean;
  action?: ReactNode;
  notice?: string;
}) {
  const [exportError, setExportError] = useState('');
  const [exportingId, setExportingId] = useState('');
  async function download(report: ProjectDailyReportView) {
    if (exportingId) return;
    setExportingId(report.id);
    setExportError('');
    try {
      await exportReport(report);
    } catch {
      setExportError('邮件导出失败，请重试。');
    } finally {
      setExportingId('');
    }
  }
  const reports = [...records].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt),
  );
  return (
    <section
      className={`daily-reports${showCustomerVisibility ? ' sr-customer-visible-panel' : ''}`}
      aria-label="服务日报"
    >
      <div className="daily-report-toolbar">
        <div className="sr-panel-title-with-visibility">
          <h3>
            服务日报 <span>{reports.length}</span>
          </h3>
          {showCustomerVisibility && <CustomerVisibleBadge />}
        </div>
        {action}
      </div>
      {exportError && (
        <p className="sr-error" role="alert">
          {exportError}
        </p>
      )}
      {notice && <output className="sr-notice">{notice}</output>}
      {reports.length ? (
        <div className="sr-table-scroll">
          <table
            className="sr-table wo-overview-table daily-report-table"
            aria-label="服务日报列表"
          >
            <thead>
              <tr>
                <th scope="col">报告主题</th>
                <th scope="col">类型</th>
                <th scope="col">编写人</th>
                <th scope="col">状态</th>
                <th scope="col">报告日期</th>
                <th scope="col">记录时间</th>
                <th scope="col">操作</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id}>
                  <td className="daily-report-subject-cell">
                    <strong>{report.subject}</strong>
                    {report.to && (
                      <small
                        title={`收件人：${report.to}${report.cc ? `；抄送：${report.cc}` : ''}`}
                      >
                        收件人：{report.to}
                      </small>
                    )}
                  </td>
                  <td>
                    {report.kind === 'project' ? '项目报告' : '每日工作日报'}
                  </td>
                  <td>{report.authorName}</td>
                  <td>
                    <span
                      className="wo-status"
                      data-tone="blue"
                    >
                      {report.confirmation
                        ? confirmations.find(
                            (item) => item.id === report.confirmation!.id,
                          )?.invalidatedAt
                          ? '已失效'
                          : (confirmations.find(
                              (item) => item.id === report.confirmation!.id,
                            )?.state ?? '历史确认')
                        : '本地发送'}
                    </span>
                  </td>
                  <td>{report.date}</td>
                  <td>
                    {new Date(report.recordedAt).toLocaleString('zh-CN', {
                      hour12: false,
                    })}
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!!exportingId}
                      onClick={() => void download(report)}
                      aria-label={`导出邮件：${report.subject}`}
                    >
                      <Download size={14} />
                      {exportingId === report.id ? '导出中…' : '导出邮件'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="daily-report-empty">
          <div>
            <Mail size={28} />
          </div>
          <h4>暂无服务日报</h4>
        </div>
      )}
    </section>
  );
}

export function CustomerProjectDailyReports({
  reports,
  projectId,
  confirmation,
}: {
  reports: ProjectDailyReportView[];
  projectId?: string;
  confirmation?: ProjectConfirmation;
}) {
  return (
    <DailyReportsPanel
      reports={dailyReportHistory(reports, projectId)}
      confirmations={confirmation ? [confirmation] : []}
    />
  );
}
