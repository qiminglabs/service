import type { OperationActor } from './request-operations';
import type { InternalUser } from './service-requests';

// Demo administrators may perform another user's action, never bypass workflow state.
export function isDemoAdministrator(actor?: OperationActor, users?: InternalUser[]) {
  return actor?.id === 'USR-006' && actor.role === 'SmartX 系统管理员'
    && (!users || users.some(user => user.id === actor.id && user.status === '启用'));
}

export function canActForUser(actor: OperationActor | undefined, userId: string | undefined) {
  return !!actor?.id && (actor.id === userId || isDemoAdministrator(actor));
}
