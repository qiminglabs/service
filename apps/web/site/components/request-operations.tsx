'use client';
import { RequestSupplements } from '@/components/request-supplements';
import { visibleSupplements } from '@/lib/request-supplements';
import { RequestCustomerConfirmation } from '@/components/request-customer-confirmation';

import { useRef, useState, type ReactNode } from 'react';
import { Video, Clock3, Plus, Play, History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { DateField } from '@/components/date-field';
import { TimeField } from '@/components/time-field';
import { RequestAssessment } from '@/components/request-assessment';
import { downloadFile, storedFile } from '@/lib/service-requests';
import type {
  ServiceRequest,
  CatalogService,
  CustomerRef,
  InternalUser,
  StoredFile,
} from '@/lib/service-requests';
import {
  applyRequestAction,
  canRecordWorklog,
  worklogHours,
  formatWorklogHours,
  isInternal,
  isAdministrator,
  migrateRoleLabel,
  localDate,
  operationsOf,
  meetingAttachments,
  meetingAttachmentAccept,
  meetingAttachmentIssue,
  meetingTranscript,
} from '@/lib/request-operations';
import type {
  OperationActor,
  RequestAction,
  RequestAsset,
  RequestMeeting,
  RequestWorklog,
} from '@/lib/request-operations';

type Props = {
  customers: CustomerRef[];
  services: CatalogService[];
  record: ServiceRequest;
  users: InternalUser[];
  assets: RequestAsset[];
  actor: OperationActor;
  customerId?: string;
  busy: boolean;
  save: (record: ServiceRequest, message?: string) => Promise<boolean>;
  children: ReactNode;
  sidebar: ReactNode;
};
const stamp = (s: string) =>
  new Date(s).toLocaleString('zh-CN', { hour12: false });
function Tag({ children }: { children: string }) {
  const tone = ['有效', '已通过', '已结束'].includes(children)
    ? 'green'
    : ['待审批', '待核对', '已预约', '进行中'].includes(children)
      ? 'blue'
      : ['已拒绝'].includes(children)
        ? 'amber'
        : 'muted';
  return (
    <span className="sr-badge" data-tone={tone}>
      {children}
    </span>
  );
}
function Empty({
  icon,
  title,
  detail,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="sr-ops-empty">
      {icon}
      <h4>{title}</h4>
      <p>{detail}</p>
    </div>
  );
}
function Field({
  title,
  required,
  children,
}: {
  title: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="sr-ops-field">
      <span>
        {title}
        {required && <em> *</em>}
      </span>
      {children}
    </label>
  );
}
function Summary({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

export function RequestOperationsTabs({
  customers,
  services,
  record,
  users,
  assets,
  actor,
  customerId,
  busy,
  save,
  children,
  sidebar,
}: Props) {
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<'meeting' | 'worklog' | null>(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('全部');
  const [meeting, setMeeting] = useState<RequestMeeting | null>(null);
  const [worklog, setWorklog] = useState<RequestWorklog | null>(null);
  const [voidWorklog, setVoidWorklog] = useState(false);
  const role = actor.role;
  const ops = operationsOf(record);
  const closed = ['已取消', '已转服务项目'].includes(record.status);
  const editable = !closed && !busy && Boolean(actor.id);
  const canLog = editable && canRecordWorklog(record, actor);
  const activeLogs = ops.worklogs.filter((w) => !w.voidedAt);
  const activities = [...ops.activities];
  if (record.submittedAt && !activities.some((a) => a.category === '提交'))
    activities.unshift({
      id: 'submission',
      at: record.submittedAt,
      actor: migrateRoleLabel(record.createdBy ?? record.owner),
      actorId: '',
      category: '提交',
      title: '提交服务请求',
      detail: '请求进入待评估',
    });
  activities.sort((a, b) => b.at.localeCompare(a.at));
  async function run(action: RequestAction) {
    setError('');
    try {
      const saved = await save(
        applyRequestAction(record, action, actor, assets),
        '已保存',
      );
      if (!saved)
        setError('保存未完成，请检查本地存储后重试；当前填写内容已保留。');
      return saved;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存未完成，请重试。');
      return false;
    }
  }
  function launch(which: typeof dialog) {
    setError('');
    setDialog(which);
  }
  const tabs = [
    ['overview', '申请信息', null],
    ['supplements', '补充信息', visibleSupplements(record, actor).length],
    ['meetings', '会议', ops.meetings.length],
    ['evaluations', '评估', null],
    ['worklogs', '工时', activeLogs.length],
    ['activity', '活动', activities.length],
  ] as const;
  const shownTabs = tabs.filter(([value]) => {
    if (!isInternal(role)) return ['overview', 'supplements'].includes(value);
    if (record.status === '草稿') return ['overview', 'supplements', 'meetings'].includes(value);
    return true;
  });
  return (
    <div className="sr-ops-workspace">
      <Tabs
        value={shownTabs.some(([value]) => value === tab) ? tab : 'overview'}
        onValueChange={(v) => {
          setTab(String(v));
          setError('');
        }}
        className="sr-ops-tabs"
      >
        <TabsList
          variant="line"
          className="sr-ops-tab-list"
          aria-label="服务请求工作区"
        >
          {shownTabs.map(([value, label, count]) => (
            <TabsTrigger key={value} value={value} data-assistant-tab={label}>
              {label}
              {count !== null && count > 0 && <span>{count}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
        {closed && (
          <p className="sr-ops-hint">
            请求已结束，工作记录仅供查阅。协作人仍可在右侧管理。
          </p>
        )}
        {error && !dialog && (
          <p role="alert" className="sr-error">
            {error}
          </p>
        )}
        <div className="sr-detail-layout">
          <div className="sr-detail-main">
            <TabsContent value="overview">
              {!isInternal(role) && <RequestCustomerConfirmation record={record} actor={actor} customerId={customerId} busy={busy} save={save} />}
              {children}
            </TabsContent>
            <TabsContent value="supplements">
              <RequestSupplements key={`${record.id}:${actor.id}`} record={record} actor={actor} customerId={customerId} busy={busy} save={save} />
            </TabsContent>
            <TabsContent value="meetings">
              <section className="sr-panel sr-ops-panel">
                <div className="sr-ops-heading">
                  <div>
                    <h3>会议</h3>
                  </div>
                  <Button
                    disabled={!editable || record.status === '草稿'}
                    onClick={() => {
                      setMeeting(null);
                      launch('meeting');
                    }}
                  >
                    <Video size={16} />
                    预约会议
                  </Button>
                </div>
                <div className="sr-meeting-integration">
                  <Video size={18} />
                  <div>
                    <strong>
                      腾讯会议 <Tag>本地模拟</Tag>
                    </strong>
                    <p>
                      尚未连接腾讯会议。此处不创建真实会议、不通知参会人；支持预约会议、查看转写及上传会议附件。
                    </p>
                  </div>
                </div>
                {!ops.meetings.length ? (
                  <Empty
                    icon={<Video />}
                    title="还没有会议"
                    detail="预约会议后，会议记录将与当前请求关联。"
                  />
                ) : (
                  <div className="sr-ops-records">
                    {ops.meetings.map((m) => (
                      <article key={m.id} className="sr-ops-record">
                        <div className="sr-ops-record-main">
                          <h4>
                            <button
                              className="sr-ops-link"
                              onClick={() => {
                                setMeeting(m);
                                launch('meeting');
                              }}
                            >
                              {m.title}
                            </button>
                            <Tag>{m.status}</Tag>
                          </h4>
                          <p>
                            {m.scheduledDate
                              ? `${m.scheduledDate} ${m.scheduledTime} · ${m.durationMinutes} 分钟`
                              : stamp(m.createdAt)}{' '}
                            · 主持人 {m.host}
                          </p>
                          <small>
                            附件 {meetingAttachments(m).length} 个 ·{' '}
                            {m.status === '已结束'
                              ? meetingTranscript(m).example
                                ? '示例转写'
                                : '已有转写'
                              : '暂无转写'}{' '}
                            · 本地模拟
                          </small>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setMeeting(m);
                            launch('meeting');
                          }}
                        >
                          {m.status === '已预约'
                            ? '查看预约'
                            : m.status === '进行中'
                              ? '进入模拟会议'
                              : '查看会议资料'}
                          <Play size={14} />
                        </Button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </TabsContent>
            <TabsContent value="worklogs">
              <section className="sr-panel sr-ops-panel">
                <div className="sr-ops-heading">
                  <div>
                    <h3>工时</h3>
                    <p>项目经理和内部协作人记录自己的实际投入，不等于客户计费人天。</p>
                  </div>
                  <Button
                    disabled={!canLog}
                    onClick={() => {
                      setWorklog(null);
                      setVoidWorklog(false);
                      launch('worklog');
                    }}
                  >
                    <Plus size={16} />
                    录入工时
                  </Button>
                </div>
                <div className="sr-ops-summary">
                  <Summary
                    label="累计投入"
                    value={`${formatWorklogHours(activeLogs.reduce((s, w) => s + w.hours, 0))} 小时`}
                  />
                  <Summary
                    label="参与成员"
                    value={`${new Set(activeLogs.map((w) => w.userId)).size} 人`}
                  />
                </div>
                {!canLog && !closed && (
                  <p className="sr-ops-hint">
                    项目经理可直接录入工时，其他人员需先加入右侧“内部协作人”。
                  </p>
                )}
                {!ops.worklogs.length ? (
                  <Empty
                    icon={<Clock3 />}
                    title="暂无内部工时"
                    detail="支持记录需求调研、技术评估、会议沟通等投入。"
                  />
                ) : (
                  <div className="sr-table-scroll">
                    <table className="sr-table app-list-table sr-worklog-table">
                      <colgroup>
                        <col className="sr-worklog-name-col" />
                        <col className="sr-worklog-date-col" />
                        <col />
                        <col className="sr-worklog-hours-col" />
                        <col className="sr-worklog-type-col" />
                        <col className="sr-worklog-actions-col" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>姓名</th>
                          <th>工作日期 / 时间</th>
                          <th>工作内容</th>
                          <th>工时</th>
                          <th>类型</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ops.worklogs.map((w) => (
                          <tr key={w.id}>
                            <td>{w.userName}</td>
                            <td>
                              {w.date}
                              {w.startTime && w.endTime && (
                                <small>
                                  {w.startTime}–{w.endTime}
                                </small>
                              )}
                            </td>
                            <td className="sr-ops-cell-wrap">
                              {w.description}
                            </td>
                            <td>
                              {w.voidedAt ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger className="sr-worklog-void-badge">
                                      已作废
                                    </TooltipTrigger>
                                    <TooltipContent className="whitespace-pre-wrap break-words">
                                      作废原因：{w.voidReason || '未填写'}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                `${formatWorklogHours(w.hours)} 小时`
                              )}
                            </td>
                            <td>{w.category}</td>
                            <td>
                              {!w.voidedAt &&
                              w.userId === actor.id &&
                              editable ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    onClick={() => {
                                      setWorklog(w);
                                      setVoidWorklog(false);
                                      launch('worklog');
                                    }}
                                  >
                                    编辑
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    onClick={() => {
                                      setWorklog(w);
                                      setVoidWorklog(true);
                                      launch('worklog');
                                    }}
                                  >
                                    作废
                                  </Button>
                                </>
                              ) : (
                                '—'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </TabsContent>
            <TabsContent value="evaluations">
              <RequestAssessment
                customers={customers}
                services={services}
                record={record}
                users={users}
                assets={assets}
                actor={actor}
                busy={busy}
                save={save}
              />
            </TabsContent>
            <TabsContent value="activity">
              <section className="sr-panel sr-ops-panel" aria-label="活动">
                <div className="sr-ops-heading">
                  <div>
                    <h3>活动</h3>
                    <p>审批历史、协作变更及内部工作记录，按时间集中留痕。</p>
                  </div>
                  <NativeSelect
                    aria-label="活动类型"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    {[
                      '全部',
                      '受理',
                      '审批',
                      '评估',
                      '协作',
                      '会议',
                      '工时',
                      '服务依据',
                      '提交',
                    ].map((f) => (
                      <option key={f}>{f}</option>
                    ))}
                  </NativeSelect>
                </div>
                <ol className="sr-activity-list">
                  {activities
                    .filter((a) => filter === '全部' || a.category === filter)
                    .map((a) => (
                      <li key={a.id}>
                        <span className="sr-activity-dot" aria-hidden="true">
                          <History size={14} />
                        </span>
                        <div>
                          <h4>
                            {a.title}
                            <small>{a.category}</small>
                          </h4>
                          <p>{a.detail}</p>
                          <span>
                            {migrateRoleLabel(a.actor)} · {stamp(a.at)}
                          </span>
                        </div>
                      </li>
                    ))}
                </ol>
                {!activities.some(
                  (a) => filter === '全部' || a.category === filter,
                ) && (
                  <Empty
                    icon={<History />}
                    title="暂无相关活动"
                    detail="完成操作后，系统自动记录操作人、时间和处理意见。"
                  />
                )}
              </section>
            </TabsContent>
          </div>
          {sidebar}
        </div>
      </Tabs>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!busy && !open) {
            setDialog(null);
            setError('');
          }
        }}
      >
        <DialogContent
          className={`sr-ops-dialog ${dialog === 'meeting' && meeting ? 'sr-ops-dialog--wide' : ''}`}
          showCloseButton={!busy}
        >
          {dialog === 'meeting' && (
            <MeetingForm
              key={`${actor.id}:${actor.role}:${meeting?.id ?? 'new'}`}
              meeting={
                meeting
                  ? (ops.meetings.find((m) => m.id === meeting.id) ?? meeting)
                  : null
              }
              record={record}
              actor={actor}
              disabled={!editable}
              error={error}
              run={run}
              close={() => setDialog(null)}
            />
          )}
          {dialog === 'worklog' && (
            <WorklogForm
              key={`${actor.id}:${actor.role}:${worklog?.id ?? 'new'}:${voidWorklog}`}
              voiding={voidWorklog}
              log={worklog}
              actor={actor}
              disabled={!editable}
              error={error}
              run={run}
              close={() => setDialog(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type FormActions = {
  actor: OperationActor;
  disabled: boolean;
  error: string;
  run: (action: RequestAction) => Promise<boolean>;
  close: () => void;
};
function ErrorText({ error }: { error: string }) {
  return error ? (
    <p className="sr-error" role="alert">
      {error}
    </p>
  ) : null;
}
function WorklogForm({
  log,
  voiding,
  actor,
  disabled,
  error,
  run,
  close,
}: FormActions & { log: RequestWorklog | null; voiding: boolean }) {
  const [date, setDate] = useState(log?.date ?? localDate());
  const [startTime, setStartTime] = useState(log?.startTime ?? '');
  const [endTime, setEndTime] = useState(log?.endTime ?? '');
  const hours = worklogHours(startTime, endTime);
  const [category, setCategory] = useState(log?.category ?? '需求调研');
  const [description, setDescription] = useState(
    voiding ? '' : (log?.description ?? ''),
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {voiding ? '作废工时' : log ? '编辑内部工时' : '录入内部工时'}
        </DialogTitle>
        <DialogDescription>
          {voiding && log
            ? `${log.date} · ${formatWorklogHours(log.hours)} 小时；作废后保留原记录，不计入汇总。`
            : `录入人：${actor.name}。按起止时间计算分钟数，自动换算为投入小时。`}
        </DialogDescription>
      </DialogHeader>
      <div className="sr-ops-form">
        {!voiding && (
          <>
            <DateField
              id="sr-work-date"
              label="日期"
              required
              value={date}
              onChange={setDate}
              disabled={disabled}
            />
            <div className="sr-ops-form-row">
              <TimeField
                id="sr-work-start"
                label="起始时间"
                required
                value={startTime}
                onChange={setStartTime}
                disabled={disabled}
              />
              <TimeField
                id="sr-work-end"
                label="终止时间"
                required
                value={endTime}
                onChange={setEndTime}
                disabled={disabled}
              />
            </div>
            <div className="sr-ops-form-row">
              <Field title="工作类型" required>
                <NativeSelect
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  disabled={disabled}
                >
                  {[
                    '需求调研',
                    '技术评估',
                    '会议沟通',
                    '材料准备',
                    '项目协调',
                    '其他',
                  ].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
          </>
        )}
        <Field title={voiding ? '作废原因' : '工作内容'} required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={4}
          />
        </Field>
        {!voiding && (
          <Field title="投入小时（自动计算）">
            <Input
              aria-label="投入小时（自动计算）"
              value={hours === null ? '' : formatWorklogHours(hours)}
              readOnly
              placeholder="选择有效起止时间后自动计算"
            />
          </Field>
        )}
        <ErrorText error={error} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close} disabled={disabled}>
          取消
        </Button>
        <Button
          disabled={disabled}
          onClick={async () => {
            if (
              await run(
                voiding && log
                  ? { type: 'worklog-void', id: log.id, reason: description }
                  : {
                      ...(log
                        ? { type: 'worklog-edit' as const, id: log.id }
                        : { type: 'worklog-add' as const }),
                      date,
                      startTime,
                      endTime,
                      category,
                      description,
                    },
              )
            )
              close();
          }}
        >
          {voiding ? '确认作废' : '保存工时'}
        </Button>
      </DialogFooter>
    </>
  );
}

function MeetingForm({
  meeting,
  record,
  actor,
  disabled,
  error,
  run,
  close,
}: FormActions & { meeting: RequestMeeting | null; record: ServiceRequest }) {
  const [title, setTitle] = useState(record.title + ' · 需求沟通');
  const [scheduledDate, setScheduledDate] = useState(localDate());
  const [scheduledTime, setScheduledTime] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [pendingFiles, setPendingFiles] = useState<StoredFile[]>([]);
  const [uploadError, setUploadError] = useState('');
  const attachmentInput = useRef<HTMLInputElement>(null);
  const canManage =
    !disabled &&
    meeting &&
    (meeting.hostId === actor.id || isAdministrator(actor.role));
  return (
    <>
      <DialogHeader>
        <DialogTitle>{meeting ? meeting.title : '预约会议'}</DialogTitle>
        <DialogDescription>
          腾讯会议 · 本地模拟
          {meeting
            ? ` · ${meeting.host} · ${stamp(meeting.createdAt)}`
            : '。不会向腾讯会议创建会议或发送邀请。'}
        </DialogDescription>
      </DialogHeader>
      <div className="sr-ops-form">
        {!meeting ? (
          <>
            <Field title="会议主题" required>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <div className="sr-ops-form-row">
              <DateField
                label="预约日期"
                required
                value={scheduledDate}
                onChange={setScheduledDate}
                disabled={disabled}
              />
              <TimeField
                label="开始时间"
                required
                value={scheduledTime}
                onChange={setScheduledTime}
                disabled={disabled}
              />
            </div>
            <Field title="会议时长" required>
              <NativeSelect
                value={String(durationMinutes)}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                disabled={disabled}
              >
                {[15, 30, 45, 60, 90, 120, 180, 240].map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} 分钟
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </>
        ) : (
          <>
            {meeting.status === '已预约' ? (
              <dl className="sr-ops-details">
                <div>
                  <dt>预约日期</dt>
                  <dd>{meeting.scheduledDate}</dd>
                </div>
                <div>
                  <dt>开始时间</dt>
                  <dd>{meeting.scheduledTime}</dd>
                </div>
                <div>
                  <dt>会议时长</dt>
                  <dd>{meeting.durationMinutes} 分钟</dd>
                </div>
              </dl>
            ) : meeting.status === '进行中' ? (
              <div className="sr-meeting-stage">
                <Video size={32} />
                <h3>模拟会议进行中</h3>
                <p>尚未接入腾讯会议 SDK，无实际音视频连接。</p>
                <span>
                  {meeting.participantNames.join('、') || meeting.host}
                </span>
              </div>
            ) : (
              <>
                <dl className="sr-meeting-meta">
                  <div>
                    <dt>会议时间</dt>
                    <dd>
                      {stamp(meeting.startedAt ?? meeting.createdAt)}
                      {meeting.endedAt ? ` — ${stamp(meeting.endedAt)}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>参会人</dt>
                    <dd>
                      {[
                        ...new Set(
                          [meeting.host, ...meeting.participantNames].filter(
                            Boolean,
                          ),
                        ),
                      ].join('、') || '未记录'}
                    </dd>
                  </div>
                </dl>
                <section className="sr-meeting-transcript-section">
                  <div className="sr-meeting-section-heading">
                    <h4>会议转写</h4>
                    {meetingTranscript(meeting).example && (
                      <span className="sr-help">模拟示例</span>
                    )}
                  </div>
                  <div className="sr-meeting-transcript">
                    {meetingTranscript(meeting).text}
                  </div>
                </section>

              </>
            )}
                <section className="sr-meeting-attachments">
                  <div className="sr-meeting-section-heading">
                    <h4>
                      附件{' '}
                      <span className="sr-help">
                        {meetingAttachments(meeting).length +
                          pendingFiles.length}
                      </span>
                    </h4>
                    {canManage && (
                      <div className="sr-meeting-upload-actions">
                        <span className="sr-help">单文件不超过 20 MB</span>
                        <Button
                          variant="outline"
                          onClick={() => attachmentInput.current?.click()}
                        >
                          上传附件
                        </Button>
                        <input
                          ref={attachmentInput}
                          type="file"
                          multiple
                          hidden
                          accept={meetingAttachmentAccept}
                          aria-label="上传会议附件"
                          disabled={disabled}
                          onChange={(event) => {
                            const files = Array.from(
                              event.target.files ?? [],
                            ).map(storedFile);
                            event.target.value = '';
                            const issue = files
                              .map(meetingAttachmentIssue)
                              .find(Boolean);
                            setUploadError(issue ?? '');
                            if (!issue)
                              setPendingFiles((previous) => [
                                ...previous,
                                ...files,
                              ]);
                          }}
                        />
                      </div>
                    )}
                  </div>
                  {meetingAttachments(meeting).length || pendingFiles.length ? (
                    <ul className="sr-meeting-file-list">
                      {meetingAttachments(meeting).map((file) => (
                        <li key={file.id}>
                          <span
                            className="sr-meeting-file-name"
                            title={file.name}
                          >
                            {file.name}
                          </span>
                          <small>{(file.size / 1024).toFixed(1)} KB</small>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => downloadFile(file)}
                          >
                            下载
                          </Button>
                          {canManage && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={disabled}
                              aria-label={`删除附件 ${file.name}`}
                              onClick={() =>
                                void run({
                                  type: 'meeting-attachment-delete',
                                  id: meeting.id,
                                  fileId: file.id,
                                })
                              }
                            >
                              删除
                            </Button>
                          )}
                        </li>
                      ))}
                      {pendingFiles.map((file) => (
                        <li key={file.id}>
                          <span
                            className="sr-meeting-file-name"
                            title={file.name}
                          >
                            {file.name}
                          </span>
                          <small>
                            待保存 · {(file.size / 1024).toFixed(1)} KB
                          </small>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={disabled}
                            onClick={() =>
                              setPendingFiles((previous) =>
                                previous.filter((item) => item.id !== file.id),
                              )
                            }
                          >
                            移除
                          </Button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="sr-help">暂无附件</p>
                  )}
                </section>
          </>
        )}
        <ErrorText error={uploadError || error} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          关闭
        </Button>
        {!meeting && (
          <Button
            disabled={disabled}
            onClick={async () => {
              if (
                await run({
                  type: 'meeting-schedule',
                  title,
                  scheduledDate,
                  scheduledTime,
                  durationMinutes,
                })
              )
                close();
            }}
          >
            预约会议
          </Button>
        )}
        {canManage && record.status !== '草稿' && meeting?.status === '已预约' && (
          <Button
            onClick={() => void run({ type: 'meeting-start', id: meeting.id })}
          >
            开始模拟会议
          </Button>
        )}
        {canManage && record.status !== '草稿' && meeting?.status === '进行中' && (
          <Button
            onClick={() => void run({ type: 'meeting-end', id: meeting.id })}
          >
            结束模拟会议
          </Button>
        )}
        {canManage &&
          meeting &&
          pendingFiles.length > 0 && (
            <Button
              disabled={disabled || Boolean(uploadError)}
              onClick={async () => {
                if (
                  await run({
                    type: 'meeting-attachments-add',
                    id: meeting.id,
                    files: pendingFiles,
                  })
                ) {
                  setPendingFiles([]);
                  setUploadError('');
                }
              }}
            >
              保存附件
            </Button>
          )}
      </DialogFooter>
    </>
  );
}
