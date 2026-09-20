'use client';

import type { ReactNode } from 'react';
import type { RequestConfig } from '@/lib/service-requests';
import { requestFormLayoutFields } from '@/lib/request-form-layout';

export function RequestFormLayout({
  config,
  visibleIds,
  renderField,
}: {
  config: RequestConfig;
  visibleIds?: string[];
  renderField: (id: string) => ReactNode;
}) {
  return (
    <FormFieldsLayout
      fields={requestFormLayoutFields(config, visibleIds)}
      renderField={renderField}
    />
  );
}

export function FormFieldsLayout({
  fields,
  renderField,
}: {
  fields: { id: string; gridColumn: string }[];
  renderField: (id: string) => ReactNode;
}) {
  return (
    <div className="rf-auto-layout">
      {fields.map(({ id, gridColumn }) => (
        <div key={id} className="rf-layout-field" style={{ gridColumn }}>
          {renderField(id)}
        </div>
      ))}
    </div>
  );
}
