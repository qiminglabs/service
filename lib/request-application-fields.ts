import type { RequestField } from '../components/request-field-settings';
import type { RequestConfig } from './service-requests';

export const initialApplicationFields: RequestField[] = [
  { id: 'title', name: '申请主题', type: 'text', options: [] },
  { id: 'customerId', name: '客户', type: 'lookup', referenceTarget: 'customers', options: [] },
  { id: 'expectedServiceDate', name: '期望服务日期', type: 'date', options: [] },
  { id: 'description', name: '申请说明', type: 'textarea', options: [] },
];

export function isSystemApplicationField(id: string): boolean {
  return initialApplicationFields.some(field => field.id === id);
}

// Import existing request fields once, retaining saved labels, options and custom fields.
export function normalizeApplicationFields(fields: RequestField[] = []): RequestField[] {
  const ids = initialApplicationFields.map(field => field.id);
  return [
    ...initialApplicationFields.map(seed => {
      const stored = fields.find(field => field.id === seed.id);
      return { ...seed, ...stored, name: stored?.name?.trim() || seed.name, type: seed.type, referenceTarget: seed.referenceTarget, options: structuredClone(stored?.options ?? seed.options) };
    }),
    ...fields.filter(field => !ids.includes(field.id) && field.id !== 'expectedProvider').map(field => ({ ...field, options: structuredClone(field.options) })),
  ];
}

// Only live service forms lose the field; existing request snapshots retain their history.
export function withoutServiceExpectedProvider(config: RequestConfig): RequestConfig {
  const omit = <T,>(values?: Record<string, T>) => values
    ? Object.fromEntries(Object.entries(values).filter(([id]) => id !== 'expectedProvider')) : undefined;
  return {
    ...config,
    fields: config.fields.filter(id => id !== 'expectedProvider'),
    fieldOrder: config.fieldOrder?.filter(id => id !== 'expectedProvider'),
    fieldRowStarts: config.fieldRowStarts?.filter(id => id !== 'expectedProvider'),
    fieldNames: omit(config.fieldNames) ?? {},
    fieldOptions: omit(config.fieldOptions) ?? {},
    fieldRequired: omit(config.fieldRequired),
    fieldRequiredWhen: omit(config.fieldRequiredWhen),
    fieldWidths: omit(config.fieldWidths),
    fieldColumns: omit(config.fieldColumns),
  };
}

