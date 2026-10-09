'use client';
import { useI18n } from '@/lib/i18n/context';


import { lazy, Suspense, useRef, useState } from 'react';
import { materialRequiredFor } from '@/lib/material-requirements';
import { requestTypeOf } from '@/lib/request-types';
import {
  Download,
  FilePenLine,
  FilePlus2,
  FileText,
  Trash2,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
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
  requestMaterialFiles,
  requestMaterialsCustomerVisible,
  attributeMaterialFile,
  downloadFile,
  fileAccept,
  storedFile,
  materialFiles,
  withMaterialFiles,
  saveMaterialFile,
  removeMaterialFile,
} from '@/lib/service-requests';
import type {
  RequestItem,
  MaterialRequirement,
  ItemMaterial,
  StoredFile,
  ServiceRequest,
} from '@/lib/service-requests';
import {
  canEditTemplate,
  onlineMaterialFile,
  templateText,
} from '@/lib/online-material';

import type { OperationActor } from '@/lib/request-operations';

type OnlineDocument = NonNullable<StoredFile['onlineDocument']>;
const LocalDocumentEditor = lazy(() =>
  import('@/components/local-document-editor').then((module) => ({
    default: module.LocalDocumentEditor,
  })),
);
export function RequestMaterialDialog({
  actor,
  record,
  item,
  requirement,
  readonly,
  busy,
  error,
  onSave,
  onClose,
  lockedFileIds = [],
}: {
  actor: OperationActor;
  record: ServiceRequest;
  item: RequestItem;
  requirement: MaterialRequirement;
  readonly: boolean;
  busy: boolean;
  error: string;
  onSave: (material: ItemMaterial) => Promise<boolean>;
  onClose: () => void;
  lockedFileIds?: string[];
}) {
  const { localize } = useI18n();
  const [material, setMaterial] = useState<ItemMaterial>(() =>
    structuredClone(
      item.materials.find((m) => m.requirementId === requirement.id) ?? {
        requirementId: requirement.id,
        files: [],
      },
    ),
  );
  const [editor, setEditor] = useState<OnlineDocument | null>(null);
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredFile | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const editing = !!editor && showEditor;
  const [editorChanged, setEditorChanged] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState('');
  const [discardOpen, setDiscardOpen] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const internal = actor.role !== '客户';
  const customerVisible = requestMaterialsCustomerVisible(record);
  const files = requestMaterialFiles(record, material, internal ? 'internal' : 'customer');
  const required = materialRequiredFor(requirement, requestTypeOf(record));
  const canEditFile = (file: StoredFile) => !readonly && !lockedFileIds.includes(file.id) && (internal || (file.uploaderAudience === 'customer' && file.uploadedById === actor.id));
  const editingReadonly = readonly || (!!editingFileId && !files.some(file => file.id === editingFileId && canEditFile(file)));
  const blocked = busy || loading || saving;
  const templateName =
    requirement.template?.name ?? requirement.templateUrl ?? '';
  const hasTemplate = !!templateName;
  const editableTemplate = canEditTemplate(templateName);

  function close() {
    if (blocked || deleteTarget) return;
    if (dirty) setDiscardOpen(true);
    else onClose();
  }
  function replaceEditor(next: OnlineDocument) {
    if (
      editorChanged &&
      !window.confirm(localize('当前正文尚未保存，是否放弃正文并切换填写方式？'))
    )
      return;
    setEditor(next);
    setEditingFileId(null);
    setShowEditor(true);
    setEditorChanged(true);
    setDirty(true);

    setProblem('');
  }
  async function fromTemplate() {
    if (lock.current || blocked || readonly) return;
    if (
      editorChanged &&
      !window.confirm(localize('当前正文尚未保存，是否重新从模板开始？'))
    )
      return;
    lock.current = true;
    setLoading(true);
    setProblem('');
    try {
      let blob = requirement.template?.blob;
      if (!blob) {
        const url = new URL(requirement.templateUrl!, window.location.href);
        if (url.origin !== window.location.origin)
          throw new Error('仅支持读取本站模板，请先将模板配置到本地目录。');
        const response = await fetch(url, {
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok)
          throw new Error('模板读取失败，请稍后重试或下载模板后上传。');
        blob = await response.blob();
      }
      const content = await templateText(blob, templateName);
      setEditor({ title: requirement.name, content, source: 'template' });
      setEditingFileId(null);
      setShowEditor(true);
      setEditorChanged(true);

      setDirty(true);
    } catch (e) {
      setProblem(
        e instanceof Error ? e.message : '无法读取模板，请下载后填写上传。',
      );
    } finally {
      setLoading(false);
      lock.current = false;
    }
  }
  async function save() {
    if (lock.current || blocked || readonly) return;
    if (!internal && !customerVisible) return;
    lock.current = true;
    setSaving(true);
    setProblem('');
    try {
      let next = withMaterialFiles(material, materialFiles(material));
      if (editor && editorChanged && !editingReadonly) {
        const file = attributeMaterialFile(onlineMaterialFile(editor), actor);
        next = saveMaterialFile(next, file, editingFileId);
      }
      if (await onSave(next)) onClose();
      else setProblem('本地保存未完成，当前内容仍保留，请重试。');
    } catch (e) {
      setProblem(e instanceof Error ? e.message : '保存失败，当前内容仍保留。');
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  if (!internal && !customerVisible) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className={
          'sr-dialog sr-document-dialog' +
          (editing ? ' sr-document-dialog-online' : '')
        }
      >
        <DialogHeader className={editing ? 'sr-only' : undefined}>
          <DialogTitle>{localize(requirement.name)}{localize(required && <sup className="sr-material-required" aria-label={localize("必填")}>*</sup>)}</DialogTitle>
          <DialogDescription>
            {localize(item.serviceName)} ·{localize(' ')}
            {localize(required ? '必填材料' : '选填材料')}
          </DialogDescription>
        </DialogHeader>
        <div className="sr-document-body">
          {localize(internal && !readonly && (
            <div className="sr-material-visibility-notice" role="note">
              {localize(customerVisible ? <CustomerVisibleBadge /> : <span className="sr-assessment-badge">{localize("仅内部可见")}</span>)}
              <span>{localize(customerVisible ? '此申请由客户中心发起，上传或在线填写的材料对客户可见。' : '此申请由内部发起，上传或在线填写的材料仅内部人员可见。')}</span>
            </div>
          ))}
          {localize(!editing && (
            <>
              <div className="sr-document-instructions">
                <strong>{localize("文件说明")}</strong>
                <p>
                  {localize(requirement.instructions ||
                    '请说明本项服务的实际情况，不适用内容注明原因。')}
                </p>
              </div>
              <div
                className="sr-document-actions"
                data-readonly={readonly || undefined}
              >
                {localize(!readonly && (
                  <>
                    <Button
                      size="lg"
                      className="sr-document-entry"
                      variant="outline"
                      disabled={blocked || !editableTemplate}
                      onClick={() => void fromTemplate()}
                    >
                      <FilePenLine size={22} />
                      {localize(loading ? '正在读取模板…' : '从模板开始在线填写')}
                    </Button>
                    <Button
                      size="lg"
                      className="sr-document-entry"
                      variant="outline"
                      disabled={blocked}
                      onClick={() =>
                        replaceEditor({
                          title: requirement.name,
                          content: '',
                          source: 'blank',
                        })
                      }
                    >
                      <FilePlus2 size={22} />
                      {localize("从空白开始在线填写")}</Button>
                  </>
                ))}
                <div className="sr-document-file-actions">
                  {localize(!readonly && (
                    <Button
                      size="lg"
                      className="sr-document-entry"
                      variant="outline"
                      disabled={blocked}
                      onClick={() => uploadRef.current?.click()}
                      aria-describedby="sr-upload-size-hint"
                    >
                      <Upload size={22} />
                      {localize("上传已有文件")}</Button>
                  ))}
                  {localize(!readonly && (
                    <p id="sr-upload-size-hint" className="sr-upload-size-hint">
                      {localize("单文件上限 20 MB")}</p>
                  ))}
                  {localize(!readonly && (
                  <div className="sr-document-template-download">
                    {localize(/^https?:\/\//i.test(
                      requirement.onlineTemplateUrl?.trim() ?? '',
                    ) && (
                      <a
                        className="sr-download"
                        href={requirement.onlineTemplateUrl!.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {localize("打开在线文档模板")}</a>
                    ))}
                    {localize(requirement.template ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => downloadFile(requirement.template!)}
                      >
                        <Download size={14} />
                        {localize("下载模板")}</Button>
                    ) : requirement.templateUrl ? (
                      <a
                        className="sr-download"
                        href={requirement.templateUrl}
                        download
                      >
                        <Download size={14} />
                        {localize("下载模板")}</a>
                    ) : (
                      <Button size="sm" variant="ghost" disabled>
                        {localize("未配置模板")}</Button>
                    ))}
                  </div>
                  ))}
                </div>
                {localize(!readonly && (
                  <input
                    ref={uploadRef}
                    className="sr-only"
                    type="file"
                    multiple
                    accept={fileAccept}
                    disabled={blocked}
                    aria-label={localize('上传' + requirement.name)}
                    onChange={(e) => {
                      const selected = Array.from(e.target.files ?? []);
                      e.target.value = '';
                      if (!selected.length || blocked || readonly) return;
                      const invalid = selected
                        .map((file) => ({ file, issue: checkFile(file) }))
                        .find((entry) => entry.issue);
                      setProblem(
                        invalid
                          ? `${invalid.file.name}：${invalid.issue}。本次所选文件均未添加。`
                          : '',
                      );
                      if (invalid) return;
                      const additions = selected.map(file => attributeMaterialFile(storedFile(file), actor));
                      setMaterial((m) =>
                        withMaterialFiles(m, [
                          ...materialFiles(m),
                          ...additions,
                        ]),
                      );
                      setDirty(true);
                    }}
                  />
                ))}
              </div>
              {localize(!readonly && (!hasTemplate || !editableTemplate) && (
                <p className="sr-help">
                  {localize(!hasTemplate
                    ? '此材料未配置模板，可从空白开始。'
                    : !editableTemplate
                      ? '当前模板格式不支持在线提取正文。'
                      : '')}
                </p>
              ))}
            </>
          ))}
          {localize(editing && editor ? (
            <Suspense
              fallback={<output className="sr-help">{localize("正在打开在线文档…")}</output>}
            >
              <LocalDocumentEditor
                key={editingFileId ?? 'new-document'}
                value={editor}
                readonly={editingReadonly}
                busy={blocked}
                dirty={dirty}
                onBack={() => setShowEditor(false)}
                onChange={(next) => {
                  if (editingReadonly) return;
                  setEditor(next);
                  setEditorChanged(true);
                  setDirty(true);
                }}
              />
            </Suspense>
          ) : null)}
          {localize(!editing && editor && (
            <Button variant="outline" onClick={() => setShowEditor(true)}>
              {localize("返回在线文档")}{localize(editorChanged ? ' · 未保存' : '')}
            </Button>
          ))}
          {localize(!editing && files.length > 0 && (
            <section className="sr-material-files" aria-label={localize("材料文件")}>
              <h3>
                {localize("材料文件")}<span>（{localize(files.length)}）</span>
              </h3>
              <ul>
                {localize(files.map((file) => (
                  <li key={file.id}>
                    <FileText size={20} aria-hidden="true" />
                    <div className="sr-material-file-info">
                      <span>{localize(file.name)}</span>
                      <small>
                        {localize(file.onlineDocument ? '在线文档' : '上传文件')} ·{localize(' ')}
                        {localize((file.size / 1024).toFixed(1))} KB ·{localize(' ')}
                        {localize(new Date(file.uploadedAt).toLocaleString('zh-CN'))}
                      </small>
                    </div>
                    <div className="sr-material-file-controls">
                      {localize(file.onlineDocument && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={blocked}
                          onClick={() => {
                            if (editor && editingFileId === file.id) {
                              setShowEditor(true);
                              return;
                            }
                            if (
                              editorChanged &&
                              !window.confirm(
                                localize('当前在线正文尚未保存，是否放弃正文并打开此文件？'),
                              )
                            )
                              return;
                            setEditor(structuredClone(file.onlineDocument!));
                            setEditingFileId(file.id);
                            setShowEditor(true);
                            setEditorChanged(false);
                          }}
                        >
                          {localize(canEditFile(file) ? '在线编辑' : '查看正文')}
                        </Button>
                      ))}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={blocked}
                        onClick={() => downloadFile(file)}
                        aria-label={localize('下载 ' + file.name)}
                      >
                        <Download size={14} />
                        {localize("下载")}</Button>
                      {localize(canEditFile(file) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="sr-material-delete"
                          disabled={blocked}
                          onClick={() => setDeleteTarget(file)}
                          aria-label={localize('删除 ' + file.name)}
                        >
                          <Trash2 size={14} />
                          {localize("删除")}</Button>
                      ))}
                    </div>
                  </li>
                )))}
              </ul>
            </section>
          ))}
          {localize((problem || error) && (
            <p className="sr-error" role="alert">
              {localize(problem || error)}
            </p>
          ))}
        </div>
        <DialogFooter>
          {localize(discardOpen ? (
            <div className="sr-discard-confirm" role="alert">
              <span>{localize("材料修改尚未保存，确定放弃？")}</span>
              <Button variant="outline" onClick={() => setDiscardOpen(false)}>
                {localize("继续编辑")}</Button>
              <Button variant="destructive" onClick={onClose}>
                {localize("放弃修改")}</Button>
            </div>
          ) : (
            <>
              <Button variant="outline" disabled={blocked} onClick={close}>
                {localize(readonly ? '关闭' : '取消')}
              </Button>
              {localize(!readonly && (
                <Button
                  disabled={blocked || !dirty}
                  onClick={() => void save()}
                >
                  {localize(saving || busy
                    ? '正在保存…'
                    : editing
                      ? '保存文档'
                      : '保存材料')}
                </Button>
              ))}
            </>
          ))}
        </DialogFooter>
        <AlertDialog
          open={!!deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
        >
          <AlertDialogContent className="sr-material-delete-confirm">
            <AlertDialogHeader>
              <AlertDialogTitle>{localize("删除此材料文件？")}</AlertDialogTitle>
              <AlertDialogDescription>
                {localize("将移除“")}{localize(deleteTarget?.name)}”
                {localize(editingFileId === deleteTarget?.id && editorChanged
                  ? '及其未保存的正文'
                  : '')}
                {localize("，保存材料后生效；取消材料修改可保留文件。")}{localize(required && files.length === 1
                  ? '删除后需补充至少一个文件，才能提交申请。'
                  : '')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{localize("保留文件")}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={blocked}
                onClick={() => {
                  if (!deleteTarget || !canEditFile(deleteTarget) || blocked) return;
                  setMaterial((m) => removeMaterialFile(m, deleteTarget.id));
                  if (editingFileId === deleteTarget.id) {
                    setEditor(null);
                    setEditingFileId(null);
                    setEditorChanged(false);
                    setShowEditor(false);
                  }
                  setDirty(true);
                  setProblem('');
                  setDeleteTarget(null);
                }}
              >
                {localize("删除文件")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
