'use client';
import { useI18n } from '@/lib/i18n/context';

import { useContext } from 'react';
import type { RequestItem } from '@/lib/service-requests';
import { requestFieldIsRequired } from '@/lib/service-requests';
import { workOrderField, workOrderFieldValue, workOrderVisibleFields } from '@/lib/work-order-form';
import { RequestFieldsContext, RequestFieldControl } from '@/components/request-field-settings';
import { RequestFormLayout } from '@/components/request-form-layout';
import { Textarea } from '@/components/ui/textarea';

export function WorkOrderFormFields({ item, readonly = false, disabled = false, leadingFields = [], onChange }: {
  item: RequestItem;
  readonly?: boolean;
  leadingFields?: { id: string; label: string; value: string }[];
  disabled?: boolean;
  onChange?: (patch: Partial<Pick<RequestItem, 'values' | 'description' | 'method'>>) => void;
}) {
  const { localize } = useI18n();
  const directoryFields = useContext(RequestFieldsContext);
  if (readonly) return <dl className="wo-basic-grid">
    {localize(leadingFields.map(field => <div key={field.id}><dt>{localize(field.label)}</dt><dd>{localize(field.value)}</dd></div>))}
    {localize(workOrderVisibleFields(item).map(id => {
      const field = workOrderField(item, id, directoryFields);
      const wide = id === 'description' || field.type === 'textarea';
      return <div key={id} data-wide={wide || undefined} data-address={field.type === 'address' || undefined}>
        <dt>{localize(field.name)}</dt><dd>{localize(workOrderFieldValue(item, id))}</dd>
      </div>;
    }))}
  </dl>;
  return <div className="wo-configured-fields"><RequestFormLayout
    config={item.config}
    visibleIds={workOrderVisibleFields(item)}
    renderField={id => {
      const field = workOrderField(item, id, directoryFields);
      if (id === 'businessObjects') return <dl className="wo-configured-value">
        <dt>{localize(field.name)}</dt><dd>{localize(workOrderFieldValue(item, id))}</dd>
      </dl>;
      const required = id === 'method' ? true : id === 'description' ? item.config.basicFields?.description?.required !== false : requestFieldIsRequired(item.config, id, item.method, item.values);
      return <fieldset disabled={disabled} className="wo-configured-control">
        <legend>{localize(field.name)}{localize(required && <em> *</em>)}</legend>
        {localize(id === 'method' ? <RequestFieldControl field={field} value={item.method} disabled={disabled} onChange={method => onChange?.({ method })} /> : id === 'description' ? <Textarea aria-label={localize(field.name)} rows={4} maxLength={60000} value={item.description} onChange={event => onChange?.({ values: item.values, description: event.target.value })} /> :
          <RequestFieldControl field={field} value={item.values[id] ?? ''} disabled={disabled} onChange={value => onChange?.({ description: item.description, values: { ...item.values, [id]: value } })} />)}
      </fieldset>;
    }}
  /></div>;
}
