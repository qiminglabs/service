'use client';
/* eslint-disable jsx-a11y/prefer-tag-over-role -- The mention popup keeps focus in the text editor and uses its keyboard-controlled listbox. */
import { useEffect, useId, useRef, useState } from 'react';
import { AtSign, Paperclip, FileText } from 'lucide-react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Popover } from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { MentionOptionLabel } from '@/components/mention-option-label';
import { internalProjectProvider } from '@/lib/service-project-providers';
import {
  readLocal,
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
  type ProjectSupplementInput,
  type ProjectSupplement,
} from '@/lib/service-project-supplements';
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
    supplements?: Omit<ProjectSupplement, 'authorId'>[];
    collaborators?: ServiceProjectRecord['collaborators'];
  };
  actor: OperationActor;
  users: (InternalUser & { companyName?: string })[];
  contacts?: ContactRef[];
  customers?: CustomerRef[];
  busy: boolean;
  publish: (input: ProjectSupplementInput) => Promise<string | null>;
  joinMention: (id: string) => Promise<string | null>;
};

export function ServiceProjectSupplements(props: Omit<SupplementPanelProps, 'record'> & { record: ServiceProjectRecord }) {
  return <ProjectSupplementsPanel {...props} editable={canAddProjectSupplement(props.record, props.actor)} />;
}

export function ProjectSupplementsPanel({
  record,
  actor,
  users,
  contacts = [],
  customers = [],
  busy,
  publish,
  joinMention,
  editable,
  emptyMessage = '暂无补充资料',
  hideReadonlyWhenEmpty = false,
}: SupplementPanelProps & {
  editable: boolean;
  emptyMessage?: string;
  hideReadonlyWhenEmpty?: boolean;
}) {
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
  const [pendingMention, setPendingMention] = useState<{
    user: InternalUser;
    start: number;
    end: number;
  } | null>(null);
  const [joiningError, setJoiningError] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const disabled = busy || working || !!pendingMention;
  const items = (record.supplements ?? []).filter(
    (item) => isInternal(actor.role) || item.externalVisible,
  );
  const customerMentionUsers = projectCustomerMentionUsers({ ...record, customerId: record.customerId ?? '' }, actor, contacts);
  const mentionUsers = [...users.filter(
    (user) =>
      user.status === '启用' &&
      (isInternal(actor.role) ||
        record.collaborators?.internal?.some(
          (person) => person.id === user.id,
        ) || (actor.role === '客户' && record.collaborators?.partner?.some(person => person.id === user.id))),
  ), ...customerMentionUsers];
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
    if (
      isInternal(actor.role) &&
      !customerMentionUsers.some(person => person.id === user.id) &&
      !record.collaborators?.internal?.some((person) => person.id === user.id)
    ) {
      setPendingMention({ user, start: query.start, end: caret });
      setJoiningError('');
      setQuery(null);
      return;
    }
    insertSelectedMention(user, query.start, caret);
  }
  function cancelMention() {
    if (busy || working || !pendingMention) return;
    // Remove the unfinished @ query, retaining the rest of the comment and attachments.
    const next =
      comment.slice(0, pendingMention.start) +
      comment.slice(pendingMention.end);
    setMentions((previous) => editMentions(comment, next, previous));
    setComment(next);
    setCaret(pendingMention.start);
    setQuery(null);
    setPendingMention(null);
    setJoiningError('');
  }
  async function confirmMention() {
    if (!pendingMention || busy || working || lock.current) return;
    lock.current = true;
    setWorking(true);
    setJoiningError('');
    try {
      const references = await readLocal<{
        id: string;
        payload?: { users?: InternalUser[] };
      }>('references');
      const user = references
        .find((reference) => reference.id === 'workspace')
        ?.payload?.users?.find((user) => user.id === pendingMention.user.id);
      if (!user || user.status !== '启用')
        throw new Error('该用户已停用或不存在，请取消后重新选择。');
      const issue = await joinMention(user.id);
      if (issue) {
        setJoiningError(issue);
        return;
      }
      insertSelectedMention(user, pendingMention.start, pendingMention.end);
      setPendingMention(null);
    } catch (error) {
      setJoiningError(
        error instanceof Error ? error.message : '加入协作人失败，请重试。',
      );
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }

  return (
    <section className="sr-panel sr-ops-panel">
      <AlertDialog
        open={!!pendingMention}
        onOpenChange={(open) => {
          if (!open) cancelMention();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>加入内部协作人？</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMention?.user.name}{' '}
              尚未加入当前项目的内部协作人。确认加入后，可在留言中被 @。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {joiningError && (
            <p className="sr-error" role="alert">
              {joiningError}
            </p>
          )}
          <AlertDialogFooter>
            <Button
              variant="outline"
              disabled={busy || working}
              onClick={cancelMention}
            >
              不加入，不 @
            </Button>
            <Button
              disabled={busy || working}
              onClick={() => void confirmMention()}
            >
              {working ? '正在加入…' : '加入并 @'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="sr-ops-heading">
        <div>
          <h3>补充信息</h3>
        </div>
      </div>
      <div className="sr-supplements-body">
        {editable ? (
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
                  aria-label="补充说明或评论"
                  placeholder="填写补充说明或评论，输入 @ 选择协作人，也可仅上传附件"
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
                      aria-label="@协作人"
                    >
                      <p>
                        @协作人
                      </p>
                      <div
                        role="listbox"
                        id={listId}
                        aria-label="可 @ 的协作人"
                      >
                        {matches.map((user, index) => (
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
                            <MentionOptionLabel name={user.name} email={user.email} companyName={customerMentionUsers.some(person => person.id === user.id)
                              ? customers.find(customer => customer.id === record.customerId)?.name
                              : users.find(person => person.id === user.id)?.companyName ?? internalProjectProvider.name} />
                          </button>
                        ))}
                      </div>
                      {!matches.length && (
                        <span className="sr-mention-empty">
                          没有匹配的可选用户
                        </span>
                      )}
                    </PopoverPrimitive.Popup>
                  </PopoverPrimitive.Positioner>
                </PopoverPrimitive.Portal>
              </Popover>
            </div>
            {files.length > 0 && (
              <div className="sr-supplement-files">
                {files.map((file) => (
                  <div className="sr-supplement-file" key={file.id}>
                    <FileText size={16} aria-hidden="true" />
                    <span title={file.name}>{file.name}</span>
                    <small>{(file.size / 1024).toFixed(1)} KB</small>
                    <Button
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`移除 ${file.name}`}
                      onClick={() =>
                        setFiles((old) =>
                          old.filter((item) => item.id !== file.id),
                        )
                      }
                    >
                      移除
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <div className="sr-supplement-toolbar">
              <div className="sr-supplement-upload">
                <Button
                  variant="outline"
                  disabled={disabled}
                  onClick={() => uploadInput.current?.click()}
                >
                  <Paperclip size={16} />
                  上传附件
                </Button>
                <Button
                  variant="ghost"
                  disabled={disabled}
                  aria-label="@协作人"
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
                  协作人
                </Button>
                <span>单文件不超过 20 MB</span>
                <input
                  ref={uploadInput}
                  hidden
                  aria-label="上传补充资料附件"
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
                {isInternal(actor.role) && (
                  <label
                    className="sr-supplement-visibility"
                    htmlFor={`${listId}-visibility`}
                  >
                    <span>可见范围</span>
                    <NativeSelect
                      id={`${listId}-visibility`}
                      aria-label="补充资料可见范围"
                      value={externalVisible ? 'public' : 'internal'}
                      disabled={disabled}
                      onChange={(event) =>
                        setExternalVisible(event.target.value === 'public')
                      }
                    >
                      <option value="internal">仅内部可见</option>
                      <option value="public">客户可见</option>
                    </NativeSelect>
                  </label>
                )}
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
                  {working ? '发布中…' : '发布'}
                </Button>
              </div>
            </div>
            {error && (
              <p role="alert" className="sr-error">
                {error}
              </p>
            )}
          </div>
        ) : (!hideReadonlyWhenEmpty || items.length > 0) ? (
          <p className="sr-help">当前阶段仅可查看已提交的补充资料。</p>
        ) : null}
        <div className="sr-supplement-records">
          {[...items].reverse().map((item) => (
            <article key={item.id} className="sr-assessment-plan">
              <div className="sr-assessment-round-title">
                <strong>{item.author}</strong>
                <time className="sr-help" dateTime={item.at}>
                  {new Date(item.at).toLocaleString('zh-CN', { hour12: false })}
                </time>
                {isInternal(actor.role) &&
                  (item.externalVisible ? (
                    <CustomerVisibleBadge />
                  ) : (
                    <span className="sr-assessment-badge">仅内部可见</span>
                  ))}
              </div>
              {item.comment && (
                <p className="whitespace-pre-wrap break-words my-3">
                  {renderMentionText(item.comment, item.mentions)}
                </p>
              )}
              {item.files.map((file) => (
                <div key={file.id} className="sr-supplement-file">
                  <FileText size={16} aria-hidden="true" />
                  <span title={file.name}>{file.name}</span>
                  <Button variant="ghost" onClick={() => downloadFile(file)}>
                    下载
                  </Button>
                </div>
              ))}
            </article>
          ))}
          {!items.length && <p className="sr-help">{emptyMessage}</p>}
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
