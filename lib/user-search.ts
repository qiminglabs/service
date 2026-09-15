import type { InternalUser } from './service-requests';

export type UserSearchOption = Pick<InternalUser, 'id' | 'name' | 'email'> & { disabled: boolean };

export function matchesUserSearch(user: Pick<UserSearchOption, 'name' | 'email'>, query: string) {
  return `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase());
}

export function userSearchOptions(users: InternalUser[], value: string, eligibleIds?: string[]) {
  const eligible = eligibleIds === undefined ? null : new Set(eligibleIds);
  const available = users.filter(user => user.status === '启用' && (!eligible || eligible.has(user.id)))
    .map(user => ({ id: user.id, name: user.name, email: user.email, disabled: false }));
  const original = users.find(user => user.id === value);
  const selected: UserSearchOption | null = value
    ? available.find(user => user.id === value) ?? { id: value, name: original?.name ?? value, email: original?.email ?? '', disabled: true }
    : null;
  return { selected, items: selected?.disabled ? [selected, ...available] : available, availableCount: available.length };
}
