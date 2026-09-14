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
  if (config.fieldColumns?.[id]) return config.fieldColumns[id] === 'left' ? '1 / span 1' : '2 / span 1';
  return config.fieldRowStarts?.includes(id) ? '1 / span 1' : 'span 1';
}

export type FieldPlacement = 'left' | 'right' | 'full';
export function requestFieldPlacements(config: RequestConfig): Record<string, FieldPlacement> {
  const placements: Record<string, FieldPlacement> = {};
  let next: 'left' | 'right' = 'left';
  for (const id of requestFormOrder(config)) {
    if (requestFieldWidth(config, id) === 'full') {
      placements[id] = 'full';
      next = 'left';
    } else {
      const column: 'left' | 'right' = config.fieldColumns?.[id] ?? (config.fieldRowStarts?.includes(id) ? 'left' : next);
      placements[id] = column;
      next = column === 'left' ? 'right' : 'left';
    }
  }
  return placements;
}

export function setRequestFieldPlacement(config: RequestConfig, id: string, placement: FieldPlacement): RequestConfig {
  // Freeze inferred legacy columns before an edit so neighboring fields stay put.
  const columns = { ...config.fieldColumns };
  for (const [key, position] of Object.entries(requestFieldPlacements(config)))
    if (position !== 'full') columns[key] = position;
  if (placement !== 'full') columns[id] = placement;
  return {
    ...config,
    fieldColumns: columns,
    fieldWidths: { ...config.fieldWidths, [id]: placement === 'full' ? 'full' : 'half' },
    fieldRowStarts: config.fieldRowStarts?.filter(key => key !== id),
  };
}

export type FormLayoutSection =
  | { kind: 'full'; key: string; field: string }
  | { kind: 'columns'; key: string; left: string[]; right: string[]; before?: string };

export function requestFormSections(config: RequestConfig, visibleIds = requestFormOrder(config)): FormLayoutSection[] {
  const visible = new Set(visibleIds);
  const placements = requestFieldPlacements(config);
  const sections: FormLayoutSection[] = [];
  let columns: Extract<FormLayoutSection, { kind: 'columns' }> = { kind: 'columns', key: 'start', left: [], right: [] };
  for (const id of requestFormOrder(config)) {
    if (!visible.has(id)) continue;
    const position = placements[id];
    if (position === 'full') {
      if (columns.left.length || columns.right.length) sections.push({ ...columns, before: id });
      sections.push({ kind: 'full', key: `full:${id}`, field: id });
      columns = { kind: 'columns', key: `after:${id}`, left: [], right: [] };
    } else columns[position].push(id);
  }
  if (columns.left.length || columns.right.length) sections.push(columns);
  return sections;
}
