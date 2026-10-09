'use client';
import { useI18n } from '@/lib/i18n/context';


import { useEffect, useState } from 'react';
import { FileText, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { requestMaterialGroups, type RequestMaterialGroup } from '@/lib/request-materials';
import { requestMaterialFiles, requestMaterialsCustomerVisible } from '@/lib/service-requests';
import { isInternal } from '@/lib/request-operations';
import type { ServiceRequest, RequestAudience } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

export function RequestMaterialsPanel({ record, actor, readonly, busy, onMaterial, description, audience, isGroupReadonly, showCustomerVisibility, title = '申请材料' }: {
  record: ServiceRequest;
  actor: OperationActor;
  readonly: boolean;
  busy: boolean;
  description?: string;
  title?: string;
  showCustomerVisibility?: boolean;
  isGroupReadonly?: (group: RequestMaterialGroup) => boolean;
  audience?: RequestAudience;
  onMaterial: (target: { itemId: string; requirementId: string }) => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [focusedItem, setFocusedItem] = useState<string | null>(null);
  const highlightedItem = hoveredItem ?? focusedItem;
  useEffect(() => {
    if (!highlightedItem) return;
    const target = document.getElementById(`sr-service-${record.id}-${highlightedItem}`);
    target?.setAttribute('data-material-highlight', 'true');
    return () => { target?.removeAttribute('data-material-highlight'); };
  }, [record.id, highlightedItem]);
  const internal = audience ? audience === 'internal' : isInternal(actor.role);
  const customerVisible = requestMaterialsCustomerVisible(record);
  const showVisibilityBadge = showCustomerVisibility ?? customerVisible;
  const groups = requestMaterialGroups(record).map(group => ({ group, files: requestMaterialFiles(record, group.material, internal ? 'internal' : 'customer') }));
  if (!internal && !customerVisible) return null;
  return <section className={`sr-panel sr-request-materials-panel${showVisibilityBadge ? ' sr-customer-visible-panel' : ''}`} aria-label={localize(title)}>
    <div className="sr-panel-heading"><div className="sr-panel-title-with-visibility">
      <h3>{localize(title)}</h3>
      {localize(showVisibilityBadge && <CustomerVisibleBadge />)}
    </div></div>
    {localize(description && <p className="sr-request-material-description">{localize(description)}</p>)}
    {localize(!groups.length ? <div className="sr-materials-empty">{localize(record.items.length ? '当前服务项没有材料要求。' : '添加服务项后，将在此显示材料要求。')}</div> : <div className="sr-request-material-list">
      {localize(groups.map(({ group, files }) => {
        const member = group.members[0];
        const related = group.members.filter((entry, index, members) => members.findIndex(other => other.item.id === entry.item.id) === index);
        return <article className="sr-request-material-row" data-readonly={readonly || isGroupReadonly?.(group) || undefined} key={group.key}>
          <FileText className="sr-request-material-icon" size={22} aria-hidden="true" />
          <div className="sr-request-material-copy">
            <div className="sr-request-material-title"><h4>{localize(group.requirement.name)}{localize(group.requirement.required && <sup className="sr-material-required" aria-label={localize("必填")}>*</sup>)}</h4>
              <span className="sr-badge" data-tone={files.length ? 'green' : group.requirement.required ? 'amber' : 'muted'}>{localize(files.length ? '已提供' : group.requirement.required ? '待提供' : '选填')}</span>
            </div>
            <div className="sr-material-relations">
              <span className="sr-material-relations-label"><Link2 size={14} aria-hidden="true" />{localize("关联服务项")}</span>
              {localize(related.map(entry => <button type="button" className="sr-material-relation" key={entry.item.id}
              onMouseEnter={() => setHoveredItem(entry.item.id)} onMouseLeave={() => setHoveredItem(null)}
              onFocus={() => setFocusedItem(entry.item.id)} onBlur={() => setFocusedItem(null)}
              onClick={() => document.getElementById(`sr-service-${record.id}-${entry.item.id}`)?.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })}
              title={localizeMessage("查看关联服务项：{0}", [localize(entry.item.serviceName)])}
              aria-label={localizeMessage("定位服务项 {0} {1}", [localize(entry.index + 1), localize(entry.item.serviceName)])}>
              <span className="sr-material-relation-number">{localize(String(entry.index + 1).padStart(2, '0'))}</span><span>{localize(entry.item.serviceName)}</span>
            </button>))}</div>
            {localize(files.length > 0 && <ul className="sr-material-file-summary">{localize(files.map(file => <li key={file.id}>
              <span>{localize(file.name)}</span>
            </li>))}</ul>)}
          </div>
          <Button variant="outline" disabled={busy}
            onClick={() => onMaterial({ itemId: member.item.id, requirementId: member.requirement.id })}>
            {localize(readonly || isGroupReadonly?.(group) || files.length ? '查看材料' : '填写材料')}
          </Button>
        </article>;
      }))}
    </div>)}
  </section>;
}
