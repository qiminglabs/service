import type { RequestField } from '../components/request-field-settings';
import { resolveRequestConfig, type CatalogService, type RequestConfig, type RequestItem } from './service-requests.ts';

export type ProjectItemFieldMapping = { source: RequestField; target: RequestField; readonly: boolean };
export type ItemMappingDirectory = { requestFields?: RequestField[]; services?: CatalogService[]; itemConfigs?: RequestConfig[] };
const reserved = ['method', 'description', 'businessObjects', '__proto__', 'constructor', 'prototype'];
export function itemMappingTargets(directory: ItemMappingDirectory): RequestField[] {
  return (directory.requestFields ?? []).filter(field => !reserved.includes(field.id));
}
export function mapItemFields(item: RequestItem, directory: ItemMappingDirectory) {
  const service = directory.services?.find(service => service.id === item.serviceId);
  const targetConfig = service ? resolveRequestConfig(service, directory.itemConfigs ?? []) : undefined;
  // Both objects share field identifiers; copy data without renaming or aliasing.
  const values = structuredClone(item.values);
  // Materials have their own mapping. Field layout comes from the target form,
  // while mapped values remain stored even when that form does not display them.
  const config: RequestConfig = targetConfig
    ? { ...structuredClone(targetConfig), materials: structuredClone(item.config.materials) }
    : { serviceId: item.serviceId, revision: 0, fields: [], fieldNames: {}, fieldOptions: {}, materials: structuredClone(item.config.materials), basicFields: structuredClone(item.config.basicFields) };
  config.fields = config.fields.filter(id => directory.requestFields?.some(field => field.id === id));
  return { values, config };
}
