'use client';
import { useEffect, useRef, useState } from 'react';
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
import { ReportPreview } from '@/components/project-daily-report-history';
import {
  applyMailTemplate,
  reportMailText,
  type DailyReportInput,
} from '@/lib/service-project-daily-reports';
import { canManageRouting } from '@/lib/assessment-routing-store';
import {
  readServiceMailTemplates,
  saveServiceMailTemplate,
  type ServiceMailTemplateData,
} from '@/lib/service-mail-template-store';
import {
  defaultMailTemplate,
  mailTemplateFields,
  mailTemplateVariables,
  mailTemplateNames,
  mailTemplateUses,
  mailTemplateIssue,
  MailTemplateConflict,
  type ServiceMailTemplate,
  type MailTemplateField,
} from '@/lib/service-mail-templates';
import type { OperationActor } from '@/lib/request-operations';

function sampleReport(template: ServiceMailTemplate) {
  const base: DailyReportInput = {
    kind: template.id === 'daily' ? 'daily' : 'project',
    date: '2026-09-20',
    subject: '',
    to: 'customer@example.com',
    cc: 'engineer@example.com',
    greeting: '',
    customerEngineers: '客户技术人员',
    projectManager: '项目经理',
    engineers: '执行工程师',
    startTime: '09:00',
    endTime: '18:00',
    serviceNumber: 'SP-DEMO-001',
    workContent: '',
    nextPlan: '',
  };
  const report = applyMailTemplate(
    base,
    { ...template, customerName: '示例客户' },
    '示例服务项目',
  );
  return {
    ...report,
    ...(template.id === 'review'
      ? {
          confirmation: {
            id: '',
            notice: reportMailText(report, '示例服务项目').confirmationNotice,
          },
        }
      : {}),
  };
}
export function ServiceMailTemplateSettings({
  actor,
}: {
  actor: OperationActor;
}) {
  const [data, setData] = useState<ServiceMailTemplateData>();
  const [draft, setDraft] = useState<ServiceMailTemplate | null>(null);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [error, setError] = useState(''),
    [formError, setFormError] = useState(''),
    [notice, setNotice] = useState(''),
    [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false),
    baseline = useRef('');
  const selection = useRef<{
    key: MailTemplateField;
    start: number;
    end: number;
  }>({ key: 'subject', start: 0, end: 0 });
  const controls = useRef<
    Partial<Record<MailTemplateField, HTMLInputElement | HTMLTextAreaElement>>
  >({});
  useEffect(() => {
    let active = true;
    void readServiceMailTemplates()
      .then((value) => {
        if (active) setData(value);
      })
      .catch((cause) => {
        if (active)
          setError(cause instanceof Error ? cause.message : '模板读取失败。');
      });
    return () => {
      active = false;
    };
  }, []);
  const allowed =
    canManageRouting(actor) &&
    !!data?.users.some(
      (user) => user.id === actor.id && user.status === '启用',
    );
  const report = draft ? sampleReport(draft) : null;
  function open(template: ServiceMailTemplate, preview: boolean) {
    setDraft(structuredClone(template));
    baseline.current = JSON.stringify(template);
    setPreviewOnly(preview);
    setFormError('');
    selection.current = {
      key: 'subject',
      start: template.subject.length,
      end: template.subject.length,
    };
  }
  function close() {
    if (
      busy ||
      (!previewOnly &&
        draft &&
        JSON.stringify(draft) !== baseline.current &&
        !window.confirm('模板尚未保存，确定放弃修改？'))
    )
      return;
    setDraft(null);
  }
  function insert(variable: string) {
    if (!draft) return;
    const { key, start, end } = selection.current,
      token = `{{${variable}}}`;
    setDraft({
      ...draft,
      [key]: draft[key].slice(0, start) + token + draft[key].slice(end),
    });
    const position = start + token.length;
    selection.current = { key, start: position, end: position };
    requestAnimationFrame(() => {
      controls.current[key]?.focus();
      controls.current[key]?.setSelectionRange(position, position);
    });
  }
  async function save() {
    if (!draft || !data || lock.current || !allowed) return;
    const issue = mailTemplateIssue(draft);
    if (issue) {
      setFormError(issue);
      return;
    }
    lock.current = true;
    setBusy(true);
    setFormError('');
    try {
      const saved = await saveServiceMailTemplate(
        draft,
        data.config.revision,
        actor,
      );
      setData(saved);
      setDraft(null);
      setNotice(`已保存${mailTemplateNames[draft.id]}`);
    } catch (cause) {
      if (cause instanceof MailTemplateConflict) {
        try {
          setData(await readServiceMailTemplates());
          setDraft(null);
          setError(cause.message);
        } catch {
          setFormError('配置已变更，读取失败，请重新进入该页签。');
        }
      } else
        setFormError(cause instanceof Error ? cause.message : '保存失败。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="service-mail-settings">
      <div className="submission-rules-toolbar">
        <Input
          aria-label="搜索邮件模板"
          placeholder="搜索模板名称"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <output className="provider-settings-feedback">{notice}</output>
      )}
      <div className="table-scroll">
        <table className="reference-table app-list-table">
          <thead>
            <tr>
              <th>模板名称</th>
              <th>使用场景</th>
              <th>版本</th>
              <th>修改时间</th>
              <th>修改人</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {data?.config.templates
              .filter((template) =>
                mailTemplateNames[template.id].includes(search.trim()),
              )
              .map((template) => (
                <tr key={template.id}>
                  <td>
                    <strong>{mailTemplateNames[template.id]}</strong>
                  </td>
                  <td>{mailTemplateUses[template.id]}</td>
                  <td>v{template.version}</td>
                  <td>
                    {template.updatedAt
                      ? new Date(template.updatedAt).toLocaleString('zh-CN', {
                          hour12: false,
                        })
                      : '—'}
                  </td>
                  <td>{template.updatedBy}</td>
                  <td>
                    <div className="service-mail-actions">
                      <Button
                        variant="ghost"
                        aria-label={`编辑${mailTemplateNames[template.id]}`}
                        disabled={!allowed}
                        onClick={() => open(template, false)}
                      >
                        编辑模板
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={`预览${mailTemplateNames[template.id]}`}
                        onClick={() => open(template, true)}
                      >
                        预览
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            {(!data ||
              !data.config.templates.some((template) =>
                mailTemplateNames[template.id].includes(search.trim()),
              )) && (
              <tr>
                <td colSpan={6} className="routing-empty">
                  {data
                    ? '无匹配模板'
                    : error
                      ? '模板读取失败'
                      : '正在读取模板…'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Dialog
        open={!!draft}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          className={`service-mail-template-dialog${previewOnly ? ' is-preview' : ''}`}
          showCloseButton={!busy}
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>
              {previewOnly ? '预览' : '编辑'}
              {draft && mailTemplateNames[draft.id]}
            </DialogTitle>
          </DialogHeader>
          {draft && report && (
            <div className="service-mail-template-layout">
              {!previewOnly && (
                <div className="service-mail-template-fields">
                  <div className="service-mail-variables">
                    <span>插入字段</span>
                    {mailTemplateVariables.map((variable) => (
                      <Button
                        type="button"
                        key={variable}
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => insert(variable)}
                      >
                        {variable}
                      </Button>
                    ))}
                  </div>
                  {mailTemplateFields
                    .filter(
                      (field) =>
                        (field.key !== 'confirmationNotice' ||
                          draft.id === 'review') &&
                        (field.key !== 'nextPlan' || draft.id !== 'review'),
                    )
                    .map((field) => {
                      const singleLine =
                        field.key === 'subject' || field.key === 'greeting';
                      const props = {
                        id: `mail-template-${field.key}`,
                        value: draft[field.key],
                        disabled: busy,
                        maxLength: field.max,
                        required: field.required,
                        onChange: (
                          event: React.ChangeEvent<
                            HTMLInputElement | HTMLTextAreaElement
                          >,
                        ) => {
                          setDraft({
                            ...draft,
                            [field.key]: event.target.value,
                          });
                          setFormError('');
                        },
                        onSelect: (
                          event: React.SyntheticEvent<
                            HTMLInputElement | HTMLTextAreaElement
                          >,
                        ) => {
                          selection.current = {
                            key: field.key,
                            start: event.currentTarget.selectionStart ?? 0,
                            end: event.currentTarget.selectionEnd ?? 0,
                          };
                        },
                      };
                      return (
                        <label
                          className="sr-ops-field"
                          key={field.key}
                          htmlFor={props.id}
                        >
                          <span>
                            {field.label}
                            {field.required && <em> *</em>}
                          </span>
                          {singleLine ? (
                            <Input
                              {...props}
                              ref={(node) => {
                                if (node) controls.current[field.key] = node;
                              }}
                            />
                          ) : (
                            <Textarea
                              {...props}
                              rows={
                                field.key === 'workContent' ||
                                field.key === 'nextPlan'
                                  ? 4
                                  : 3
                              }
                              ref={(node) => {
                                if (node) controls.current[field.key] = node;
                              }}
                            />
                          )}
                        </label>
                      );
                    })}
                </div>
              )}
              <div className="service-mail-template-preview">
                <h3>邮件预览 · 示例数据</h3>
                <p className="service-mail-preview-subject">
                  <strong>主题：</strong>
                  {report.subject}
                </p>
                <ReportPreview report={report} projectName="示例服务项目" />
              </div>
            </div>
          )}
          {formError && (
            <p className="sr-error" role="alert">
              {formError}
            </p>
          )}
          <DialogFooter>
            {!previewOnly && draft && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  const initial = defaultMailTemplate(draft.id);
                  setDraft({
                    ...initial,
                    version: draft.version,
                    updatedAt: draft.updatedAt,
                    updatedBy: draft.updatedBy,
                  });
                  setFormError('');
                }}
              >
                恢复默认
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={close}>
              {previewOnly ? '关闭' : '取消'}
            </Button>
            {!previewOnly && (
              <Button disabled={busy || !allowed} onClick={() => void save()}>
                {busy ? '保存中…' : '保存模板'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
