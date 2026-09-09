import type { InternalUser } from './service-requests';
import type { OperationActor } from './request-operations';

// Local prototype directory only; these are not provisioned accounts.
type DirectoryUser = Omit<InternalUser, 'status'> & { status: '启用' | '停用' };
export const localInternalUsers: DirectoryUser[] = [
  {
    id: 'USR-001',
    name: '王琪',
    email: 'wang.qi@example.com',
    department: '销售部',
    status: '启用',
  },
  {
    id: 'USR-006',
    name: '陆明',
    email: 'admin@example.com',
    department: '系统管理',
    status: '启用',
  },
  {
    id: 'USR-002',
    name: '陈屿',
    email: 'chen.yu@example.com',
    department: '售前团队',
    status: '启用',
  },
  {
    id: 'USR-007',
    name: '许安',
    email: 'xu.an@example.com',
    department: '服务管理部',
    status: '停用',
  },
  {
    id: 'USR-003',
    name: '赵言',
    email: 'zhao.yan@example.com',
    department: '项目管理部',
    status: '启用',
  },
  {
    id: 'USR-004',
    name: '林澈',
    email: 'lin.che@example.com',
    department: '技术服务部',
    status: '启用',
  },
  {
    id: 'USR-005',
    name: '周遥',
    email: 'zhou.yao@example.com',
    department: '客户成功部',
    status: '停用',
  },
];

export const fixedIdentityRoles: Readonly<Record<string, string>> =
  Object.freeze({
    'USR-006': 'SmartX 系统管理员',
    'USR-001': 'SmartX 销售经理',
    'USR-002': 'SmartX 销售经理',
    'USR-005': 'SmartX 销售经理',
    'USR-007': 'SmartX 销售经理',
    'USR-003': 'SmartX 项目经理',
    'USR-004': 'SmartX 服务工程师',
  });

type NamedRecord = { id: string; name: string; status: string };
export type IdentitySources = {
  contacts?: (NamedRecord & { customerId: string })[];
  customers?: NamedRecord[];
  partnerUsers?: (NamedRecord & { partnerId: string })[];
  partners?: NamedRecord[];
};

export function ensureLocalInternalUsers(
  users: DirectoryUser[],
): DirectoryUser[] {
  // Rename the original placeholder only; preserve custom names and status.
  return [
    ...users.map((user) =>
      user.id === 'USR-005' || user.id === 'USR-007'
        ? { ...user, status: '停用' as const }
        : user.id === 'USR-006' && user.name === '系统管理员'
          ? { ...user, name: '陆明' }
          : user,
    ),
    ...localInternalUsers.filter(
      (seed) => !users.some((user) => user.id === seed.id),
    ),
  ];
}

export function operationIdentities(
  users: InternalUser[],
  sources: IdentitySources = {},
): OperationActor[] {
  return [
    ...Object.entries(fixedIdentityRoles).flatMap(([id, role]) => {
      const user = users.find(
        (user) => user.id === id && user.status === '启用',
      );
      return user ? [{ id, name: user.name, role }] : [];
    }),
    ...(sources.partnerUsers ?? [])
      .filter(
        (user) =>
          user.status === '启用' &&
          user.name.trim() &&
          sources.partners?.some(
            (partner) =>
              partner.id === user.partnerId && partner.status === '启用',
          ),
      )
      .map((user) => ({
        id: user.id,
        name: user.name,
        role: '合作伙伴服务工程师',
      })),
    ...(sources.contacts ?? [])
      .filter(
        (contact) =>
          contact.status === '启用' &&
          contact.name.trim() &&
          sources.customers?.some(
            (customer) =>
              customer.id === contact.customerId && customer.status === '启用',
          ),
      )
      .map((contact) => ({ id: contact.id, name: contact.name, role: '客户' })),
  ];
}

// Menu-only deduplication; approval and collaboration retain the full directory.
export function roleSwitchIdentities(
  identities: OperationActor[],
  selectedId: string,
): OperationActor[] {
  const byRole = new Map<string, OperationActor>();
  for (const identity of identities) {
    if (!byRole.has(identity.role) || identity.id === selectedId)
      byRole.set(identity.role, identity);
  }
  return [...byRole.values()];
}

export function resolveOperationActor(
  users: InternalUser[],
  selectedId: string,
  sources: IdentitySources = {},
): OperationActor {
  return (
    operationIdentities(users, sources).find(
      (actor) => actor.id === (selectedId || 'USR-006'),
    ) ?? { id: '', name: '', role: '客户' }
  );
}
