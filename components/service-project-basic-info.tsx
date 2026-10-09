
import { useI18n } from '@/lib/i18n/context';
import type { RequestField } from '@/components/request-field-settings';
import { addressLabel } from '@/lib/request-address';

export function projectFieldText(field: RequestField, value: string): string {
  if (!value) return '—';
  if (field.type === 'address') return addressLabel(value) || '—';
  if (field.type === 'multiple') {
    try {
      const selected: unknown = JSON.parse(value);
      if (Array.isArray(selected)) return selected.map(String).join('、') || '—';
    } catch { /* Older single-value records remain readable. */ }
  }
  return value;
}

export function ServiceProjectBasicInfo({ fields }: {
  fields: { id: string; label: string; value?: string; fullWidth?: boolean }[];
}) {
  const { localize } = useI18n();
  return <dl className="sr-form-grid service-project-basic-view">
    {localize(fields.map(field => <div key={field.id} className={field.fullWidth ? 'sr-span' : undefined}>
      <dt>{localize(field.label)}</dt>
      <dd>{localize(field.value || '—')}</dd>
    </div>))}
  </dl>;
}
