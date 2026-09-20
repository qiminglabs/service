'use client';

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
  if (field.type === 'boolean') {
    return (
      <NativeSelect
        aria-label={field.name}
        required={field.required}
        disabled={disabled}
        value={typeof value === 'boolean' ? String(value) : ''}
        onChange={(event) =>
          onChange(
            event.target.value === '' ? '' : event.target.value === 'true',
          )
        }
      >
        <option value="">请选择</option>
        <option value="true">是</option>
        <option value="false">否</option>
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
