import messages from './en.json' with { type: 'json' };
import patterns from './patterns.json' with { type: 'json' };
export type Locale = 'zh-CN' | 'en';
const dictionary: Record<string, string> = messages;
const templateDictionary: Record<string, string> = Object.fromEntries(patterns);

// Saved prose and configured names only use an explicitly registered full label.
// Unlike legacy UI messages, their contents must never be inferred from patterns.
export function translateExact(value: string, locale: Locale, overrides: Record<string, string> = {}): string {
  if (locale !== 'en') return value;
  if (Object.hasOwn(overrides, value)) return overrides[value];
  return Object.hasOwn(dictionary, value) ? dictionary[value] : value;
}
const templates = (patterns as string[][]).map(([source, target]) => ({
  matcher: new RegExp('^' + source.trim().split(/\{\d+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)') + '$'),
  target, source,
}));

function translateString(value: string, overrides: Record<string, string>): string {
  if (!/[\u3400-\u9fff]/.test(value)) return value;
  const trimmed = value.trim();
  const direct = overrides[trimmed] ?? dictionary[trimmed] ?? overrides[trimmed.replace(/\s+/g, ' ')] ?? dictionary[trimmed.replace(/\s+/g, ' ')];
  if (direct !== undefined) return value.replace(trimmed, direct);
  for (const { matcher, target, source } of templates) {
    const match = trimmed.match(matcher);
    if (match) return value.replace(trimmed, (overrides[source] ?? target).trim().replace(/\{(\d+)\}/g, (_, index) => translateString(match[Number(index) + 1] ?? '', overrides)));
  }
  // Translate independently rendered labels around punctuation, but never
  // translate arbitrary substrings inside customer names or free-form content.
  const parts = value.split(/(\s+[·|/]\s+|\n)/);
  if (parts.length > 1) return parts.map(part => { const label = overrides[part.trim()] ?? dictionary[part.trim()]; return label ? part.replace(part.trim(), label) : part; }).join('');
  const suffix = trimmed.match(/^(.+?)([：:])$/);
  if (suffix && (overrides[suffix[1]] ?? dictionary[suffix[1]])) return value.replace(trimmed, (overrides[suffix[1]] ?? dictionary[suffix[1]]) + ':');
  return value;
}

// Only presentation strings change. Objects, callbacks, numeric values and
// React elements retain their identity; persisted business values stay Chinese.
export function translate<T>(value: T, locale: Locale, overrides: Record<string, string> = {}): T {
  if (locale !== 'en') return value;
  if (typeof value === 'string') return translateString(value, overrides) as T;
  if (Array.isArray(value)) {
    const next = value.map(item => translate(item, locale, overrides));
    return (next.some((item, index) => item !== value[index]) ? next : value) as T;
  }
  return value;
}

// Join display labels only after translating each item; never split free-form text.
export function translateList(values: readonly string[], locale: Locale, overrides: Record<string, string> = {}, separator = '、'): string {
  return translate(values, locale, overrides).join(locale === 'en' && (separator === '、' || separator === '，') ? ', ' : separator);
}

// Select the complete sentence before inserting values. Values are deliberately
// opaque: callers explicitly translate UI labels and leave user content intact.
export function translateMessage(source: string, values: readonly (string | number)[], locale: Locale, overrides: Record<string, string> = {}): string {
  const template = locale === 'en' ? overrides[source] ?? dictionary[source] ?? templateDictionary[source] ?? source : source;
  return template.replace(/\{(\d+)\}/g, (token, index) => values[Number(index)] === undefined ? token : String(values[Number(index)]));
}
