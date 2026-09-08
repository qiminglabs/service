'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  assessmentOf,
  gapApproverOptions,
  assessedEffort,
  currentPlan,
  planAssetDays,
  planGap,
  assetAvailable,
  isProjectManager,
  isSalesUser,
  applyAssessmentAction,
} from '@/lib/request-assessment';
import type { AssessmentAction, GapApproval } from '@/lib/request-assessment';
import { operationIdentities } from '@/lib/internal-users';
import type { OperationActor, RequestAsset } from '@/lib/request-operations';
import { readLocal } from '@/lib/service-requests';
import type { ServiceRequest, InternalUser } from '@/lib/service-requests';

type Props = {
  record: ServiceRequest;
  actor: OperationActor;
  users: InternalUser[];
  assets: RequestAsset[];
  busy: boolean;
  save: (r: ServiceRequest, message?: string) => Promise<boolean>;
};
type Mode = 'round' | 'effort' | 'plan' | 'gap' | 'decide' | null;
const fmt = (n: number) => String(Number(n.toFixed(2)));
const stamp = (s: string) => {
  const date = new Date(s);
  if (!Number.isFinite(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
function StepTitle({
  index,
  stage,
  complete,
  children,
}: {
  index: number;
  stage: number;
  complete: boolean;
  children: ReactNode;
}) {
  const state =
    complete || index < stage
      ? 'done'
      : index === stage
        ? 'active'
        : 'upcoming';
  return (
    <h4
      className="sr-assessment-step-title"
      data-state={state}
      aria-current={state === 'active' ? 'step' : undefined}
    >
      <span className="sr-assessment-step-icon" aria-hidden="true">
        {state === 'done' ? <CheckCircle2 size={20} /> : index + 1}
      </span>
      {children}
      <span className="sr-only">
        {state === 'done'
          ? '，已完成'
          : state === 'active'
            ? '，当前步骤'
            : '，待进行'}
      </span>
    </h4>
  );
}
function RecordMeta({ author, at }: { author: string; at: string }) {
  return (
    <div className="sr-assessment-record-meta">
      <span>{author}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={at}>{stamp(at)}</time>
    </div>
  );
}
function Field({ title, children }: { title: string; children: ReactNode }) {
  return (
    <label className="sr-ops-field">
      <span>{title}</span>
      {children}
    </label>
  );
}
function Badge({ children }: { children: ReactNode }) {
  return <span className="sr-assessment-badge">{children}</span>;
}
export function RequestAssessment({
  record,
  actor,
  users,
  assets,
  busy,
  save,
}: Props) {
  const a = assessmentOf(record),
    plan = currentPlan(record),
    effort = assessedEffort(record);
  const passed = a.rounds.some((r) => r.outcome === '评估通过');
  const customerConfirmed = ['待受理', '已转服务项目'].includes(record.status);
  const latestDecision = record.operations?.customerDecisions?.at(-1);
  const confirmedDecision = customerConfirmed && latestDecision?.accepted && latestDecision.planId === a.confirmation?.planId
    ? latestDecision : undefined;
  const confirmationLabel = record.status === '已取消' ? '已取消' : customerConfirmed ? '客户已确认' : '等待客户确认';
  const gap = planGap(plan);
  const approved =
    plan &&
    a.approvals.some(
      (v) => v.planId === plan.id && v.state === '已通过' && v.days >= gap,
    );
  const waiting =
    plan &&
    a.approvals.some((v) => v.planId === plan.id && v.state === '待审批');
  const currentApprovals = a.approvals.filter(item => item.planId === plan?.id && item.state !== '已失效').slice(-1);
  const editable = record.status === '待评估' && !busy;
  const manager =
    isProjectManager(actor) && (!a.managerId || a.managerId === actor.id);
  const confirmationReady = passed && effort !== undefined && !!plan && (gap < 1e-8 || !!approved);
  const canConfirm = manager && editable && confirmationReady;
  const [externalNote, setExternalNote] = useState('');
  const [dialog, setDialog] = useState<Mode | 'confirm'>(null);
  const [approval, setApproval] = useState<GapApproval | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [records, setRecords] = useState<ServiceRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    readLocal<ServiceRequest>('requests')
      .then((r) => {
        if (active) {
          setRecords(r);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (active) {
          setError('无法读取资产锁定情况，请刷新重试。');
          setLoaded(false);
        }
      });
    return () => {
      active = false;
    };
  }, [record.updatedAt]);
  async function run(action: AssessmentAction) {
    if (working || busy) return false;
    setWorking(true);
    setError('');
    try {
      const fresh = await readLocal<ServiceRequest>('requests');
      const next = applyAssessmentAction(
        record,
        action,
        actor,
        assets,
        users,
        fresh,
      );
      const ok = await save(
        next,
        action.type === 'confirm' ? '已发起客户确认' : '评估工作已保存',
      );
      if (ok) {
        setRecords(fresh);
        setDialog(null);
      } else setError('保存未完成，请检查页面错误提示后重试。');
      return ok;
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试。');
      return false;
    } finally {
      setWorking(false);
    }
  }
  function open(v: Mode | 'confirm') {
    setError('');
    if (v === 'confirm') setExternalNote(a.confirmation?.externalNote ?? '');
    setDialog(v);
  }
  const stage = plan && (gap < 1e-8 || approved) ? 3 : effort !== undefined ? 2 : passed ? 1 : 0;
  const disabled = busy || working;
  return (
    <section className="sr-panel sr-assessment">
      <div className="sr-ops-heading">
        <div>
          <h3>评估</h3>
          <p>由项目经理完成材料评估、核定人天、关联服务依据并发起客户确认。</p>
        </div>
        <div className="sr-assessment-manager">
          <span>项目经理</span>
          <strong>
            {a.manager ||
              operationIdentities(users).find(
                (user) => user.role === 'SmartX 项目经理',
              )?.name ||
              '待分配'}
          </strong>
        </div>
      </div>
      {error && !dialog && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      <div className="sr-assessment-body">
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={0} stage={stage} complete={!!a.confirmation}>
                材料评估
              </StepTitle>
              {a.rounds.at(-1) && (
                <RecordMeta
                  author={a.rounds.at(-1)!.author}
                  at={a.rounds.at(-1)!.at}
                />
              )}
            </div>
            {manager && editable && !passed && (
              <Button
                variant="default"
                disabled={disabled}
                onClick={() => open('round')}
              >
                材料评估
              </Button>
            )}
            {passed && <Badge>已通过 · 评估结论已锁定</Badge>}
          </div>
          {!a.rounds.length ? (
            <p className="sr-help">等待项目经理查看申请材料并记录评估结论。</p>
          ) : (
            <div className="sr-assessment-rounds">
              {a.rounds.slice(-1).map((r) => (
                <article key={r.id}>
                  <div className="sr-assessment-round-title">
                    <strong>材料评估记录</strong>
                    <Badge>{r.outcome}</Badge>
                    {r.id !== a.rounds.at(-1)?.id && (
                      <RecordMeta author={r.author} at={r.at} />
                    )}
                  </div>
                  <p>{r.opinion}</p>
                  {(r.scope || r.risks) && (
                    <dl>
                      {r.scope && (
                        <>
                          <dt>服务范围</dt>
                          <dd>{r.scope}</dd>
                        </>
                      )}
                      {r.risks && (
                        <>
                          <dt>风险与前置条件</dt>
                          <dd>{r.risks}</dd>
                        </>
                      )}
                    </dl>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={1} stage={stage} complete={!!a.confirmation}>
                核定人天
              </StepTitle>
              {(a.effort || plan) && (
                <RecordMeta
                  author={(a.effort ?? plan)!.author}
                  at={(a.effort ?? plan)!.at}
                />
              )}
            </div>
            {passed && manager && editable && (
              <Button
                variant="default"
                disabled={disabled || !!waiting}
                onClick={() => open('effort')}
              >
                核定人天
              </Button>
            )}
          </div>
          {effort === undefined ? (
            <p className="sr-help">
              {passed
                ? '材料评估已通过，请核定服务总人天。'
                : '材料评估通过后可核定人天。'}
            </p>
          ) : (
            <>
              <div className="sr-assessment-amounts">
                <span>
                  服务总人天
                  <strong>
                    {fmt(effort)} <small>人天</small>
                  </strong>
                </span>
              </div>
            </>
          )}
          {a.effort?.note && (
            <div className="sr-assessment-note">
              <strong>备注</strong>
              <p>{a.effort.note}</p>
            </div>
          )}
        </section>
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={2} stage={stage} complete={!!a.confirmation}>
                关联服务依据
              </StepTitle>
              {plan && <RecordMeta author={plan.author} at={plan.at} />}
            </div>
            {passed && effort !== undefined && manager && editable && (
              <Button
                variant="default"
                disabled={!loaded || disabled || !!waiting}
                onClick={() => open('plan')}
              >
                关联依据
              </Button>
            )}
          </div>
          {waiting && (
            <p className="sr-help">
              额度特批审批中，核定人天与服务依据暂不可修改。
            </p>
          )}
          {plan ? (
            <>
              <div className="sr-assessment-amounts">
                <span>
                  客户资产已锁定
                  <strong>
                    {fmt(planAssetDays(plan))} <small>人天</small>
                  </strong>
                </span>
                <span>
                  需额外额度
                  <strong>
                    {fmt(gap)} <small>人天</small>
                  </strong>
                </span>
              </div>
              <div className="sr-assessment-allocations">
                {plan.allocations.length ? (
                  plan.allocations.map((v) => (
                    <div key={v.assetId}>
                      <span>
                        {v.name} <small>{v.assetId}</small>
                      </span>
                      <strong>{fmt(v.days)} 人天</strong>
                      <Badge>已锁定</Badge>
                    </div>
                  ))
                ) : (
                  <p>未锁定客户资产，全部人天需额度特批。</p>
                )}
              </div>
              <p className="sr-help">负责销售：{plan.salesName}</p>
              {gap > 1e-8 && (
                <div className="sr-assessment-gap">
                  <div>
                    <strong>资产缺少 {fmt(gap)} 人天</strong>
                    <p>
                      {approved
                        ? '额度特批已通过，可发起客户确认。'
                        : waiting
                          ? '销售已发起特批，等待指定上级审批。'
                          : `由 ${plan.salesName} 发起额度特批，再交上级审批。`}
                    </p>
                  </div>
                  {editable &&
                    actor.id === plan.salesId &&
                    isSalesUser(users.find((u) => u.id === actor.id)) &&
                    !waiting &&
                    !approved && (
                      <Button disabled={disabled} onClick={() => open('gap')}>
                        发起额度特批
                      </Button>
                    )}
                </div>
              )}
            </>
          ) : (
            <p className="sr-help">
              {effort === undefined
                ? '核定人天后，关联客户资产或额外服务额度。'
                : '请选择客户资产并填写锁定人天；不足部分由销售发起额度特批。'}
            </p>
          )}
          {currentApprovals.length > 0 && (
            <div className="sr-assessment-approvals">
              {currentApprovals.map((v) => (
                <article key={v.id}>
                  <div>
                    <strong>{fmt(v.days)} 人天额度特批</strong>{' '}
                    <Badge>{v.state}</Badge>
                    <p>{v.reason}</p>
                    <small>
                      {v.author} 发起 · 上级审批人：{v.approver} · {stamp(v.at)}
                    </small>
                    {v.note && (
                      <p className="sr-ops-decision">
                        {v.decidedBy}：{v.note}
                      </p>
                    )}
                  </div>
                  {editable &&
                    v.state === '待审批' &&
                    v.approverId === actor.id && (
                      <Button
                        variant="default"
                        disabled={disabled}
                        onClick={() => {
                          setApproval(v);
                          open('decide');
                        }}
                      >
                        处理审批
                      </Button>
                    )}
                </article>
              ))}
            </div>
          )}
        </section>
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={3} stage={stage} complete={customerConfirmed}>
                客户确认
              </StepTitle>
              {confirmedDecision ? <RecordMeta author={confirmedDecision.actor} at={confirmedDecision.at} /> : a.confirmation && <RecordMeta author={a.confirmation.by} at={a.confirmation.at} />}
            </div>
            {!a.confirmation && manager && editable && confirmationReady && (
              <Button disabled={!canConfirm || disabled} onClick={() => open('confirm')}>
                发起客户确认<ArrowRight size={15} />
              </Button>
            )}
            {(a.confirmation || customerConfirmed) && <Badge>{confirmationLabel}</Badge>}
          </div>
          <p className="sr-help">
            {record.status === '已取消' ? '请求已取消。'
              : record.status === '已转服务项目' ? '客户已确认，服务项目已创建。'
              : customerConfirmed ? '客户已确认，等待项目经理创建服务项目。'
              : a.confirmation ? '服务依据已提交，等待客户确认。' : !plan
              ? '关联服务依据后，可发起客户确认。'
              : gap > 1e-8 && !approved
                ? '等待额度特批通过后，可发起客户确认。'
                : '服务依据已足额覆盖，请核对请求概览与预计消耗资产后发起客户确认。'}
          </p>
        </section>
      </div>
      <Dialog
        open={!!dialog}
        onOpenChange={(v) => {
          if (!v && !disabled) setDialog(null);
        }}
      >
        <DialogContent className="sr-ops-dialog" showCloseButton={!disabled}>
          {dialog === 'confirm' ? (
            <>
              <DialogHeader>
                <DialogTitle>确认发起客户确认</DialogTitle>
                <DialogDescription>请核对以下请求与预计消耗资产，确认后将提交给客户确认。</DialogDescription>
              </DialogHeader>
              <div className="sr-confirmation-preview">
                <section>
                  <h4>请求概览</h4>
                  <dl>
                    <dt>请求名称</dt><dd>{record.title}</dd>
                    <dt>请求编号</dt><dd>{record.id}</dd>
                    <dt>预计服务日期</dt><dd>{record.expectedServiceDate || '未填写'}</dd>
                    <dt>请求描述</dt><dd>{record.description || '未填写'}</dd>
                    <dt>申请服务</dt><dd>{record.items.map(item => (
                      <div key={item.id}>{item.serviceName}{item.method ? ` · ${item.method}` : ''}</div>
                    ))}</dd>
                  </dl>
                </section>
                <section>
                  <h4>待客户确认的服务资产消耗</h4>
                  {plan?.allocations.length ? (
                    <>
                      <div className="sr-assessment-allocations">
                        {plan.allocations.map(asset => (
                          <div key={asset.assetId}>
                            <span>{asset.name} <small>{asset.assetId}</small></span>
                            <strong>{fmt(asset.days)} 人天</strong>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <p className="sr-help">本次不消耗客户资产。</p>}
                </section>
                <section>
                  <div className="sr-confirmation-note-label">
                    <label htmlFor="customer-confirmation-note">说明（选填）</label>
                    <span className="sr-assessment-badge" id="customer-confirmation-note-hint">客户可见</span>
                  </div>
                  <Textarea id="customer-confirmation-note" aria-describedby="customer-confirmation-note-hint" value={externalNote} onChange={event => setExternalNote(event.target.value)} disabled={disabled} rows={4} placeholder="填写给客户的服务说明，提交后将在客户中心显示" />
                </section>
              </div>
              {error && <p className="sr-error" role="alert">{error}</p>}
              <DialogFooter>
                <Button variant="outline" disabled={disabled} onClick={() => setDialog(null)}>取消</Button>
                <Button disabled={!canConfirm || disabled} onClick={() => void run({ type: 'confirm', externalNote })}>
                  {working ? '正在发起…' : '确认发起'}
                </Button>
              </DialogFooter>
            </>
          ) : <AssessmentForm
            key={`${dialog}:${approval?.id}`}
            mode={dialog}
            record={record}
            users={users}
            actor={actor}
            assets={assets}
            records={records}
            approval={approval}
            disabled={disabled}
            error={error}
            run={run}
            close={() => setDialog(null)}
          />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
function AssessmentForm({
  mode,
  record,
  users,
  actor,
  assets,
  records,
  approval,
  disabled,
  error,
  run,
  close,
}: {
  mode: Mode;
  record: ServiceRequest;
  users: InternalUser[];
  actor: OperationActor;
  assets: RequestAsset[];
  records: ServiceRequest[];
  approval: GapApproval | null;
  disabled: boolean;
  error: string;
  run: (action: AssessmentAction) => Promise<boolean>;
  close: () => void;
}) {
  const a = assessmentOf(record),
    plan = currentPlan(record),
    assessed = assessedEffort(record);
  const [opinion, setOpinion] = useState('');
  const [outcome, setOutcome] = useState<'需补充' | '评估通过'>('需补充');
  const [effort, setEffort] = useState(
    assessed === undefined ? '' : String(assessed),
  );
  const [effortNote, setEffortNote] = useState(a.effort?.note ?? '');
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      plan?.allocations.map((v) => [v.assetId, String(v.days)]) ?? [],
    ),
  );
  const salesUsers = users.filter(isSalesUser);
  const [salesId, setSalesId] = useState(
    plan?.salesId ??
      (salesUsers.some((u) => u.id === record.createdById)
        ? record.createdById!
        : salesUsers.length === 1
          ? salesUsers[0].id
          : ''),
  );
  const [approverId, setApproverId] = useState('');
  const approvers = gapApproverOptions(users, actor.id, a.managerId);
  const customerAssets = assets.filter(
    (v) =>
      v.customerId === record.customerId &&
      ['启用', '使用中'].includes(v.status),
  );
  const titles: Record<string, string> = {
    round: '材料评估',
    effort: '核定人天',
    plan: '关联服务依据',
    gap: '销售发起额度特批',
    decide: '上级审批额度特批',
  };
  async function submit() {
    if (mode === 'round') return run({ type: 'review', opinion, outcome });
    if (mode === 'effort')
      return run({ type: 'effort', days: Number(effort), note: effortNote });
    if (mode === 'plan')
      return run({
        type: 'plan',
        salesId,
        allocations: Object.entries(amounts)
          .filter(([, v]) => v.trim() !== '' && Number(v) !== 0)
          .map(([assetId, v]) => ({ assetId, days: Number(v) })),
      });
    if (mode === 'gap')
      return run({ type: 'gap-submit', reason: opinion, approverId });
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{titles[mode ?? '']}</DialogTitle>
        {mode !== 'round' && (
          <DialogDescription>
            {mode === 'effort'
              ? '核定本次服务总人天。修改人天会释放原资产预留，需重新关联服务依据。'
              : mode === 'plan'
                ? '关联客户资产并锁定人天，不足部分由销售发起额度特批。'
                : `额外额度 ${fmt(mode === 'decide' ? (approval?.days ?? 0) : planGap(plan))} 人天`}
          </DialogDescription>
        )}
      </DialogHeader>
      <div className="sr-ops-form">
        {mode === 'round' && (
          <>
            <Field title="评估结论 *">
              <NativeSelect
                value={outcome}
                disabled={disabled}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                <option>需补充</option>
                <option>评估通过</option>
              </NativeSelect>
            </Field>
            <Field title="评估意见 *">
              <Textarea
                rows={4}
                value={opinion}
                disabled={disabled}
                onChange={(e) => setOpinion(e.target.value)}
                placeholder="记录材料完整性、待补充信息及评估判断"
              />
            </Field>
          </>
        )}
        {mode === 'effort' && (
          <>
            <Field title="服务总人天 *">
              <Input
                type="number"
                min="0.01"
                step="0.01"
                value={effort}
                disabled={disabled}
                onChange={(e) => setEffort(e.target.value)}
              />
            </Field>
            <Field title="备注（选填）">
              <Textarea
                value={effortNote}
                disabled={disabled}
                onChange={(event) => setEffortNote(event.target.value)}
                rows={3}
                placeholder="补充人天估算依据或说明"
              />
            </Field>
          </>
        )}
        {mode === 'plan' && (
          <>
            <div className="sr-ops-form-row">
              <Field title="已核定人天">
                <Input value={`${fmt(assessed ?? 0)} 人天`} readOnly />
              </Field>
              <Field title="负责销售 *">
                <NativeSelect
                  value={salesId}
                  disabled={disabled}
                  onChange={(e) => setSalesId(e.target.value)}
                >
                  <option value="">请选择销售</option>
                  {salesUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <div className="sr-assessment-asset-editor">
              {customerAssets.map((v) => {
                const available = assetAvailable(v, records, record.id);
                return (
                  <div key={v.id}>
                    <span>
                      <strong>{v.name}</strong>
                      <small>
                        {v.id} ·{' '}
                        {available === null
                          ? '余额未维护'
                          : `可锁定 ${fmt(available)} 人天`}
                      </small>
                    </span>
                    <Input
                      aria-label={`${v.name} ${v.id} 锁定人天`}
                      placeholder="锁定人天"
                      type="number"
                      min="0"
                      step="0.01"
                      max={available ?? 0}
                      disabled={disabled || available === null}
                      value={amounts[v.id] ?? ''}
                      onChange={(e) =>
                        setAmounts({ ...amounts, [v.id]: e.target.value })
                      }
                    />
                  </div>
                );
              })}
              {!customerAssets.length && (
                <p>当前客户暂无有效资产，可按全部人天发起额度特批。</p>
              )}
            </div>
            <p className="sr-help">
              预计缺口：
              {fmt(
                Math.max(
                  0,
                  (assessed ?? 0) -
                    Object.values(amounts).reduce(
                      (s, v) => s + (Number(v) || 0),
                      0,
                    ),
                ),
              )}{' '}
              人天。
            </p>
          </>
        )}
        {(mode === 'gap' || mode === 'decide') && (
          <Field title={mode === 'gap' ? '额度特批原因 *' : '审批意见 *'}>
            <Textarea
              rows={4}
              disabled={disabled}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
            />
          </Field>
        )}
        {mode === 'gap' && (
          <Field title="上级审批人 *">
            <NativeSelect
              disabled={disabled}
              value={approverId}
              onChange={(e) => setApproverId(e.target.value)}
            >
              <option value="">请选择上级审批人</option>
              {approvers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {mode === 'decide' && (
          <p className="sr-help">
            销售 {approval?.author} 发起：{approval?.reason}
          </p>
        )}
        {error && (
          <p className="sr-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={disabled} onClick={close}>
          取消
        </Button>
        {mode === 'decide' && approval ? (
          <>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void run({
                  type: 'gap-decide',
                  id: approval.id,
                  approve: false,
                  note: opinion,
                })
              }
            >
              拒绝
            </Button>
            <Button
              disabled={disabled}
              onClick={() =>
                void run({
                  type: 'gap-decide',
                  id: approval.id,
                  approve: true,
                  note: opinion,
                })
              }
            >
              通过特批
            </Button>
          </>
        ) : (
          <Button disabled={disabled} onClick={() => void submit()}>
            {mode === 'round'
              ? '保存评估结论'
              : mode === 'effort'
                ? '保存核定人天'
                : mode === 'plan'
                  ? '保存服务依据'
                  : '提交上级审批'}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
