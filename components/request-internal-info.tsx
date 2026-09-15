'use client';

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
  DialogDescription,
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
  description,
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
  description: string;
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
            {title} <span>{selected.length}</span>
          </h3>
          {showCustomerVisibility && <CustomerVisibleBadge />}
        </div>
        {!readonly && (
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
              aria-label={'添加' + title}
            >
              <Plus size={14} />
              添加
            </DialogTrigger>
            <DialogContent
              className="sr-collaborator-dialog"
              showCloseButton={!busy}
            >
              <DialogHeader>
                <DialogTitle>添加{title}</DialogTitle>
                <DialogDescription>{description}</DialogDescription>
              </DialogHeader>
              <div className="sr-collaborator-search">
                <Search size={16} aria-hidden="true" />
                <Input
                  aria-label={'搜索' + title}
                  placeholder={placeholder}
                  value={query}
                  disabled={busy}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <div
                className="sr-collaborator-results"
                aria-label={title + '搜索结果'}
              >
                {matches.length ? (
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
                            {person.name}
                          </span>
                          <small>{person.details}</small>
                        </span>
                        {person.disabled ? <span className="sr-help">已停用</span> : added && <span className="sr-help">已添加</span>}
                      </label>
                    );
                  })
                ) : (
                  <output className="sr-collaborator-empty">
                    {query.trim() ? '没有匹配的搜索结果' : '暂无可添加的协作人'}
                  </output>
                )}
              </div>
              <DialogFooter className="sr-collaborator-footer">
                <output>已选择 {additions.length} 人</output>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setOpen(false)}
                >
                  取消
                </Button>
                <Button
                  disabled={busy || additions.length === 0}
                  onClick={() => {
                    if (busy || !additions.length) return;
                    onAdd(additions);
                    setOpen(false);
                    setPendingIds([]);
                  }}
                >
                  确认添加
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <div className="sr-internal-body">
        {selected.length ? (
          <ul className="sr-participants">
            {selected.map((person) => (
              <li key={person.id}>
                <span className="sr-collaborator-copy">
                  <span className="sr-participant-name" title={person.name}>
                    {person.name}
                  </span>
                  <small title={person.details}>{person.details}</small>
                </span>
                {person.fixed && <span className="sr-help" title={`${person.fixed}为固定协作人，不允许移除`}>{person.fixed}</span>}
                {!readonly && allowRemove && !person.fixed && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={'移除' + title + ' ' + person.name}
                    onClick={() => onRemove(person.id)}
                  >
                    移除
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="sr-help">未添加{title}</p>
        )}
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
  description = '搜索当前客户联系人，勾选后确认添加。',
}: {
  applicantId?: string;
  contacts: ContactRef[];
  description?: string;
  value: ExternalCollaborator[];
  readonly: boolean;
  allowRemove?: boolean;
  showCustomerVisibility?: boolean;
  busy: boolean;
  onChange: (value: ExternalCollaborator[]) => void;
}) {
  const available = contacts.filter((contact) => contact.status === '启用');
  return (
    <CollaboratorCard
      title="客户协作人"
      showCustomerVisibility={showCustomerVisibility}
      description={description}
      placeholder="搜索姓名、手机号或邮箱"
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
  const available = users.filter((user) => user.status === '启用');
  return (
    <CollaboratorCard
      title="内部协作人"
      description="搜索主数据中的内部用户，勾选后确认添加。"
      placeholder="搜索姓名或邮箱"
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
