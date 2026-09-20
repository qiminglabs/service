import type { RequestField } from '../components/request-field-settings';
import { fieldLabels, itemDisplayFields, requestFieldIsVisible, type RequestItem } from './service-requests.ts';
import { requestFormOrder } from './request-form-layout.ts';
import { addressLabel, isAddressValue } from './request-address.ts';

const fixedTypes: Record<string, RequestField['type']> = {
  address: 'address', nodes: 'integer', tibCount: 'integer', instanceCount: 'integer', clusterCount: 'integer',
  description: 'textarea', method: 'single', businessObjects: 'lookup',
};
export function workOrderField(item: RequestItem, id: string, directoryFields: RequestField[] = []): RequestField {
  const saved = item.config.fieldDefinitions?.[id];
  const definition = directoryFields.find(field => field.id === id);
  const options = id === 'method' ? item.methods : item.config.fieldOptions[id] ?? saved?.options.filter(option => option.enabled).map(option => option.value) ?? definition?.options.filter(option => option.enabled).map(option => option.value) ?? [];
  return {
    id,
    name: item.config.fieldNames[id] || saved?.name || fieldLabels[id] || ({ method: '服务方式', description: '服务说明', businessObjects: '业务对象' }[id]) || id,
    type: id === 'method' ? item.methodFieldType ?? saved?.type ?? 'single' : saved?.type ?? fixedTypes[id] ?? definition?.type ?? (options.length ? 'single' : 'text'),
    referenceTarget: saved?.referenceTarget ?? definition?.referenceTarget,
    options: options.map(value => ({ value, enabled: true })),
  };
}
export function snapshotWorkOrderForm(item: RequestItem, fields: RequestField[] = []): RequestItem {
  const snapshot = structuredClone(item);
  snapshot.config.fieldDefinitions = Object.fromEntries(requestFormOrder(item.config).map(id => [id, workOrderField(item, id, fields)]));
  return snapshot;
}
export function workOrderVisibleFields(item: RequestItem) {
  return requestFormOrder(item.config).filter(id => ['method', 'description', 'businessObjects'].includes(id) || requestFieldIsVisible(item.config, id, item.method, item.values));
}
export function workOrderFieldValue(item: RequestItem, id: string): string {
  if (id === 'description') return item.description || '—';
  const field = itemDisplayFields(item).find(field => field.key === id);
  if (field) return field.value;
  const raw = item.values[id] ?? '';
  return isAddressValue(raw) ? addressLabel(raw) || '—' : raw || '—';
}
