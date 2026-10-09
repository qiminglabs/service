'use client';
import { useI18n } from '@/lib/i18n/context';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import {
  readReportTemplateData,
  saveReportTemplates,
} from '@/lib/report-template-store';
import {
  orderReportFields,
  projectReportFields,
  parseReportTemplate,
  parseReportLibrary,
  reportFields,
  reportText,
  type ReportField,
  type ReportNode,
  type ReportTemplate,
} from '@/lib/report-templates';
import { ReportTemplatePreview } from '@/components/report-template-preview';
import { ReportFieldSettings } from '@/components/report-field-settings';
import {
  localizeReportTemplate,
  reportTemplateSteps,
  validateFlowReportTemplates,
  validateProjectReportTemplate,
} from '@/lib/flow-report-templates';
import { stepFieldOptions } from '@/lib/report-templates';
import type { ServiceFlow } from '@/lib/service-flows';
import type { OperationActor } from '@/lib/request-operations';
const LocalDocumentEditor = lazy(() =>
  import('@/components/local-document-editor').then((module) => ({
    default: module.LocalDocumentEditor,
  })),
);

export function ReportTemplateSettings({
  actor,
  flow,
  readonly = false,
  onTemplatesChange,
  onViewStep,
}: {
  actor: OperationActor;
  flow?: ServiceFlow;
  readonly?: boolean;
  onTemplatesChange?: (templates: ReportTemplate[]) => void;
  onViewStep?: (stepId: string) => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const [data, setData] =
    useState<Awaited<ReturnType<typeof readReportTemplateData>>>();
  const [draft, setDraft] = useState<ReportTemplate>();
  const [query, setQuery] = useState('');
  const [blockedTemplate, setBlockedTemplate] = useState<ReportTemplate>();
  const templateKind = flow ? '工单文档模板' : '项目报告模板';
  const [fieldSettings, setFieldSettings] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [preview, setPreview] = useState(false);
  const [baseline, setBaseline] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    void readReportTemplateData()
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const editable = !readonly && canManageRouting(actor),
    dirty = !!draft && baseline !== JSON.stringify(draft);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const options: (ReportField & { group: string })[] = [
    ...(data?.projectFields ?? []).map((f) => ({
      id: `p:${f.id}`,
      label: f.name,
      scope: 'project' as const,
      fieldId: projectReportFields.some(([id]) => id === f.id)
        ? f.id
        : `custom:${f.id}`,
      group: '服务项目',
    })),
    ...(flow ? orderReportFields : []).map(([id, label]) => ({
      id: `o:${id}`,
      label,
      scope: 'order' as const,
      fieldId: id,
      group: '工单基本信息',
    })),
    ...(flow ? (data?.orderFields ?? []) : []).map((f) => ({
      id: `i:${f.id}`,
      label: f.name,
      scope: 'order' as const,
      fieldId: `item:${f.id}`,
      group: '工单服务字段',
    })),
    ...stepFieldOptions(flow?.steps ?? []).map((source) => ({
      id: `s:${source.stepId}:${source.fieldId}`,
      label: source.label,
      scope: 'step' as const,
      fieldId: source.fieldId,
      stepId: source.stepId,
      formId: source.formId,
      group: `流程步骤 · ${flow?.steps.find((step) => step.id === source.stepId)?.name}`,
    })),
  ];
  const templates =
    flow?.reportTemplates ??
    data?.library.templates.filter((t) => t.scope === 'project') ??
    [];
  const matches = templates.filter((t) => t.name.includes(query));
  function toggleTemplate(t: ReportTemplate) {
    setError('');
    setNotice('');
    if (flow && t.enabled && reportTemplateSteps(flow, t.id).length) {
      setBlockedTemplate(t);
      return;
    }
    void save({ ...t, enabled: !t.enabled }, false);
  }
  function open(t: ReportTemplate) {
    setDraft(structuredClone(t));
    setBaseline(JSON.stringify(t));
    setError('');
    setPreview(false);
    setFieldSettings(false);
  }
  function close() {
    if (busy) return;
    if (dirty && !window.confirm(localize('模板尚未保存，确定放弃修改？'))) return;
    setDraft(undefined);
    setError('');
    void readReportTemplateData()
      .then(setData)
      .catch((e) => setError(e.message));
  }
  async function save(input: ReportTemplate, closeEditor = true) {
    if (!data || busy || lock.current || !editable) return;
    setError('');
    try {
      const checked = parseReportTemplate(input);
      if (flow) {
        const old = templates.find((t) => t.id === checked.id);
        const next = {
          ...checked,
          scope: 'step' as const,
          flowId: flow.id,
          version: old
            ? JSON.stringify(old) === JSON.stringify(checked)
              ? old.version
              : old.version + 1
            : 1,
          updatedAt: new Date().toISOString(),
        };
        const updated = old
          ? templates.map((t) => (t.id === next.id ? next : t))
          : [...templates, next];
        parseReportLibrary({ revision: 0, templates: updated });
        validateFlowReportTemplates({
          ...flow,
          reportTemplates: [next],
          steps: flow.steps.map((step) => ({
            ...step,
            documents: step.documents?.map((doc) => ({
              ...doc,
              reportTemplate: undefined,
            })),
          })),
        });
        onTemplatesChange?.(updated);
        if (closeEditor) setDraft(undefined);
        setNotice(
          closeEditor
            ? '模板已更新，保存流程后生效。'
            : `模板已${checked.enabled ? '启用' : '停用'}，保存流程后生效。`,
        );
        return;
      }
      validateProjectReportTemplate(checked);
      lock.current = true;
      setBusy(true);
      const nextGlobalTemplates = data.library.templates.some(
        (t) => t.id === input.id,
      )
        ? data.library.templates.map((t) => (t.id === input.id ? checked : t))
        : [...data.library.templates, checked];
      const library = await saveReportTemplates(
        { ...data.library, templates: nextGlobalTemplates },
        actor,
      );
      setData({ ...data, library });
      if (closeEditor) setDraft(undefined);
      setNotice(
        closeEditor
          ? `${templateKind}已保存。`
          : `模板已${checked.enabled ? '启用' : '停用'}。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="report-template-settings execution-form-settings"
      aria-label={localize(templateKind)}
    >
      <div className="submission-rules-toolbar">
        <Input
          className="execution-form-search"
          aria-label={localizeMessage("搜索{0}", [localize(templateKind)])}
          placeholder={localize("搜索模板名称")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="approval-toolbar-actions">
          {localize(flow &&
            data?.library.templates.some(
              (t) =>
                t.scope === 'step' ||
                reportFields(t.body).some((f) => f.scope !== 'project'),
            ) && (
              <NativeSelect
                aria-label={localize("从已有模板创建")}
                value=""
                disabled={!editable}
                onChange={(event) => {
                  const source = data.library.templates.find(
                    (t) => t.id === event.target.value,
                  );
                  if (source)
                    open({
                      ...localizeReportTemplate(source, flow),
                      id: crypto.randomUUID(),
                      name: `${source.name.slice(0, 100)}（导入）`,
                      version: 1,
                    });
                }}
              >
                <option value="">{localize("从已有模板创建")}</option>
                {localize(data.library.templates
                  .filter(
                    (t) =>
                      t.scope === 'step' ||
                      reportFields(t.body).some((f) => f.scope !== 'project'),
                  )
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {localize(t.name)}
                    </option>
                  )))}
              </NativeSelect>
            ))}
          <Button
            disabled={!editable || !data}
            onClick={() =>
              open({
                id: crypto.randomUUID(),
                name: '',
                scope: flow ? 'step' : 'project',
                ...(flow ? { flowId: flow.id } : {}),
                version: 1,
                enabled: true,
                body: { type: 'doc', content: [{ type: 'paragraph' }] },
              })
            }
          >
            <Plus size={16} />
            {localize("新建模板")}</Button>
        </div>
      </div>
      {localize(notice && <output className="sr-notice">{localize(notice)}</output>)}
      {localize(!draft && error && (
        <p className="sr-error" role="alert">
          {localize(error)}
        </p>
      ))}
      <div className="table-scroll">
        <table className="reference-table app-list-table report-template-table">
          <thead>
            <tr>
              <th>{localize("模板名称")}</th>
              <th>{localize("适用范围")}</th>
              <th>{localize("状态")}</th>
              <th>{localize(flow ? '引用步骤' : '引用字段')}</th>
              <th>{localize("版本")}</th>
              <th>{localize("修改时间")}</th>
              <th data-list-actions>{localize("操作")}</th>
            </tr>
          </thead>
          <tbody>
            {localize(matches.map((t) => (
              <tr key={t.id}>
                <td>{localize(t.name)}</td>
                <td>{localize(t.scope === 'project' ? '项目报告' : '工单文档')}</td>
                <td>
                  <span
                    className="sr-badge"
                    data-tone={t.enabled ? 'green' : 'muted'}
                  >
                    {localize(t.enabled ? '启用' : '停用')}
                  </span>
                </td>
                <td>
                  {localize(flow ? (
                    <div className="report-template-step-links">
                      {localize(reportTemplateSteps(flow, t.id).length ? (
                        reportTemplateSteps(flow, t.id).map((step) =>
                          onViewStep ? (
                            <button
                              type="button"
                              key={step.id}
                              onClick={() => onViewStep(step.id)}
                            >
                              {localize(step.name)}
                            </button>
                          ) : (
                            <span key={step.id}>{localize(step.name)}</span>
                          ),
                        )
                      ) : (
                        <span className="sr-help">{localize("未被引用")}</span>
                      ))}
                    </div>
                  ) : (
                    reportFields(t.body).length
                  ))}
                </td>
                <td>v{localize(t.version)}</td>
                <td>
                  {localize(t.updatedAt
                    ? new Date(t.updatedAt).toLocaleString('zh-CN', {
                        hour12: false,
                      })
                    : '—')}
                </td>
                <td>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => open(t)}
                  >
                    {localize(editable ? '编辑模板' : '查看模板')}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!editable || busy}
                    onClick={() =>
                      open({
                        ...structuredClone(t),
                        id: crypto.randomUUID(),
                        name: `${t.name}（副本）`,
                        version: 1,
                      })
                    }
                  >
                    {localize("复制")}</Button>
                  {localize(editable && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => toggleTemplate(t)}
                    >
                      {localize(t.enabled ? '停用' : '启用')}
                    </Button>
                  ))}
                </td>
              </tr>
            )))}
            {localize((!data || !matches.length) && (
              <tr>
                <td colSpan={7} className="routing-empty">
                  {localize(data
                    ? '暂无匹配的模板'
                    : error
                      ? '模板读取失败'
                      : '正在读取模板…')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {localize(blockedTemplate && flow && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setBlockedTemplate(undefined);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{localize("模板正在使用")}</DialogTitle>
              <DialogDescription>
                {localize("模板「")}{localize(blockedTemplate.name)}
                {localize("」被以下步骤引用，请先替换或解除绑定后再停用。")}</DialogDescription>
            </DialogHeader>
            <div className="report-template-step-links">
              {localize(reportTemplateSteps(flow, blockedTemplate.id).map((step) =>
                onViewStep ? (
                  <button
                    type="button"
                    key={step.id}
                    onClick={() => {
                      setBlockedTemplate(undefined);
                      onViewStep(step.id);
                    }}
                  >
                    {localize(step.name)}
                  </button>
                ) : (
                  <span key={step.id}>{localize(step.name)}</span>
                ),
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setBlockedTemplate(undefined)}
              >
                {localize("关闭")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}
      {localize(draft && (
        <Dialog
          open
          onOpenChange={(value) => {
            if (!value) close();
          }}
        >
          <DialogContent
            className="report-template-dialog"
            showCloseButton={false}
          >
            <DialogHeader>
              <DialogTitle>{localize(draft.name || localizeMessage("新建{0}", [String(localize(templateKind))]))} </DialogTitle>
            </DialogHeader>
            <div className="report-template-config">
              {localize(preview ? (
                <div className="report-template-preview-scope">
                  <span>{localize("适用范围")}</span>
                  <strong>{localize(flow ? flow.name : '通用项目报告')}</strong>
                </div>
              ) : (
                <label htmlFor="report-template-scope">
                  {localize("适用范围")}<Input
                    id="report-template-scope"
                    readOnly
                    value={flow ? flow.name : '通用项目报告'}
                  />
                </label>
              ))}
              {localize(!preview && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setFieldSettings((v) => !v);
                    setPreview(false);
                  }}
                >
                  {localize(fieldSettings
                    ? '返回正文'
                    : localizeMessage("引用字段（{0}）", [String(localize(reportFields(draft.body).length))]))}
                </Button>
              ))}
              <Button
                variant="outline"
                disabled={fieldSettings}
                onClick={() => setPreview((v) => !v)}
              >
                {localize(preview ? '返回编辑' : flow ? '预览工单' : '预览报告')}
              </Button>
            </div>
            <div className="report-editor-host">
              {localize(fieldSettings ? (
                <ReportFieldSettings
                  template={draft}
                  options={options}
                  disabled={!editable || busy}
                  onChange={setDraft}
                />
              ) : preview ? (
                <ReportTemplatePreview
                  actor={actor}
                  template={draft}
                  flowId={flow?.id}
                  customers={data?.customers ?? []}
                />
              ) : (
                <Suspense fallback={<p className="sr-help">{localize("正在打开编辑器…")}</p>}>
                  <LocalDocumentEditor
                    key={draft.id}
                    value={{
                      title: draft.name,
                      content: reportText(draft.body),
                      richText: draft.body as Record<string, unknown>,
                      source: 'template',
                    }}
                    readonly={!editable || preview}
                    busy={busy}
                    dirty={dirty}
                    fieldOptions={options}
                    onChange={(doc) =>
                      setDraft({
                        ...draft,
                        name: doc.title,
                        body: doc.richText as ReportNode,
                      })
                    }
                    onBack={close}
                  />
                </Suspense>
              ))}
            </div>
            {localize(error && (
              <p className="sr-error" role="alert">
                {localize(error)}
              </p>
            ))}
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={close}>
                {localize("关闭")}</Button>
              {localize(editable && !preview && (
                <Button disabled={busy} onClick={() => void save(draft)}>
                  {localize("保存模板")}</Button>
              ))}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ))}
    </section>
  );
}
