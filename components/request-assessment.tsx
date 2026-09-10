'use client';

import { customerCollaboratorsIssue } from '@/lib/request-collaboration';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { formatDays, parseDayQuantity } from '@/lib/day-quantity';
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
  customerOwner,
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
import { activeEntitlementAllocations, effortEntitlementAllocations, entitlementLabel } from '@/lib/request-entitlement-reservations';
import { assetDayMethod, requestDayRequirements, coverageByMethod, allocationMethodIssue, planDayGaps, formatDayRequirements } from '@/lib/request-asset-coverage';
import type { AssessmentAction, GapApproval } from '@/lib/request-assessment';
import { operationIdentities } from '@/lib/internal-users';
import type { OperationActor, RequestAsset } from '@/lib/request-operations';
import { readLocal } from '@/lib/service-requests';
import { itemMinimumDays, itemPriceCoefficient, calculateBillableDays, calculateEffortPricing, effortTotalsByMethod, entitlementPricingContext, itemEntitlementKind, calculateEntitlementLines, type EntitlementPricingContext } from '@/lib/request-pricing';
import type { ServiceRequest, InternalUser, CatalogService, CustomerRef } from '@/lib/service-requests';

type Props = {
  customers: CustomerRef[];
  services: CatalogService[];
  record: ServiceRequest;
  actor: OperationActor;
  users: InternalUser[];
  assets: RequestAsset[];
  busy: boolean;
  save: (r: ServiceRequest, message?: string) => Promise<boolean>;
};
type Mode = 'round' | 'effort' | 'plan' | 'gap' | 'decide' | null;
const fmt = formatDays;
const isMinimumDaysIssue = (message: string) => message.includes('预估人天不能小于当前最小人天数量');
async function readCurrentPricingData() {
  const [references, records] = await Promise.all([readLocal<{ id: string; payload?: any }>('references'), readLocal<ServiceRequest>('requests')]);
  const services = references.find(reference => reference.id === 'workspace')?.payload?.services;
  if (!services) throw new Error('无法读取最新服务目录，请刷新后重试。');
  return { contacts: references.find(reference => reference.id === 'workspace')?.payload?.contacts ?? [], services: services as CatalogService[], context: entitlementPricingContext(references, records) };
}
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
  customers,
  services,
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
  const effortTotals = effortTotalsByMethod(record, a.effort?.lines ?? []);
  const entitlementAllocations = activeEntitlementAllocations(record);
  const passed = a.rounds.some((r) => r.outcome === '评估通过');
  const customerConfirmed = ['待受理', '已转服务项目'].includes(record.status);
  const latestDecision = record.operations?.customerDecisions?.at(-1);
  const confirmedDecision = customerConfirmed && latestDecision?.accepted && latestDecision.planId === a.confirmation?.planId
    ? latestDecision : undefined;
  const confirmationLabel = record.status === '已取消' ? '已取消' : customerConfirmed ? '客户已确认' : '等待客户确认';
  const gap = planGap(plan);
  const dayGaps = planDayGaps(plan);
  const gapDescription = formatDayRequirements(dayGaps) || `${fmt(gap)} 人天`;
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
  const [liveServices, setLiveServices] = useState<CatalogService[]>([]);
  const [livePricingContext, setLivePricingContext] = useState<EntitlementPricingContext>({ businessObjects: [], conversions: {} });
  const [catalogReady, setCatalogReady] = useState(false);
  const [approval, setApproval] = useState<GapApproval | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [records, setRecords] = useState<ServiceRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (dialog !== 'effort' && dialog !== 'plan') return;
    let active = true;
    let version = 0;
    const refresh = async () => {
      const current = ++version;
      setCatalogReady(false);
      try {
        const latest = await readCurrentPricingData();
        if (active && current === version) {
          setLiveServices(latest.services);
          setLivePricingContext(latest.context);
          setCatalogReady(true);
          setError('');
        }
      } catch (error) {
        if (active && current === version) setError(error instanceof Error ? error.message : '无法读取最新服务目录。');
      }
    };
    void refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [dialog]);
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
      const pricingData = ['effort', 'plan', 'confirm'].includes(action.type) ? await readCurrentPricingData() : { services, context: livePricingContext };
      if (action.type === 'confirm') {
        const issue = customerCollaboratorsIssue(record, 'contacts' in pricingData ? pricingData.contacts : []);
        if (issue) throw new Error(issue);
      }
      const pricingServices = pricingData.services;
      if (action.type === 'effort') { setLiveServices(pricingServices); setLivePricingContext(pricingData.context); }
      const references = action.type === 'plan' ? await readLocal<{ id: string; payload?: { customers?: CustomerRef[]; users?: InternalUser[] } }>('references') : [];
      const workspace = references.find(reference => reference.id === 'workspace')?.payload;
      const next = applyAssessmentAction(
        record,
        action,
        actor,
        assets,
        action.type === 'plan' ? (workspace?.users ?? []) : users,
        fresh,
        undefined,
        pricingServices,
        action.type === 'plan' ? (workspace?.customers ?? []) : customers,
        pricingData.context,
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
    if (v === 'effort') setCatalogReady(false);
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
                ? '材料评估已通过，请按服务目录核定预估人天。'
                : '材料评估通过后可核定人天。'}
            </p>
          ) : (
            <>
              <div className="sr-pricing-overview">
                {effortTotals.length ? effortTotals.flatMap(total => [
                  <div key={`${total.method}-billable`} className="sr-pricing-primary"><span>计价{total.method}总人天</span><strong>{fmt(total.days)} <small>人天</small></strong></div>,
                  <div key={`${total.method}-estimated`} className="sr-pricing-primary"><span>预估{total.method}总人天</span><strong>{fmt(total.estimatedDays)} <small>人天</small></strong></div>,
                ]) : <>
                  <div className="sr-pricing-primary"><span>计价总人天</span><strong>{fmt(effort)} <small>人天</small></strong></div>
                  {a.effort?.estimatedDays !== undefined && <div className="sr-pricing-primary"><span>预估总人天</span><strong>{fmt(a.effort.estimatedDays)} <small>人天</small></strong></div>}
                </>}
              </div>
              {!!a.effort?.lines?.length && <ul className="sr-pricing-details" aria-label="服务目录计价明细">
                {a.effort.lines.map(line => <li key={line.itemId}>
                  <div className="sr-pricing-service"><strong>{line.serviceName}</strong><span>{record.items.find(item => item.id === line.itemId)?.method}</span></div>
                  <div className="sr-pricing-equation">
                    <span><small>{line.kind === 'entitlement' ? '差额权益' : '预估'}</small> {line.kind === 'entitlement' ? (line.deficitEntitlements ? fmt(line.deficitEntitlements) : '—') : `${fmt(line.estimatedDays)} 人天`}</span>
                    <span className="sr-pricing-operator" aria-hidden="true">×</span>
                    <span><small>{line.kind === 'entitlement' ? '换算系数' : '计价系数'}</small> {fmt(line.priceCoefficient)}</span>
                    <span className="sr-pricing-operator" aria-hidden="true">=</span>
                    <strong aria-label={`计价 ${fmt(line.billableDays)} 人天`}>{fmt(line.billableDays)} <small>人天</small></strong>
                  </div>
                </li>)}
              </ul>}
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
              <div className="sr-basis-assets">
                <div className="sr-basis-assets-heading">
                  <h5>客户资产占用</h5>
                  {plan.allocations.length > 0 && <span>人天资产合计：{fmt(planAssetDays(plan))} 人天</span>}
                </div>
                {plan.allocations.length || entitlementAllocations.length ? (
                  <ul className="sr-basis-asset-list" aria-label="已锁定人天资产及已冻结权益">
                    {plan.allocations.map(asset => (
                      <li key={asset.assetId}>
                        <span className="sr-basis-asset-kind">人天资产</span>
                        <div className="sr-basis-asset-name"><strong>{asset.name}</strong><small>{asset.assetId}</small></div>
                        <strong className="sr-basis-asset-quantity">{fmt(asset.days)} <small>人天</small></strong>
                        <Badge>已锁定</Badge>
                      </li>
                    ))}
                    {entitlementAllocations.map(allocation => (
                      <li key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
                        <span className="sr-basis-asset-kind">{entitlementLabel(allocation.kind)}</span>
                        <div className="sr-basis-asset-name"><strong>{allocation.name}</strong></div>
                        <strong className="sr-basis-asset-quantity" aria-label={`冻结权益数量 ${allocation.quantity}`}>{allocation.quantity}</strong>
                        <Badge>已冻结</Badge>
                      </li>
                    ))}
                  </ul>
                ) : <p className="sr-help">{plan.effort > 0 ? '暂无已锁定的客户资产。' : '本次无需占用客户资产。'}</p>}
              </div>
              {gap > 1e-8 && (
                <div className="sr-assessment-gap">
                  <div>
                    <strong>人天资产缺口：{gapDescription}</strong>
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
              <p className="sr-basis-owner">负责销售：{plan.salesName}</p>
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
                    <strong>{formatDayRequirements(v.gaps ?? dayGaps) || `${fmt(v.days)} 人天`}额度特批</strong>{' '}
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
        <DialogContent className={`sr-ops-dialog${dialog === 'effort' ? ' sr-ops-dialog--wide' : ''}`} showCloseButton={!disabled}>
          {dialog === 'confirm' ? (
            <>
              <DialogHeader>
                <DialogTitle>确认发起客户确认</DialogTitle>
                <DialogDescription>请核对以下请求与预计消耗资产，确认后将提交给客户确认。</DialogDescription>
              </DialogHeader>
              <div className="sr-confirmation-preview">
                <section className="sr-customer-visible-panel">
                  <div className="sr-panel-title-with-visibility">
                    <h4>请求概览</h4>
                    <CustomerVisibleBadge />
                  </div>
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
                <section className="sr-customer-visible-panel">
                  <div className="sr-panel-title-with-visibility">
                    <h4>待客户确认的服务资产消耗</h4>
                    <CustomerVisibleBadge />
                  </div>
                  {plan && (plan.allocations.length || activeEntitlementAllocations(record).length) ? (
                    <>
                      <div className="sr-assessment-allocations">
                        {activeEntitlementAllocations(record).map(allocation => <div key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
                          <span>{allocation.name} · {entitlementLabel(allocation.kind)}</span><strong>{allocation.quantity}</strong>
                        </div>)}
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
                <section className="sr-customer-visible-panel">
                  <div className="sr-confirmation-note-label">
                    <label htmlFor="customer-confirmation-note">说明（选填）</label>
                    <CustomerVisibleBadge id="customer-confirmation-note-hint" />
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
            customers={customers}
            services={dialog === 'effort' ? liveServices : services}
            pricingContext={livePricingContext}
            record={record}
            users={users}
            actor={actor}
            assets={assets}
            records={records}
            approval={approval}
            disabled={disabled}
            pricingReady={!['effort', 'plan'].includes(dialog ?? '') || catalogReady}
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
  pricingContext,
  customers,
  services,
  pricingReady,
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
  customers: CustomerRef[];
  mode: Mode;
  services: CatalogService[];
  pricingReady: boolean;
  pricingContext: EntitlementPricingContext;
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
  const [estimates, setEstimates] = useState<Record<string, string>>(() => Object.fromEntries(
    record.items.map(item => [item.id, String(a.effort?.lines?.find(line => line.itemId === item.id)?.estimatedDays ?? '')]),
  ));
  const dayItems = record.items.filter(item => !itemEntitlementKind(item, services));
  const entitlementItems = record.items.filter(item => !!itemEntitlementKind(item, services));
  const pricingInputs = record.items.map(item => itemEntitlementKind(item, services)
    ? { itemId: item.id, estimatedDays: 0 }
    : { itemId: item.id, estimatedDays: parseDayQuantity(estimates[item.id] ?? '') ?? NaN, priceCoefficient: itemPriceCoefficient(item, services) });
  let pricingIssue = '';
  let pricing: ReturnType<typeof calculateEffortPricing> | undefined;
  try { pricing = calculateEffortPricing(record, pricingInputs, services, pricingContext); }
  catch (error) { pricingIssue = error instanceof Error ? error.message : '请填写完整的预估人天。'; }

  let entitlementLines: ReturnType<typeof calculateEntitlementLines> = [];
  let entitlementIssue = '';
  try { entitlementLines = calculateEntitlementLines(record, services, pricingContext); }
  catch (error) { entitlementIssue = error instanceof Error ? error.message : '无法获取权益信息'; }
  const [effortNote, setEffortNote] = useState(a.effort?.note ?? '');
  const requirements = requestDayRequirements(record);
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      plan?.allocations.filter(v => { const asset = assets.find(asset => asset.id === v.assetId); return asset && requirements.some(row => row.method === assetDayMethod(asset)); }).map((v) => [v.assetId, String(v.days)]) ?? [],
    ),
  );
  const sales = customerOwner(record, customers, users);
  const salesId = sales?.id ?? '';
  const [approverId, setApproverId] = useState('');
  const approvers = gapApproverOptions(users, actor.id, a.managerId);
  const customerAssets = assets.filter(
    (v) =>
      v.customerId === record.customerId &&
      ['启用', '使用中'].includes(v.status),
  );
  const allocationPreview = Object.entries(amounts).filter(([, value]) => value.trim() !== '' && Number(value) !== 0)
    .map(([assetId, value]) => { const asset = customerAssets.find(asset => asset.id === assetId); return { assetId, days: parseDayQuantity(value) ?? NaN, name: asset?.name ?? assetId, method: asset && assetDayMethod(asset) }; });
  const coverage = coverageByMethod(requirements, allocationPreview);
  const allocationIssue = allocationMethodIssue(record, allocationPreview, customerAssets);
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
      return run({ type: 'effort', items: pricingInputs, note: effortNote });
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
        {mode === 'round' && (
          <DialogDescription>材料评估通过后，申请项及材料将锁定，不再支持修改。</DialogDescription>
        )}
        {mode !== 'round' && (
          <DialogDescription>
            {mode === 'effort'
              ? '人天类按预估人天 × 计价系数计价；权益类按差额权益 × 换算系数计价。计价结果逐项四舍五入到一位小数后汇总。'
              : mode === 'plan'
                ? '远程计价人天仅锁定远程资产，现场计价人天仅锁定现场资产；各类资产缺少数量分别核算。'
                : `额外额度：${formatDayRequirements(mode === 'decide' ? (approval?.gaps ?? planDayGaps(plan)) : planDayGaps(plan)) || `${fmt(mode === 'decide' ? (approval?.days ?? 0) : planGap(plan))} 人天`}`}
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
            {!!dayItems.length && <section className="sr-pricing-group" aria-label="人天类申请项">
            <h4>人天类申请项</h4>
            <div className="sr-pricing-table-wrap"><table className="sr-pricing-table sr-pricing-editor">
              <thead><tr><th>服务目录</th><th>预估人天 <em>*</em></th><th>计价系数</th><th>计价人天</th></tr></thead>
              <tbody>{dayItems.map(item => {
                const coefficient = itemPriceCoefficient(item, services);
                const minimumDays = itemMinimumDays(item, services);
                const estimate = Number(estimates[item.id]);
                const belowMinimum = !!estimates[item.id]?.trim() && Number.isFinite(estimate) && minimumDays !== undefined && estimate < minimumDays;
                const billable = estimates[item.id]?.trim() && Number.isFinite(estimate) && estimate > 0 && coefficient !== undefined
                  ? calculateBillableDays(estimate, coefficient) : undefined;
                return <tr key={item.id}>
                  <td><strong>{item.serviceName}</strong><small>{item.method}</small></td>
                  <td><Input aria-label={`${item.serviceName} ${item.id} 预估人天`} aria-describedby={`minimum-days-${item.id}`} aria-invalid={belowMinimum} type="number" min={minimumDays ?? 0.1} max="100000" step="0.1"
                    placeholder="填写人天" value={estimates[item.id] ?? ''} disabled={disabled || !pricingReady}
                    onChange={event => setEstimates(old => ({ ...old, [item.id]: event.target.value }))} />
                    <small id={`minimum-days-${item.id}`} className="sr-pricing-minimum" data-invalid={belowMinimum}>{minimumDays === undefined ? '最小人天数量未获取' : `最少 ${fmt(minimumDays)} 人天`}</small></td>
                  <td><span aria-label={`${item.serviceName} 计价系数（只读）`}>{coefficient === undefined ? '未配置' : `× ${fmt(coefficient)}`}</span></td>
                  <td><output aria-label={`${item.serviceName} 计价人天`}>{billable === undefined ? '—' : fmt(billable)}</output></td>
                </tr>;
              })}</tbody>
            </table></div>
            </section>}
            {!!entitlementItems.length && <section className="sr-pricing-group" aria-label="权益类申请项">
              <h4>权益类申请项</h4>
              <div className="sr-pricing-table-wrap"><table className="sr-pricing-table sr-pricing-editor">
                <thead><tr><th>服务目录</th><th>差额权益</th><th>换算系数</th><th>计价人天</th></tr></thead>
                <tbody>{entitlementItems.map(item => {
                  const line = entitlementLines.find(line => line.itemId === item.id);
                  const issue = entitlementIssue;
                  const kind = itemEntitlementKind(item, services)!;
                  const conversion = pricingContext.conversions[kind];
                  return <tr key={item.id}>
                    <td><strong>{item.serviceName}</strong><small>{item.method} · {kind === 'inspection' ? '巡检权益' : '升级权益'}</small>
                      {line?.entitlementObjects?.map(object => <small key={object.objectId}>{object.name}（{object.available}/{object.nodes}）</small>)}
                      {issue && pricingReady && <small className="sr-error">{issue}</small>}</td>
                    <td><span className={line?.deficitEntitlements ? 'sr-entitlement-deficit' : undefined}>{line ? (line.deficitEntitlements ? fmt(line.deficitEntitlements) : '—') : '—'}</span></td>
                    <td><span aria-label={`${item.serviceName} 换算系数（只读）`}>{conversion ? `× ${fmt(conversion.days)}` : '未配置'}</span><small>人天 / 权益</small></td>
                    <td><output aria-label={`${item.serviceName} 计价人天`}>{line ? fmt(line.billableDays) : '—'}</output></td>
                  </tr>;
                })}</tbody>
              </table></div>
            </section>}
            <div className="sr-pricing-totals" aria-live="polite">
              {pricing ? effortTotalsByMethod(record, pricing.lines).flatMap(total => [
                <span key={`${total.method}-estimated`}>预估{total.method}总人天 <strong>{fmt(total.estimatedDays)}</strong></span>,
                <span key={`${total.method}-billable`}>计价{total.method}总人天 <strong>{fmt(total.days)}</strong></span>,
              ]) : <><span>预估总人天 <strong>—</strong></span><span>计价总人天 <strong>—</strong></span></>}
            </div>
            {pricingIssue && !isMinimumDaysIssue(pricingIssue) && <p className="sr-help">{pricingIssue}</p>}
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
            <Field title="负责销售">
              <Input value={sales?.name ?? '未配置有效的客户所有人'} readOnly aria-readonly="true" />
              <small className="sr-help">使用客户所有人，由客户资料统一维护。</small>
            </Field>
            {!!effortEntitlementAllocations(a.effort?.lines).length && <section>
              <h4>待冻结权益</h4>
              <div className="sr-assessment-allocations">{effortEntitlementAllocations(a.effort?.lines).map(allocation => <div key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
                <span>{allocation.name} · {entitlementLabel(allocation.kind)}</span><strong>{allocation.quantity}</strong>
              </div>)}</div>
              <p className="sr-help">保存服务依据后冻结权益；调整核定结果、退回草稿或取消请求时按人天规则释放。</p>
            </section>}
            <div className="sr-asset-method-groups">
              {coverage.map(row => {
                const matchingAssets = customerAssets.filter(asset => assetDayMethod(asset) === row.method);
                return <section className="sr-asset-method-group" key={row.method} aria-label={`${row.method}人天资产`}>
                  <div className="sr-asset-method-heading"><h4>{row.method}人天</h4><span>计价需求 <strong>{fmt(row.days)}</strong> 人天</span></div>
                  <div className="sr-assessment-asset-editor">
                    {matchingAssets.map(asset => {
                      const available = assetAvailable(asset, records, record.id);
                      const maxDays = Math.max(0, Math.min(available ?? 0, row.days - (row.lockedDays - (Number(amounts[asset.id]) || 0))));
                      return <div key={asset.id}>
                        <span><strong>{asset.name}</strong><small>{asset.id} · {available === null ? '余额未维护' : `可锁定 ${fmt(available)} 人天`}</small></span>
                        <Input aria-label={`${asset.name} ${asset.id} 锁定${row.method}人天`} placeholder="锁定人天，最多一位小数" type="number" min="0" step="0.1" max={maxDays}
                          disabled={disabled || available === null} value={amounts[asset.id] ?? ''}
                          onChange={event => setAmounts(old => ({ ...old, [asset.id]: event.target.value }))} />
                      </div>;
                    })}
                    {!matchingAssets.length && <p className="sr-help">暂无可用的{row.method}人天资产。</p>}
                  </div>
                  <div className="sr-asset-method-summary" aria-live="polite">
                    <span>已选锁定 {fmt(row.lockedDays)} 人天</span>
                    {row.gap > 0 ? <strong className="sr-assessment-gap-preview">{row.method}资产缺少：{fmt(row.gap)} 人天</strong>
                      : <span>{row.method}资产已足额覆盖</span>}
                  </div>
                </section>;
              })}
            </div>
            {allocationIssue && <p className="sr-error" role="alert">{allocationIssue}</p>}
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
        {error && !(mode === 'effort' && isMinimumDaysIssue(error)) && (
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
          <Button disabled={disabled || (mode === 'effort' && (!pricingReady || !!pricingIssue)) || (mode === 'plan' && (!pricingReady || !sales || !!allocationIssue))} onClick={() => void submit()}>
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
