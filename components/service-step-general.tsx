'use client';
import { useI18n } from '@/lib/i18n/context';


import { RequiredMark } from '@/components/required-mark';

import { useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  downloadFile,
  storedFile,
  type StoredFile,
} from '@/lib/service-requests';
import {
  generalStepDescription,
  validateGeneralStepSubmission,
} from '@/lib/service-step-general';
import type { ServiceFlowStep } from '@/lib/service-flow-steps';

function GeneralStepPreview({
  step,
  onClose,
}: {
  step: ServiceFlowStep;
  onClose: () => void;
}) {
  const { localize } = useI18n();
  const [description, setDescription] = useState(() =>
    generalStepDescription(step),
  );
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const upload = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sr-dialog sr-document-dialog">
        <DialogHeader>
          <DialogTitle>{localize(step.name)} {localize(" · 通用操作预览")}</DialogTitle>
          <DialogDescription>
            {localize("说明和附件仅内部使用，不交付客户。预览内容关闭后清空。")}</DialogDescription>
        </DialogHeader>
        <div className="sr-document-body service-general-preview">
          <label className="approval-field">
            <span>{localize("说明")}{localize(step.recordRequired ? <> <RequiredMark /></> : '（选填）')}</span>
            <Textarea
              rows={7}
              maxLength={60000}
              required={step.recordRequired}
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                setNotice('');
                setError('');
              }}
              placeholder={localize("请填写本步骤的执行说明")}
            />
          </label>
          <div className="service-flow-step-heading">
            <strong>{localize("附件")}{localize(step.attachmentRequired ? <> <RequiredMark /></> : '（选填）')}</strong>
            <Button variant="outline" onClick={() => upload.current?.click()}>
              <Upload size={14} />
              {localize("上传附件")}</Button>
          </div>
          <input
            ref={upload}
            hidden
            type="file"
            multiple
            aria-label={localize("上传通用步骤附件")}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (
                selected.some(
                  (file) => !file.size || file.size > 20 * 1024 * 1024,
                )
              ) {
                setError('附件须为非空文件，单个不超过 20 MB。');
                return;
              }
              setFiles((current) => [...current, ...selected.map(storedFile)]);
              setError('');
              setNotice('');
            }}
          />
          <p className="sr-help">{localize("支持多份附件，单个不超过 20 MB。")}</p>
          <div className="service-step-preview-files">
            {localize(files.map((file) => (
              <div key={file.id}>
                <span>{localize(file.name)}</span>
                <Button variant="ghost" onClick={() => downloadFile(file)}>
                  {localize("下载")}</Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFiles((current) =>
                      current.filter((row) => row.id !== file.id),
                    );
                    setNotice('');
                  }}
                >
                  {localize("删除")}</Button>
              </div>
            )))}
          </div>
          {localize(error && (
            <p className="sr-error" role="alert">
              {localize(error)}
            </p>
          ))}
          {localize(notice && (
            <p role="status" className="submission-rule-notice">
              {localize(notice)}
            </p>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {localize("关闭预览")}</Button>
          <Button
            onClick={() => {
              try {
                validateGeneralStepSubmission(step, description, files);
                setError('');
                setNotice('校验通过，说明和附件均不交付客户。');
              } catch (issue) {
                setNotice('');
                setError(issue instanceof Error ? issue.message : '校验失败。');
              }
            }}
          >
            {localize("校验填写内容")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function ServiceStepGeneral({
  step,
  editable,
  onChange,
}: {
  step: ServiceFlowStep;
  editable: boolean;
  onChange: (patch: Partial<ServiceFlowStep>) => void;
}) {
  const { localize } = useI18n();
  const [preview, setPreview] = useState(false);
  return (
    <div className="service-step-deliverables">
      <label className="approval-field">
        <span>{localize("说明长文本")}</span>
        <Textarea
          rows={5}
          maxLength={60000}
          disabled={!editable}
          value={generalStepDescription(step)}
          placeholder={localize("可设置说明初始内容，执行时可填写或修改")}
          onChange={(event) =>
            onChange({ generalDescription: event.target.value })
          }
        />
      </label>
      <label className="service-flow-checkbox">
        <input
          type="checkbox"
          disabled={!editable}
          checked={step.recordRequired}
          onChange={(event) =>
            onChange({ recordRequired: event.target.checked })
          }
        />
        {localize("说明必填")}</label>
      <label className="service-flow-checkbox">
        <input
          type="checkbox"
          disabled={!editable}
          checked={step.attachmentRequired}
          onChange={(event) =>
            onChange({ attachmentRequired: event.target.checked })
          }
        />
        {localize("必须上传附件")}</label>
      <Button variant="outline" onClick={() => setPreview(true)}>
        {localize("预览通用操作")}</Button>
      {localize(preview && (
        <GeneralStepPreview step={step} onClose={() => setPreview(false)} />
      ))}
    </div>
  );
}
