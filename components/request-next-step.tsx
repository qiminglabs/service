'use client';
import { useI18n } from '@/lib/i18n/context';


import { useState } from 'react';
import { Info, X } from 'lucide-react';
import type { ContactRef, CustomerRef, InternalUser, ServiceRequest } from '@/lib/service-requests';
import { requestNextStep } from '@/lib/request-next-step';

export function RequestNextStepBanner({ record, users, customers, contacts }: {
  record: ServiceRequest; users: InternalUser[]; customers: CustomerRef[]; contacts: ContactRef[];
}) {
  const { localize } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  const next = requestNextStep(record, users, customers, contacts);
  return (
    <aside className="sr-next-step" aria-label={localize("下一步操作")} role="status">
      <Info size={15} aria-hidden="true" />
      <span className="sr-next-step-label">{localize(next.site ? '下一步' : '流程提示')}</span>
      <span className="sr-next-step-content">{localize(next.site && <>{localize("前往")}<strong>{localize(next.site)}</strong>{localize("，由")}<strong>{localize(next.actor)}</strong></>)}{localize(next.action)}</span>
      <button type="button" className="sr-next-step-close" aria-label={localize("临时关闭流程提示")} title={localize("临时关闭")} onClick={() => setDismissed(true)}>
        <X size={16} aria-hidden="true" />
      </button>
    </aside>
  );
}
