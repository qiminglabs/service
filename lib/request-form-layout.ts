import { businessObjectsEnabled } from './service-requests.ts';
import type { RequestConfig } from './service-requests';

export function requestFormOrder(config: RequestConfig): string[] {
  const enabled = [
    'method',
    ...(config.basicFields?.description?.enabled !== false
      ? ['description']
      : []),
    ...config.fields.filter(
      (id) => !['method', 'description', 'businessObjects'].includes(id),
    ),
    ...(businessObjectsEnabled(config) ? ['businessObjects'] : []),
  ];
  return [
    ...new Set([
      ...(config.fieldOrder ?? []).filter((id) => enabled.includes(id)),
      ...enabled,
    ]),
  ];
}
export function requestFieldWidth(config: RequestConfig, id: string) {
  return (
    config.fieldWidths?.[id] ??
    (['description', 'businessObjects'].includes(id) ? 'full' : 'half')
  );
}

export function requestFieldGridColumn(config: RequestConfig, id: string) {
  if (requestFieldWidth(config, id) === 'full') return '1 / -1';
  return config.fieldRowStarts?.includes(id) ? '1 / span 1' : 'span 1';
}
