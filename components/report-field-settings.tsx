'use client';
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
            <th>引用字段</th>
            <th>字段来源</th>
            <th>没有值时</th>
            <th>默认文本</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => {
            const source = options.find(
              (o) =>
                o.scope === field.scope &&
                o.fieldId === field.fieldId &&
                (field.scope !== 'step' || o.stepId === field.stepId),
            );
            return (
              <tr key={field.id}>
                <td>{field.label}</td>
                <td>
                  <NativeSelect
                    aria-label={`${field.label} 字段来源`}
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
                      来源不匹配，请重新选择
                    </option>
                    {[...new Set(options.map((o) => o.group))].map((group) => (
                      <optgroup key={group} label={group}>
                        {options
                          .filter((o) => o.group === group)
                          .map((o) => (
                            <option value={o.id} key={o.id}>
                              {o.label}
                            </option>
                          ))}
                      </optgroup>
                    ))}
                  </NativeSelect>
                </td>
                <td>
                  <NativeSelect
                    aria-label={`${field.label} 空值处理`}
                    disabled={disabled}
                    value={field.emptyPolicy ?? 'block'}
                    onChange={(event) =>
                      update(field.id, {
                        emptyPolicy: event.target
                          .value as ReportField['emptyPolicy'],
                      })
                    }
                  >
                    <option value="block">阻止生成</option>
                    <option value="blank">留空</option>
                    <option value="default">显示默认文本</option>
                  </NativeSelect>
                </td>
                <td>
                  {field.emptyPolicy === 'default' ? (
                    <Input
                      aria-label={`${field.label} 默认文本`}
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
                  )}
                </td>
              </tr>
            );
          })}
          {!fields.length && (
            <tr>
              <td colSpan={4} className="routing-empty">
                暂无引用字段
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
