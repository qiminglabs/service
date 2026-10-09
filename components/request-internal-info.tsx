'use client';
import { useI18n } from '@/lib/i18n/context';


import { useId, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { fixedInternalCollaboratorLabel } from '@/lib/request-collaboration';
import { fixedIdentityRoles } from '@/lib/internal-users';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  reconcileExternalCollaborators,
  reconcileParticipants,
} from '@/lib/service-requests';
import type {
  ContactRef,
  ExternalCollaborator,
  InternalParticipant,
  InternalUser,
} from '@/lib/service-requests';

type CollaboratorOption = { id: string; name: string; details: string; disabled?: boolean; fixed?: string };

function CollaboratorCard({
  title,
  placeholder,
  options,
  selected,
  readonly,
  busy,
  onAdd,
  onRemove,
  allowRemove = true,
  showCustomerVisibility = false,
}: {
  title: string;
  placeholder: string;
  options: CollaboratorOption[];
  selected: CollaboratorOption[];
  readonly: boolean;
  busy: boolean;
  onAdd: (ids: string[]) => void;
  onRemove: (id: string) => void;
  allowRemove?: boolean;
  showCustomerVisibility?: boolean;
}) {
  const { localize, localizeMessage } = useI18n();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const selectedIds = new Set(selected.map((person) => person.id));
  const availableIds = new Set(options.filter((person) => !person.disabled).map((person) => person.id));
  const additions = pendingIds.filter(
    (personId) => availableIds.has(personId) && !selectedIds.has(personId),
  );
  const matches = options.filter((person) =>
    (person.name + ' ' + person.details)
      .toLowerCase()
      .includes(query.toLowerCase().trim()),
  );
  return (
    <section className={`sr-panel sr-collaboration-card${showCustomerVisibility ? ' sr-customer-visible-panel' : ''}`} aria-labelledby={id}>
      <div className="sr-panel-heading">
        <div className="sr-panel-title-with-visibility">
          <h3 id={id}>
            {localize(title)} <span>{localize(selected.length)}</span>
          </h3>
          {localize(showCustomerVisibility && <CustomerVisibleBadge />)}
        </div>
        {localize(!readonly && (
          <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
              if (busy) return;
              setQuery('');
              setPendingIds([]);
              setOpen(nextOpen);
            }}
          >
            <DialogTrigger
              render={<Button size="sm" variant="outline" disabled={busy} />}
              aria-label={localize(localizeMessage("添加{0}", [String(localize(title))]))}
            >
              <Plus size={14} />
              {localize("添加")}</DialogTrigger>
            <DialogContent
              className="sr-collaborator-dialog"
              showCloseButton={!busy}
            >
              <DialogHeader>
                <DialogTitle>{localize("添加")}{localize(title)}</DialogTitle>
              </DialogHeader>
              <div className="sr-collaborator-search">
                <Search size={16} aria-hidden="true" />
                <Input
                  aria-label={localize(localizeMessage("搜索{0}", [String(localize(title))]))}
                  placeholder={localize(placeholder)}
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div
                className="sr-collaborator-results"
                aria-label={localize(localizeMessage("{0}搜索结果", [String(localize(title))]))}
              >
                {localize(matches.length ? (
                  matches.map((person) => {
                    const added = selectedIds.has(person.id);
                    return (
                      <label
                        key={person.id}
                        className="sr-collaborator-option"
                        data-added={added || undefined}
                      >
                        <Checkbox
                          checked={added || pendingIds.includes(person.id)}
                          disabled={busy || added || person.disabled}
                          onCheckedChange={(checked) =>
                            setPendingIds((previous) =>
                              checked
                                ? [...new Set([...previous, person.id])]
                                : previous.filter(
                                    (entry) => entry !== person.id,
                                  ),
                            )
                          }
                        />
                        <span className="sr-collaborator-copy">
                          <span className="sr-participant-name">
                            {localize(person.name)}
                          </span>
                          <small>{localize(person.details)}</small>
                        </span>
                        {localize(person.disabled ? <span className="sr-help">{localize("已停用")}</span> : added && <span className="sr-help">{localize("已添加")}</span>)}
                      </label>
                    );
                  })
                ) : (
                  <output className="sr-collaborator-empty">
                    {localize(query.trim() ? '没有匹配的搜索结果' : '暂无可添加的协作人')}
                  </output>
                ))}
              </div>
              <DialogFooter className="sr-collaborator-footer">
                <output>{localize("已选择")}{localize(additions.length)} {localize(" 人")}</output>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  {localize("取消")}</Button>
                <Button
                  disabled={busy || additions.length === 0}
                  onClick={() => {
                    if (busy || !additions.length) return;
                    onAdd(additions);
                    setOpen(false);
                    setPendingIds([]);
                  }}
                >
                  {localize("确认添加")}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        ))}
      </div>
      <div className="sr-internal-body">
        {localize(selected.length ? (
          <ul className="sr-participants">
            {localize(selected.map((person) => (
              <li key={person.id}>
                <span className="sr-collaborator-copy">
                  <span className="sr-participant-name" title={localize(person.name)}>
                    {localize(person.name)}
                  </span>
                  <small title={localize(person.details)}>{localize(person.details)}</small>
                </span>
                {localize(person.fixed && <span className="sr-help" title={localizeMessage("{0}为固定协作人，不允许移除", [localize(person.fixed)])}>{localize(person.fixed)}</span>)}
                {localize(!readonly && allowRemove && !person.fixed && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={localize(localizeMessage("移除{0} {1}", [String(localize(title)), String(localize(person.name))]))}
                    onClick={() => onRemove(person.id)}
                  >
                    {localize("移除")}</Button>
                ))}
              </li>
            )))}
          </ul>
        ) : (
          <p className="sr-help">{localize("未添加")}{localize(title)}</p>
        ))}
      </div>
    </section>
  );
}

export function RequestExternalCollaborators({
  applicantId,
  contacts,
  value,
  readonly,
  busy,
  onChange,
  allowRemove = true,
  showCustomerVisibility = false,
}: {
  applicantId?: string;
  contacts: ContactRef[];
  value: ExternalCollaborator[];
  readonly: boolean;
  allowRemove?: boolean;
  showCustomerVisibility?: boolean;
  busy: boolean;
  onChange: (value: ExternalCollaborator[]) => void;
}) {
  const { localize } = useI18n();
  const available = contacts.filter((contact) => contact.status === '启用');
  return (
    <CollaboratorCard
      title={localize("客户协作人")}
      showCustomerVisibility={showCustomerVisibility}
      placeholder={localize("搜索姓名、手机号或邮箱")}
      options={contacts.map((contact) => ({
        disabled: contact.status !== '启用',
        id: contact.id,
        name: contact.name,
        details: [contact.phone, contact.email].filter(Boolean).join(' · '),
      }))}
      selected={value.map((person) => {
        const contact = contacts.find(entry => entry.id === person.contactId);
        return {
          id: person.contactId,
          fixed: person.contactId === applicantId ? '申请人' : undefined,
          name: contact?.name ?? person.name,
          details: [contact?.phone ?? person.phone, contact?.email ?? person.email].filter(Boolean).join(' · '),
        };
      })}
      readonly={readonly}
      allowRemove={allowRemove}
      busy={busy}
      onAdd={(ids) =>
        onChange([
          ...value,
          ...reconcileExternalCollaborators(
            available.filter((contact) => ids.includes(contact.id)),
          ),
        ])
      }
      onRemove={(id) =>
        id !== applicantId && onChange(value.filter((person) => person.contactId !== id))
      }
    />
  );
}

export function RequestInternalInfo({
  applicantId,
  ownerUserId,
  hardwareReviewerId,
  projectManagerId,
  users,
  value,
  readonly,
  busy,
  onChange,
}: {
  applicantId?: string;
  ownerUserId?: string;
  hardwareReviewerId?: string;
  projectManagerId?: string;
  users: InternalUser[];
  value: InternalParticipant[];
  readonly: boolean;
  busy: boolean;
  onChange: (value: InternalParticipant[]) => void;
}) {
  const { localize } = useI18n();
  const available = users.filter((user) => user.status === '启用');
  return (
    <CollaboratorCard
      title={localize("SmartX 协作人")}
      placeholder={localize("搜索姓名或邮箱")}
      options={available.map((user) => ({
        id: user.id,
        name: user.name,
        details: [fixedIdentityRoles[user.id], user.email]
          .filter(Boolean)
          .join(' · '),
      }))}
      selected={value.map((person) => {
        const user = users.find((entry) => entry.id === person.userId);
        return {
          id: person.userId,
          fixed: fixedInternalCollaboratorLabel(person.userId, applicantId, ownerUserId, hardwareReviewerId, projectManagerId),
          name: person.name,
          details: user?.email ?? '',
        };
      })}
      readonly={readonly}
      busy={busy}
      onAdd={(ids) =>
        onChange([
          ...value.map(({ userId, name }) => ({ userId, name })),
          ...reconcileParticipants(
            available.filter((user) => ids.includes(user.id)),
          ),
        ])
      }
      onRemove={(id) =>
        !fixedInternalCollaboratorLabel(id, applicantId, ownerUserId, hardwareReviewerId, projectManagerId) && onChange(value.filter((person) => person.userId !== id))
      }
    />
  );
}

export function RequestPartnerCollaborators({ users, value, readonly, busy, onChange, showCustomerVisibility = false }: {
  users: import('@/lib/partner-directory').PartnerUser[];
  value: InternalParticipant[];
  readonly: boolean;
  busy: boolean;
  onChange: (value: InternalParticipant[]) => void;
  showCustomerVisibility?: boolean;
}) {
  const { localize } = useI18n();
  return <CollaboratorCard title={localize("合作伙伴协作人")} placeholder={localize("搜索姓名或邮箱")} readonly={readonly} busy={busy}
    showCustomerVisibility={showCustomerVisibility}
    options={users.map(user => ({ id: user.id, name: user.name, details: user.email, disabled: user.status !== '启用' }))}
    selected={value.map(person => {
      const user = users.find(user => user.id === person.userId);
      return { id: person.userId, name: user?.name ?? person.name, details: [user?.phone, user?.email].filter(Boolean).join(' · ') };
    })}
    onAdd={ids => onChange([...value, ...ids.filter(id => !value.some(person => person.userId === id)).map(id => ({ userId: id, name: users.find(user => user.id === id)!.name }))])}
    onRemove={id => onChange(value.filter(person => person.userId !== id))} />;
}
