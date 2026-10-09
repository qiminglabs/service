'use client';
import { useI18n } from '@/lib/i18n/context';


import { useId, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  projectCollaboratorGroups,
  projectCollaboratorRoleLabels,
  projectCollaboratorDialogOptions,
  type ProjectCollaborator,
  type ProjectCollaboratorOption,
  type ProjectCollaboratorGroup,
  type ProjectCollaboratorDirectory,
} from '@/lib/service-project-collaborators';
import type { ServiceProjectRecord } from '@/lib/service-projects';

function ProjectCollaboratorCard({
  title,
  placeholder,
  value,
  options,
  readonly,
  busy,
  addDisabled = false,
  showCustomerVisibility = false,
  emptyHint,
  save,
}: {
  title: string;
  placeholder: string;
  value: ProjectCollaborator[];
  options: ProjectCollaboratorOption[];
  readonly: boolean;
  busy: boolean;
  addDisabled?: boolean;
  showCustomerVisibility?: boolean;
  emptyHint?: string;
  save: (ids: string[]) => Promise<string | null>;
}) {
  const { localize } = useI18n();
  const headingId = useId();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string[]>([]);
  const lock = useRef(false);
  const selected = new Set(value.map((person) => person.id));
  const matches = options.filter((person) =>
    `${person.name} ${person.details}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const additions = pending.filter(
    (id) =>
      !selected.has(id) &&
      options.some((person) => person.id === id && !person.disabled),
  );

  async function persist(ids: string[], close = false) {
    if (lock.current || busy) return;
    lock.current = true;
    setError('');
    try {
      const issue = await save(ids);
      if (issue) setError(issue);
      else if (close) setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      lock.current = false;
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy || lock.current) return;
        setQuery('');
        setPending([]);
        setError('');
        setOpen(next);
      }}
    >
      <section
        className={`sr-panel sr-collaboration-card${showCustomerVisibility ? ' sr-customer-visible-panel' : ''}`}
        aria-labelledby={headingId}
      >
        <div className="sr-panel-heading">
          <div className="sr-panel-title-with-visibility"><h3 id={headingId}>
            {localize(title)} <span>{localize(value.length)}</span>
          </h3>{localize(showCustomerVisibility && <CustomerVisibleBadge />)}</div>
          {localize(!readonly && (
            <DialogTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || addDisabled}
                />
              }
              aria-label={localize('添加' + title)}
            >
              <Plus size={14} />
              {localize("添加")}</DialogTrigger>
          ))}
        </div>
        <div className="sr-internal-body">
          {localize(value.length ? (
            <ul className="sr-participants">
              {localize(value.map((person) => {
                const current = person;
                const identityLabels = projectCollaboratorRoleLabels(current.assignmentRoles);
                return (
                  <li key={person.id}>
                    <span className="sr-collaborator-copy">
                      <span
                        className="sr-participant-name"
                        title={localize(current.name)}
                      >
                        {localize(current.name)}
                      </span>
                      <small title={localize(current.details)}>{localize(current.details)}</small>
                    </span>
                    {localize(identityLabels.length ? (
                      <span className="sr-help" title={localize(`${identityLabels.join(' · ')}为固定协作人，不允许移除`)}>
                        {localize(identityLabels.join(' · '))}
                      </span>
                    ) : null)}
                    {localize(!readonly && !current.assignmentRoles?.length && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        aria-label={localize('移除' + title + ' ' + current.name)}
                        onClick={() =>
                          void persist(
                            value
                              .filter((item) => item.id !== person.id)
                              .map((item) => item.id),
                          )
                        }
                      >
                        {localize("移除")}</Button>
                    ))}
                  </li>
                );
              }))}
            </ul>
          ) : (
            <p className="sr-help">{localize(emptyHint ?? `未添加${title}`)}</p>
          ))}
        </div>
        {localize(error && !open && (
          <p className="sr-error" role="alert">
            {localize(error)}
          </p>
        ))}
      </section>
      <DialogContent className="sr-collaborator-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>{localize("添加")}{localize(title)}</DialogTitle>
        </DialogHeader>
        <div className="sr-collaborator-search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label={localize('搜索' + title)}
            placeholder={localize(placeholder)}
            value={query}
            disabled={busy}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div
          className="sr-collaborator-results"
          aria-label={localize(title + '搜索结果')}
        >
          {localize(matches.length ? (
            matches.map((person) => (
              <label
                key={person.id}
                className="sr-collaborator-option"
                data-added={selected.has(person.id) || undefined}
              >
                <Checkbox
                  checked={
                    selected.has(person.id) || pending.includes(person.id)
                  }
                  disabled={busy || selected.has(person.id) || person.disabled}
                  onCheckedChange={(checked) =>
                    setPending((previous) =>
                      checked
                        ? [...new Set([...previous, person.id])]
                        : previous.filter((id) => id !== person.id),
                    )
                  }
                />
                <span className="sr-collaborator-copy">
                  <span className="sr-participant-name">{localize(person.name)}</span>
                  <small>{localize(person.details)}</small>
                </span>
                {localize(person.disabled ? (
                  <span className="sr-help">{localize("已停用")}</span>
                ) : (
                  selected.has(person.id) && (
                    <span className="sr-help">{localize("已添加")}</span>
                  )
                ))}
              </label>
            ))
          ) : (
            <output className="sr-collaborator-empty">
              {localize(query.trim() ? '没有匹配的搜索结果' : '暂无可添加的协作人')}
            </output>
          ))}
        </div>
        {localize(error && (
          <p className="sr-error" role="alert">
            {localize(error)}
          </p>
        ))}
        <DialogFooter className="sr-collaborator-footer">
          <output>{localize("已选择")}{localize(additions.length)} {localize(" 人")}</output>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            {localize("取消")}</Button>
          <Button
            disabled={busy || !additions.length}
            onClick={() =>
              void persist(
                [...value.map((person) => person.id), ...additions],
                true,
              )
            }
          >
            {localize(busy ? '保存中…' : '确认添加')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiceProjectCollaborators({
  showCustomerVisibility = false,
  project,
  directory,
  busy,
  partnerBusy = false,
  internalReadonly,
  readonly,
  save,
}: {
  showCustomerVisibility?: boolean;
  project: Pick<
    ServiceProjectRecord,
    'customerId' | 'serviceProviderId' | 'collaborators'
  >;
  directory: ProjectCollaboratorDirectory;
  busy: boolean;
  partnerBusy?: boolean;
  internalReadonly: boolean;
  readonly: boolean;
  save: (
    group: ProjectCollaboratorGroup,
    ids: string[],
  ) => Promise<string | null>;
}) {
  const { localize } = useI18n();
  const options = projectCollaboratorDialogOptions(
    project.customerId,
    directory,
    project.serviceProviderId,
  );
  return (
    <aside className="sr-collaboration-column" aria-label={localize("项目协作人")}>
      {localize(projectCollaboratorGroups.map((group) => (
        <ProjectCollaboratorCard
          key={
            group.key === 'customer'
              ? `customer:${project.customerId}`
              : group.key === 'partner'
                ? `partner:${project.serviceProviderId ?? ''}`
                : group.key
          }
          title={localize(group.title)}
          showCustomerVisibility={showCustomerVisibility && (group.key === 'customer' || (group.key === 'partner' && !!project.serviceProviderId?.startsWith('partner:')))}
          placeholder={
            localize(group.key === 'internal'
              ? '搜索姓名或邮箱'
              : '搜索姓名、手机号或邮箱')
          }
          value={(project.collaborators?.[group.key] ?? []).map((person) => {
            if (group.key === 'internal')
              return {
                ...person,
                details:
                  directory.users.find((user) => user.id === person.id)
                    ?.email ?? '',
              };
            if (group.key === 'partner') {
              const user = directory.partnerUsers.find(
                (user) => user.id === person.id,
              );
              return {
                ...person,
                details: [user?.phone, user?.email].filter(Boolean).join(' · '),
              };
            }
            return (
              { ...person, ...options[group.key].find((option) => option.id === person.id) }
            );
          })}
          options={options[group.key]}
          busy={
            busy ||
            (group.key === 'customer' && !project.customerId) ||
            (group.key === 'partner' && partnerBusy)
          }
          addDisabled={group.key === 'partner' && !project.serviceProviderId}
          emptyHint={
            group.key === 'customer' && !project.customerId
              ? '请先选择客户'
              : group.key === 'partner' && !project.serviceProviderId
                ? '请先选择服务方'
                : undefined
          }
          readonly={readonly || (group.key === 'internal' && internalReadonly)}
          save={(ids) => save(group.key, ids)}
        />
      )))}
    </aside>
  );
}
