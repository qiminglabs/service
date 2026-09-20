import type { IdentitySources } from './internal-users';
import type { OperationActor } from './request-operations';

export type PortalType = 'staff' | 'customer' | 'partner';
export type PortalView =
  | 'manager-home'
  | 'requests'
  | 'projects'
  | 'catalog'
  | 'reference-data'
  | 'field-settings';
export const portalDefinitions: Record<
  PortalType,
  { title: string; views: readonly PortalView[] }
> = {
  staff: {
    title: '服务管理中心',
    views: ['manager-home', 'requests', 'projects', 'catalog', 'reference-data', 'field-settings'],
  },
  customer: { title: '客户中心', views: ['requests', 'projects'] },
  partner: { title: '合作伙伴中心', views: ['projects'] },
};

export type PortalContext = {
  type: PortalType | null;
  title: string;
  organizationId: string;
  organizationName: string;
  views: readonly PortalView[];
};

// Collapse only the switcher, retaining the full directory for assignments.
export function portalSwitchIdentities(
  identities: OperationActor[],
  selectedId: string,
  sources: IdentitySources,
): OperationActor[] {
  const groups = new Map<string, OperationActor>();
  for (const identity of identities) {
    const portal = resolvePortalContext(identity, sources);
    if (!portal.type) continue;
    const key = JSON.stringify([
      portal.type,
      portal.organizationId,
      identity.role,
    ]);
    if (!groups.has(key) || identity.id === selectedId)
      groups.set(key, identity);
  }
  return [...groups.values()];
}

// Presentation context for the local prototype; production authorization must
// resolve organization membership and permissions on the server.
export function resolvePortalContext(
  actor: OperationActor,
  sources: IdentitySources,
): PortalContext {
  const empty: PortalContext = {
    type: null,
    title: '服务平台',
    organizationId: '',
    organizationName: '请选择身份',
    views: [],
  };
  if (!actor.id) return empty;
  if (actor.role === 'SmartX 销售经理' || actor.role.startsWith('SmartX ')) {
    return {
      type: 'staff',
      ...portalDefinitions.staff,
      views:
        actor.role === 'SmartX 系统管理员'
          ? portalDefinitions.staff.views
          : actor.role === 'SmartX 项目经理'
            ? ['manager-home', 'requests', 'projects', 'catalog']
            : ['SmartX 服务工程师', 'SmartX 销售经理'].includes(actor.role)
              ? ['requests', 'projects']
              : ['requests'],
      organizationId: 'smartx',
      organizationName: '北京志凌海纳科技有限公司',
    };
  }
  const type =
    actor.role === '客户'
      ? 'customer'
      : actor.role === '合作伙伴服务工程师'
        ? 'partner'
        : null;
  if (!type) return empty;
  const organizationId =
    type === 'customer'
      ? sources.contacts?.find(
          (record) => record.id === actor.id && record.status === '启用',
        )?.customerId
      : sources.partnerUsers?.find(
          (record) => record.id === actor.id && record.status === '启用',
        )?.partnerId;
  const organization = (
    type === 'customer' ? sources.customers : sources.partners
  )?.find((record) => record.id === organizationId && record.status === '启用');
  if (!organization) return empty;
  return {
    type,
    ...portalDefinitions[type],
    organizationId: organization.id,
    organizationName: organization.name,
  };
}
