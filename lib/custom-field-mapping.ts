import type { RequestField } from '../components/request-field-settings';
import { normalizeApplicationFields, isSystemApplicationField } from './request-application-fields.ts';
import { normalizeProjectFields, isSystemProjectField } from './service-project-fields.ts';
import type { ServiceRequest } from './service-requests';

export type CustomFieldMapping = { source: RequestField; target: RequestField; readonly: boolean };
export type MappingFieldDirectory = { applicationFields?: RequestField[]; projectFields?: RequestField[] };
export function compatibleMappingFields(source: RequestField, target: RequestField): boolean {
  if (source.type === 'lookup' || target.type === 'lookup') return source.type === target.type && !!source.referenceTarget && source.referenceTarget === target.referenceTarget;
  if (['text', 'textarea'].includes(source.type) && ['text', 'textarea'].includes(target.type)) return true;
  if (source.type === 'integer' && target.type === 'decimal') return true;
  if (source.type !== target.type) return false;
  return !['single', 'multiple'].includes(source.type) || source.options.filter(option => option.enabled).every(option => target.options.some(targetOption => targetOption.enabled && targetOption.value === option.value));
}
export function customFieldValueIssue(field: RequestField, value: unknown): string | null {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string') return `${field.name}的值无效。`;
  let valid = true;
  if (field.type === 'integer') valid = /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));
  if (field.type === 'decimal') valid = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) && Number.isFinite(Number(value));
  if (field.type === 'date') {
    const date = new Date(`${value}T12:00:00Z`);
    valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  if (field.type === 'single') valid = field.options.some(option => option.enabled && option.value === value);
  if (field.type === 'multiple') {
    try {
      const values: unknown = JSON.parse(value);
      valid = Array.isArray(values) && values.every(entry => typeof entry === 'string' && field.options.some(option => option.enabled && option.value === entry));
    } catch { valid = false; }
  }
  if (field.type === 'address') {
    try { const address = JSON.parse(value); valid = !!address && ['province', 'city', 'detail'].every(key => typeof address[key] === 'string'); } catch { valid = false; }
  }
  return valid ? null : `${field.name}的值与字段类型或可用选项不符。`;
}
export function parseCustomFieldMappings(raw: unknown): CustomFieldMapping[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('自定义字段映射无效。');
  const targets = new Set<string>();
  const types = ['text', 'textarea', 'integer', 'decimal', 'date', 'single', 'multiple', 'lookup', 'address'];
  for (const entry of raw) {
    for (const field of [entry?.source, entry?.target]) {
      if (!field || typeof field.id !== 'string' || !field.id || typeof field.name !== 'string' || !types.includes(field.type) || !Array.isArray(field.options)
        || field.options.some((option: {value?: unknown; enabled?: unknown}) => !option || typeof option.value !== 'string' || typeof option.enabled !== 'boolean')) throw new Error('自定义字段映射无效。');
    }
    if (isSystemProjectField(entry.target.id) || ['__proto__', 'constructor', 'prototype'].includes(entry.target.id) || targets.has(entry.target.id) || typeof entry.readonly !== 'boolean') throw new Error('自定义字段映射目标无效或重复。');
    if (!compatibleMappingFields(entry.source, entry.target)) throw new Error(`${entry.target.name}的来源字段类型或选项不兼容。`);
    targets.add(entry.target.id);
  }
  return structuredClone(raw);
}
const signature = (field: RequestField) => JSON.stringify([field.type, field.referenceTarget, field.options]);
export function validateCustomFieldMappings(mappings: CustomFieldMapping[] = [], directory: MappingFieldDirectory) {
  const sources = normalizeApplicationFields(directory.applicationFields);
  const targets = normalizeProjectFields(directory.projectFields);
  for (const mapping of mappings) {
    const source = sources.find(field => field.id === mapping.source.id);
    const target = targets.find(field => field.id === mapping.target.id && !isSystemProjectField(field.id));
    if (!source || !target || signature(source) !== signature(mapping.source) || signature(target) !== signature(mapping.target)) throw new Error(`${mapping.target.name}的字段定义已变化，请重新配置并保存映射。`);
    if (!compatibleMappingFields(source, target)) throw new Error(`${target.name}的来源字段类型或选项不兼容。`);
  }
}
export function mappedCustomValues(record: ServiceRequest, mappings: CustomFieldMapping[] = []) {
  return Object.fromEntries(mappings.map(({ source, target }) => {
    const value = isSystemApplicationField(source.id) ? (record as unknown as Record<string, unknown>)[source.id] ?? '' : record.customValues?.[source.id] ?? '';
    const issue = customFieldValueIssue(source, value) ?? customFieldValueIssue(target, value);
    if (issue) throw new Error(issue);
    return [target.id, value as string];
  }));
}
export function validateCustomValues(values: Record<string, string> = {}, fields: RequestField[], previous: Record<string, string> = {}) {
  for (const [id, value] of Object.entries(values)) {
    if (value === previous[id]) continue;
    const field = fields.find(field => field.id === id);
    if (!field) throw new Error('自定义字段不存在，请刷新后重试。');
    const issue = customFieldValueIssue(field, value);
    if (issue) throw new Error(issue);
  }
}
