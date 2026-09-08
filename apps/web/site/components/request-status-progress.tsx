'use client';

import { Check, Square } from 'lucide-react';
import { requestProgressSteps } from '@/lib/service-requests';
import type { RequestStatus } from '@/lib/service-requests';

export function RequestStatusProgress({ status }: { status: RequestStatus }) {
  const cancelled = status === '已取消';
  return (
    <section
      className="sr-status-progress"
      data-cancelled={cancelled || undefined}
      aria-label={'服务请求状态：' + status}
    >
      <ol className="sr-status-steps">
        {requestProgressSteps(status).map((step, index) => (
          <li
            key={step.label}
            data-state={step.state}
            aria-current={step.state === 'current' ? 'step' : undefined}
          >
            <span className="sr-status-node">
              <span className="sr-status-circle" aria-hidden="true">
                {cancelled ? (
                  <Square size={13} />
                ) : step.state === 'complete' ||
                  (step.state === 'current' && step.label === '已转服务项目') ? (
                  <Check size={16} />
                ) : (
                  index + 1
                )}
              </span>
              <span>{step.label}</span>
              {step.state === 'complete' && (
                <span className="sr-only">，已完成</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
