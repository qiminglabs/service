'use client';

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
  return <article>
    <div>
      <strong>{formatDayRequirements(approval.gaps ?? fallbackGaps) || `${formatDays(approval.days)} 人天`}额度特批</strong>{' '}
      <span className="sr-assessment-badge">{approval.state}</span>
      <p>{approval.reason}</p>
      <small>{approval.author} 发起 · {approval.workflow ? approval.workflow.ruleName : '上级审批人：' + approval.approver} · {stamp(approval.at)}</small>
      {approval.workflow && <ol className="sr-approval-step-history">{approval.workflow.steps.map(step => <li key={step.id}>
        <strong>{step.nodeName} · {step.approver}</strong>{' '}<span className="sr-assessment-badge">{step.state}</span>
        {step.cutoff && <small>审批截止人</small>}
        {step.fallback && <small>默认审批人兜底：{step.fallbackReason}</small>}
        {step.note && <p>{step.note} · {stamp(step.decidedAt)}</p>}
      </li>)}</ol>}
      {approval.note && <p className="sr-ops-decision">{approval.decidedBy}：{approval.note}</p>}
    </div>
    {children}
  </article>;
}
