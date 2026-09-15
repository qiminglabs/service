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

// Visible fields stay in form order. Legacy left/right assignments are ignored.
export function requestFormLayoutFields(config: RequestConfig, visibleIds = requestFormOrder(config)) {
  const visible = new Set(visibleIds);
  return requestFormOrder(config).filter(id => visible.has(id)).map(id => ({
    id, gridColumn: requestFieldGridColumn(config, id),
  }));
}

export function moveRequestFormField(order: string[], id: string, targetId?: string): string[] {
  if (id === targetId) return order;
  const targetIndex = targetId ? order.indexOf(targetId) : -1;
  const next = order.filter(field => field !== id);
  // For existing fields the target's original index gives natural forward/backward
  // movement, including adjacent cards. New fields insert before the target.
  next.splice(targetIndex < 0 ? next.length : Math.min(targetIndex, next.length), 0, id);
  return next;
}
