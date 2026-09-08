'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  FileText,
  Video,
  Clock3,
  Plus,
  Download,
  Play,
  ShieldCheck,
  ClipboardCheck,
  History,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
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
import { operationIdentities } from '@/lib/internal-users';
import { downloadFile } from '@/lib/service-requests';
import type {
  ServiceRequest,
  InternalUser,
  StoredFile,
} from '@/lib/service-requests';
import {
  applyRequestAction,
  basisUsable,
  canApprove,
  isInternal,
  canEvaluate,
  isAdministrator,
  migrateRoleLabel,
  localDate,
  operationsOf,
  uncoveredItems,
} from '@/lib/request-operations';
import type {
  OperationActor,
  RequestAction,
  RequestAsset,
  RequestBasis,
  RequestEvaluation,
  RequestMeeting,
  RequestWorklog,
} from '@/lib/request-operations';

type Props = {
  record: ServiceRequest;
  users: InternalUser[];
  assets: RequestAsset[];
  actor: OperationActor;
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
    : ['待审批', '待核对', '进行中'].includes(children)
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
  record,
  users,
  assets,
  actor,
  busy,
  save,
  children,
  sidebar,
}: Props) {
  const [tab, setTab] = useState('overview');
  const [dialog, setDialog] = useState<
    'meeting' | 'worklog' | 'evaluation' | 'basis' | null
  >(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('全部');
  const [meeting, setMeeting] = useState<RequestMeeting | null>(null);
  const [worklog, setWorklog] = useState<RequestWorklog | null>(null);
  const [evaluation, setEvaluation] = useState<RequestEvaluation | null>(null);
  const [basis, setBasis] = useState<RequestBasis | null>(null);
  const [basisKind, setBasisKind] = useState<'asset' | 'exception'>('asset');
  const role = actor.role;
  const ops = operationsOf(record);
  const closed = ['已取消', '已转工单'].includes(record.status);
  const editable = !closed && !busy && Boolean(actor.id);
  const assessing = record.status === '待评估';
  const canLog =
    editable &&
    Boolean(record.internalParticipants?.some((p) => p.userId === actor.id));
  const availableBases = ops.bases.filter((b) =>
    basisUsable(b, record, assets),
  );
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
    ['meetings', '会议', ops.meetings.length],
    ['worklogs', '内部工时', activeLogs.length],
    ['evaluations', '评估记录', ops.evaluations.length],
    ['activity', '活动', activities.length],
    ['basis', '服务依据', availableBases.length],
  ] as const;
  if (record.status === '草稿' || !isInternal(role))
    return (
      <div className="sr-detail-layout">
        <div className="sr-detail-main">{children}</div>
        {sidebar}
      </div>
    );
  return (
    <div className="sr-ops-workspace">
      <Tabs
        value={tab}
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
          {tabs.map(([value, label, count]) => (
            <TabsTrigger key={value} value={value}>
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
            <TabsContent value="overview">{children}</TabsContent>
            <TabsContent value="meetings">
              <section className="sr-panel sr-ops-panel">
                <div className="sr-ops-heading">
                  <div>
                    <h3>会议</h3>
                    <p>围绕本次服务请求开展沟通，集中查看录制与转写。</p>
                  </div>
                  <Button
                    disabled={!editable}
                    onClick={() => {
                      setMeeting(null);
                      launch('meeting');
                    }}
                  >
                    <Video size={16} />
                    发起会议
                  </Button>
                </div>
                <div className="sr-meeting-integration">
                  <Video size={18} />
                  <div>
                    <strong>
                      腾讯会议 <Tag>本地模拟</Tag>
                    </strong>
                    <p>
                      尚未连接腾讯会议。此处不创建真实会议、不通知参会人；支持模拟会议流程和导入已有录制、转写。
                    </p>
                  </div>
                </div>
                {!ops.meetings.length ? (
                  <Empty
                    icon={<Video />}
                    title="还没有会议"
                    detail="发起首次沟通，会议记录将与当前请求关联。"
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
                            {stamp(m.createdAt)} · 主持人 {m.host}
                          </p>
                          <small>
                            {m.recording ? '已有录制' : '暂无录制'} ·{' '}
                            {m.transcript ? '已有转写' : '暂无转写'} · 本地模拟
                          </small>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setMeeting(m);
                            launch('meeting');
                          }}
                        >
                          {m.status === '进行中'
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
                    <h3>内部工时</h3>
                    <p>内部协作人记录自己的实际投入，不等于客户计费人天。</p>
                  </div>
                  <Button
                    disabled={!canLog}
                    onClick={() => {
                      setWorklog(null);
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
                    value={`${activeLogs.reduce((s, w) => s + w.hours, 0)} 小时`}
                  />
                  <Summary
                    label="参与成员"
                    value={`${new Set(activeLogs.map((w) => w.userId)).size} 人`}
                  />
                  <Summary
                    label="我的投入"
                    value={`${activeLogs.filter((w) => w.userId === actor.id).reduce((s, w) => s + w.hours, 0)} 小时`}
                  />
                </div>
                {!canLog && !closed && (
                  <p className="sr-ops-hint">
                    当前操作人需加入右侧“内部协作人”，才能录入自己的工时。
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
                    <table className="sr-table app-list-table">
                      <thead>
                        <tr>
                          <th>成员 / 工作日期</th>
                          <th>工作内容</th>
                          <th>工时</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ops.worklogs.map((w) => (
                          <tr key={w.id}>
                            <td>
                              {w.userName}
                              <small>{w.date}</small>
                            </td>
                            <td className="sr-ops-cell-wrap">
                              {w.description}
                              <small>
                                {w.category}
                                {w.voidedAt && ` · 作废原因：${w.voidReason}`}
                              </small>
                            </td>
                            <td>{w.hours} 小时</td>
                            <td>
                              <Tag>{w.voidedAt ? '已作废' : '有效'}</Tag>
                            </td>
                            <td>
                              {!w.voidedAt &&
                              w.userId === actor.id &&
                              editable ? (
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    setWorklog(w);
                                    launch('worklog');
                                  }}
                                >
                                  作废
                                </Button>
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
              <section className="sr-panel sr-ops-panel">
                <div className="sr-ops-heading">
                  <div>
                    <h3>评估记录</h3>
                    <p>
                      SmartX
                      员工梳理服务范围和工作量，指定审批人审核；通过后进入待确认。
                    </p>
                  </div>
                  <Button
                    disabled={!editable || !canEvaluate(role) || !assessing}
                    onClick={() => {
                      setEvaluation(null);
                      launch('evaluation');
                    }}
                  >
                    <Plus size={16} />
                    新增评估
                  </Button>
                </div>
                {assessing && (
                  <div className="sr-ops-summary">
                    <Summary
                      label="待审批"
                      value={
                        ops.evaluations.filter((e) => e.state === '待审批')
                          .length
                      }
                    />
                    <Summary
                      label="已覆盖申请项"
                      value={`${record.items.length - uncoveredItems(record, assets).length} / ${record.items.length}`}
                    />
                    <button
                      className="sr-ops-link"
                      onClick={() => setTab('basis')}
                    >
                      查看服务依据 →
                    </button>
                  </div>
                )}
                {!ops.evaluations.length ? (
                  <Empty
                    icon={<ClipboardCheck />}
                    title="暂无评估记录"
                    detail="评估草稿可持续完善；提交审批后的意见和结论保留历史。"
                  />
                ) : (
                  <div className="sr-ops-records">
                    {ops.evaluations.map((e, index) => (
                      <article key={e.id} className="sr-ops-record">
                        <div className="sr-ops-record-main">
                          <h4>
                            第 {ops.evaluations.length - index} 次评估
                            <Tag>{e.state}</Tag>
                          </h4>
                          <p className="sr-ops-excerpt">
                            {e.opinion || '尚未填写评估意见'}
                          </p>
                          <small>
                            {e.author} · {stamp(e.createdAt)} · 预计{' '}
                            {e.effort || '—'} 人天 · 审批人{' '}
                            {e.approverName || '待指定'}
                          </small>
                          {e.decisionNote && (
                            <p className="sr-ops-decision">
                              {e.decidedBy}：{e.decisionNote}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setEvaluation(e);
                            launch('evaluation');
                          }}
                        >
                          {e.state === '待审批' &&
                          e.approverId === actor.id &&
                          canApprove(role) &&
                          editable
                            ? '审批评估'
                            : e.state === '草稿' &&
                                e.authorId === actor.id &&
                                canEvaluate(role) &&
                                editable
                              ? '继续填写'
                              : '查看详情'}
                        </Button>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </TabsContent>
            <TabsContent value="activity">
              <section className="sr-panel sr-ops-panel">
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
            <TabsContent value="basis">
              <section className="sr-panel sr-ops-panel">
                <div className="sr-ops-heading">
                  <div>
                    <h3>服务依据</h3>
                    <p>
                      按申请项关联客户资产；额度不足时，由 SmartX 员工提交特批。
                    </p>
                  </div>
                  <div className="sr-ops-actions">
                    <Button
                      variant="outline"
                      disabled={!editable || !assessing || !canEvaluate(role)}
                      onClick={() => {
                        setBasis(null);
                        setBasisKind('exception');
                        launch('basis');
                      }}
                    >
                      提交特批
                    </Button>
                    <Button
                      disabled={!editable || !assessing || !canEvaluate(role)}
                      onClick={() => {
                        setBasis(null);
                        setBasisKind('asset');
                        launch('basis');
                      }}
                    >
                      <Plus size={16} />
                      关联资产
                    </Button>
                  </div>
                </div>
                <div className="sr-ops-summary">
                  <Summary
                    label="有效依据"
                    value={`${availableBases.length} 条`}
                  />
                  <Summary
                    label="未覆盖申请项"
                    value={uncoveredItems(record, assets).length}
                  />
                  <Summary
                    label="待特批"
                    value={ops.bases.filter((b) => b.state === '待审批').length}
                  />
                </div>
                <p className="sr-ops-hint">
                  资产余额尚未接入：关联不代表扣减或冻结，需 SmartX 员工
                  核对有效性及可用额度。特批信息仅供内部使用。
                </p>
                {!ops.bases.length ? (
                  <Empty
                    icon={<ShieldCheck />}
                    title="尚未关联服务依据"
                    detail="有效依据覆盖全部申请项后，才能提交评估审批。"
                  />
                ) : (
                  <div className="sr-ops-records">
                    {ops.bases.map((b) => (
                      <article key={b.id} className="sr-ops-record">
                        <div className="sr-ops-record-main">
                          <h4>
                            {b.name}
                            <Tag>
                              {b.state === '有效' &&
                              !basisUsable(b, record, assets)
                                ? '资产已失效'
                                : b.state}
                            </Tag>
                          </h4>
                          <p>
                            {b.quantity} {b.unit} ·{' '}
                            {b.itemIds
                              .map(
                                (id) =>
                                  record.items.find((i) => i.id === id)
                                    ?.serviceName ?? '历史申请项',
                              )
                              .join('、')}
                          </p>
                          <small>
                            {b.kind === 'asset'
                              ? b.assetId
                              : `审批人 ${b.approverName}`}{' '}
                            · {b.createdBy} · {stamp(b.createdAt)}
                          </small>
                          {b.decisionNote && (
                            <p className="sr-ops-decision">
                              {b.decidedBy}：{b.decisionNote}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          onClick={() => {
                            setBasis(b);
                            setBasisKind(b.kind);
                            launch('basis');
                          }}
                        >
                          {b.state === '待核对' &&
                          canEvaluate(role) &&
                          editable &&
                          assessing
                            ? '核对资产'
                            : b.state === '待审批' &&
                                b.approverId === actor.id &&
                                canApprove(role) &&
                                editable &&
                                assessing
                              ? '审批特批'
                              : '查看详情'}
                        </Button>
                      </article>
                    ))}
                  </div>
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
              key={`${actor.id}:${actor.role}:${worklog?.id ?? 'new'}`}
              log={worklog}
              actor={actor}
              disabled={!editable}
              error={error}
              run={run}
              close={() => setDialog(null)}
            />
          )}
          {dialog === 'evaluation' && (
            <EvaluationForm
              key={`${actor.id}:${actor.role}:${evaluation?.id ?? 'new'}`}
              evaluation={evaluation}
              users={users}
              actor={actor}
              disabled={!editable || !assessing}
              error={error}
              run={run}
              close={() => setDialog(null)}
            />
          )}
          {dialog === 'basis' && (
            <BasisForm
              key={`${actor.id}:${actor.role}:${basis?.id ?? 'new'}`}
              basis={basis}
              kind={basisKind}
              record={record}
              assets={assets}
              users={users}
              actor={actor}
              disabled={!editable || !assessing}
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
function Reviewer({
  users,
  actorId,
  value,
  onChange,
  disabled,
}: {
  users: InternalUser[];
  actorId: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <Field title="审批人" required>
      <NativeSelect
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">请选择审批人</option>
        {operationIdentities(users)
          .filter((u) => u.id !== actorId && canApprove(u.role))
          .map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} · {u.role}
            </option>
          ))}
      </NativeSelect>
    </Field>
  );
}

function WorklogForm({
  log,
  actor,
  disabled,
  error,
  run,
  close,
}: FormActions & { log: RequestWorklog | null }) {
  const [date, setDate] = useState(localDate());
  const [hours, setHours] = useState('');
  const [category, setCategory] = useState('需求调研');
  const [description, setDescription] = useState('');
  return (
    <>
      <DialogHeader>
        <DialogTitle>{log ? '作废工时' : '录入内部工时'}</DialogTitle>
        <DialogDescription>
          {log
            ? `${log.date} · ${log.hours} 小时；作废后保留原记录，不计入汇总。`
            : `录入人：${actor.name}。仅记录实际投入，最小单位为 0.25 小时。`}
        </DialogDescription>
      </DialogHeader>
      <div className="sr-ops-form">
        {!log && (
          <>
            <DateField
              id="sr-work-date"
              label="工作日期"
              value={date}
              onChange={setDate}
              disabled={disabled}
            />
            <div className="sr-ops-form-row">
              <Field title="投入小时" required>
                <Input
                  type="number"
                  min="0.25"
                  max="24"
                  step="0.25"
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  disabled={disabled}
                  placeholder="例如 1.5"
                />
              </Field>
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
        <Field title={log ? '作废原因' : '工作内容'} required>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={disabled}
            rows={4}
          />
        </Field>
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
                log
                  ? { type: 'worklog-void', id: log.id, reason: description }
                  : {
                      type: 'worklog-add',
                      date,
                      hours: Number(hours),
                      category,
                      description,
                    },
              )
            )
              close();
          }}
        >
          {log ? '确认作废' : '保存工时'}
        </Button>
      </DialogFooter>
    </>
  );
}

function EvaluationForm({
  evaluation: e,
  users,
  actor,
  disabled,
  error,
  run,
  close,
}: FormActions & {
  evaluation: RequestEvaluation | null;
  users: InternalUser[];
}) {
  const [scope, setScope] = useState(e?.scope ?? '');
  const [opinion, setOpinion] = useState(e?.opinion ?? '');
  const [risks, setRisks] = useState(e?.risks ?? '');
  const [effort, setEffort] = useState(e?.effort ? String(e.effort) : '');
  const [approverId, setApproverId] = useState(e?.approverId ?? '');
  const [note, setNote] = useState('');
  const edit =
    !disabled &&
    canEvaluate(actor.role) &&
    (!e || (e.state === '草稿' && e.authorId === actor.id));
  const review =
    !disabled &&
    e?.state === '待审批' &&
    e.approverId === actor.id &&
    e.authorId !== actor.id &&
    canApprove(actor.role);
  async function submit(send: boolean) {
    if (
      await run({
        type: 'evaluation-save',
        id: e?.id,
        input: {
          scope,
          opinion,
          risks,
          effort: Number(effort),
          approverId,
          approverName: users.find((u) => u.id === approverId)?.name ?? '',
        },
        submit: send,
      })
    )
      close();
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {review ? '审批评估' : edit ? '填写评估' : '评估详情'}
        </DialogTitle>
        <DialogDescription>
          {e
            ? `${e.author} · ${stamp(e.createdAt)} · ${e.state}`
            : '先明确范围与风险，再核对服务依据，提交给其他内部用户审批。'}
        </DialogDescription>
      </DialogHeader>
      <div className="sr-ops-form">
        <Field title="服务范围与交付结果" required>
          <Textarea
            value={scope}
            onChange={(ev) => setScope(ev.target.value)}
            readOnly={!edit}
            rows={3}
          />
        </Field>
        <Field title="评估意见" required>
          <Textarea
            value={opinion}
            onChange={(ev) => setOpinion(ev.target.value)}
            readOnly={!edit}
            rows={4}
          />
        </Field>
        <Field title="风险与前置条件">
          <Textarea
            value={risks}
            onChange={(ev) => setRisks(ev.target.value)}
            readOnly={!edit}
            rows={3}
          />
        </Field>
        <div className="sr-ops-form-row">
          <Field title="预计服务人天" required>
            <Input
              type="number"
              min="0.25"
              step="0.25"
              value={effort}
              onChange={(ev) => setEffort(ev.target.value)}
              readOnly={!edit}
            />
          </Field>
          {edit ? (
            <Reviewer
              users={users}
              actorId={actor.id}
              value={approverId}
              onChange={setApproverId}
            />
          ) : (
            <Field title="审批人">
              <Input value={e?.approverName || '未指定'} readOnly />
            </Field>
          )}
        </div>
        {e?.decisionNote && (
          <div className="sr-ops-decision">
            <strong>
              {e.decidedBy} · {e.state}
            </strong>
            <p>{e.decisionNote}</p>
            <small>{stamp(e.decidedAt!)}</small>
          </div>
        )}
        {review && (
          <Field title="审批意见" required>
            <Textarea
              value={note}
              onChange={(ev) => setNote(ev.target.value)}
              rows={3}
              placeholder="填写通过或拒绝的原因"
            />
          </Field>
        )}
        <ErrorText error={error} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          关闭
        </Button>
        {edit && (
          <>
            <Button variant="outline" onClick={() => void submit(false)}>
              保存草稿
            </Button>
            <Button onClick={() => void submit(true)}>提交审批</Button>
          </>
        )}
        {review && (
          <>
            <Button
              variant="outline"
              onClick={async () => {
                if (
                  await run({
                    type: 'evaluation-decide',
                    id: e!.id,
                    approve: false,
                    note,
                  })
                )
                  close();
              }}
            >
              拒绝
            </Button>
            <Button
              onClick={async () => {
                if (
                  await run({
                    type: 'evaluation-decide',
                    id: e!.id,
                    approve: true,
                    note,
                  })
                )
                  close();
              }}
            >
              通过评估
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}

function BasisForm({
  basis: b,
  kind,
  record,
  assets,
  users,
  actor,
  disabled,
  error,
  run,
  close,
}: FormActions & {
  basis: RequestBasis | null;
  kind: 'asset' | 'exception';
  record: ServiceRequest;
  assets: RequestAsset[];
  users: InternalUser[];
}) {
  const [assetId, setAssetId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [itemIds, setItemIds] = useState<string[]>([]);
  const [approverId, setApproverId] = useState('');
  const [note, setNote] = useState('');
  const decide =
    b &&
    !disabled &&
    ((b.state === '待核对' && canEvaluate(actor.role)) ||
      (b.state === '待审批' &&
        b.approverId === actor.id &&
        actor.id !== b.creatorId &&
        canApprove(actor.role)));
  const remove =
    b &&
    !disabled &&
    canEvaluate(actor.role) &&
    !['已移除', '已拒绝'].includes(b.state);
  const available = assets.filter(
    (a) => a.customerId === record.customerId && a.status === '启用',
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {b
            ? kind === 'asset'
              ? '资产依据详情'
              : '特批详情'
            : kind === 'asset'
              ? '关联客户资产'
              : '提交额度特批'}
        </DialogTitle>
        <DialogDescription>
          {kind === 'asset'
            ? '资产仅从当前客户中选择，关联后由 SmartX 员工核对；不会自动冻结或扣减额度。'
            : '特批仅作为内部服务依据，不进入客户总览。审批拒绝后保留记录，可重新提交。'}
        </DialogDescription>
      </DialogHeader>
      <div className="sr-ops-form">
        {b ? (
          <dl className="sr-ops-details">
            <div>
              <dt>依据</dt>
              <dd>
                {b.name} <Tag>{b.state}</Tag>
              </dd>
            </div>
            <div>
              <dt>服务数量</dt>
              <dd>
                {b.quantity} {b.unit}
              </dd>
            </div>
            <div>
              <dt>关联申请项</dt>
              <dd>
                {b.itemIds
                  .map(
                    (id) =>
                      record.items.find((i) => i.id === id)?.serviceName ?? id,
                  )
                  .join('、')}
              </dd>
            </div>
            <div>
              <dt>申请说明</dt>
              <dd>{b.reason}</dd>
            </div>
            <div>
              <dt>提交人</dt>
              <dd>
                {b.createdBy} · {stamp(b.createdAt)}
              </dd>
            </div>
            {b.approverName && (
              <div>
                <dt>审批人</dt>
                <dd>{b.approverName}</dd>
              </div>
            )}
            {b.decisionNote && (
              <div>
                <dt>处理意见</dt>
                <dd>
                  {b.decidedBy}：{b.decisionNote}
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <>
            {kind === 'asset' && (
              <Field title="客户资产" required>
                <NativeSelect
                  value={assetId}
                  onChange={(e) => setAssetId(e.target.value)}
                  disabled={disabled}
                >
                  <option value="">
                    {available.length ? '请选择资产' : '当前客户无已启用的资产'}
                  </option>
                  {available.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.id}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <Field
              title={kind === 'asset' ? '本次计划使用人天' : '申请特批人天'}
              required
            >
              <Input
                type="number"
                min="0.25"
                step="0.25"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                disabled={disabled}
              />
            </Field>
            <fieldset className="sr-ops-item-choices" disabled={disabled}>
              <legend>关联申请项 *</legend>
              {record.items.map((item, index) => (
                <label key={item.id}>
                  <Checkbox
                    checked={itemIds.includes(item.id)}
                    onCheckedChange={(v) =>
                      setItemIds((old) =>
                        v
                          ? [...old, item.id]
                          : old.filter((id) => id !== item.id),
                      )
                    }
                  />
                  {String(index + 1).padStart(2, '0')} · {item.serviceName}
                </label>
              ))}
            </fieldset>
            <Field
              title={kind === 'asset' ? '使用说明' : '特批原因与业务价值'}
              required
            >
              <Textarea
                rows={4}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={disabled}
              />
            </Field>
            {kind === 'exception' && (
              <Reviewer
                users={users}
                actorId={actor.id}
                value={approverId}
                onChange={setApproverId}
                disabled={disabled}
              />
            )}
          </>
        )}
        {(decide || remove) && (
          <Field
            title={
              b?.kind === 'asset' && b.state === '待核对'
                ? '核对结论（有效期、余额及适用范围）'
                : '处理意见 / 移除原因'
            }
            required
          >
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
            />
          </Field>
        )}
        <ErrorText error={error} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={close}>
          关闭
        </Button>
        {remove && (
          <Button
            variant="outline"
            onClick={async () => {
              if (await run({ type: 'basis-remove', id: b!.id, reason: note }))
                close();
            }}
          >
            移除依据
          </Button>
        )}
        {decide && (
          <>
            <Button
              variant="outline"
              onClick={async () => {
                if (
                  await run({
                    type: 'basis-decide',
                    id: b!.id,
                    approve: false,
                    note,
                  })
                )
                  close();
              }}
            >
              拒绝
            </Button>
            <Button
              onClick={async () => {
                if (
                  await run({
                    type: 'basis-decide',
                    id: b!.id,
                    approve: true,
                    note,
                  })
                )
                  close();
              }}
            >
              {kind === 'asset' ? '核对通过' : '批准特批'}
            </Button>
          </>
        )}
        {!b && (
          <Button
            disabled={disabled}
            onClick={async () => {
              if (
                await run({
                  type: 'basis-add',
                  kind,
                  assetId,
                  quantity: Number(quantity),
                  reason,
                  itemIds,
                  approverId,
                  approverName: users.find((u) => u.id === approverId)?.name,
                })
              )
                close();
            }}
          >
            {kind === 'asset' ? '保存关联' : '提交特批'}
          </Button>
        )}
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
  const [transcript, setTranscript] = useState(meeting?.transcript ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canManage =
    !disabled &&
    meeting &&
    (meeting.hostId === actor.id || isAdministrator(actor.role));
  useEffect(() => {
    const video = videoRef.current;
    if (!meeting?.recording || !video) return;
    const next = URL.createObjectURL(meeting.recording.blob);
    video.src = next;
    return () => {
      video.removeAttribute('src');
      URL.revokeObjectURL(next);
    };
  }, [meeting?.recording]);
  return (
    <>
      <DialogHeader>
        <DialogTitle>{meeting ? meeting.title : '发起会议'}</DialogTitle>
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
            <div className="sr-ops-hint">
              参会范围：当前内部协作人与外部协作人。此处仅记录拟参会名单。
            </div>
            <div className="sr-meeting-people">
              {[
                ...(record.internalParticipants?.map((p) => p.name) ?? []),
                ...(record.externalCollaborators?.map((p) => p.name) ?? []),
              ].join('、') || '尚未添加协作人'}
            </div>
          </>
        ) : (
          <>
            {meeting.status === '进行中' ? (
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
                <div className="sr-meeting-artifacts">
                  <section>
                    <h4>会议录制</h4>
                    {meeting.recording ? (
                      <>
                        <video
                          ref={videoRef}
                          controls
                          preload="metadata"
                          aria-label="会议录制"
                        >
                          <track kind="captions" />
                        </video>
                        <Button
                          variant="ghost"
                          onClick={() => downloadFile(meeting.recording!)}
                        >
                          <Download size={14} />
                          下载录制
                        </Button>
                      </>
                    ) : (
                      <div className="sr-meeting-placeholder">
                        <Video size={24} />
                        <p>暂无会议录制</p>
                        <small>
                          连接腾讯会议后可同步；本地可导入已有文件。
                        </small>
                      </div>
                    )}
                  </section>
                  <section>
                    <h4>会议转写</h4>
                    {meeting.transcript ? (
                      <div className="sr-meeting-transcript">
                        {meeting.transcript}
                      </div>
                    ) : (
                      <div className="sr-meeting-placeholder">
                        <FileText size={24} />
                        <p>暂无转写内容</p>
                      </div>
                    )}
                  </section>
                </div>
                {canManage && (
                  <div className="sr-meeting-import">
                    <h4>归档已有会议资料</h4>
                    <Field title="导入录制 · MP4 / WebM，单文件不超过 20 MB">
                      <Input
                        type="file"
                        accept="video/mp4,video/webm"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          setUploadError('');
                          if (
                            f &&
                            (f.size <= 0 ||
                              f.size > 20 * 1024 * 1024 ||
                              !['video/mp4', 'video/webm'].includes(f.type))
                          ) {
                            setUploadError(
                              '请选择 20 MB 以内的 MP4 或 WebM 文件。',
                            );
                            setFile(null);
                            e.target.value = '';
                          } else setFile(f ?? null);
                        }}
                      />
                    </Field>
                    <Field title="转写正文（粘贴已有转写，不自动生成）">
                      <Textarea
                        rows={5}
                        value={transcript}
                        onChange={(e) => setTranscript(e.target.value)}
                      />
                    </Field>
                  </div>
                )}
              </>
            )}
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
                  type: 'meeting-create',
                  title,
                  participantNames: [
                    ...(record.internalParticipants?.map((p) => p.name) ?? []),
                    ...(record.externalCollaborators?.map((p) => p.name) ?? []),
                  ],
                })
              )
                close();
            }}
          >
            发起模拟会议
          </Button>
        )}
        {canManage && meeting?.status === '进行中' && (
          <Button
            onClick={() => void run({ type: 'meeting-end', id: meeting.id })}
          >
            结束模拟会议
          </Button>
        )}
        {canManage && meeting?.status === '已结束' && (
          <Button
            disabled={Boolean(uploadError)}
            onClick={async () => {
              const recording: StoredFile | undefined = file
                ? {
                    id: crypto.randomUUID(),
                    name: file.name,
                    size: file.size,
                    blob: file,
                    uploadedAt: new Date().toISOString(),
                  }
                : undefined;
              if (
                await run({
                  type: 'meeting-materials',
                  id: meeting.id,
                  recording,
                  transcript,
                })
              )
                close();
            }}
          >
            保存会议资料
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
