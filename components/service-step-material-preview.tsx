'use client';
import { ReportTemplateComposer } from '@/components/report-template-composer';
import type { ServiceProjectRecord } from '@/lib/service-projects';

import { lazy, Suspense, useRef, useState } from 'react';
import { Download, FilePenLine, FilePlus2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  checkFile,
  downloadFile,
  fileAccept,
  storedFile,
  type StoredFile,
} from '@/lib/service-requests';
import {
  canEditTemplate,
  onlineMaterialFile,
  templateText,
} from '@/lib/online-material';
import {
  validOnlineTemplateUrl,
  type StepDocument,
  type StepFile,
} from '@/lib/service-step-deliverables';

const LocalDocumentEditor = lazy(() =>
  import('@/components/local-document-editor').then((module) => ({
    default: module.LocalDocumentEditor,
  })),
);
type OnlineDocument = NonNullable<StoredFile['onlineDocument']>;
export function ServiceStepMaterialPreview({
  item,
  kind,
  onClose,
  initialFiles,
  onApply,
  reportContext,
}: {
  reportContext?: {project:ServiceProjectRecord;orderId:string;customerName:string};
  item: StepDocument | StepFile;
  kind: 'document' | 'upload';
  onClose: () => void;
  initialFiles?: StoredFile[];
  onApply?: (files: StoredFile[]) => void;
}) {
  const [reportOpen,setReportOpen]=useState(false);
  const [files, setFiles] = useState<StoredFile[]>(() =>
    structuredClone(initialFiles ?? []),
  );
  const [editor, setEditor] = useState<OnlineDocument>();
  const [editingId, setEditingId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  const doc = kind === 'document' ? (item as StepDocument) : undefined;
  const file = kind === 'upload' ? (item as StepFile) : undefined;
  const localTemplate =
    !!(doc?.template && canEditTemplate(doc.template.name)) ||
    !!(!doc?.template && doc?.initialContent);
  const onlineUrl = doc?.onlineTemplateUrl.trim() ?? '';
  async function startTemplate() {
    if (!doc || busy) return;
    setBusy(true);
    setError('');
    try {
      const content = doc.template
        ? await templateText(doc.template.blob, doc.template.name)
        : (doc.initialContent ?? '');
      setEditingId(undefined);
      setEditor({ title: doc.name, content, source: 'template' });
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : '无法读取模板。');
    } finally {
      setBusy(false);
    }
  }
  function back() {
    if (editor && !window.confirm('返回将放弃当前尚未保存的正文，是否继续？'))
      return;
    setEditor(undefined);
    setEditingId(undefined);
    setError('');
  }
  function close() {
    if (busy || (editor && !window.confirm('关闭将放弃当前正文，是否继续？')))
      return;
    onClose();
  }
  if(reportOpen && doc?.reportTemplate && reportContext) return <ReportTemplateComposer project={reportContext.project} customerName={reportContext.customerName} fixedOrderId={reportContext.orderId} selection={doc.reportTemplate} onClose={()=>setReportOpen(false)} onSave={saved=>{setFiles(current=>[...current,saved]);}}/>;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={`sr-dialog sr-document-dialog${editor ? ' sr-document-dialog-online' : ''}`}
        showCloseButton={!busy}
      >
        <DialogHeader className={editor ? 'sr-only' : undefined}>
          <DialogTitle>
            {item.name || '未命名材料'}
            {onApply ? '' : ' · 操作预览'}
          </DialogTitle>
          {!onApply && (
            <DialogDescription>
              此处用于试用填写方式，预览文件不写入流程配置，关闭后清空。
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="sr-document-body">
          {editor ? (
            <Suspense fallback={<p>正在打开在线文档…</p>}>
              <LocalDocumentEditor
                key={editingId ?? 'new'}
                value={editor}
                readonly={false}
                busy={busy}
                dirty
                onChange={setEditor}
                onBack={back}
              />
            </Suspense>
          ) : (
            <>
              {onApply && (
                <div className="sr-material-visibility-notice" role="note">
                  {item.deliverToCustomer ? (
                    <CustomerVisibleBadge />
                  ) : (
                    <span className="sr-assessment-badge">仅内部可见</span>
                  )}
                  <span>
                    {item.deliverToCustomer
                      ? '此材料作为客户交付物，上传或在线填写的内容对客户可见。'
                      : '此材料仅供内部使用，上传或在线填写的内容不对客户展示。'}
                  </span>
                </div>
              )}
              <div className="sr-document-instructions">
                <strong>
                  {item.required ? '必填' : '选填'}
                </strong>
                <p>{item.instructions || '暂无填写说明'}</p>
              </div>
              {doc ? (
                <div className="sr-document-actions">
                  {doc.reportTemplate ? <Button size="lg" className="sr-document-entry" variant="outline" disabled={!reportContext} onClick={()=>setReportOpen(true)}><FilePenLine size={22}/>{doc.reportTemplate.template.name} · 生成报告</Button> : localTemplate ? (
                    <Button
                      size="lg"
                      className="sr-document-entry"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void startTemplate()}
                    >
                      <FilePenLine size={22} />
                      {busy ? '正在读取模板…' : '从模板开始在线填写'}
                    </Button>
                  ) : validOnlineTemplateUrl(onlineUrl) ? (
                    <Button
                      size="lg"
                      className="sr-document-entry"
                      variant="outline"
                      disabled={busy}
                      nativeButton={false}
                      render={<a href={onlineUrl} target="_blank" rel="noopener noreferrer" />}
                    >
                      <FilePenLine size={22} />
                      从模板开始在线填写
                    </Button>
                  ) : (
                    <Button size="lg" className="sr-document-entry" variant="outline" disabled>
                      <FilePenLine size={22} />
                      从模板开始在线填写
                    </Button>
                  )}
                  <Button
                    size="lg"
                    className="sr-document-entry"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setError('');
                      setEditingId(undefined);
                      setEditor({ title: doc.name, content: '', source: 'blank' });
                    }}
                  >
                    <FilePlus2 size={22} />
                    从空白开始在线填写
                  </Button>
                  <div className="sr-document-file-actions">
                    <Button
                      size="lg"
                      className="sr-document-entry"
                      variant="outline"
                      disabled={busy}
                      onClick={() => upload.current?.click()}
                      aria-describedby="step-document-upload-size"
                    >
                      <Upload size={22} />
                      上传已有文件
                    </Button>
                    <p id="step-document-upload-size" className="sr-upload-size-hint">单文件上限 20 MB</p>
                    <div className="sr-document-template-download">
                      {validOnlineTemplateUrl(onlineUrl) && localTemplate && (
                        <a className="sr-download" href={onlineUrl} target="_blank" rel="noopener noreferrer">
                          打开在线文档模板
                        </a>
                      )}
                      {doc.template ? (
                        <Button size="sm" variant="ghost" onClick={() => downloadFile(doc.template!)}>
                          <Download size={14} />
                          下载模板
                        </Button>
                      ) : !localTemplate && !validOnlineTemplateUrl(onlineUrl) ? (
                        <Button size="sm" variant="ghost" disabled>未配置模板</Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="service-step-preview-actions">
                  <Button variant="outline" disabled={busy} onClick={() => upload.current?.click()}>
                    <Upload size={14} />
                    上载文件
                  </Button>
                </div>
              )}
              {doc?.template && !canEditTemplate(doc.template.name) && (
                <p className="sr-help">
                  当前文件模板不支持提取正文，可下载填写后上传，或从空白开始。
                </p>
              )}
              {file && (
                <p className="sr-help">
                  {file.formats ? `允许格式：${file.formats}` : '文件格式不限'}
                  ，单个不超过 20 MB。
                </p>
              )}
              {doc && (
                <p className="sr-help">
                  支持多次上传或在线填写多份文档，单个文件不超过 20
                  MB。外部在线模板将在新页面打开。
                </p>
              )}
              <input
                ref={upload}
                hidden
                type="file"
                multiple
                accept={doc ? fileAccept : file?.formats || undefined}
                aria-label={doc ? '上载文档' : '上载文件'}
                disabled={busy}
                onChange={(event) => {
                  const selected = Array.from(event.target.files ?? []);
                  event.target.value = '';
                  const issue = selected
                    .map((value) => {
                      if (doc) return checkFile(value);
                      if (!value.size || value.size > 20 * 1024 * 1024)
                        return '文件须为非空文件，单个不超过 20 MB。';
                      if (
                        file?.formats &&
                        !file.formats
                          .split(',')
                          .map((format) => format.trim().toLowerCase())
                          .some((format) =>
                            value.name.toLowerCase().endsWith(format),
                          )
                      )
                        return `${value.name} 不符合允许的文件格式。`;
                      return null;
                    })
                    .find(Boolean);
                  if (issue) {
                    setError(issue);
                    return;
                  }
                  setFiles((current) => [
                    ...current,
                    ...selected.map(storedFile),
                  ]);
                  setError('');
                }}
              />
              {!!files.length && (
                <section
                  className="service-step-preview-files"
                  aria-label="预览文件"
                >
                  {files.map((value) => (
                    <div key={value.id}>
                      <span>
                        {value.name}
                      </span>
                      {value.onlineDocument && (
                        <Button
                          variant="ghost"
                          onClick={() => {
                            setEditingId(value.id);
                            setEditor(structuredClone(value.onlineDocument!));
                          }}
                        >
                          在线编辑
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => downloadFile(value)}
                      >
                        下载
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((row) => row.id !== value.id),
                          )
                        }
                      >
                        删除
                      </Button>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={close}>
            {onApply ? '取消' : '关闭预览'}
          </Button>
          {onApply && !editor && (
            <Button
              disabled={busy}
              onClick={() => {
                onApply(files);
                onClose();
              }}
            >
              保存
            </Button>
          )}
          {editor && (
            <Button
              disabled={busy}
              onClick={() => {
                try {
                  const saved = onlineMaterialFile(editor);
                  setFiles((current) =>
                    editingId
                      ? current.map((value) =>
                          value.id === editingId
                            ? { ...saved, id: editingId }
                            : value,
                        )
                      : [...current, saved],
                  );
                  setEditor(undefined);
                  setEditingId(undefined);
                  setError('');
                } catch (issue) {
                  setError(
                    issue instanceof Error ? issue.message : '文档保存失败。',
                  );
                }
              }}
            >
              {onApply ? '保存' : '保存至预览'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
