import type { RequestField } from '../components/request-field-settings';
import { requestTypes } from './request-types.ts';

export const initialApplicationFields: RequestField[] = [
  { id: 'title', name: '申请主题', type: 'text', options: [] },
  { id: 'requestType', name: '申请类型', type: 'single', options: requestTypes.map(value => ({ value, enabled: true })) },
  { id: 'customerId', name: '客户', type: 'lookup', referenceTarget: 'customers', options: [] },
  { id: 'expectedServiceDate', name: '期望服务日期', type: 'date', options: [] },
  { id: 'description', name: '申请说明', type: 'textarea', options: [] },
];

export function isSystemApplicationField(id: string): boolean {
  return initialApplicationFields.some(field => field.id === id);
}

// Keep required system field types and user-defined labels/options consistent.
export function normalizeApplicationFields(fields: RequestField[] = []): RequestField[] {
  const ids = initialApplicationFields.map(field => field.id);
  return [
    ...initialApplicationFields.map(seed => {
      const stored = fields.find(field => field.id === seed.id);
      return { ...seed, ...stored, name: stored?.name?.trim() || seed.name, type: seed.type, referenceTarget: seed.referenceTarget, options: structuredClone(seed.id === 'requestType' ? seed.options : stored?.options ?? seed.options) };
    }),
    ...fields.filter(field => !ids.includes(field.id)).map(field => ({ ...field, options: structuredClone(field.options) })),
  ];
}
