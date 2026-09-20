'use client';
import { useState } from 'react';
import { Info, X } from 'lucide-react';
import type { ProjectNextStep } from '@/lib/service-project-next-step';

export function ServiceProjectNextStepBanner({ next }: { next: ProjectNextStep }) {
  const [dismissed, setDismissed] = useState('');
  const current = JSON.stringify(next);
  if (dismissed === current) return null;
  return <aside className="sr-next-step" aria-label="下一步操作" role="status">
    <Info size={15} aria-hidden="true" />
    <span className="sr-next-step-label">{next.site ? '下一步' : '流程提示'}</span>
    <span className="sr-next-step-content">{next.site && <>前往<strong>{next.site}</strong>，由<strong>{next.actor}</strong></>}{next.action}</span>
    <button type="button" className="sr-next-step-close" aria-label="临时关闭流程提示" title="临时关闭" onClick={() => setDismissed(current)}><X size={16} aria-hidden="true" /></button>
  </aside>;
}
