'use client';
import { useI18n } from '@/lib/i18n/context';

/* eslint-disable jsx-a11y/prefer-tag-over-role -- The mention popup keeps focus in the text editor and uses its keyboard-controlled listbox. */
import { useEffect, useId, useRef, useState } from 'react';
import { AtSign, Paperclip, FileText } from 'lucide-react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Popover } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { MentionOptionLabel } from '@/components/mention-option-label';
import { internalProjectProvider } from '@/lib/service-project-providers';
import {
  storedFile,
  downloadFile,
  type InternalUser,
  type ContactRef,
  type CustomerRef,
  type StoredFile,
} from '@/lib/service-requests';
import {
  isInternal,
  meetingAttachmentAccept,
  meetingAttachmentIssue,
  type OperationActor,
} from '@/lib/request-operations';
import {
  canAddProjectSupplement,
  projectCustomerMentionUsers,
  projectSupplementMentionUsers,
  type ProjectSupplementInput,
  type ProjectSupplement,
} from '@/lib/service-project-supplements';
import type { CustomerProjectDirectory } from '@/lib/customer-service-projects';
import type { ServiceProjectRecord } from '@/lib/service-projects';

import {
  mentionQuery,
  editMentions,
  insertMention,
  type SupplementMention,
} from '@/lib/supplement-mentions';

type SupplementPanelProps = {
  record: {
    customerId?: string;
    serviceProviderId?: string;
    supplements?: Omit<ProjectSupplement, 'authorId'>[];
    collaborators?: ServiceProjectRecord['collaborators'];
  };
  actor: OperationActor;
  users: (InternalUser & { companyName?: string })[];
  contacts?: ContactRef[];
  directory?: CustomerProjectDirectory;
  mentionCandidates?: (InternalUser & { companyName?: string })[];
  customers?: CustomerRef[];
  busy: boolean;
  publish: (input: ProjectSupplementInput) => Promise<string | null>;
};

export function ServiceProjectSupplements(props: Omit<SupplementPanelProps, 'record'> & { record: ServiceProjectRecord }) {
  return <ProjectSupplementsPanel {...props} editable={canAddProjectSupplement(props.record, props.actor)} />;
}

export function ProjectSupplementsPanel({
  record,
  actor,
  users,
  contacts = [],
  directory,
  mentionCandidates,
  customers = [],
  busy,
  publish,
  editable,
  emptyMessage = '暂无补充资料',
}: SupplementPanelProps & {
  editable: boolean;
  emptyMessage?: string;
}) {
  const { localize, localizeMessage } = useI18n();
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [externalVisible, setExternalVisible] = useState(
    !isInternal(actor.role),
  );
  const [mentions, setMentions] = useState<SupplementMention[]>([]);
  const [query, setQuery] = useState<ReturnType<typeof mentionQuery>>(null);
  const [caret, setCaret] = useState(0);
  const [activeOption, setActiveOption] = useState(0);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  const listId = useId();
  const activeMention = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const disabled = busy || working;
  const items = (record.supplements ?? []).filter(
    (item) => isInternal(actor.role) || item.externalVisible,
  );
  const customerMentionUsers = projectCustomerMentionUsers({ ...record, customerId: record.customerId ?? '' }, actor, contacts);
  const mentionUsers = mentionCandidates ?? projectSupplementMentionUsers({ ...record, customerId: record.customerId ?? '' }, actor, users, contacts, directory);
  const matches = query
    ? mentionUsers
        .filter((user) =>
          (isInternal(actor.role)
            ? `${user.name} ${user.email} ${user.department}`
            : user.name
          )
            .toLowerCase()
            .includes(query.query.toLowerCase()),
        )
        .slice(0, 12)
    : [];
  const selectedOption = Math.min(
    activeOption,
    Math.max(0, matches.length - 1),
  );
  useEffect(() => {
    if (query) activeMention.current?.scrollIntoView({ block: 'nearest' });
  }, [selectedOption, query]);
  function updateComment(value: string, position: number) {
    setMentions((previous) => editMentions(comment, value, previous));
    setComment(value);
    setCaret(position);
    setQuery(mentionQuery(value, position));
    setActiveOption(0);
  }
  function insertSelectedMention(
    user: InternalUser,
    start: number,
    end: number,
  ) {
    const next = insertMention(comment, mentions, start, end, user);
    setComment(next.comment);
    setMentions(next.mentions);
    setCaret(next.caret);
    setQuery(null);
    requestAnimationFrame(() => {
      commentInput.current?.focus();
      commentInput.current?.setSelectionRange(next.caret, next.caret);
    });
  }
  function chooseMention(user: InternalUser) {
    if (!query || disabled) return;
    insertSelectedMention(user, query.start, caret);
  }
  return (
    <section className="sr-panel sr-ops-panel">
      <div className="sr-ops-heading">
        <div>
          <h3>{localize("补充信息")}</h3>
        </div>
      </div>
      <div className="sr-supplements-body">
        {localize(editable ? (
          <div className="sr-supplement-composer">
            <div className="sr-mention-composer">
              <Popover
                open={!!query && !disabled}
                modal={false}
                onOpenChange={(open) => {
                  if (!open) setQuery(null);
                }}
              >
                <Textarea
                  ref={commentInput}
                  aria-label={localize("补充说明或评论")}
                  placeholder={localize("填写补充说明或评论，输入 @ 选择协作人，也可仅上传附件")}
                  value={comment}
                  aria-autocomplete="list"
                  aria-controls={query ? listId : undefined}
                  aria-activedescendant={
                    query && matches.length
                      ? `${listId}-${selectedOption}`
                      : undefined
                  }
                  onChange={(event) =>
                    updateComment(
                      event.target.value,
                      event.target.selectionStart,
                    )
                  }
                  onSelect={(event) => {
                    const position = event.currentTarget.selectionStart;
                    setCaret(position);
                    setQuery(mentionQuery(event.currentTarget.value, position));
                  }}
                  onBlur={() => setQuery(null)}
                  onKeyDown={(event) => {
                    if (!query || event.nativeEvent.isComposing) return;
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setQuery(null);
                    }
                    if (
                      matches.length &&
                      ['ArrowDown', 'ArrowUp'].includes(event.key)
                    ) {
                      event.preventDefault();
                      setActiveOption(
                        (selectedOption +
                          (event.key === 'ArrowDown' ? 1 : -1) +
                          matches.length) %
                          matches.length,
                      );
                    }
                    if (matches.length && event.key === 'Enter') {
                      event.preventDefault();
                      chooseMention(matches[selectedOption]);
                    }
                  }}
                  disabled={disabled}
                  rows={4}
                />
                <PopoverPrimitive.Portal>
                  <PopoverPrimitive.Positioner
                    anchor={commentInput}
                    positionMethod="fixed"
                    side="bottom"
                    align="start"
                    sideOffset={6}
                    collisionPadding={16}
                    collisionAvoidance={{ side: 'flip', align: 'shift' }}
                    className="sr-mention-positioner"
                  >
                    <PopoverPrimitive.Popup
                      className="sr-mention-picker"
                      initialFocus={false}
                      finalFocus={false}
                      aria-label={localize("@协作人")}
                    >
                      <p>
                        {localize("@协作人")}</p>
                      <div
                        role="listbox"
                        id={listId}
                        aria-label={localize("可 @ 的协作人")}
                      >
                        {localize(matches.map((user, index) => (
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === selectedOption}
                            id={`${listId}-${index}`}
                            key={user.id}
                            ref={
                              index === selectedOption
                                ? activeMention
                                : undefined
                            }
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setActiveOption(index)}
                            onClick={() => chooseMention(user)}
                          >
                            <MentionOptionLabel name={user.name} email={user.email} companyName={user.companyName ?? (customerMentionUsers.some(person => person.id === user.id)
                              ? customers.find(customer => customer.id === record.customerId)?.name
                              : users.find(person => person.id === user.id)?.companyName ?? internalProjectProvider.name)} />
                          </button>
                        )))}
                      </div>
                      {localize(!matches.length && (
                        <span className="sr-mention-empty">
                          {localize("没有匹配的可选用户")}</span>
                      ))}
                    </PopoverPrimitive.Popup>
                  </PopoverPrimitive.Positioner>
                </PopoverPrimitive.Portal>
              </Popover>
            </div>
            {localize(files.length > 0 && (
              <div className="sr-supplement-files">
                {localize(files.map((file) => (
                  <div className="sr-supplement-file" key={file.id}>
                    <FileText size={16} aria-hidden="true" />
                    <span title={localize(file.name)}>{localize(file.name)}</span>
                    <small>{localize((file.size / 1024).toFixed(1))} KB</small>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label={localizeMessage("移除 {0}", [localize(file.name)])}
                      onClick={() =>
                        setFiles((old) =>
                          old.filter((item) => item.id !== file.id),
                        )
                      }
                    >
                      {localize("移除")}</Button>
                  </div>
                )))}
              </div>
            ))}
            <div className="sr-supplement-toolbar">
              <div className="sr-supplement-upload">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => uploadInput.current?.click()}
                >
                  <Paperclip size={16} />
                  {localize("上传附件")}</Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  aria-label={localize("@协作人")}
                  onClick={() => {
                    const input = commentInput.current;
                    const start = input?.selectionStart ?? comment.length,
                      end = input?.selectionEnd ?? start;
                    const prefix =
                      start > 0 && !/[\s（(，,。；;]/.test(comment[start - 1])
                        ? ' @'
                        : '@';
                    const next =
                      comment.slice(0, start) + prefix + comment.slice(end);
                    const position = start + prefix.length;
                    updateComment(next, position);
                    requestAnimationFrame(() => {
                      input?.focus();
                      input?.setSelectionRange(position, position);
                    });
                  }}
                >
                  <AtSign size={16} />
                  {localize("协作人")}</Button>
                <span>{localize("单文件不超过 20 MB")}</span>
                <input
                  ref={uploadInput}
                  hidden
                  aria-label={localize("上传补充资料附件")}
                  type="file"
                  multiple
                  accept={meetingAttachmentAccept}
                  disabled={disabled}
                  onChange={(event) => {
                    const selected = Array.from(event.target.files ?? []).map(
                      storedFile,
                    );
                    event.target.value = '';
                    const issue = selected
                      .map(meetingAttachmentIssue)
                      .find(Boolean);
                    setError(issue ?? '');
                    if (!issue) setFiles((old) => [...old, ...selected]);
                  }}
                />
              </div>
              <div className="sr-supplement-actions">
                {localize(isInternal(actor.role) && (
                  <label
                    className="sr-supplement-visibility"
                    htmlFor={`${listId}-visibility`}
                  >
                    <span>{localize("可见范围")}</span>
                    <NativeSelect
                      id={`${listId}-visibility`}
                      aria-label={localize("补充资料可见范围")}
                      value={externalVisible ? 'public' : 'internal'}
                      disabled={disabled}
                      onChange={(event) =>
                        setExternalVisible(event.target.value === 'public')
                      }
                    >
                      <option value="internal">{localize("仅内部可见")}</option>
                      <option value="public">{localize("客户可见")}</option>
                    </NativeSelect>
                  </label>
                ))}
                <Button
                  className="sr-supplement-publish"
                  disabled={disabled || (!comment.trim() && !files.length)}
                  onClick={async () => {
                    if (disabled || lock.current) return;
                    lock.current = true;
                    setWorking(true);
                    setError('');
                    try {
                      const issue = await publish({
                        comment,
                        mentions,
                        files,
                        externalVisible,
                      });
                      if (!issue) {
                        setComment('');
                        setMentions([]);
                        setFiles([]);
                        setQuery(null);
                        setExternalVisible(!isInternal(actor.role));
                      } else setError(issue);
                    } catch (error) {
                      setError(
                        error instanceof Error ? error.message : '发布失败',
                      );
                    } finally {
                      lock.current = false;
                      setWorking(false);
                    }
                  }}
                >
                  {localize(working ? '发布中…' : '发布')}
                </Button>
              </div>
            </div>
            {localize(error && (
              <p role="alert" className="sr-error">
                {localize(error)}
              </p>
            ))}
          </div>
        ) : null)}
        <div className="sr-supplement-records">
          {localize([...items].reverse().map((item) => (
            <article key={item.id} className="sr-assessment-plan">
              <div className="sr-assessment-round-title">
                <strong>{localize(item.author)}</strong>
                <time className="sr-help" dateTime={item.at}>
                  {localize(new Date(item.at).toLocaleString('zh-CN', { hour12: false }))}
                </time>
                {localize(isInternal(actor.role) &&
                  (item.externalVisible ? (
                    <CustomerVisibleBadge />
                  ) : (
                    <span className="sr-assessment-badge">{localize("仅内部可见")}</span>
                  )))}
              </div>
              {localize(item.comment && (
                <p className="whitespace-pre-wrap break-words my-3">
                  {localize(renderMentionText(item.comment, item.mentions))}
                </p>
              ))}
              {localize(item.files.map((file) => (
                <div key={file.id} className="sr-supplement-file">
                  <FileText size={16} aria-hidden="true" />
                  <span title={localize(file.name)}>{localize(file.name)}</span>
                  <Button variant="ghost" onClick={() => downloadFile(file)}>
                    {localize("下载")}</Button>
                </div>
              )))}
            </article>
          )))}
          {localize(!items.length && <p className="sr-help">{localize(emptyMessage)}</p>)}
        </div>
      </div>
    </section>
  );
}

function renderMentionText(
  comment: string,
  mentions: SupplementMention[] = [],
) {
  let cursor = 0;
  const parts = [];
  for (const mention of mentions) {
    if (
      mention.start < cursor ||
      comment.slice(mention.start, mention.end) !== `@${mention.name}`
    )
      continue;
    parts.push(comment.slice(cursor, mention.start));
    parts.push(
      <span
        key={`${mention.start}:${mention.userId}`}
        className="sr-comment-mention"
      >
        {comment.slice(mention.start, mention.end)}
      </span>,
    );
    cursor = mention.end;
  }
  parts.push(comment.slice(cursor));
  return parts;
}
