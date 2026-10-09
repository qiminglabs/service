'use client';
import { useI18n } from '@/lib/i18n/context';

import { ConfirmationMailNotice } from '@/components/confirmation-mail-notice';
import { type ConfirmationMail } from '@/lib/project-confirmation-notice';
import type { ProjectConfirmation } from '@/lib/service-project-review';

import { useState, type ReactNode } from 'react';
import { CalendarDays, Eye, Mail } from 'lucide-react';
import { ReportBody } from '@/components/report-body';
import { ProjectReportFilesSection } from '@/components/project-report-files';
import type { ReportNode } from '@/lib/report-templates';
import type { ProjectReportFile } from '@/lib/project-report-files';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import {
  dailyReportDate,
  dailyReportLines,
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
  const { localize, localizeMessage } = useI18n();
  if (report.kind === 'project' && report.projectDocument)
    return (
      <article className="daily-report-paper" aria-label={localize("项目报告邮件预览")}>
        <header>
          <span className="daily-report-eyebrow">{localize("项目报告")}</span>
          <h3>{localize(projectName)}</h3>
          <p>
            <CalendarDays size={14} />
            {localize(dailyReportDate(report.date))}
          </p>
        </header>
        <div className="daily-report-paper-body">
          {localize(report.greeting && <p>{localize(report.greeting)}：</p>)}
          {localize(report.projectDocument?.richText ? (
            <ReportBody body={report.projectDocument.richText as ReportNode} />
          ) : (
            <p className="whitespace-pre-wrap">
              {localize(report.projectDocument?.content || '选择模板后填写项目报告正文')}
            </p>
          ))}
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
    <article className="daily-report-paper" aria-label={localize("日报正文预览")}>
      <header>
        <span className="daily-report-eyebrow">{localize(template.title)}</span>
        <h3>{localize(projectName)}</h3>
        <p>
          <CalendarDays size={14} />
          {localize(dailyReportDate(report.date))}
        </p>
      </header>
      <div className="daily-report-paper-body">
        <p>{localize(report.greeting || '客户称呼')}：</p>
        <p className="whitespace-pre-wrap">{localize(mailText.introduction)}</p>
        <h4>{localize("实施信息")}</h4>
        <dl>
          {localize(rows.map(([label, value]) => (
            <div key={label}>
              <dt>{localize(label)}</dt>
              <dd>
                {localize(label === '服务项目编号' && value ? (
                  <a
                    className="daily-report-project-number"
                    href={dailyReportProjectUrl(value)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {localize(value)}
                  </a>
                ) : (
                  value || '—'
                ))}
              </dd>
            </div>
          )))}
        </dl>
        {localize((
          [
            [template.workLabel, report.workContent],
            ...(reportHasNextPlan(report)
              ? [['后续安排', report.nextPlan] as const]
              : []),
          ] as const
        ).map(([title, content]) => (
          <section key={title}>
            <h4>{localize(title)}</h4>
            {localize(dailyReportLines(content).length ? (
              <ol>
                {localize(dailyReportLines(content).map((line, index) => (
                  <li key={index}>{localize(line)}</li>
                )))}
              </ol>
            ) : (
              <p className="daily-report-placeholder">{localizeMessage("待填写{0}", [localize(title)])}</p>
            ))}
          </section>
        )))}
        {localize(!!report.projectFiles?.length && (
          <ProjectReportFilesSection
            title={localize("相关文件")}
            files={report.projectFiles}
          />
        ))}
        {localize(report.confirmation && (
          <ConfirmationMailNotice
            confirmation={report.confirmation}
            projectId={report.projectId || report.serviceNumber}
          />
        ))}
        <footer className="whitespace-pre-wrap">{localize(mailText.closing)}</footer>
      </div>
    </article>
  );
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
  const { localize, localizeMessage } = useI18n();
  const [viewingId, setViewingId] = useState('');
  const viewing = records.find((report) => report.id === viewingId);
  const reports = [...records].sort(
    (a, b) =>
      b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt),
  );
  return (
    <section
      className={`daily-reports${showCustomerVisibility ? ' sr-customer-visible-panel' : ''}`}
      aria-label={localize("服务日报")}
    >
      <div className="daily-report-toolbar">
        <div className="sr-panel-title-with-visibility">
          <h3>
            {localize("服务日报")}<span>{localize(reports.length)}</span>
          </h3>
          {localize(showCustomerVisibility && <CustomerVisibleBadge />)}
        </div>
        {localize(action)}
      </div>
      {localize(notice && <output className="sr-notice">{localize(notice)}</output>)}
      {localize(reports.length ? (
        <div className="sr-table-scroll">
          <table
            className="sr-table wo-overview-table daily-report-table"
            aria-label={localize("服务日报列表")}
          >
            <thead>
              <tr>
                <th scope="col">{localize("报告主题")}</th>
                <th scope="col">{localize("类型")}</th>
                <th scope="col">{localize("编写人")}</th>
                <th scope="col">{localize("状态")}</th>
                <th scope="col">{localize("报告日期")}</th>
                <th scope="col">{localize("记录时间")}</th>
                <th scope="col">{localize("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {localize(reports.map((report) => (
                <tr key={report.id}>
                  <td className="daily-report-subject-cell">
                    <strong>{localize(report.subject)}</strong>
                  </td>
                  <td>
                    {localize(report.kind === 'project' ? '项目报告' : '每日工作日报')}
                  </td>
                  <td>{localize(report.authorName)}</td>
                  <td>
                    <span className="wo-status" data-tone="blue">
                      {localize(report.confirmation
                        ? confirmations.find(
                            (item) => item.id === report.confirmation!.id,
                          )?.invalidatedAt
                          ? '已失效'
                          : (confirmations.find(
                              (item) => item.id === report.confirmation!.id,
                            )?.state ?? '历史确认')
                        : '本地发送')}
                    </span>
                  </td>
                  <td>{localize(report.date)}</td>
                  <td>
                    {localize(new Date(report.recordedAt).toLocaleString('zh-CN', {
                      hour12: false,
                    }))}
                  </td>
                  <td>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewingId(report.id)}
                      aria-label={localizeMessage("查看邮件：{0}", [localize(report.subject)])}
                    >
                      <Eye size={14} />
                      {localize("查看邮件")}</Button>
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="daily-report-empty">
          <div>
            <Mail size={28} />
          </div>
          <h4>{localize("暂无服务日报")}</h4>
        </div>
      ))}
      <Dialog
        open={!!viewing}
        onOpenChange={(open) => {
          if (!open) setViewingId('');
        }}
      >
        <DialogContent
          className="daily-report-dialog"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>{localize("查看邮件")}</DialogTitle>
          </DialogHeader>
          {localize(viewing && (
            <div className="daily-report-compose is-confirm">
              <div className="daily-report-live-preview">
                <div className="daily-report-preview-label">
                  {localize(viewing.subject)}
                </div>
                <div className="daily-report-confirm-recipients">
                  <p>
                    <strong>{localize("收件人")}</strong>
                    {localize(viewing.to || '—')}
                  </p>
                  {localize(viewing.cc && (
                    <p>
                      <strong>{localize("抄送")}</strong>
                      {localize(viewing.cc)}
                    </p>
                  ))}
                  <span className="daily-report-status">{localize("本地发送")}</span>
                </div>
                <ReportPreview
                  report={viewing}
                  projectName={viewing.projectName}
                />
              </div>
            </div>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewingId('')}>
              {localize("关闭")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
