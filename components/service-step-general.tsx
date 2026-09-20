'use client';

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
          <DialogTitle>{step.name} · 通用操作预览</DialogTitle>
          <DialogDescription>
            说明和附件仅内部使用，不交付客户。预览内容关闭后清空。
          </DialogDescription>
        </DialogHeader>
        <div className="sr-document-body service-general-preview">
          <label className="approval-field">
            <span>说明{step.recordRequired ? ' *' : '（选填）'}</span>
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
              placeholder="请填写本步骤的执行说明"
            />
          </label>
          <div className="service-flow-step-heading">
            <strong>附件{step.attachmentRequired ? ' *' : '（选填）'}</strong>
            <Button variant="outline" onClick={() => upload.current?.click()}>
              <Upload size={14} />
              上传附件
            </Button>
          </div>
          <input
            ref={upload}
            hidden
            type="file"
            multiple
            aria-label="上传通用步骤附件"
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
          <p className="sr-help">支持多份附件，单个不超过 20 MB。</p>
          <div className="service-step-preview-files">
            {files.map((file) => (
              <div key={file.id}>
                <span>{file.name}</span>
                <Button variant="ghost" onClick={() => downloadFile(file)}>
                  下载
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setFiles((current) =>
                      current.filter((row) => row.id !== file.id),
                    );
                    setNotice('');
                  }}
                >
                  删除
                </Button>
              </div>
            ))}
          </div>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="submission-rule-notice">
              {notice}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭预览
          </Button>
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
            校验填写内容
          </Button>
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
  const [preview, setPreview] = useState(false);
  return (
    <div className="service-step-deliverables">
      <label className="approval-field">
        <span>说明长文本</span>
        <Textarea
          rows={5}
          maxLength={60000}
          disabled={!editable}
          value={generalStepDescription(step)}
          placeholder="可设置说明初始内容，执行时可填写或修改"
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
        说明必填
      </label>
      <label className="service-flow-checkbox">
        <input
          type="checkbox"
          disabled={!editable}
          checked={step.attachmentRequired}
          onChange={(event) =>
            onChange({ attachmentRequired: event.target.checked })
          }
        />
        必须上传附件
      </label>
      <Button variant="outline" onClick={() => setPreview(true)}>
        预览通用操作
      </Button>
      {preview && (
        <GeneralStepPreview step={step} onClose={() => setPreview(false)} />
      )}
    </div>
  );
}
