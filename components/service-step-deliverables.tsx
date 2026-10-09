'use client';
import { useI18n } from '@/lib/i18n/context';


import { RequiredMark } from '@/components/required-mark';
import { StepReportTemplateSelect } from '@/components/step-report-template-select';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { ServiceStepMaterialPreview } from '@/components/service-step-material-preview';
import {
  checkFile,
  downloadFile,
  fileAccept,
  storedFile,
} from '@/lib/service-requests';
import {
  newStepDocument,
  newStepFile,
  stepDocuments,
  stepFiles,
  validOnlineTemplateUrl,
  type StepDocument,
  type StepFile,
} from '@/lib/service-step-deliverables';
import type { ServiceFlowStep } from '@/lib/service-flow-steps';
import type { ReportTemplate } from '@/lib/report-templates';

export function ServiceStepDeliverables({
  step,
  steps,
  editable,
  onChange,
  reportTemplates,
  onManageTemplates,
}: {
  step: ServiceFlowStep;
  steps: ServiceFlowStep[];
  editable: boolean;
  onChange: (patch: Partial<ServiceFlowStep>) => void;
  reportTemplates: ReportTemplate[];
  onManageTemplates: () => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const [error, setError] = useState('');
  const [previewId, setPreviewId] = useState<string>();
  const document = step.type === 'document';
  const label = document ? '文档' : '文件';
  const items = document ? stepDocuments(step) : stepFiles(step);
  const preview = items.find((item) => item.id === previewId);
  function replace(next: (StepDocument | StepFile)[]) {
    if (!editable) return;
    onChange(
      document
        ? { documents: next as StepDocument[] }
        : { files: next as StepFile[] },
    );
  }
  function patch(id: string, change: Partial<StepDocument & StepFile>) {
    replace(
      items.map((item) => (item.id === id ? { ...item, ...change } : item)),
    );
  }
  return (
    <div className="service-step-deliverables">
      {localize(items.map((item, index) => (
        <section
          className="service-step-deliverable"
          key={item.id}
          aria-label={localizeMessage("{0} {1} 配置", [localize(label), localize(index + 1)])}
        >
          <div className="service-flow-step-heading">
            <strong>
              {localize(label)} {localize(index + 1)}
            </strong>
            <Button
              variant="ghost"
              size="icon"
              aria-label={localizeMessage("删除{0} {1}", [localize(label), localize(index + 1)])}
              disabled={!editable || items.length === 1}
              onClick={() => replace(items.filter((row) => row.id !== item.id))}
            >
              <Trash2 size={14} />
            </Button>
          </div>
          <label className="approval-field">
            <span>{localize(label)}{localize("名称")}<RequiredMark /></span>
            <Input
              required
              maxLength={120}
              value={item.name}
              disabled={!editable}
              onChange={(event) => patch(item.id, { name: event.target.value })}
            />
          </label>
          <label
            className="approval-field"
            htmlFor={`delivery-${item.id}-instructions`}
          >
            <span>{localize("填写说明")}</span>
            <Textarea
              id={`delivery-${item.id}-instructions`}
              rows={3}
              maxLength={20000}
              value={item.instructions}
              disabled={!editable}
              onChange={(event) =>
                patch(item.id, { instructions: event.target.value })
              }
            />
          </label>
          <div className="service-step-two-fields">
            <label
              className="approval-field"
              htmlFor={`delivery-${item.id}-required`}
            >
              <span>{localize("填写要求")}</span>
              <NativeSelect
                id={`delivery-${item.id}-required`}
                value={String(item.required)}
                disabled={!editable}
                onChange={(event) =>
                  patch(item.id, { required: event.target.value === 'true' })
                }
              >
                <option value="true">{localize("必填")}</option>
                <option value="false">{localize("选填")}</option>
              </NativeSelect>
            </label>
            <label
              className="approval-field"
              htmlFor={`delivery-${item.id}-visibility`}
            >
              <span>{localize("是否交付客户")}</span>
              <NativeSelect
                id={`delivery-${item.id}-visibility`}
                value={String(item.deliverToCustomer)}
                disabled={!editable}
                onChange={(event) =>
                  patch(item.id, {
                    deliverToCustomer: event.target.value === 'true',
                  })
                }
              >
                <option value="false">{localize("否（内部使用）")}</option>
                <option value="true">{localize("是（交付客户）")}</option>
              </NativeSelect>
            </label>
          </div>
          {localize(document ? (
            <>
              <StepReportTemplateSelect
                value={(item as StepDocument).reportTemplate}
                steps={steps}
                templates={reportTemplates}
                editable={editable}
                onManage={onManageTemplates}
                onChange={(reportTemplate) =>
                  patch(item.id, { reportTemplate })
                }
              />
              <label
                className="approval-field"
                htmlFor={`delivery-${item.id}-url`}
              >
                <span>{localize("在线文档模板链接")}</span>
                <Input
                  id={`delivery-${item.id}-url`}
                  type="url"
                  maxLength={2048}
                  placeholder="https://…"
                  disabled={!editable}
                  value={(item as StepDocument).onlineTemplateUrl}
                  onChange={(event) =>
                    patch(item.id, { onlineTemplateUrl: event.target.value })
                  }
                />
              </label>
              <label className="approval-field">
                <span>
                  {localize((item as StepDocument).template
                    ? '替换文件模板'
                    : '上载文件模板')}
                </span>
                <input
                  type="file"
                  accept={fileAccept}
                  disabled={!editable}
                  aria-label={localizeMessage("上载 {0} 模板", [localize(item.name)])}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file || !editable) return;
                    const issue = checkFile(file);
                    setError(issue ?? '');
                    if (!issue)
                      patch(item.id, {
                        template: storedFile(file),
                        initialContent: undefined,
                      });
                  }}
                />
              </label>
              <p className="sr-help">
                {localize("模板单个不超过 20 MB；DOCX、TXT、MD 可从模板开始在线填写。")}</p>
              {localize((item as StepDocument).template && (
                <div className="service-step-template-actions">
                  <Button
                    variant="link"
                    onClick={() =>
                      downloadFile((item as StepDocument).template!)
                    }
                  >
                    {localize((item as StepDocument).template!.name)} {localize(" · 下载模板")}</Button>
                  <Button
                    variant="ghost"
                    disabled={!editable}
                    onClick={() => patch(item.id, { template: undefined })}
                  >
                    {localize("移除模板")}</Button>
                </div>
              ))}
              {localize(validOnlineTemplateUrl(
                (item as StepDocument).onlineTemplateUrl.trim(),
              ) && (
                <a
                  href={(item as StepDocument).onlineTemplateUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {localize("打开在线文档模板 ↗")}</a>
              ))}
              {localize(!!(item as StepDocument).initialContent &&
                !(item as StepDocument).template && (
                  <p className="sr-help">
                    {localize("已保留原文本模板，可在操作预览中从模板开始。")}</p>
                ))}
            </>
          ) : (
            <div className="service-step-two-fields">
              <label
                className="approval-field"
                htmlFor={`delivery-${item.id}-min-files`}
              >
                <span>{localize("最少文件数量")}</span>
                <Input
                  id={`delivery-${item.id}-min-files`}
                  type="number"
                  min={1}
                  max={20}
                  step={1}
                  disabled={!editable}
                  value={
                    Number.isFinite((item as StepFile).minFiles)
                      ? (item as StepFile).minFiles
                      : ''
                  }
                  onChange={(event) =>
                    patch(item.id, {
                      minFiles:
                        event.target.value === ''
                          ? NaN
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
              <label
                className="approval-field"
                htmlFor={`delivery-${item.id}-formats`}
              >
                <span>{localize("允许文件格式")}</span>
                <Input
                  id={`delivery-${item.id}-formats`}
                  maxLength={200}
                  disabled={!editable}
                  placeholder={localize("留空不限，如 .pdf,.docx")}
                  value={(item as StepFile).formats}
                  onChange={(event) =>
                    patch(item.id, { formats: event.target.value })
                  }
                />
              </label>
            </div>
          ))}
          <Button variant="outline" onClick={() => setPreviewId(item.id)}>
            {localize("预览")}{localize(label)}{localize("操作")}</Button>
        </section>
      )))}
      <Button
        variant="outline"
        disabled={!editable || items.length >= 50}
        onClick={() =>
          replace([
            ...items,
            document
              ? newStepDocument(items.length + 1)
              : newStepFile(items.length + 1),
          ])
        }
      >
        <Plus size={14} />
        {localize("添加")}{localize(label)}
      </Button>
      {localize(error && (
        <p className="sr-error" role="alert">
          {localize(error)}
        </p>
      ))}
      {localize(preview && (
        <ServiceStepMaterialPreview
          key={preview.id}
          item={preview}
          kind={document ? 'document' : 'upload'}
          onClose={() => setPreviewId(undefined)}
        />
      ))}
    </div>
  );
}
