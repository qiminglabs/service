'use client';
import { useI18n } from '@/lib/i18n/context';


import { RequiredMark } from '@/components/required-mark';

import { canActForUser } from '@/lib/demo-permissions';
import { effectiveRequestApprovals, requestApprovalRemaining, requestApprovalRemainingDays } from '@/lib/request-approval-quota';
import { requestBasisIsFrozen } from '@/lib/project-reservation-release';
import { requestTypeOf } from '@/lib/request-types';

import { canPerformAssessmentRole } from '@/lib/assessment-routing';
import { readApprovalRules } from '@/lib/approval-flow-store';
import { createApprovalExecution, type ApprovalExecution } from '@/lib/approval-execution';

import type { ValidationFailure } from '@/lib/submission-validation';
import { useEffect, useState, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-react';
import { AssessmentApprovalCard } from '@/components/assessment-approval-card';
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
  canManageAssessmentBasis,
  canSubmitGapApproval,
  customerOwner,
  assessedEffort,
  currentPlan,
  planGap,
  assetAvailable,
  applyAssessmentAction,
} from '@/lib/request-assessment';
import { associatedEntitlementAllocations, effortEntitlementAllocations, entitlementLabel } from '@/lib/request-entitlement-reservations';
import { assetDayMethod, requestDayRequirements, coverageByMethod, allocationMethodIssue, planDayGaps, formatDayRequirements } from '@/lib/request-asset-coverage';
import type { AssessmentAction, GapApproval } from '@/lib/request-assessment';
import { hardwareItems, currentHardwareReview, hardwarePassIssue } from '@/lib/request-hardware-assessment';
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
  validationFailures?: ValidationFailure[];
};
type Mode = 'round' | 'hardware-review' | 'effort' | 'plan' | 'gap' | 'decide' | null;
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
  const { localize } = useI18n();
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
        {localize(state === 'done' ? <CheckCircle2 size={20} /> : index + 1)}
      </span>
      {localize(children)}
      <span className="sr-only">
        {localize(state === 'done'
          ? '，已完成'
          : state === 'active'
            ? '，当前步骤'
            : '，待进行')}
      </span>
    </h4>
  );
}
function RecordMeta({ author, at }: { author: string; at: string }) {
  const { localize } = useI18n();
  return (
    <div className="sr-assessment-record-meta">
      <span>{localize(author)}</span>
      <span aria-hidden="true">·</span>
      <time dateTime={at}>{localize(stamp(at))}</time>
    </div>
  );
}
function Field({ title, children }: { title: ReactNode; children: ReactNode }) {
  const { localize } = useI18n();
  return (
    <label className="sr-ops-field">
      <span>{localize(title)}</span>
      {localize(children)}
    </label>
  );
}
function Badge({ children }: { children: ReactNode }) {
  const { localize } = useI18n();
  return <span className="sr-assessment-badge">{localize(children)}</span>;
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
  validationFailures,
}: Props) {
  const { localize, localizeMessage } = useI18n();
  const a = assessmentOf(record),
    plan = currentPlan(record),
    effort = assessedEffort(record);
  const effortTotals = effortTotalsByMethod(record, a.effort?.lines ?? []);
  const presales = requestTypeOf(record) === '技术评估';
  const entitlementAllocations = associatedEntitlementAllocations(record);
  const passed = a.rounds.some((r) => r.outcome === '评估通过');
  const needsHardware = hardwareItems(record).length > 0;
  const hardwareRound = passed ? a.hardware?.rounds.at(-1) : currentHardwareReview(record);
  const hardwareReviewer = canPerformAssessmentRole(record, actor, 'hardware', users);
  const customerConfirmed = ['待受理', '已转服务项目'].includes(record.status);
  const latestDecision = record.operations?.customerDecisions?.at(-1);
  const confirmedDecision = customerConfirmed && latestDecision?.accepted && latestDecision.planId === a.confirmation?.planId
    ? latestDecision : undefined;
  const confirmationLabel = record.status === '已取消' ? '已取消' : customerConfirmed ? '客户已确认' : '等待客户确认';
  const gap = planGap(plan);
  const dayGaps = planDayGaps(plan);
  const approved = !!plan && requestApprovalRemainingDays(record) <= 1e-8;
  const waiting =
    plan &&
    a.approvals.some((v) => v.planId === plan.id && v.state === '待审批');
  const currentApprovals = a.approvals.filter(item => item.planId === plan?.id && item.state !== '已失效');
  const approvedBasisRows = effectiveRequestApprovals(record).flatMap(approval => {
    const requirements = approval.gaps?.length ? approval.gaps : dayGaps;
    return requirements.length
      ? requirements.map(row => ({ id: `${approval.id}:${row.method}`, method: row.method, days: row.days }))
      : [{ id: approval.id, method: requestDayRequirements(record).length === 1 ? requestDayRequirements(record)[0].method : '—', days: approval.days }];
  });
  const editable = record.status === '待评估' && !busy;
  const manager =
    canPerformAssessmentRole(record, actor, 'manager', users);
  const confirmationReady = passed && effort !== undefined && !!plan && (gap < 1e-8 || !!approved);
  const basisOwner = canManageAssessmentBasis(record, actor, customers, users);
  const canConfirm = basisOwner && editable && confirmationReady;
  const [externalNote, setExternalNote] = useState('');
  const [dialog, setDialog] = useState<Mode | 'confirm'>(null);
  useEffect(() => { if (validationFailures?.length) setDialog(null); }, [validationFailures]);
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
          setError('无法读取资产冻结情况，请刷新重试。');
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
      const pricingServices = pricingData.services;
      if (action.type === 'effort') { setLiveServices(pricingServices); setLivePricingContext(pricingData.context); }
      const approvalData = action.type === 'gap-submit' || action.type === 'gap-decide' ? await readApprovalRules() : undefined;
      const checkBasisOwner = action.type === 'plan' || action.type === 'confirm';
      const references = checkBasisOwner ? await readLocal<{ id: string; payload?: { customers?: CustomerRef[]; users?: InternalUser[] } }>('references') : [];
      const workspace = references.find(reference => reference.id === 'workspace')?.payload;
      const next = applyAssessmentAction(
        record,
        action,
        actor,
        assets,
        approvalData?.users ?? (checkBasisOwner ? (workspace?.users ?? []) : users),
        fresh,
        undefined,
        pricingServices,
        checkBasisOwner ? (workspace?.customers ?? []) : customers,
        pricingData.context,
        approvalData?.collection,
      );
      const ok = await save(
        next,
        action.type === 'confirm' ? '已发起客户确认' : '评估工作已保存',
      );
      if (ok) {
        setRecords(fresh);
        setDialog(null);
      } else setError('保存未完成，请检查页面提示后重试。');
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
          <h3>{localize("评估")}</h3>
        </div>
        <div className="sr-assessment-manager">
          <span>{localize("项目经理")}</span>
          <strong>
            {localize(a.manager || '待分配')}
          </strong>
        </div>
      </div>
      {localize(error && !dialog && (
        <p className="sr-error" role="alert">
          {localize(error)}
        </p>
      ))}
      <div className="sr-assessment-body">
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={0} stage={stage} complete={!!a.confirmation}>
                {localize("材料评估")}</StepTitle>
            </div>
            {localize(passed && <Badge>{localize("已通过 · 评估结论已锁定")}</Badge>)}
          </div>
          {localize(needsHardware && <section className="sr-assessment-role" aria-label={localize("硬件产品经理评估")}>
            <div className="sr-assessment-section-title">
              <div><strong>{localize("硬件产品经理评估")}</strong> <Badge>{localize(hardwareRound?.outcome ?? (passed && !a.hardware ? '无需补评' : a.hardware?.rounds.length ? '待重新评估' : '待评估'))}</Badge></div>
              {localize(hardwareReviewer && editable && !passed && <Button disabled={disabled} onClick={() => open('hardware-review')}>{localize("填写评估")}</Button>)}
            </div>
            {localize(hardwareRound ? <div className="sr-assessment-rounds"><article>
              <RecordMeta author={hardwareRound.author} at={hardwareRound.at} />
              <p>{localize(hardwareRound.opinion)}</p>
            </article></div> : <p className="sr-help">{localize(passed && !a.hardware ? '历史已通过请求，保留原评估结果。' : a.hardware?.rounds.length ? '材料已变化，请重新评估。' : '等待硬件产品经理记录评估结论。')}</p>)}
          </section>)}
          <section className="sr-assessment-role" aria-label={localize("项目经理评估")}>
            <div className="sr-assessment-section-title">
              <div><strong>{localize("项目经理评估")}</strong> <Badge>{localize(a.rounds.at(-1)?.outcome ?? '待评估')}</Badge></div>
              {localize(manager && editable && !passed && <Button disabled={disabled} onClick={() => open('round')}>{localize("填写评估")}</Button>)}
            </div>
            {localize(!a.rounds.length ? (
              <p className="sr-help">{localize("等待项目经理查看申请材料并记录评估结论。")}</p>
            ) : (
              <div className="sr-assessment-rounds">
                {localize(a.rounds.slice(-1).map((r) => (
                  <article key={r.id}>
                    <RecordMeta author={r.author} at={r.at} />
                    <p>{localize(r.opinion)}</p>
                  </article>
                )))}
              </div>
            ))}
          </section>
        </section>
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={1} stage={stage} complete={!!a.confirmation || record.status === '评估完成'}>
                {localize("人天核定")}</StepTitle>
              {localize((a.effort || plan) && (
                <RecordMeta
                  author={(a.effort ?? plan)!.author}
                  at={(a.effort ?? plan)!.at}
                />
              ))}
            </div>
            {localize(passed && manager && editable && (
              <Button
                variant="default"
                disabled={disabled || !!waiting}
                onClick={() => open('effort')}
              >
                {localize("人天核定")}</Button>
            ))}
          </div>
          {localize(effort === undefined ? (
            <p className="sr-help">
              {localize(passed
                ? '材料评估已通过，请按服务目录核定预估人天。'
                : '材料评估通过后可进行人天核定。')}
            </p>
          ) : (
            <>
              <div className="sr-pricing-overview">
                {localize(effortTotals.length ? effortTotals.flatMap(total => [
                  <div key={`${total.method}-billable`} className="sr-pricing-primary"><span>{localize("计价")}{localize(total.method)}{localize("总人天")}</span><strong>{localize(fmt(total.days))} <small>{localize("人天")}</small></strong></div>,
                  <div key={`${total.method}-estimated`} className="sr-pricing-primary"><span>{localize("预估")}{localize(total.method)}{localize("总人天")}</span><strong>{localize(fmt(total.estimatedDays))} <small>{localize("人天")}</small></strong></div>,
                ]) : <>
                  <div className="sr-pricing-primary"><span>{localize("计价总人天")}</span><strong>{localize(fmt(effort))} <small>{localize("人天")}</small></strong></div>
                  {localize(a.effort?.estimatedDays !== undefined && <div className="sr-pricing-primary"><span>{localize("预估总人天")}</span><strong>{localize(fmt(a.effort.estimatedDays))} <small>{localize("人天")}</small></strong></div>)}
                </>)}
              </div>
              {localize(!!a.effort?.lines?.length && <div className="sr-table-scroll">
                <table className="sr-table app-list-table sr-assessment-effort-table" aria-label={localize("服务目录计价明细")}>
                  <colgroup><col style={{ width: '34%' }} /><col style={{ width: '14%' }} /><col style={{ width: '16%' }} /><col style={{ width: '18%' }} /><col style={{ width: '18%' }} /></colgroup>
                  <thead><tr><th>{localize("服务目录")}</th><th>{localize("服务方式")}</th><th>{localize("预估人天")}</th><th>{localize("计价系数")}</th><th>{localize("计价人天")}</th></tr></thead>
                  <tbody>{localize(a.effort.lines.map(line => <tr key={line.itemId}>
                    <td>{localize(line.serviceName)}{localize(line.kind === 'entitlement' && <small>{localize("差额权益")}{localize(fmt(line.deficitEntitlements ?? 0))} {localize(" 份 × 换算系数")}{localize(fmt(line.priceCoefficient))} = {localize(fmt(line.billableDays))} {localize(" 人天")}</small>)}</td>
                    <td>{localize(record.items.find(item => item.id === line.itemId)?.method ?? '—')}</td>
                    <td>{localize(line.kind === 'entitlement' ? '—' : fmt(line.estimatedDays))}</td>
                    <td>{localize(line.kind === 'entitlement' ? '—' : fmt(line.priceCoefficient))}</td>
                    <td>{localize(fmt(line.billableDays))}</td>
                  </tr>))}</tbody>
                </table>
              </div>)}
            </>
          ))}
          {localize(a.effort?.note && (
            <div className="sr-assessment-note">
              <strong>{localize("备注")}</strong>
              <p>{localize(a.effort.note)}</p>
            </div>
          ))}
        </section>
        {localize(!presales && <><section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={2} stage={stage} complete={!!a.confirmation}>
                {localize("服务依据关联")}</StepTitle>
              {localize(plan && <RecordMeta author={plan.author} at={plan.at} />)}
            </div>
            {localize(passed && effort !== undefined && editable && (basisOwner || canSubmitGapApproval(record, actor, users)) && <div className="project-review-basis-actions">
              {localize(basisOwner && <Button variant="outline" disabled={!loaded || disabled || !!waiting} onClick={() => open('plan')}>{localize("补充服务依据")}</Button>)}
              <Button disabled={!loaded || disabled || !plan || !canSubmitGapApproval(record, actor, users) || !!waiting || !!approved || gap <= 1e-8} onClick={() => open('gap')}>{localize("发起额度审批")}</Button>
            </div>)}
          </div>
          {localize(plan ? (
            <>
              <div className="sr-table-scroll">
                <table className="sr-table app-list-table sr-assessment-effort-table" aria-label={localize("已关联服务依据")}>
                  <colgroup><col style={{ width: '34%' }} /><col style={{ width: '14%' }} /><col style={{ width: '34%' }} /><col style={{ width: '18%' }} /></colgroup>
                  <thead><tr><th>{localize("服务依据")}</th><th>{localize("服务方式")}</th><th>{localize("来源")}</th><th>{localize("关联依据人天")}</th></tr></thead>
                  <tbody>
                    {localize(plan.allocations.map(asset => <tr key={asset.assetId}>
                      <td>{localize(asset.name)}<small>{localize(asset.assetId)} · {localize(requestBasisIsFrozen(record) ? '已冻结' : '已关联')}</small></td>
                      <td>{localize(asset.method ?? assetDayMethod(asset) ?? '—')}</td>
                      <td>{localize("客户资产")}</td>
                      <td>{localize(fmt(asset.days))}</td>
                    </tr>))}
                    {localize(entitlementAllocations.map(allocation => <tr key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
                      <td>{localize(entitlementLabel(allocation.kind))}<small>{localize(allocation.name)} · {localize(requestBasisIsFrozen(record) ? '已冻结' : '已关联')} {localize(allocation.quantity)} {localize(" 份")}</small></td>
                      <td>—</td><td>{localize("服务权益")}</td><td>—</td>
                    </tr>))}
                    {localize(approvedBasisRows.map(row => <tr key={row.id}>
                      <td>{localize(row.method === '—' ? '额度审批' : localizeMessage("{0}额度审批", [String(localize(row.method))]))}</td>
                      <td>{localize(row.method)}</td><td>{localize("服务请求审批")}</td><td>{localize(fmt(row.days))}</td>
                    </tr>))}
                    {localize(!plan.allocations.length && !entitlementAllocations.length && !approvedBasisRows.length && <tr><td colSpan={4}>{localize(plan.effort > 0 ? '暂无已关联的服务依据。' : '本次无需占用客户资产。')}</td></tr>)}
                  </tbody>
                </table>
              </div>

            </>
          ) : (
            <p className="sr-help">
              {localize(effort === undefined
                ? '完成人天核定后，关联客户资产或额外服务额度。'
                : '尚未关联服务依据。')}
            </p>
          ))}
          {localize(currentApprovals.length > 0 && (
            <div className="sr-assessment-approvals">
              {localize(currentApprovals.map((v) => (
                <AssessmentApprovalCard key={v.id} approval={v} fallbackGaps={dayGaps}>
                  {localize(editable &&
                    v.state === '待审批' &&
                    canActForUser(actor, v.approverId) && (
                      <Button
                        variant="default"
                        disabled={disabled}
                        onClick={() => {
                          setApproval(v);
                          open('decide');
                        }}
                      >
                        {localize("处理审批")}</Button>
                    ))}
                </AssessmentApprovalCard>
              )))}
            </div>
          ))}
        </section>
        <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title">
            <div className="sr-assessment-step-heading">
              <StepTitle index={3} stage={stage} complete={customerConfirmed}>
                {localize("客户确认")}</StepTitle>
              {localize(confirmedDecision ? <RecordMeta author={confirmedDecision.actor} at={confirmedDecision.at} /> : a.confirmation && <RecordMeta author={a.confirmation.by} at={a.confirmation.at} />)}
            </div>
            {localize(!a.confirmation && basisOwner && editable && (
              <Button disabled={!canConfirm || disabled} onClick={() => open('confirm')}>
                {localize("发起客户确认")}<ArrowRight size={15} />
              </Button>
            ))}
            {localize((a.confirmation || customerConfirmed) && <Badge>{localize(confirmationLabel)}</Badge>)}
          </div>
          <p className="sr-help">
            {localize(record.status === '已取消' ? '请求已取消。'
              : record.status === '已转服务项目' ? '客户已确认，服务项目已创建。'
              : customerConfirmed ? '客户已确认，等待项目经理创建服务项目。'
              : a.confirmation ? '服务依据已提交，等待客户确认。' : !plan
              ? '完成服务依据关联后，可发起客户确认。'
              : gap > 1e-8 && !approved
                ? '等待服务依据充足后，可发起客户确认。'
                : '服务依据已足额覆盖，请核对请求概览与预计消耗资产后发起客户确认。')}
          </p>
        </section></>)}
        {localize(presales && <section className="sr-assessment-plan">
          <div className="sr-assessment-section-title"><strong>{localize("评估完成")}</strong>{localize(record.status === '评估完成' && <Badge>{localize("已完成")}</Badge>)}</div>
          <p className="sr-help">{localize(record.status === '评估完成' ? '技术评估已完成。如需继续交付，由负责项目经理点击页面上方“转为服务交付”。' : '完成人天核定后结束技术评估。')}</p>
        </section>)}
      </div>
      <Dialog
        open={!!dialog}
        onOpenChange={(v) => {
          if (!v && !disabled) setDialog(null);
        }}
      >
        <DialogContent className={`sr-ops-dialog${dialog === 'effort' ? ' sr-ops-dialog--wide' : ''}`} showCloseButton={!disabled}>
          {localize(dialog === 'confirm' ? (
            <>
              <DialogHeader>
                <DialogTitle>{localize("确认发起客户确认")}</DialogTitle>
                <DialogDescription>{localize(requestBasisIsFrozen(record) ? '请核对以下请求与预计消耗资产，已关联资产及权益将继续保持冻结，提交给客户确认。' : '请核对以下请求与预计消耗资产，确认发起后将冻结已关联的人天资产及服务权益，并提交给客户确认。')}</DialogDescription>
              </DialogHeader>
              <div className="sr-confirmation-preview">
                <section className="sr-customer-visible-panel">
                  <div className="sr-panel-title-with-visibility">
                    <h4>{localize("请求概览")}</h4>
                    <CustomerVisibleBadge />
                  </div>
                  <dl>
                    <dt>{localize("请求名称")}</dt><dd>{localize(record.title)}</dd>
                    <dt>{localize("请求编号")}</dt><dd>{localize(record.id)}</dd>
                    <dt>{localize("预计服务日期")}</dt><dd>{localize(record.expectedServiceDate || '未填写')}</dd>
                    <dt>{localize("请求描述")}</dt><dd>{localize(record.description || '未填写')}</dd>
                    <dt>{localize("申请服务")}</dt><dd>{localize(record.items.map(item => (
                      <div key={item.id}>{localize(item.serviceName)}{localize(item.method ? localizeMessage(" · {0}", [String(localize(item.method))]) : '')}</div>
                    )))}</dd>
                  </dl>
                </section>
                <section className="sr-customer-visible-panel">
                  <div className="sr-panel-title-with-visibility">
                    <h4>{localize("待客户确认的服务资产消耗")}</h4>
                    <CustomerVisibleBadge />
                  </div>
                  {localize(plan && (plan.allocations.length || associatedEntitlementAllocations(record).length) ? (
                    <>
                      <div className="sr-assessment-allocations">
                        {localize(associatedEntitlementAllocations(record).map(allocation => <div key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
                          <span>{localize(allocation.name)} · {localize(entitlementLabel(allocation.kind))}</span><strong>{localize(allocation.quantity)}</strong>
                        </div>))}
                        {localize(plan.allocations.map(asset => (
                          <div key={asset.assetId}>
                            <span>{localize(asset.name)} <small>{localize(asset.assetId)}</small></span>
                            <strong>{localize(fmt(asset.days))} {localize(" 人天")}</strong>
                          </div>
                        )))}
                      </div>
                    </>
                  ) : <p className="sr-help">{localize("本次不消耗客户资产。")}</p>)}
                </section>
                <section className="sr-customer-visible-panel">
                  <div className="sr-confirmation-note-label">
                    <label htmlFor="customer-confirmation-note">{localize("说明（选填）")}</label>
                    <CustomerVisibleBadge id="customer-confirmation-note-hint" />
                  </div>
                  <Textarea id="customer-confirmation-note" aria-describedby="customer-confirmation-note-hint" value={externalNote} onChange={event => setExternalNote(event.target.value)} disabled={disabled} rows={4} placeholder={localize("填写给客户的服务说明，提交后将在客户中心显示")} />
                </section>
              </div>
              {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
              <DialogFooter>
                <Button variant="outline" disabled={disabled} onClick={() => setDialog(null)}>{localize("取消")}</Button>
                <Button disabled={!canConfirm || disabled} onClick={() => void run({ type: 'confirm', externalNote })}>
                  {localize(working ? '正在发起…' : '确认发起')}
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
            assets={assets}
            records={records}
            approval={approval}
            disabled={disabled}
            pricingReady={!['effort', 'plan'].includes(dialog ?? '') || catalogReady}
            error={error}
            run={run}
            close={() => setDialog(null)}
          />)}
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
  assets: RequestAsset[];
  records: ServiceRequest[];
  approval: GapApproval | null;
  disabled: boolean;
  error: string;
  run: (action: AssessmentAction) => Promise<boolean>;
  close: () => void;
}) {
  const { localize, localizeMessage } = useI18n();
  const a = assessmentOf(record),
    plan = currentPlan(record),
    assessed = assessedEffort(record);
  const [opinion, setOpinion] = useState('');
  const [outcome, setOutcome] = useState<'需补充' | '评估通过'>('需补充');
  const hardwareIssue = hardwarePassIssue(record, users);
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
  const remainingGaps = requestApprovalRemaining(record);
  const defaultApprovalMethod = remainingGaps[0]?.method ?? requirements[0]?.method ?? '远程';
  const [approvalMethod, setApprovalMethod] = useState<'远程' | '现场'>(defaultApprovalMethod);
  const [approvalDays, setApprovalDays] = useState(String(remainingGaps.find(row => row.method === defaultApprovalMethod)?.days ?? requestApprovalRemainingDays(record)));
  const requestedDays = parseDayQuantity(approvalDays);
  const validApprovalDays = requestedDays !== null && requestedDays > 0 && requestedDays <= 100000;

  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(
      plan?.allocations.filter(v => { const asset = assets.find(asset => asset.id === v.assetId); return asset && requirements.some(row => row.method === assetDayMethod(asset)); }).map((v) => [v.assetId, String(v.days)]) ?? [],
    ),
  );
  const sales = customerOwner(record, customers, users);
  const salesId = sales?.id ?? '';
  const [approvalRoute, setApprovalRoute] = useState<ApprovalExecution | null>(null);
  const [approvalRouteError, setApprovalRouteError] = useState('');
  useEffect(() => {
    if (mode !== 'gap') return;
    let active = true;
    setApprovalRoute(null); setApprovalRouteError('');
    readApprovalRules().then(data => {
      const route = createApprovalExecution(record, data.collection, data.users, data.dictionary.customers, new Date().toISOString());
      if (active) setApprovalRoute(route);
    }).catch(error => { if (active) setApprovalRouteError(error instanceof Error ? error.message : '审批规则读取失败。'); });
    return () => { active = false; };
  }, [mode, record]);
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
    'hardware-review': '硬件产品经理评估',
    round: '材料评估',
    effort: '人天核定',
    plan: '补充服务依据',
    gap: '发起额度审批',
    decide: '上级审批额度特批',
  };
  async function submit() {
    if (mode === 'hardware-review') return run({ type: 'hardware-review', outcome, opinion });
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
      return run({ type: 'gap-submit', method: approvalMethod, days: requestedDays ?? NaN, reason: opinion });
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>{localize(titles[mode ?? ''])}</DialogTitle>
        {localize(mode === 'round' && (
          <DialogDescription>{localize("材料评估通过后，申请项及材料将锁定，不再支持修改。")}</DialogDescription>
        ))}
        {localize(mode === 'hardware-review' && <DialogDescription className="sr-only">{localize("填写评估结论和评估意见。")}</DialogDescription>)}
        {localize(mode !== 'round' && mode !== 'plan' && mode !== 'hardware-review' && (
          <DialogDescription>
            {localize(mode === 'effort'
              ? '人天类按预估人天 × 计价系数计价；权益类按差额权益 × 换算系数计价。计价结果逐项四舍五入到一位小数后汇总。'
              : mode === 'gap' ? record.title : localizeMessage("额外额度：{0}", [String(localize(formatDayRequirements(mode === 'decide' ? (approval?.gaps ?? planDayGaps(plan)) : planDayGaps(plan)) || localizeMessage("{0} 人天", [String(localize(fmt(mode === 'decide' ? (approval?.days ?? 0) : planGap(plan))))])))]))}
          </DialogDescription>
        ))}
      </DialogHeader>
      <div className="sr-ops-form">
        {localize((mode === 'round' || mode === 'hardware-review') && (
          <>
            <Field title={localize(<>{localize("评估结论")}<RequiredMark /></>)}>
              <NativeSelect
                value={outcome}
                disabled={disabled}
                onChange={(e) => setOutcome(e.target.value as typeof outcome)}
              >
                <option value={"需补充"}>{localize("需补充")}</option>
                <option value={"评估通过"} disabled={mode === 'round' && !!hardwareIssue}>{localize("评估通过")}</option>
              </NativeSelect>
            </Field>
            <Field title={localize(<>{localize("评估意见")}<RequiredMark /></>)}>
              <Textarea
                rows={4}
                value={opinion}
                disabled={disabled}
                onChange={(e) => setOpinion(e.target.value)}
                placeholder={localize("记录材料完整性、待补充信息及评估判断")}
              />
            </Field>
            {localize(mode === 'round' && hardwareIssue && <p className="sr-help">{localize("需硬件产品经理先完成评估，才能通过整体材料评估。")}</p>)}
          </>
        ))}
        {localize(mode === 'effort' && (
          <>
            {localize(!!dayItems.length && <section className="sr-pricing-group" aria-label={localize("人天类申请项")}>
            <h4>{localize("人天类申请项")}</h4>
            <div className="sr-pricing-table-wrap"><table className="sr-pricing-table sr-pricing-editor">
              <thead><tr><th>{localize("服务目录")}</th><th>{localize("预估人天")}<em>*</em></th><th>{localize("计价系数")}</th><th>{localize("计价人天")}</th></tr></thead>
              <tbody>{localize(dayItems.map(item => {
                const coefficient = itemPriceCoefficient(item, services);
                const minimumDays = itemMinimumDays(item, services);
                const estimate = Number(estimates[item.id]);
                const belowMinimum = !!estimates[item.id]?.trim() && Number.isFinite(estimate) && minimumDays !== undefined && estimate < minimumDays;
                const billable = estimates[item.id]?.trim() && Number.isFinite(estimate) && estimate > 0 && coefficient !== undefined
                  ? calculateBillableDays(estimate, coefficient) : undefined;
                return <tr key={item.id}>
                  <td><strong>{localize(item.serviceName)}</strong><small>{localize(item.method)}</small></td>
                  <td><Input aria-label={localizeMessage("{0} {1} 预估人天", [localize(item.serviceName), localize(item.id)])} aria-describedby={`minimum-days-${item.id}`} aria-invalid={belowMinimum} type="number" min={minimumDays ?? 0.1} max="100000" step="0.1"
                    placeholder={localize("填写人天")} value={estimates[item.id] ?? ''} disabled={disabled || !pricingReady}
                    onChange={event => setEstimates(old => ({ ...old, [item.id]: event.target.value }))} />
                    <small id={`minimum-days-${item.id}`} className="sr-pricing-minimum" data-invalid={belowMinimum}>{localize(minimumDays === undefined ? '最小人天数量未获取' : localizeMessage("最少 {0} 人天", [String(localize(fmt(minimumDays)))]))}</small></td>
                  <td><span aria-label={localizeMessage("{0} 计价系数（只读）", [localize(item.serviceName)])}>{localize(coefficient === undefined ? '未配置' : localizeMessage("× {0}", [String(localize(fmt(coefficient)))]))}</span></td>
                  <td><output aria-label={localizeMessage("{0} 计价人天", [localize(item.serviceName)])}>{localize(billable === undefined ? '—' : fmt(billable))}</output></td>
                </tr>;
              }))}</tbody>
            </table></div>
            </section>)}
            {localize(!!entitlementItems.length && <section className="sr-pricing-group" aria-label={localize("权益类申请项")}>
              <h4>{localize("权益类申请项")}</h4>
              <div className="sr-pricing-table-wrap"><table className="sr-pricing-table sr-pricing-editor">
                <thead><tr><th>{localize("服务目录")}</th><th>{localize("差额权益")}</th><th>{localize("换算系数")}</th><th>{localize("计价人天")}</th></tr></thead>
                <tbody>{localize(entitlementItems.map(item => {
                  const line = entitlementLines.find(line => line.itemId === item.id);
                  const issue = entitlementIssue;
                  const kind = itemEntitlementKind(item, services)!;
                  const conversion = pricingContext.conversions[kind];
                  return <tr key={item.id}>
                    <td><strong>{localize(item.serviceName)}</strong><small>{localize(item.method)} · {localize(kind === 'inspection' ? '巡检权益' : '升级权益')}</small>
                      {localize(line?.entitlementObjects?.map(object => <small key={object.objectId}>{localize(object.name)}（{localize(object.available)}/{localize(object.nodes)}）</small>))}
                      {localize(issue && pricingReady && <small className="sr-error">{localize(issue)}</small>)}</td>
                    <td><span className={line?.deficitEntitlements ? 'sr-entitlement-deficit' : undefined}>{localize(line ? (line.deficitEntitlements ? fmt(line.deficitEntitlements) : '—') : '—')}</span></td>
                    <td><span aria-label={localizeMessage("{0} 换算系数（只读）", [localize(item.serviceName)])}>{localize(conversion ? localizeMessage("× {0}", [String(localize(fmt(conversion.days)))]) : '未配置')}</span><small>{localize("人天 / 权益")}</small></td>
                    <td><output aria-label={localizeMessage("{0} 计价人天", [localize(item.serviceName)])}>{localize(line ? fmt(line.billableDays) : '—')}</output></td>
                  </tr>;
                }))}</tbody>
              </table></div>
            </section>)}
            <div className="sr-pricing-totals" aria-live="polite">
              {localize(pricing ? effortTotalsByMethod(record, pricing.lines).flatMap(total => [
                <span key={`${total.method}-estimated`}>{localize("预估")}{localize(total.method)}{localize("总人天")}<strong>{localize(fmt(total.estimatedDays))}</strong></span>,
                <span key={`${total.method}-billable`}>{localize("计价")}{localize(total.method)}{localize("总人天")}<strong>{localize(fmt(total.days))}</strong></span>,
              ]) : <><span>{localize("预估总人天")}<strong>—</strong></span><span>{localize("计价总人天")}<strong>—</strong></span></>)}
            </div>
            {localize(pricingIssue && !isMinimumDaysIssue(pricingIssue) && <p className="sr-help">{localize(pricingIssue)}</p>)}
            <Field title={localize("备注（选填）")}>
              <Textarea
                value={effortNote}
                disabled={disabled}
                onChange={(event) => setEffortNote(event.target.value)}
                rows={3}
                placeholder={localize("补充人天估算依据或说明")}
              />
            </Field>
          </>
        ))}
        {localize(mode === 'plan' && (
          <div className="sr-basis-plan-layout">
            {localize(plan && a.approvals.some(approval => approval.planId === plan.id && ['已通过', '已拒绝'].includes(approval.state)) && (
              <div className="sr-basis-approval-warning" role="alert">
                <TriangleAlert size={18} aria-hidden="true" />
                <span>{localize("保存后，原特殊审批将失效；如仍有额度缺口，需重新发起审批。")}</span>
              </div>
            ))}
            <section className="sr-basis-card sr-basis-pricing" aria-label={localize("计价")}>
              <div className="sr-basis-section-heading">
                <h4>{localize("计价")}</h4>
                {localize(requirements.length > 1 && <span>{localize("合计")}<strong>{localize(fmt(assessed ?? 0))}</strong> {localize(" 人天")}</span>)}
              </div>
              <dl className="sr-basis-pricing-values">
                {localize(requirements.length ? requirements.map(row => <div key={row.method}>
                  <dt>{localize(row.method)}{localize("人天")}</dt><dd><strong>{localize(fmt(row.days))}</strong><span>{localize("人天")}</span></dd>
                </div>) : <div><dt>{localize("计价人天")}</dt><dd><strong>{localize(fmt(assessed ?? 0))}</strong><span>{localize("人天")}</span></dd></div>)}
              </dl>
            </section>
            <section className="sr-basis-card sr-basis-freezing" aria-label={localize("关联")}>
              <div className="sr-basis-section-heading"><h4>{localize("关联")}</h4></div>
            {localize(!!effortEntitlementAllocations(a.effort?.lines).length && <section className="sr-asset-method-group">
              <div className="sr-asset-method-heading"><h5>{localize("服务权益")}</h5><span>{localize("关联数量")}</span></div>
              <div className="sr-assessment-allocations">{localize(effortEntitlementAllocations(a.effort?.lines).map(allocation => <div key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
                <span>{localize(allocation.name)} · {localize(entitlementLabel(allocation.kind))}</span><strong>{localize(allocation.quantity)}</strong>
              </div>))}</div>
              <p className="sr-help">{localize("保存后仅关联服务依据，发起客户确认时冻结资产及权益。")}</p>
            </section>)}
            <div className="sr-asset-method-groups">
              {localize(coverage.map(row => {
                const matchingAssets = customerAssets.filter(asset => assetDayMethod(asset) === row.method);
                return <section className="sr-asset-method-group" key={row.method} aria-label={localizeMessage("{0}人天资产", [localize(row.method)])}>
                  <div className="sr-assessment-asset-editor">
                    {localize(matchingAssets.map(asset => {
                      const available = assetAvailable(asset, records, record.id);
                      const maxDays = Math.max(0, Math.min(available ?? 0, row.days - (row.lockedDays - (Number(amounts[asset.id]) || 0))));
                      return <div key={asset.id}>
                        <span><strong>{localize(asset.name)}</strong><small>{localize(asset.id)} · {localize(available === null ? '余额未维护' : localizeMessage("剩余可用 {0} 人天", [String(localize(fmt(available)))]))}</small></span>
                        <label className="sr-basis-freeze-input"><Input aria-label={localizeMessage("{0} {1} 关联{2}人天", [localize(asset.name), localize(asset.id), localize(row.method)])} placeholder="0" type="number" min="0" step="0.1" max={maxDays}
                          disabled={disabled || available === null} value={amounts[asset.id] ?? ''}
                          onChange={event => setAmounts(old => ({ ...old, [asset.id]: event.target.value }))} /><span>{localize("人天")}</span></label>
                      </div>;
                    }))}
                    {localize(!matchingAssets.length && <p className="sr-help">{localize("暂无可用的")}{localize(row.method)}{localize("人天资产。")}</p>)}
                  </div>
                  <div className="sr-asset-method-summary" aria-live="polite">
                    <span>{localize("已选关联")}{localize(fmt(row.lockedDays))} {localize(" 人天")}</span>
                    {localize(row.gap > 0 ? <strong className="sr-assessment-gap-preview">{localize(row.method)}{localize("资产缺少：")}{localize(fmt(row.gap))} {localize(" 人天")}</strong>
                      : <span>{localize(row.method)}{localize("资产已足额覆盖")}</span>)}
                  </div>
                </section>;
              }))}
            </div>
            {localize(!coverage.length && !effortEntitlementAllocations(a.effort?.lines).length && <p className="sr-help">{localize("无需关联资产或权益。")}</p>)}
            {localize(allocationIssue && <p className="sr-error" role="alert">{localize(allocationIssue)}</p>)}
            </section>
          </div>
        ))}
        {localize(mode === 'gap' && <>
          <Field title={localize("服务方式")}><NativeSelect aria-label={localize("服务方式")} value={approvalMethod} disabled={disabled} onChange={event => {
            const method = event.target.value as '远程' | '现场';
            setApprovalMethod(method);
            setApprovalDays(String(remainingGaps.find(row => row.method === method)?.days ?? 0));
          }}><option value="远程">{localize("远程")}</option><option value="现场">{localize("现场")}</option></NativeSelect></Field>
          <Field title={localize("申请人天")}><Input aria-label={localize("申请人天")} type="number" min="0.1" max="100000" step="0.1" value={approvalDays} disabled={disabled} onChange={event => setApprovalDays(event.target.value)} /></Field>
          {localize(approvalDays !== '' && !validApprovalDays && <p className="sr-error" role="alert">{localize("申请人天须大于 0，按 0.1 粒度填写且不超过 100000。")}</p>)}
        </>)}
        {localize((mode === 'gap' || mode === 'decide') && (
          <Field title={localize(<>{localize(mode === 'gap' ? '申请理由' : '审批意见')} <RequiredMark /></>)}>
            <Textarea
              rows={4}
              disabled={disabled}
              value={opinion}
              onChange={(e) => setOpinion(e.target.value)}
            />
          </Field>
        ))}
        {localize(mode === 'gap' && <Field title={localize("审批流程")}>
          {localize(approvalRoute ? <><strong>{localize(approvalRoute.ruleName)}</strong><ol>{localize(approvalRoute.steps.map(step => <li key={step.id}>{localize(step.nodeName)}：{localize(step.approver)}{localize(step.cutoff ? '（审批截止人）' : step.fallback ? '（默认审批人）' : '')}</li>))}</ol></> : <p className={approvalRouteError ? 'sr-error' : 'sr-help'}>{localize(approvalRouteError || '正在匹配审批流程…')}</p>)}
        </Field>)}
        {localize(mode === 'decide' && (
          <p className="sr-help">
            {localize(approval?.author)} {localize(" 发起：")}{localize(approval?.reason)}
          </p>
        ))}
        {localize(error && !(mode === 'effort' && isMinimumDaysIssue(error)) && (
          <p className="sr-error" role="alert">
            {localize(error)}
          </p>
        ))}
      </div>
      <DialogFooter>
        <Button variant="outline" disabled={disabled} onClick={close}>
          {localize("取消")}</Button>
        {localize(mode === 'decide' && approval ? (
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
              {localize("拒绝")}</Button>
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
              {localize("通过特批")}</Button>
          </>
        ) : (
          <Button disabled={disabled || (mode === 'gap' && (!approvalRoute || !opinion.trim() || !validApprovalDays)) || (mode === 'hardware-review' && !opinion.trim()) || (mode === 'round' && outcome === '评估通过' && !!hardwareIssue) || (mode === 'effort' && (!pricingReady || !!pricingIssue)) || (mode === 'plan' && (!pricingReady || !sales || !!allocationIssue))} onClick={() => void submit()}>
            {localize(mode === 'hardware-review' ? '保存评估结论' : mode === 'round'
              ? '保存评估结论'
              : mode === 'effort'
                ? '保存人天核定'
                : mode === 'plan'
                  ? '保存服务依据'
                  : '提交审批')}
          </Button>
        ))}
      </DialogFooter>
    </>
  );
}
