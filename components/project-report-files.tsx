'use client';
import { useI18n } from '@/lib/i18n/context';

import { useState } from 'react';
import { Download, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadFile } from '@/lib/service-requests';
import {
  maxProjectReportFileDescription,
  maxProjectReportFiles,
  type ProjectReportFile,
  type ProjectReportFileSelection,
} from '@/lib/project-report-files';
import type { ProjectDeliverable } from '@/lib/service-project-deliverables';

export function ProjectReportFilesSection({
  files,
  title = '项目文件',
}: {
  files: ProjectReportFile[];
  title?: string;
}) {
  const { localize, localizeMessage } = useI18n();
  return (
    <section className="report-project-files" aria-label={localize(title)}>
      <h3>
        {localize(title)} <span>{localize(files.length)}</span>
      </h3>
      {localize(files.length ? (
        <ol>
          {localize(files.map((item) => (
            <li key={item.id}>
              <div className="report-project-file-title">
                <FileText size={18} aria-hidden="true" />
                <strong>{localize(item.file.name)}</strong>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => downloadFile(item.file)}
                  aria-label={localizeMessage("下载 {0}", [localize(item.file.name)])}
                >
                  <Download size={14} />
                  {localize("下载")}</Button>
              </div>
              {localize(item.description && <p>{localize(item.description)}</p>)}
            </li>
          )))}
        </ol>
      ) : (
        <p className="sr-help">{localize("暂无")}{localize(title)}</p>
      ))}
    </section>
  );
}

export function ProjectReportFilePicker({
  items,
  selections,
  disabled,
  onChange,
}: {
  items: ProjectDeliverable[];
  selections: ProjectReportFileSelection[];
  disabled: boolean;
  onChange: (selections: ProjectReportFileSelection[]) => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const [query, setQuery] = useState('');
  const available = new Set(items.map((item) => item.id));
  const unavailable = selections.some(
    (item) => !available.has(item.deliverableId),
  );
  const visible = items.filter((item) =>
    `${item.file.name} ${item.serviceName} ${item.stepName}`.includes(query),
  );
  return (
    <section className="report-file-picker" aria-label={localize("选择客户交付物")}>
      <div className="report-file-picker-toolbar">
        <Input
          aria-label={localize("搜索客户交付物")}
          placeholder={localize("搜索文件名称、服务或步骤")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span>{localize("已选")}{localize(selections.length)} {localize(" 个文件")}</span>
      </div>
      {localize(unavailable && (
        <div className="report-file-picker-invalid">
          <p className="sr-error" role="alert">
            {localize("部分已选文件不再属于客户交付物。")}</p>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              onChange(
                selections.filter((item) => available.has(item.deliverableId)),
              )
            }
          >
            {localize("移除失效文件")}</Button>
        </div>
      ))}
      <div className="report-file-picker-list">
        {localize(visible.map((item) => {
          const selected = selections.find(
            (selection) => selection.deliverableId === item.id,
          );
          return (
            <section
              key={item.id}
              className="report-file-choice"
              data-selected={!!selected || undefined}
            >
              <label
                className="report-file-choice-heading"
                htmlFor={`report-file-${encodeURIComponent(item.id)}`}
              >
                <Checkbox
                  id={`report-file-${encodeURIComponent(item.id)}`}
                  aria-label={localizeMessage("选择 {0} · {1}", [localize(item.file.name), localize(item.stepName)])}
                  checked={!!selected}
                  disabled={
                    disabled ||
                    (!selected && selections.length >= maxProjectReportFiles)
                  }
                  onCheckedChange={(checked) =>
                    onChange(
                      checked
                        ? [
                            ...selections,
                            { deliverableId: item.id, description: '' },
                          ]
                        : selections.filter(
                            (selection) => selection.deliverableId !== item.id,
                          ),
                    )
                  }
                />
                <span>
                  <strong>{localize(item.file.name)}</strong>
                  <small>
                    {localize(item.serviceName)} · {localize(item.stepName)} ·{localize(' ')}
                    {localize(item.requirementName)}
                  </small>
                </span>
              </label>
              {localize(selected && (
                <label
                  className="report-file-description"
                  htmlFor={`file-description-${encodeURIComponent(item.id)}`}
                >
                  <span>{localize("文件说明")}</span>
                  <Textarea
                    id={`file-description-${encodeURIComponent(item.id)}`}
                    aria-label={localizeMessage("{0} 文件说明", [localize(item.file.name)])}
                    value={selected.description}
                    maxLength={maxProjectReportFileDescription}
                    rows={3}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange(
                        selections.map((selection) =>
                          selection.deliverableId === item.id
                            ? { ...selection, description: event.target.value }
                            : selection,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </section>
          );
        }))}
        {localize(!visible.length && (
          <p className="routing-empty">
            {localize(items.length ? '暂无匹配的客户交付物' : '暂无客户交付物')}
          </p>
        ))}
      </div>
    </section>
  );
}
