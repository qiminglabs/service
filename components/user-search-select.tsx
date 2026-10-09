'use client';
import { useI18n } from '@/lib/i18n/context';


import { Combobox, ComboboxInput, ComboboxContent, ComboboxEmpty, ComboboxList, ComboboxItem } from '@/components/ui/combobox';
import { matchesUserSearch, userSearchOptions, type UserSearchOption } from '@/lib/user-search';
import type { InternalUser } from '@/lib/service-requests';

export function UserSearchSelect({ id, label, users, eligibleIds, value, onChange, disabled = false, required = false, emptyHint }: {
  id?: string;
  label: string;
  users: InternalUser[];
  eligibleIds?: string[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  required?: boolean;
  emptyHint?: string;
}) {
  const { localize } = useI18n();
  const { selected, items, availableCount } = userSearchOptions(users, value, eligibleIds);
  return <div className="user-search-select">
    <Combobox items={items} value={selected} disabled={disabled} required={required} limit={50}
      itemToStringLabel={(user: UserSearchOption) => `${user.name}${user.email ? ` · ${user.email}` : ''}${user.disabled ? '（不可用，请重新选择）' : ''}`}
      itemToStringValue={(user: UserSearchOption) => user.id}
      isItemEqualToValue={(a: UserSearchOption, b: UserSearchOption) => a.id === b.id}
      filter={matchesUserSearch}
      onValueChange={(user: UserSearchOption | null) => { if (!user?.disabled) onChange(user?.id ?? ''); }}>
      <ComboboxInput id={id} className="w-full" aria-label={localize(label)} aria-required={required} placeholder={localize("搜索姓名或邮箱")} disabled={disabled} showClear />
      <ComboboxContent>
        <ComboboxEmpty>{localize(availableCount ? '未找到匹配的用户' : '暂无可选用户')}</ComboboxEmpty>
        <ComboboxList>{(user: UserSearchOption) => <ComboboxItem key={user.id} value={user} disabled={user.disabled}>
          <span className="min-w-0"><span className="block break-words">{localize(user.name)}{localize(user.disabled && '（不可用）')}</span><small className="block break-words text-muted-foreground">{localize(user.email)}</small></span>
        </ComboboxItem>}</ComboboxList>
        {localize(availableCount > 50 && <p className="px-3 py-2 text-xs text-muted-foreground">{localize("最多显示 50 项，可按姓名或邮箱搜索全部可选用户。")}</p>)}
      </ComboboxContent>
    </Combobox>
    {localize(!value && emptyHint && <small className="sr-help">{localize(emptyHint)}</small>)}
  </div>;
}
