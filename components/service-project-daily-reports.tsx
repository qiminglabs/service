'use client';
import { useI18n } from '@/lib/i18n/context';


import { readServiceMailTemplates } from '@/lib/service-mail-template-store';
import {
  canonicalMailTemplate,
  type ServiceMailConfig,
} from '@/lib/service-mail-templates';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Eye,
  FileText,
  Mail,
  Plus,
  Paperclip,
  Send,
} from 'lucide-react';
import { ProjectReportFilePicker } from '@/components/project-report-files';
import { projectDeliverables } from '@/lib/service-project-deliverables';
import { resolveProjectReportFiles } from '@/lib/project-report-files';
import { DailyReportRecipientField } from '@/components/daily-report-recipient-field';
import {
  dailyReportRecipients,
  defaultDailyReportRecipients,
} from '@/lib/project-daily-report-recipients';
import {
  DailyReportsPanel,
  ReportPreview,
} from '@/components/project-daily-report-history';
import { isInternal } from '@/lib/request-operations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { DateField } from '@/components/date-field';
import { TimeField } from '@/components/time-field';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import type { ProjectCollaboratorDirectory } from '@/lib/service-project-collaborators';
import { fixedIdentityRoles } from '@/lib/internal-users';
import { assignedEngineers } from '@/lib/service-work-orders';
import { sendStoredProjectDailyReport } from '@/lib/service-work-order-store';
import {
  canSendProjectDailyReport,
  dailyReportHistory,
  dailyReportTemplate,
  dailyReportProjectUrl,
  dailyReportIssue,
  applyMailTemplate,
  reportMailText,
  dailyReportEmails,
  type DailyReportInput,
} from '@/lib/service-project-daily-reports';

function initialReport(
  project: ServiceProjectRecord,
  customerName: string,
  directory: ProjectCollaboratorDirectory,
): DailyReportInput {
  const now = new Date();
  const contacts = directory.contacts.filter(
    (person) =>
      person.customerId === project.customerId &&
      person.status === '启用' &&
      project.collaborators?.customer?.some(
        (member) => member.id === person.id,
      ),
  );
  return {
    date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    subject: `【SmartX 项目实施日报】${project.name}`,
    ...defaultDailyReportRecipients(dailyReportRecipients(project, directory)),
    greeting: `${customerName}的老师`,
    customerEngineers: contacts.map((person) => person.name).join('、'),
    projectManager:
      project.collaborators?.internal
        ?.filter(
          (person) => fixedIdentityRoles[person.id] === 'SmartX 项目经理',
        )
        .map((person) => person.name)
        .join('、') ?? '',
    engineers: [
      ...new Set(
        project.workOrders
          ?.filter((order) => order.status !== '已取消')
          .flatMap((order) =>
            assignedEngineers(order).map((person) => person.name),
          ) ?? [],
      ),
    ].join('、'),
    startTime: '09:00',
    endTime: '18:00',
    serviceNumber: project.id,
    relatedFiles: [],
    workContent: '',
    nextPlan: '',
  };
}

export function ServiceProjectDailyReports({
  project,
  actor,
  customerName,
  directory,
  busy,
  onBusy,
  onSaved,
  confirmationFlow,
}: {
  confirmationFlow?: {
    onClose: () => void;
    onSend: (input: DailyReportInput) => Promise<ServiceProjectRecord>;
  };
  project: ServiceProjectRecord;
  actor: OperationActor;
  customerName: string;
  directory: ProjectCollaboratorDirectory;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const [open, setOpen] = useState(!!confirmationFlow);
  const [mailConfig, setMailConfig] = useState<ServiceMailConfig>();
  const [choosingKind, setChoosingKind] = useState(false);
  const [stage, setStage] = useState<'edit' | 'confirm'>('edit');
  const [form, setForm] = useState<DailyReportInput>(() =>
    confirmationFlow
      ? {
          ...initialReport(project, customerName, directory),
          kind: 'project',
          subject: `【SmartX 项目实施报告及确认】${project.name}`,
        }
      : initialReport(project, customerName, directory),
  );
  const baseline = useRef(JSON.stringify(form));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const initialMail = useRef({
    project,
    customerName,
    directory,
    isConfirmation: !!confirmationFlow,
  });
  useEffect(() => {
    const { project, customerName, directory, isConfirmation } =
      initialMail.current;
    let active = true;
    void readServiceMailTemplates()
      .then(({ config }) => {
        if (!active) return;
        setMailConfig(config);
        if (isConfirmation) {
          const next = applyMailTemplate(
            {
              ...initialReport(project, customerName, directory),
              kind: 'project',
            },
            canonicalMailTemplate(config, 'review', undefined, customerName),
            project.name,
          );
          setForm(next);
          baseline.current = JSON.stringify(next);
        }
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : '邮件模板读取失败。',
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const lock = useRef(false);
  const allowed = canSendProjectDailyReport(project, actor);
  const active =
    actor.role === '合作伙伴服务工程师'
      ? directory.partnerUsers.some(
          (person) =>
            person.id === actor.id &&
            person.status === '启用' &&
            directory.partners.some(
              (company) =>
                company.id === person.partnerId && company.status === '启用',
            ),
        )
      : directory.users.some(
          (person) => person.id === actor.id && person.status === '启用',
        );
  const canSend =
    active &&
    !!mailConfig &&
    (confirmationFlow
      ? !['已完成', '已取消', '已暂停'].includes(project.status)
      : allowed);
  const recipients = dailyReportRecipients(project, directory);
  function change(
    key: Exclude<
      keyof DailyReportInput,
      'kind' | 'projectDocument' | 'relatedFiles' | 'emailTemplate'
    >,
    value: string,
  ) {
    setForm((current) => ({ ...current, [key]: value }));
    setError('');
  }
  async function compose(kind: 'daily' | 'project') {
    try {
      const { config } = await readServiceMailTemplates();
      setMailConfig(config);
      const next = applyMailTemplate(
        { ...initialReport(project, customerName, directory), kind },
        canonicalMailTemplate(config, kind, undefined, customerName),
        project.name,
      );
      setForm(next);
      baseline.current = JSON.stringify(next);
      setStage('edit');
      setError('');
      setChoosingKind(false);
      setOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '邮件模板读取失败。');
    }
  }
  const template = dailyReportTemplate(form.kind);
  let projectFiles: ReturnType<typeof resolveProjectReportFiles> = [];
  let fileIssue = '';
  try {
    projectFiles = resolveProjectReportFiles(project, form.relatedFiles ?? []);
  } catch (error) {
    fileIssue = error instanceof Error ? error.message : '相关文件无效。';
  }

  function close(next: boolean) {
    if (busy || lock.current) return;
    if (
      !next &&
      baseline.current !== JSON.stringify(form) &&
      !window.confirm(localize('日报尚未发送，确定放弃本次编辑？'))
    )
      return;
    setOpen(next);
    if (!next) confirmationFlow?.onClose();
  }
  async function send() {
    if (busy || lock.current || !canSend) return;
    const issue = dailyReportIssue(form) || fileIssue;
    if (issue) {
      setError(issue);
      setStage('edit');
      return;
    }
    lock.current = true;
    onBusy(true);
    setError('');
    try {
      const result = confirmationFlow
        ? await confirmationFlow.onSend(form)
        : await sendStoredProjectDailyReport(
            project.id,
            project.revision,
            actor,
            form,
          );
      onSaved(result);
      setOpen(false);
      confirmationFlow?.onClose();
      setNotice('日报已记录为本地发送，未投递外部邮箱。');
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '日报发送失败，请重试。',
      );
    } finally {
      lock.current = false;
      onBusy(false);
    }
  }
  function field(
    key: Exclude<
      keyof DailyReportInput,
      'kind' | 'projectDocument' | 'relatedFiles' | 'emailTemplate'
    >,
    label: string,
    required = false,
    placeholder?: string,
  ) {
    return (
      <label
        className="daily-report-field"
        key={key}
        htmlFor={`daily-report-${key}`}
      >
        <span>
          {localize(label)}
          {localize(required && <em> *</em>)}
        </span>
        <Input
          id={`daily-report-${key}`}
          value={form[key]}
          onChange={(event) => change(key, event.target.value)}
          required={required}
          maxLength={
            key === 'to' || key === 'cc' ? 13000 : key === 'subject' ? 200 : 500
          }
          placeholder={localize(placeholder)}
        />
      </label>
    );
  }
  if (confirmationFlow && !mailConfig)
    return (
      <Dialog
        open
        onOpenChange={(value) => {
          if (!value) confirmationFlow.onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{localize("发送报告并发起确认")}</DialogTitle>
          </DialogHeader>
          {localize(error ? (
            <p role="alert" className="sr-error">
              {localize(error)}
            </p>
          ) : (
            <output>{localize("正在读取邮件模板…")}</output>
          ))}
        </DialogContent>
      </Dialog>
    );
  return (
    <>
      {localize(!open && !choosingKind && error && (
        <p role="alert" className="sr-error">
          {localize(error)}
        </p>
      ))}
      {localize(!confirmationFlow && (
        <DailyReportsPanel
          reports={dailyReportHistory(
            project.dailyReports ?? [],
            project.id,
          )}
          confirmations={project.review?.confirmations}
          showCustomerVisibility={isInternal(actor.role)}
          notice={notice}
          action={
            <Button
              className="ct-button ct-button--primary"
              disabled={busy || !canSend}
              title={
                localize(!canSend
                  ? ['已完成', '已取消'].includes(project.status)
                    ? '项目已关闭'
                    : '仅本项目执行工程师可发送'
                  : undefined)
              }
              onClick={() => setChoosingKind(true)}
            >
              <Plus size={16} />
              {localize("写日报")}</Button>
          }
        />
      ))}
      <Dialog open={choosingKind} onOpenChange={setChoosingKind}>
        <DialogContent className="daily-report-kind-dialog">
          <DialogHeader>
            <DialogTitle>{localize("选择报告类型")}</DialogTitle>
          </DialogHeader>
          {localize(error && (
            <p role="alert" className="sr-error">
              {localize(error)}
            </p>
          ))}
          <div className="daily-report-kind-options">
            <Button
              className="daily-report-kind-option"
              variant="outline"
              disabled={busy || !canSend}
              onClick={() => compose('daily')}
            >
              <CalendarDays size={24} />
              <strong>{localize("每日工作日报")}</strong>
            </Button>
            <Button
              className="daily-report-kind-option"
              variant="outline"
              disabled={busy || !canSend}
              onClick={() => compose('project')}
            >
              <FileText size={24} />
              <strong>{localize("项目报告")}</strong>
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChoosingKind(false)}>
              {localize("取消")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={open} onOpenChange={close}>
        <DialogContent className="daily-report-dialog" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {localize(confirmationFlow
                ? stage === 'edit'
                  ? '发送报告并发起确认'
                  : '预览客户确认邮件'
                : stage === 'edit' ? localizeMessage('写{0}', [localize(template.title)]) : localizeMessage('预览{0}', [localize(template.title)]))}
            </DialogTitle>
          </DialogHeader>
          <div
            className={`daily-report-compose${stage === 'confirm' ? ' is-confirm' : ''}`}
          >
            {localize(stage === 'edit' && (
              <fieldset
                disabled={busy || !mailConfig}
                className="daily-report-form"
              >
                <section>
                  <h3>
                    <Mail size={16} />
                    {localize("邮件信息")}</h3>
                  {localize(field('subject', '邮件主题', true))}
                  <DailyReportRecipientField
                    id="daily-report-to"
                    label={localize("收件人")}
                    required
                    value={form.to}
                    onChange={(value) => change('to', value)}
                    recipients={recipients}
                    defaultGroup="customer"
                    disabled={busy}
                  />
                  <DailyReportRecipientField
                    id="daily-report-cc"
                    label={localize("抄送")}
                    value={form.cc}
                    onChange={(value) => change('cc', value)}
                    recipients={recipients}
                    defaultGroup="internal"
                    disabled={busy}
                  />
                  {localize(field('greeting', '客户称呼', true))}
                </section>
                <>
                  <section>
                    <h3>
                      <CalendarDays size={16} />
                      {localize("实施信息")}</h3>
                    <div className="daily-report-fields">
                      <DateField
                        id="daily-report-date"
                        label={localize(template.dateLabel)}
                        required
                        value={form.date}
                        onChange={(value) => change('date', value)}
                        disabled={busy}
                      />
                      <div className="daily-report-field">
                        <span>{localize("服务项目编号")}</span>
                        <a
                          className="daily-report-project-link"
                          href={dailyReportProjectUrl(project.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {localize(project.id)}
                        </a>
                      </div>
                      {localize(field('customerEngineers', '客户技术人员', true))}
                      {localize(field('projectManager', '项目经理'))}
                      {localize(field('engineers', '实施工程师', true))}
                      <div />
                      <TimeField
                        id="daily-report-start"
                        label={localize("开始时间")}
                        required
                        value={form.startTime}
                        onChange={(value) => change('startTime', value)}
                        disabled={busy}
                      />
                      <TimeField
                        id="daily-report-end"
                        label={localize("结束时间")}
                        required
                        value={form.endTime}
                        onChange={(value) => change('endTime', value)}
                        disabled={busy}
                      />
                    </div>
                  </section>
                  <section>
                    <h3>
                      <FileText size={16} />
                      {localize(template.contentTitle)}
                    </h3>
                    <label
                      className="daily-report-field"
                      htmlFor="daily-report-work"
                    >
                      <span>
                        {localize(template.workLabel)} <em>*</em>
                      </span>
                      <Textarea
                        id="daily-report-work"
                        value={form.workContent}
                        onChange={(event) =>
                          change('workContent', event.target.value)
                        }
                        rows={5}
                        maxLength={10000}
                        placeholder={localize(template.workPlaceholder)}
                        required
                      />
                    </label>
                    {localize(!confirmationFlow && (
                      <label
                        className="daily-report-field"
                        htmlFor="daily-report-plan"
                      >
                        <span>
                          {localize("后续安排")}<em>*</em>
                        </span>
                        <Textarea
                          id="daily-report-plan"
                          value={form.nextPlan}
                          onChange={(event) =>
                            change('nextPlan', event.target.value)
                          }
                          rows={4}
                          maxLength={10000}
                          placeholder={localize("逐行填写后续计划")}
                          required
                        />
                      </label>
                    ))}
                  </section>
                  <section className="daily-report-related-files">
                    <h3>
                      <Paperclip size={16} />
                      {localize("相关文件")}</h3>
                    <ProjectReportFilePicker
                      items={projectDeliverables(project)}
                      selections={form.relatedFiles ?? []}
                      disabled={busy}
                      onChange={(relatedFiles) => {
                        setForm((current) => ({ ...current, relatedFiles }));
                        setError('');
                      }}
                    />
                    {localize(fileIssue && (
                      <p className="sr-error" role="alert">
                        {localize(fileIssue)}
                      </p>
                    ))}
                  </section>
                </>
              </fieldset>
            ))}
            <div className="daily-report-live-preview">
              <div className="daily-report-preview-label">
                {localize(stage === 'edit' ? '邮件预览' : form.subject)}
              </div>
              {localize(stage === 'confirm' && (
                <div className="daily-report-confirm-recipients">
                  <p>
                    <strong>{localize("收件人")}</strong>
                    {localize(form.to)}
                  </p>
                  {localize(form.cc && (
                    <p>
                      <strong>{localize("抄送")}</strong>
                      {localize(form.cc)}
                    </p>
                  ))}
                  <span className="daily-report-status">{localize("本地发送")}</span>
                </div>
              ))}
              <ReportPreview
                report={{
                  ...form,
                  projectFiles,
                  projectId: project.id,
                  ...(confirmationFlow
                    ? {
                        confirmation: {
                          id: '',
                          notice: reportMailText(form, project.name)
                            .confirmationNotice,
                        },
                      }
                    : {}),
                }}
                projectName={project.name}
              />
            </div>
          </div>
          {localize(error && (
            <p role="alert" className="sr-error">
              {localize(error)}
            </p>
          ))}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                stage === 'confirm' ? setStage('edit') : close(false)
              }
            >
              {localize(stage === 'confirm' && <ArrowLeft size={14} />)}
              {localize(stage === 'confirm' ? '返回编辑' : '取消')}
            </Button>
            {localize(stage === 'edit' ? (
              <Button
                className="ct-button ct-button--primary"
                disabled={busy || !canSend}
                onClick={() => {
                  const issue = dailyReportIssue(form) || fileIssue;
                  if (issue) {
                    setError(issue);
                    return;
                  }
                  setError('');
                  const to = dailyReportEmails(form.to);
                  setForm((current) => ({
                    ...current,
                    to: to.join('; '),
                    cc: dailyReportEmails(current.cc)
                      .filter((email) => !to.includes(email))
                      .join('; '),
                  }));
                  setStage('confirm');
                }}
              >
                <Eye size={15} />
                {localize("预览")}</Button>
            ) : (
              <Button
                className="ct-button ct-button--primary"
                disabled={busy || !canSend}
                onClick={() => void send()}
              >
                <Send size={15} />
                {localize(busy
                  ? '正在发送…'
                  : confirmationFlow
                    ? '发送并发起确认（本地）'
                    : '确认发送（本地）')}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
