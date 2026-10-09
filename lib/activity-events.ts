import catalog from './activity-messages.json' with { type: 'json' };
import { translateExact } from './i18n/translate.ts';

export type ActivityText = string | number | { kind: 'message'; key: string; values: ActivityText[] } | { kind: 'list'; items: ActivityText[]; separator: string } | { kind: 'label'; value: string };
export type ActivityEvent = { version: 1; type: string; params: { title: ActivityText; detail: ActivityText } };
const messages: Record<string, { id: string; en: string }> = catalog;
export function activityMessage(key: string, values: (ActivityText | undefined | null)[] = []): ActivityText { return { kind: 'message', key, values: values.map(value => value == null ? String(value) : value) }; }
export function activityList(items: ActivityText[], separator = '、'): ActivityText { return { kind: 'list', items, separator }; }
export function activityLabel(value: string): ActivityText { return { kind: 'label', value }; }
export function renderActivityText(value: ActivityText, locale: 'zh-CN' | 'en'): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value.kind === 'label') return translateExact(value.value, locale);
  if (value.kind === 'list') {
    const separator = locale === 'en' ? ({ '、': ', ', '；': '; ', '，': ', ' }[value.separator] ?? value.separator) : value.separator;
    return value.items.map(item => renderActivityText(item, locale)).join(separator);
  }
  const template = locale === 'en' ? messages[value.key]?.en ?? value.key : value.key;
  return template.replace(/\{(\d+)\}/g, (token, index) => value.values[Number(index)] === undefined ? token : renderActivityText(value.values[Number(index)], locale));
}
export function activityFields(scope: 'request' | 'project', title: ActivityText, detail: ActivityText = ''): { title: string; detail: string; event: ActivityEvent } {
  // Snapshot structured parameters as well as Chinese compatibility fields.
  const params = structuredClone({ title: typeof title === 'string' && messages[title] ? activityMessage(title) : title, detail });
  const type = typeof params.title === 'object' && params.title.kind === 'message' ? messages[params.title.key]?.id : undefined;
  return { title: renderActivityText(params.title, 'zh-CN'), detail: renderActivityText(params.detail, 'zh-CN'), event: { version: 1, type: `${scope}.${type ?? 'note'}`, params } };
}
