import type { Partner, PartnerUser } from './partner-directory';

export const internalProjectProvider = {
  id: 'provider:smartx',
  name: '北京志凌海纳科技有限公司',
};
export type ProjectServiceProvider = { id: string; name: string };

// Keep identities distinct even when a partner has the same display name as SmartX.
export function projectServiceProviders(
  partners: Partner[],
): ProjectServiceProvider[] {
  return [
    internalProjectProvider,
    ...partners.map((partner) => ({
      id: `partner:${partner.id}`,
      name: partner.name,
    })),
  ];
}

export function ownProjectServiceProvider(userId: string, partners: Partner[], users: PartnerUser[]): ProjectServiceProvider | undefined {
  const user = users.find(person => person.id === userId && person.status === '启用');
  const partner = user && partners.find(company => company.id === user.partnerId && company.status === '启用');
  return partner ? { id: `partner:${partner.id}`, name: partner.name } : undefined;
}
