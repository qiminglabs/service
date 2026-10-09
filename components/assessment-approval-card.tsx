'use client';
import { useI18n } from '@/lib/i18n/context';
import { translateExact } from '@/lib/i18n/translate';
import type { ReactNode } from 'react';
import type { GapApproval } from '@/lib/request-assessment';
import type { DayRequirement } from '@/lib/request-asset-coverage';
import { formatDays } from '@/lib/day-quantity';

function stamp(value?: string) {
  const date = new Date(value ?? '');
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function AssessmentApprovalCard({ approval, fallbackGaps = [], children }: {
  approval: GapApproval; fallbackGaps?: DayRequirement[]; children?: ReactNode;
}) {
  const { localize, localizeList, localizeMessage, locale, labels } = useI18n();
  const gaps = approval.gaps ?? fallbackGaps;
  const days = gaps.length
    ? localizeList(gaps.map(row => localizeMessage('{0} {1} 人天', [localize(row.method), formatDays(row.days)])))
    : localizeMessage('{0} 人天', [formatDays(approval.days)]);
  // Only explicitly registered text is translated in saved names and comments.
  const savedText = (value: string) => translateExact(value, locale, labels);
  const source = approval.workflow
    ? savedText(approval.workflow.ruleName)
    : localizeMessage('上级审批人：{0}', [approval.approver]);
  return <article>
    <div>
      <strong>{localizeMessage('{0}额度特批', [days])}</strong>{' '}
      <span className="sr-assessment-badge">{localize(approval.state)}</span>
      <p>{savedText(approval.reason)}</p>
      <small>{localizeMessage('{0} 发起 · {1} · {2}', [approval.author, source, stamp(approval.at)])}</small>
      {approval.workflow && <ol className="sr-approval-step-history">{approval.workflow.steps.map(step => <li key={step.id}>
        <strong>{savedText(step.nodeName)} · {step.approver}</strong>{' '}
        <span className="sr-assessment-badge">{localize(step.state)}</span>
        {step.cutoff && <small>{localize('审批截止人')}</small>}
        {step.fallback && <small>{localizeMessage('默认审批人兜底：{0}', [localize(step.fallbackReason ?? '')])}</small>}
        {step.note && <p>{savedText(step.note)} · {stamp(step.decidedAt)}</p>}
      </li>)}</ol>}
    </div>
    {children}
  </article>;
}
