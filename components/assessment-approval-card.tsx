'use client';
import { useI18n } from '@/lib/i18n/context';


import type { ReactNode } from 'react';
import type { GapApproval } from '@/lib/request-assessment';
import { formatDayRequirements, type DayRequirement } from '@/lib/request-asset-coverage';
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
  const { localize } = useI18n();
  return <article>
    <div>
      <strong>{localize(formatDayRequirements(approval.gaps ?? fallbackGaps) || `${formatDays(approval.days)} 人天`)}{localize("额度特批")}</strong>{localize(' ')}
      <span className="sr-assessment-badge">{localize(approval.state)}</span>
      <p>{localize(approval.reason)}</p>
      <small>{localize(approval.author)} {localize(" 发起 ·")}{localize(approval.workflow ? approval.workflow.ruleName : '上级审批人：' + approval.approver)} · {localize(stamp(approval.at))}</small>
      {localize(approval.workflow && <ol className="sr-approval-step-history">{localize(approval.workflow.steps.map(step => <li key={step.id}>
        <strong>{localize(step.nodeName)} · {localize(step.approver)}</strong>{localize(' ')}<span className="sr-assessment-badge">{localize(step.state)}</span>
        {localize(step.cutoff && <small>{localize("审批截止人")}</small>)}
        {localize(step.fallback && <small>{localize("默认审批人兜底：")}{localize(step.fallbackReason)}</small>)}
        {localize(step.note && <p>{localize(step.note)} · {localize(stamp(step.decidedAt))}</p>)}
      </li>))}</ol>)}
    </div>
    {localize(children)}
  </article>;
}
