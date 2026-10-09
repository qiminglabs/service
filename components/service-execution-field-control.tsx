'use client';
import { useI18n } from '@/lib/i18n/context';


import { NativeSelect } from '@/components/ui/native-select';
import { RequestFieldControl } from '@/components/request-field-settings';
import type { ExecutionField } from '@/lib/service-execution-forms';

export function ExecutionFieldControl({
  field,
  value,
  onChange,
  disabled = false,
}: {
  field: ExecutionField;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  disabled?: boolean;
}) {
  const { localize } = useI18n();
  if (field.type === 'boolean') {
    return (
      <NativeSelect
        aria-label={localize(field.name)}
        required={field.required}
        disabled={disabled}
        value={typeof value === 'boolean' ? String(value) : ''}
        onChange={(event) =>
          onChange(
            event.target.value === '' ? '' : event.target.value === 'true',
          )
        }
      >
        <option value="">{localize("请选择")}</option>
        <option value="true">{localize("是")}</option>
        <option value="false">{localize("否")}</option>
      </NativeSelect>
    );
  }
  return (
    <RequestFieldControl
      field={{
        ...field,
        type: field.type,
        options: field.options.map((value) => ({ value, enabled: true })),
      }}
      value={typeof value === 'string' ? value : ''}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
