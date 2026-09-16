import { Check, Square } from 'lucide-react';
import { serviceProjectStatuses } from '@/lib/service-project-status';
import type { ServiceProjectStatus } from '@/lib/service-projects';

export function ServiceProjectProgress({ status, cancelledFromStatus }: { status: ServiceProjectStatus; cancelledFromStatus?: ServiceProjectStatus }) {
  const cancelled = status === '已取消';
  const stages = cancelled ? [...serviceProjectStatuses.slice(0, cancelledFromStatus ? serviceProjectStatuses.indexOf(cancelledFromStatus) + 1 : 4), '已取消'] : serviceProjectStatuses.slice(0, 5);
  const currentStep = stages.indexOf(status);
  return <section className="sr-status-progress" data-cancelled={cancelled || undefined} aria-label={'服务项目状态：' + status}>
    <ol className="sr-status-steps">{stages.map((stage, index) => {
      const state = index === currentStep ? 'current' : !cancelled && index < currentStep ? 'complete' : 'pending';
      return <li key={stage} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="sr-status-node"><span className="sr-status-circle" aria-hidden="true">
          {stage === '已取消' ? <Square size={13} /> : state === 'complete' || (stage === '已完成' && state === 'current') ? <Check size={16} /> : index + 1}
        </span><span>{stage}</span></span>
      </li>;
    })}</ol>
  </section>;
}
