'use client';

import type { ReactNode } from 'react';
import type { RequestConfig } from '@/lib/service-requests';
import { requestFormSections } from '@/lib/request-form-layout';

export function RequestFormLayout({ config, visibleIds, renderField, onPlaceField }: {
  config: RequestConfig;
  visibleIds?: string[];
  renderField: (id: string) => ReactNode;
  onPlaceField?: (id: string, column: 'left' | 'right', before?: string) => void;
}) {
  const sections = requestFormSections(config, visibleIds);
  if (onPlaceField && sections.at(-1)?.kind !== 'columns')
    sections.push({ kind: 'columns', key: 'append', left: [], right: [] });
  return <div className="rf-independent-layout" data-editing={!!onPlaceField}>
    {sections.map(section => section.kind === 'full'
      ? <div key={section.key} className="rf-layout-full">{renderField(section.field)}</div>
      : <div key={section.key} className="rf-layout-columns">
        {(['left', 'right'] as const).map(column => <div
          key={column}
          className="rf-layout-column"
          data-column={column}
          onDragOver={onPlaceField ? event => { event.preventDefault(); event.stopPropagation(); } : undefined}
          onDrop={onPlaceField ? event => {
            event.preventDefault();
            event.stopPropagation();
            onPlaceField(event.dataTransfer.getData('application/x-request-field'), column, section.before);
          } : undefined}
        >
          {section[column].map(id => <div key={id} className="rf-layout-field">{renderField(id)}</div>)}
          {onPlaceField && <div className="rf-column-drop-hint">拖到{column === 'left' ? '左' : '右'}列</div>}
        </div>)}
      </div>)}
  </div>;
}
