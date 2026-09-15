'use client';

import { useEffect, useState } from 'react';
import { FileText, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { requestMaterialGroups } from '@/lib/request-materials';
import { requestMaterialFiles, requestMaterialsCustomerVisible } from '@/lib/service-requests';
import { isInternal } from '@/lib/request-operations';
import type { ServiceRequest } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

export function RequestMaterialsPanel({ record, actor, readonly, busy, onMaterial }: {
  record: ServiceRequest;
  actor: OperationActor;
  readonly: boolean;
  busy: boolean;
  onMaterial: (target: { itemId: string; requirementId: string }) => void;
}) {
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const highlightedItem = hoveredItem ?? focusedItem;
  useEffect(() => {
    if (!highlightedItem) return;
    const target = document.getElementById(`sr-service-${record.id}-${highlightedItem}`);
    target?.setAttribute('data-material-highlight', 'true');
    return () => { target?.removeAttribute('data-material-highlight'); };
  }, [record.id, highlightedItem]);
  const internal = isInternal(actor.role);
  const customerVisible = requestMaterialsCustomerVisible(record);
  const groups = requestMaterialGroups(record).map(group => ({ group, files: requestMaterialFiles(record, group.material, internal ? 'internal' : 'customer') }));
  if (!internal && !customerVisible) return null;
  return <section className={`sr-panel sr-request-materials-panel${customerVisible ? ' sr-customer-visible-panel' : ''}`} aria-label="申请材料">
    <div className="sr-panel-heading"><div className="sr-panel-title-with-visibility">
      <h3>申请材料</h3>
      {customerVisible && <CustomerVisibleBadge />}
    </div></div>
    {!groups.length ? <div className="sr-materials-empty">{record.items.length ? '当前服务项没有材料要求。' : '添加服务项后，将在此显示材料要求。'}</div> : <div className="sr-request-material-list">
      {groups.map(({ group, files }) => {
        const member = group.members[0];
        const related = group.members.filter((entry, index, members) => members.findIndex(other => other.item.id === entry.item.id) === index);
        return <article className="sr-request-material-row" key={group.key}>
          <FileText className="sr-request-material-icon" size={22} aria-hidden="true" />
          <div className="sr-request-material-copy">
            <div className="sr-request-material-title"><h4>{group.requirement.name}</h4>
              <span className="sr-badge" data-tone={files.length ? 'green' : 'amber'}>{files.length ? '已提供' : '待提供'}</span>
            </div>
            <div className="sr-material-relations">
              <span className="sr-material-relations-label"><Link2 size={14} aria-hidden="true" />关联服务项</span>
              {related.map(entry => <button type="button" className="sr-material-relation" key={entry.item.id}
              onMouseEnter={() => setHoveredItem(entry.item.id)} onMouseLeave={() => setHoveredItem(null)}
              onFocus={() => setFocusedItem(entry.item.id)} onBlur={() => setFocusedItem(null)}
              onClick={() => document.getElementById(`sr-service-${record.id}-${entry.item.id}`)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}
              title={`查看关联服务项：${entry.item.serviceName}`}
              aria-label={`定位服务项 ${entry.index + 1} ${entry.item.serviceName}`}>
              <span className="sr-material-relation-number">{String(entry.index + 1).padStart(2, '0')}</span><span>{entry.item.serviceName}</span>
            </button>)}</div>
            {files.length > 0 && <ul className="sr-material-file-summary">{files.map(file => <li key={file.id}>
              <span>{file.name}</span>
            </li>)}</ul>}
          </div>
          <Button variant="outline" disabled={busy}
            onClick={() => onMaterial({ itemId: member.item.id, requirementId: member.requirement.id })}>
            {readonly || files.length ? '查看材料' : '填写材料'}
          </Button>
        </article>;
      })}
    </div>}
  </section>;
}
