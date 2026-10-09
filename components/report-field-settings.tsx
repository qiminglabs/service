'use client';
import { useI18n } from '@/lib/i18n/context';

import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  reportFields,
  type ReportField,
  type ReportTemplate,
} from '@/lib/report-templates';
import { updateReportField } from '@/lib/flow-report-templates';

export function ReportFieldSettings({
  template,
  options,
  disabled,
  onChange,
}: {
  template: ReportTemplate;
  options: (ReportField & { group: string })[];
  disabled: boolean;
  onChange: (template: ReportTemplate) => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const fields = reportFields(template.body);
  function update(id: string, patch: Partial<ReportField>) {
    onChange({
      ...template,
      body: updateReportField(template.body, id, patch),
    });
  }
  return (
    <div className="report-field-settings table-scroll">
      <table className="reference-table app-list-table">
        <thead>
          <tr>
            <th>{localize("引用字段")}</th>
            <th>{localize("字段来源")}</th>
            <th>{localize("没有值时")}</th>
            <th>{localize("默认文本")}</th>
          </tr>
        </thead>
        <tbody>
          {localize(fields.map((field) => {
            const source = options.find(
              (o) =>
                o.scope === field.scope &&
                o.fieldId === field.fieldId &&
                (field.scope !== 'step' || o.stepId === field.stepId),
            );
            return (
              <tr key={field.id}>
                <td>{localize(field.label)}</td>
                <td>
                  <NativeSelect
                    aria-label={localizeMessage("{0} 字段来源", [localize(field.label)])}
                    disabled={disabled}
                    value={source?.id ?? ''}
                    onChange={(event) => {
                      const option = options.find(
                        (o) => o.id === event.target.value,
                      );
                      if (option)
                        update(field.id, {
                          scope: option.scope,
                          fieldId: option.fieldId,
                          stepId: option.stepId ?? null,
                          formId: option.formId ?? null,
                          label: option.label,
                        });
                    }}
                  >
                    <option value="" disabled>
                      {localize("来源不匹配，请重新选择")}</option>
                    {localize([...new Set(options.map((o) => o.group))].map((group) => (
                      <optgroup key={group} label={localize(group)}>
                        {localize(options
                          .filter((o) => o.group === group)
                          .map((o) => (
                            <option value={o.id} key={o.id}>
                              {localize(o.label)}
                            </option>
                          )))}
                      </optgroup>
                    )))}
                  </NativeSelect>
                </td>
                <td>
                  <NativeSelect
                    aria-label={localizeMessage("{0} 空值处理", [localize(field.label)])}
                    disabled={disabled}
                    value={field.emptyPolicy ?? 'block'}
                    onChange={(event) =>
                      update(field.id, {
                        emptyPolicy: event.target
                          .value as ReportField['emptyPolicy'],
                      })
                    }
                  >
                    <option value="block">{localize("阻止生成")}</option>
                    <option value="blank">{localize("留空")}</option>
                    <option value="default">{localize("显示默认文本")}</option>
                  </NativeSelect>
                </td>
                <td>
                  {localize(field.emptyPolicy === 'default' ? (
                    <Input
                      aria-label={localizeMessage("{0} 默认文本", [localize(field.label)])}
                      required
                      maxLength={1000}
                      disabled={disabled}
                      value={field.defaultText ?? ''}
                      onChange={(event) =>
                        update(field.id, { defaultText: event.target.value })
                      }
                    />
                  ) : (
                    '—'
                  ))}
                </td>
              </tr>
            );
          }))}
          {localize(!fields.length && (
            <tr>
              <td colSpan={4} className="routing-empty">
                {localize("暂无引用字段")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
