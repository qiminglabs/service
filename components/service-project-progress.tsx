import { Check, Pause, Square } from 'lucide-react';
import { serviceProjectStatuses, serviceProjectStatusLabel } from '@/lib/service-project-status';
import type { ServiceProjectStatus } from '@/lib/service-projects';

export function ServiceProjectProgress({ status, cancelledFromStatus, pausedFromStatus, skipReview = false, external = false }: { status: ServiceProjectStatus; cancelledFromStatus?: ServiceProjectStatus; pausedFromStatus?: ServiceProjectStatus; skipReview?: boolean; external?: boolean }) {
  const originalStatus = status;
  const paused = status === '已暂停';
  const cancelled = status === '已取消';
  if (skipReview && status === '待复核') status = '进行中';
  if (skipReview && cancelledFromStatus === '待复核') cancelledFromStatus = '进行中';
  if (skipReview && pausedFromStatus === '待复核') pausedFromStatus = '进行中';
  const interrupted = cancelled || paused;
  const fromStatus = paused ? pausedFromStatus ?? '进行中' : cancelledFromStatus ?? '待确认';
  const statuses = serviceProjectStatuses.filter(stage => stage !== '已暂停' && (!skipReview || stage !== '待复核'));
  const stages = interrupted ? [...statuses.slice(0, statuses.indexOf(fromStatus) + 1), status] : statuses.filter(stage => stage !== '已取消');
  const currentStep = stages.indexOf(status);
  return <section className="sr-status-progress" data-cancelled={cancelled || undefined} data-paused={paused || undefined} aria-label={'服务项目状态：' + serviceProjectStatusLabel(originalStatus, external)}>
    <ol className="sr-status-steps">{stages.map((stage, index) => {
      const state = index === currentStep ? 'current' : !interrupted && index < currentStep ? 'complete' : 'pending';
      return <li key={stage} data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="sr-status-node"><span className="sr-status-circle" aria-hidden="true">
          {stage === '已取消' ? <Square size={13} /> : stage === '已暂停' ? <Pause size={14} /> : state === 'complete' || (stage === '已完成' && state === 'current') ? <Check size={16} /> : index + 1}
        </span><span>{serviceProjectStatusLabel(stage, external)}</span></span>
      </li>;
    })}</ol>
  </section>;
}
