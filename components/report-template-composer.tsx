'use client';
import { useI18n } from '@/lib/i18n/context';

import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { ReportBody } from '@/components/report-body';
import { ReportSourceBindings } from '@/components/report-source-bindings';
import { readReportTemplateData } from '@/lib/report-template-store';
import { onlineMaterialFile } from '@/lib/online-material';
import {
  defaultReportBindings,
  renderReport,
  reportFields,
  type ReportTemplate,
  type ReportBindings,
  type ReportTemplateSelection,
} from '@/lib/report-templates';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { StoredFile } from '@/lib/service-requests';
import { projectDeliverables } from '@/lib/service-project-deliverables';
import {
  resolveProjectReportFiles,
  type ProjectReportFile,
  type ProjectReportFileSelection,
} from '@/lib/project-report-files';
import {
  ProjectReportFilePicker,
  ProjectReportFilesSection,
} from '@/components/project-report-files';
const LocalDocumentEditor = lazy(() =>
  import('@/components/local-document-editor').then((module) => ({
    default: module.LocalDocumentEditor,
  })),
);

type OnlineDocument = NonNullable<StoredFile['onlineDocument']>;
export function ReportTemplateComposer({
  project,
  customerName,
  selection,
  fixedOrderId,
  onClose,
  onSave,
  allowVisibility = false,
  initialDocument,
  saveLabel,
}: {
  project: ServiceProjectRecord;
  customerName: string;
  selection?: ReportTemplateSelection;
  fixedOrderId?: string;
  onClose: () => void;
  onSave: (file: StoredFile, customerVisible: boolean) => Promise<void> | void;
  allowVisibility?: boolean;
  initialDocument?: OnlineDocument;
  saveLabel?: string;
}) {
  const { localize, localizeList, localizeMessage } = useI18n();
  const [templates, setTemplates] = useState<ReportTemplate[]>(
      selection ? [selection.template] : [],
    ),
    [templateId, setTemplateId] = useState(
      selection?.template.id ??
        initialDocument?.reportSource?.template.id ??
        '',
    );
  const [orderId, setOrderId] = useState(fixedOrderId ?? ''),
    [bindings, setBindings] = useState<ReportBindings>(
      selection?.bindings ?? {},
    );
  const [document, setDocument] = useState<OnlineDocument | undefined>(
      initialDocument,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [customerVisible, setCustomerVisible] = useState(true),
    [loading, setLoading] = useState(!selection);
  const baseline = useRef(
      initialDocument ? JSON.stringify(initialDocument) : '',
    ),
    lock = useRef(false);
  const [fileSelections, setFileSelections] = useState<
    ProjectReportFileSelection[]
  >(initialDocument?.reportSource?.projectFiles ?? []);
  const [pickingFiles, setPickingFiles] = useState(false);
  const isProjectReport = !selection;
  const deliverables = isProjectReport ? projectDeliverables(project) : [];
  let projectFiles: ProjectReportFile[] = [];
  let fileIssue = '';
  if (isProjectReport) {
    try {
      projectFiles = resolveProjectReportFiles(project, fileSelections);
    } catch (issue) {
      fileIssue = issue instanceof Error ? issue.message : '项目文件无效。';
    }
  }
  useEffect(() => {
    if (selection) return;
    let active = true;
    void readReportTemplateData()
      .then((data) => {
        if (!active) return;
        const list = data.library.templates.filter(
          (t) =>
            t.scope === 'project' &&
            t.enabled &&
            reportFields(t.body).every((f) => f.scope === 'project'),
        );
        setTemplates(list);
        setTemplateId((current) =>
          list.some((t) => t.id === current) ? current : (list[0]?.id ?? ''),
        );
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selection]);
  const template = templates.find((t) => t.id === templateId),
    orders = project.workOrders?.filter((o) => o.status !== '已取消') ?? [],
    order = orders.find((o) => o.id === orderId);
  const needsOrder =
    template && reportFields(template.body).some((f) => f.scope !== 'project');
  const resolved = template
    ? renderReport(template, { project, orderId, customerName }, bindings)
    : undefined;
  const dirty = !!document || fileSelections.length > 0;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function close() {
    if (busy) return;
    if (dirty && !window.confirm(localize('报告尚未保存，确定放弃本次编辑？'))) return;
    onClose();
  }
  function configure() {
    if (busy) return;
    if (
      document &&
      JSON.stringify(document) !== baseline.current &&
      !window.confirm(localize('返回配置将重新生成正文，确定继续？'))
    )
      return;
    setDocument(undefined);
    setError('');
  }
  function generate() {
    if (!resolved || resolved.missing.length || !template) return;
    const doc: OnlineDocument = {
      title: `${project.name} · ${template.name}`,
      source: 'template',
      content: resolved.content,
      richText: resolved.body as Record<string, unknown>,
      reportSource: resolved.source,
    };
    baseline.current = JSON.stringify(doc);
    setDocument(doc);
    setError('');
  }
  async function save() {
    if (!document || busy || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (fileIssue) throw new Error(fileIssue);
      const output = isProjectReport
        ? {
            ...document,
            reportSource: {
              ...document.reportSource!,
              projectFiles: structuredClone(fileSelections),
            },
          }
        : document;
      await onSave(onlineMaterialFile(output), customerVisible);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '报告保存失败。');
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => {
        if (!v) close();
      }}
    >
      <DialogContent className="report-template-dialog" showCloseButton={false}>
        <DialogHeader className="report-compose-heading">
          <DialogTitle>
            {localize(pickingFiles
              ? '项目文件'
              : document
                ? '编辑报告'
                : '从模板创建报告')}
          </DialogTitle>
          {localize(isProjectReport && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setPickingFiles((value) => !value)}
            >
              {localize(pickingFiles
                ? '返回报告'
                : localizeMessage("项目文件（{0}）", [String(localize(fileSelections.length))]))}
            </Button>
          ))}
        </DialogHeader>
        {localize(pickingFiles ? (
          <ProjectReportFilePicker
            items={deliverables}
            selections={fileSelections}
            disabled={busy}
            onChange={setFileSelections}
          />
        ) : document ? (
          <div className="report-editor-with-files">
            <div className="report-editor-host">
              <Suspense fallback={<p className="sr-help">{localize("正在打开编辑器…")}</p>}>
                <LocalDocumentEditor
                  value={document}
                  readonly={false}
                  busy={busy}
                  dirty
                  onChange={setDocument}
                  onBack={configure}
                />
              </Suspense>
            </div>
            {localize(isProjectReport && projectFiles.length > 0 && (
              <aside className="report-edit-files">
                <ProjectReportFilesSection files={projectFiles} />
              </aside>
            ))}
          </div>
        ) : (
          <div className="report-compose-layout">
            <aside className="report-compose-fields">
              <label className="approval-field">
                <span>{localize("报告模板")}</span>
                <NativeSelect
                  aria-label={localize("报告模板")}
                  disabled={!!selection || loading}
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    const t = templates.find((t) => t.id === e.target.value);
                    setBindings(
                      t && order
                        ? defaultReportBindings(
                            t,
                            order.steps.map((s) => s.definition),
                          )
                        : {},
                    );
                  }}
                >
                  <option value="">
                    {localize(loading ? '正在读取模板…' : '请选择报告模板')}
                  </option>
                  {localize(templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {localize(t.name)} · v{localize(t.version)}
                    </option>
                  )))}
                </NativeSelect>
              </label>
              {localize(!loading && !templates.length && (
                <p className="sr-help">{localize("暂无启用的项目报告模板")}</p>
              ))}
              {localize(needsOrder && (
                <label className="approval-field">
                  <span>{localize("来源工单")}</span>
                  <NativeSelect
                    aria-label={localize("报告来源工单")}
                    disabled={!!fixedOrderId}
                    value={orderId}
                    onChange={(e) => {
                      setOrderId(e.target.value);
                      const next = orders.find((o) => o.id === e.target.value);
                      setBindings(
                        template && next
                          ? defaultReportBindings(
                              template,
                              next.steps.map((s) => s.definition),
                            )
                          : {},
                      );
                    }}
                  >
                    <option value="">{localize("请选择来源工单")}</option>
                    {localize(orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {localize(o.id)} · {localize(o.item.serviceName)}
                      </option>
                    )))}
                  </NativeSelect>
                </label>
              ))}
              {localize(template && !selection && (
                <ReportSourceBindings
                  template={template}
                  steps={order?.steps.map((s) => s.definition) ?? []}
                  bindings={bindings}
                  onChange={setBindings}
                  disabled={!!selection}
                />
              ))}
              {localize(!!resolved?.missing.length && (
                <p className="sr-error" role="alert">
                  {localize("未取得字段值：")}{localizeList(resolved.missing)}
                </p>
              ))}
              {localize(template && (
                <div className="report-resolved-fields">
                  <h4>{localize("引用字段")}</h4>
                  {localize(reportFields(template.body).map((f) => (
                    <div key={f.id}>
                      <span>{localize(f.label)}</span>
                      <strong>
                        {localize(resolved?.source.values[f.id] || '未填写')}
                      </strong>
                    </div>
                  )))}
                </div>
              ))}
            </aside>
            <section
              className="report-preview-canvas"
              aria-label={localize("报告填充预览")}
            >
              {localize(resolved ? (
                <>
                  <ReportBody body={resolved.body} />
                  {localize(isProjectReport && (
                    <ProjectReportFilesSection files={projectFiles} />
                  ))}
                </>
              ) : (
                <p className="sr-help">{localize("选择模板后预览")}</p>
              ))}
            </section>
          </div>
        ))}
        {localize(error && (
          <p className="sr-error" role="alert">
            {localize(error)}
          </p>
        ))}
        {localize(fileIssue && (
          <p className="sr-error" role="alert">
            {localize(fileIssue)}
          </p>
        ))}
        <DialogFooter>
          {localize(allowVisibility && document && !pickingFiles && (
            <label className="report-customer-toggle">
              <input
                type="checkbox"
                checked={customerVisible}
                disabled={busy}
                onChange={(e) => setCustomerVisible(e.target.checked)}
              />
              {localize("交付客户（客户可见）")}</label>
          ))}
          <Button variant="outline" disabled={busy} onClick={close}>
            {localize("取消")}</Button>
          {localize(pickingFiles ? (
            <Button
              disabled={busy || !!fileIssue}
              onClick={() => setPickingFiles(false)}
            >
              {localize("完成选择")}</Button>
          ) : document ? (
            <Button disabled={busy || !!fileIssue} onClick={() => void save()}>
              {localize(saveLabel ??
                (allowVisibility && customerVisible
                  ? '保存并交付'
                  : '保存报告'))}
            </Button>
          ) : (
            <Button
              disabled={
                !resolved ||
                !!resolved.missing.length ||
                !!fileIssue ||
                !!(needsOrder && !order)
              }
              onClick={generate}
            >
              {localize("生成并编辑")}</Button>
          ))}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
