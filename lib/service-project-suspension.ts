import type { ServiceProjectRecord } from './service-projects';
import type { OperationActor } from './request-operations';
import type { InternalUser } from './service-requests';
import { canManageProjectLifecycle } from './service-project-cancellation.ts';
import { appendProjectActivity } from './service-project-activity.ts';

const activeStages = ['待启动', '进行中', '待复核', '待确认'] as const;
export function canPauseServiceProject(project: ServiceProjectRecord, actor: OperationActor, users: InternalUser[]) {
  return activeStages.includes(project.status as typeof activeStages[number]) && canManageProjectLifecycle(project, actor, users);
}
export function canResumeServiceProject(project: ServiceProjectRecord, actor: OperationActor, users: InternalUser[]) {
  return project.status === '已暂停' && !!project.suspension && activeStages.includes(project.suspension.fromStatus)
    && canManageProjectLifecycle(project, actor, users);
}
export function changeServiceProjectSuspension(project: ServiceProjectRecord, actor: OperationActor, users: InternalUser[], action: 'pause' | 'resume', at = new Date().toISOString(), reason = ''): ServiceProjectRecord {
  if (action === 'pause' ? !canPauseServiceProject(project, actor, users) : action === 'resume' ? !canResumeServiceProject(project, actor, users) : true)
    throw new Error('当前身份或项目状态不允许暂停或恢复项目。');
  if (action === 'pause' && (!reason.trim() || reason.trim().length > 2000)) throw new Error('请填写暂停原因，不超过 2000 字。');
  const next = structuredClone(project);
  if (action === 'pause') {
    next.suspension = { reason: reason.trim(), at, actorId: actor.id, actor: actor.name, fromStatus: project.status as NonNullable<ServiceProjectRecord['suspension']>['fromStatus'] };
    next.status = '已暂停';
  } else {
    next.status = project.suspension!.fromStatus;
    delete next.suspension;
  }
  next.revision += 1;
  next.updatedAt = at;
  return appendProjectActivity(next, actor, '项目', action === 'pause' ? '暂停项目' : '恢复项目', `${project.status} → ${next.status}${action === 'pause' ? `；${reason.trim()}` : ''}`, at);
}
