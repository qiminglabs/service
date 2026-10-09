'use client';
import { useI18n } from '@/lib/i18n/context';


import { canActForUser } from '@/lib/demo-permissions';
import { useEffect, useRef, useState } from 'react';
import { ProjectConfirmationPreview } from '@/components/project-confirmation-preview';
import { ProjectConfirmationMail } from '@/components/project-confirmation-mail';
import { CheckCircle2 } from 'lucide-react';
import { AssessmentApprovalCard } from '@/components/assessment-approval-card';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ProjectConfirmationRecord } from '@/components/project-confirmation-record';
import { canManageProjectAsManager } from '@/lib/service-project-work-order-policy';
import { calculateProjectReviewEffort, canManageProjectReviewBasis, canInitiateProjectConfirmation, currentProjectReviewApproval, projectReviewCoverage, projectReviewCovered, projectReviewOf, projectReviewStale, projectAssetAvailable, projectBaselineLine, projectReviewCapacities, projectReviewProjection, projectSourceIssue, projectCustomerConfirmationStale, pendingProjectWorklogs, type ProjectReviewContext, type ProjectReviewAction } from '@/lib/service-project-review';
import { projectAssetBasisRows, type ProjectAssetBasisRow } from '@/lib/service-project-basis-rows';
import { readProjectReviewContext, saveProjectReview } from '@/lib/service-project-review-store';
import { formatDays, parseDayQuantity, sumDays, roundDays } from '@/lib/day-quantity';
import { assetDayMethod } from '@/lib/request-asset-coverage';
import { entitlementLabel } from '@/lib/request-entitlement-reservations';
import { type OperationActor } from '@/lib/request-operations';
import type { ServiceProjectRecord } from '@/lib/service-projects';
const stamp = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
function Meta({ author, at }: { author: string; at: string }) {
  const { localize } = useI18n(); return <div className="sr-assessment-record-meta"><span>{localize(author)}</span><span>·</span><time>{localize(stamp(at))}</time></div>; }
function Step({ index, done, children }: { index: number; done: boolean; children: string }) {
  const { localize } = useI18n(); return <h4 className="sr-assessment-step-title" data-state={done ? 'done' : 'active'}><span className="sr-assessment-step-icon">{localize(done ? <CheckCircle2 size={20} /> : index)}</span>{localize(children)}</h4>; }
export function ServiceProjectReview({ project, actor, busy, onBusy, onSaved, onViewOrder }: { project: ServiceProjectRecord; actor: OperationActor; busy: boolean; onBusy: (busy: boolean) => void; onSaved: (project: ServiceProjectRecord) => void; onViewOrder: (id: string) => void }) {
  const { localize } = useI18n();
  const [mailOpen, setMailOpen] = useState(false);
  const [ctx, setContext] = useState<ProjectReviewContext | null>(null), [error, setError] = useState('');
  const [mode, setMode] = useState<'effort' | 'basis' | 'gap-submit' | 'gap-decide' | 'confirm' | null>(null);
  const [days, setDays] = useState<Record<string, string>>({}), [allocations, setAllocations] = useState<Record<string, string>>({}), [note, setNote] = useState('');
  const [approvalDays, setApprovalDays] = useState(''), [approvalMethod, setApprovalMethod] = useState<'远程' | '现场'>('远程');
  const requestedDays = parseDayQuantity(approvalDays);
  const validApprovalDays = requestedDays !== null && requestedDays > 0 && requestedDays <= 100000;
  const quotaEditable = ['待启动', '进行中', '待复核'].includes(project.status);
  const lock = useRef(false), review = projectReviewOf(project), stale = projectReviewStale(project), snapshot = project.requestConversion?.assessmentSnapshot;
  const approval = currentProjectReviewApproval(project), confirmation = review.confirmations.at(-1);
  const editable = ['进行中', '待复核'].includes(project.status), manager = canManageProjectAsManager(project, actor), owner = !!ctx && canManageProjectReviewBasis(project, actor, ctx);
  const waiting = approval?.state === '待审批', final = project.status !== '进行中' && project.status !== '待启动';
  useEffect(() => {
    let active = true;
    const load = () => readProjectReviewContext().then(context => { if (active) setContext(context); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '复核数据读取失败。'); });
    void load(); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [project.id, project.updatedAt]);
  let defaults: ReturnType<typeof calculateProjectReviewEffort> = [], pricingIssue = '', projection = project;
  let basisRows: ProjectAssetBasisRow[] = [];
  let coverage: ReturnType<typeof projectReviewCoverage> = [], capacities: ReturnType<typeof projectReviewCapacities> = [];
  if (ctx) try {
    defaults = review.settlement ? review.effort!.lines : calculateProjectReviewEffort(project, ctx);
    projection = project.status === '待确认' ? project : projectReviewProjection(project, ctx);
    coverage = projectReviewCoverage(projection, ctx);
    capacities = projectReviewCapacities(projection, ctx);
    if (mode === 'effort') calculateProjectReviewEffort(project, ctx, defaults.map(line => ({ itemId: line.itemId, finalBillableDays: line.kind === 'entitlement' ? 0 : parseDayQuantity(days[line.itemId] ?? '') ?? NaN })));
  } catch (cause) { pricingIssue = cause instanceof Error ? cause.message : '人天计算失败。'; }
  if (ctx) basisRows = projectAssetBasisRows(project, ctx, projection);
  const displayed = projection.review?.effort?.lines ?? defaults;
  const sourceIssue = ctx ? projectSourceIssue(project, ctx) : null;
  const covered = !!ctx && !pricingIssue && projectReviewCovered(projection, ctx);
  const needsFinal = review.effort?.stage === '过程' && final;
  const confirmedStale = projectCustomerConfirmationStale(project);
  const assets = ctx?.assets.filter(asset => asset.customerId === project.customerId && ['启用', '使用中'].includes(asset.status) && assetDayMethod(asset)) ?? [];
  const effective = !!review.effort && (!stale || project.status === '待确认');
  const pendingLogs = pendingProjectWorklogs(project);
  const effortRows = displayed.map(line => ({
    ...line,
    baselineDays: projectBaselineLine(project, line.itemId)?.billableDays,
    currentDays: roundDays((defaults.find(row => row.itemId === line.itemId)?.actualHours ?? line.actualHours) / 8),
    hasPending: pendingLogs.some(log => log.workOrderId === line.itemId),
    pendingDays: roundDays(pendingLogs.filter(log => log.workOrderId === line.itemId).reduce((total, log) => total + log.hours, 0) / 8),
    finalDays: line.kind === 'entitlement' && editable ? 0 : effective && !needsFinal ? line.billableDays : null,
  }));
  const effortTotals = (['远程', '现场'] as const).map(method => ({
    method,
    billableDays: sumDays(effortRows.filter(line => line.method === method).map(line => line.finalDays ?? 0)),
  }));
  async function open(next: NonNullable<typeof mode>) {
    setError('');
    try {
      const context = await readProjectReviewContext(); setContext(context);
      if (next === 'effort') {
        const lines = calculateProjectReviewEffort(project, context);
        setDays(Object.fromEntries(lines.map(line => [line.itemId, String(line.kind === 'entitlement' ? 0 : (stale ? undefined : review.effort?.lines.find(saved => saved.itemId === line.itemId)?.billableDays) ?? line.billableDays)])));
        setNote(review.effort?.note ?? '');
      } else { setAllocations({}); setNote(''); if (next === 'gap-submit') { setApprovalDays(''); setApprovalMethod('远程'); } }
      setMode(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开复核操作。'); }
  }
  async function run(action: ProjectReviewAction) {
    if (lock.current || busy) return;
    lock.current = true; onBusy(true); setError('');
    try { onSaved(await saveProjectReview(project.id, project.revision, action, actor) as ServiceProjectRecord); setMode(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败，请重试。'); }
    finally { lock.current = false; onBusy(false); }
  }
  return <section className="sr-panel sr-assessment project-review" aria-label={localize("项目复核")}>
    <div className="sr-ops-heading"><h3>{localize("复核")}</h3></div>
    <div className="sr-assessment-body">
      <div className="project-review-source"><div><span>{localize("来源申请")}</span><strong>{localize(snapshot ? `${snapshot.requestTitle} · ${snapshot.requestId}` : project.sourceServiceRequestId || '无来源基准')}</strong>{localize(snapshot?.effort && <Meta author={snapshot.effort.author} at={snapshot.effort.at} />)}</div>{localize((project.sourceServiceRequestId || snapshot?.requestId) && <Button variant="outline" nativeButton={false} render={<a aria-label={localize("查看服务请求")} href={`/?request=${encodeURIComponent(project.sourceServiceRequestId || snapshot!.requestId)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer" />}>{localize("查看服务请求")}</Button>)}</div>
      {localize((error && !mode || sourceIssue) && <p className="sr-error" role="alert">{localize(error && !mode ? error : sourceIssue)}</p>)}
      <section className="sr-assessment-plan">
        <div className="sr-assessment-section-title"><div className="sr-assessment-step-heading"><Step index={1} done={effective && !needsFinal}>{localize("人天核定")}</Step>{localize(review.effort && <Meta author={review.effort.author} at={review.effort.at} />)}</div>{localize(manager && editable && <Button disabled={busy || !ctx || pendingLogs.length > 0} onClick={() => void open('effort')}>{localize("核定人天")}</Button>)}</div>
        {localize((stale || needsFinal) && <output className="sr-error">{localize(stale ? project.status === '待确认' ? '工时、工单或计价规则已变化，当前客户确认内容需重新核对。' : '工时、工单或计价规则已变化，待重新核定。' : '过程核定已保留，待确认最终人天。')}</output>)}
        {localize(pricingIssue && !mode && <p className="sr-error" role="alert">{localize(pricingIssue)}</p>)}
        {localize(effective && !needsFinal && <div className="sr-pricing-overview" aria-label={localize("项目人天核定结果")}>
          {localize(effortTotals.map(total => (
            <div key={total.method} className="sr-pricing-primary"><span>{localize("计价")}{localize(total.method)}{localize("总人天")}</span><strong>{localize(formatDays(total.billableDays))} <small>{localize("人天")}</small></strong></div>
          )))}
        </div>)}
        <div className="sr-table-scroll"><table className="sr-table app-list-table project-review-aligned-table"><colgroup><col style={{ width: 'var(--review-name-width)' }} /><col style={{ width: '10%' }} /><col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '10%' }} /><col style={{ width: 'var(--review-days-width)' }} /></colgroup><thead><tr><th>{localize("工单")}</th><th>{localize("服务方式")}</th><th>{localize("原核定计价人天")}</th><th>{localize("当前累计人天")}</th><th>{localize("计价系数")}</th><th>{localize("最终计价人天")}</th></tr></thead><tbody>{localize(effortRows.map(line => (
          <tr key={line.itemId}><td><button className="project-review-link" onClick={() => onViewOrder(line.itemId)}>{localize(line.serviceName)}</button></td><td>{localize(line.method)}</td><td>{localize(line.baselineDays === undefined ? '—' : formatDays(line.baselineDays))}</td><td>{localize(formatDays(line.currentDays))}{localize(line.hasPending && <span className="project-review-pending-days">{localize("（待确定")}{localize(line.pendingDays.toFixed(1))}）</span>)}</td><td>{localize(line.kind === 'entitlement' ? '—' : line.priceCoefficient ?? '—')}</td><td>{localize(line.kind === 'entitlement' ? '—' : line.finalDays === null ? '待核定' : formatDays(line.finalDays))}</td></tr>
        )))}{localize(!effortRows.length && <tr><td colSpan={6}>{localize("暂无可核定工单")}</td></tr>)}</tbody></table></div>
        {localize(review.effort?.note && <div className="sr-assessment-note"><strong>{localize("核定备注／调整原因")}</strong><p>{localize(review.effort.note)}</p></div>)}
        {localize(!!review.history?.length && <details className="project-review-history"><summary>{localize("历史核定（")}{localize(review.history.length)}）</summary>{localize(review.history.slice().reverse().map((entry, i) => <article className="sr-assessment-note" key={`${entry.at}:${i}`}><Meta author={entry.effort?.author ?? entry.author} at={entry.effort?.at ?? entry.at} />{localize(entry.effort?.lines.map(line => <p key={line.itemId}>{localize(line.serviceName)} · {localize(line.method)} {localize(" · 最终计价")}{localize(line.kind === 'entitlement' ? '—' : `${formatDays(line.billableDays)} 人天`)}</p>))}{localize(entry.effort?.note && <p>{localize(entry.effort.note)}</p>)}</article>))}</details>)}
      </section>
      <section className="sr-assessment-plan">
        <div className="sr-assessment-section-title"><div className="sr-assessment-step-heading"><Step index={2} done={covered && !stale}>{localize("服务依据核销")}</Step></div>{localize(owner && quotaEditable && <div className="project-review-basis-actions"><Button variant="outline" disabled={busy || !effective || waiting || !!sourceIssue || project.status === '待确认'} onClick={() => void open('basis')}>{localize("补充服务依据")}</Button><Button disabled={busy || !ctx || waiting} onClick={() => void open('gap-submit')}>{localize("发起额度审批")}</Button></div>)}</div>
        <div className="sr-table-scroll"><table className="sr-table app-list-table project-review-aligned-table project-review-basis-table"><colgroup><col style={{ width: 'var(--review-name-width)' }} /><col style={{ width: '14%' }} /><col style={{ width: 'calc(100% - var(--review-name-width) - var(--review-days-width) - 14%)' }} /><col style={{ width: 'var(--review-days-width)' }} /></colgroup><thead><tr><th>{localize("服务依据")}</th><th>{localize("服务方式")}</th><th>{localize("来源")}</th><th>{localize("关联依据人天")}</th></tr></thead><tbody>
          {localize(basisRows.map(row => <tr key={row.id}>
            <td>{localize(row.name)}{localize(row.pending !== undefined && <small>{localize("申请")}{localize(formatDays(row.pending))} {localize(" 人天")}</small>)}{localize(row.approvalId === approval?.id && waiting && canActForUser(actor, approval?.approverId) && editable && <Button variant="ghost" disabled={busy} onClick={() => void open('gap-decide')}>{localize("处理审批")}</Button>)}</td>
            <td>{localize(row.method)}</td><td>{localize(row.source)}</td>
            <td>{localize(row.unit === '人天' ? formatDays(row.held) : '—')}</td>
          </tr>))}
          {localize(!basisRows.length && <tr><td colSpan={4}>{localize("暂无可沿用的服务依据")}</td></tr>)}
        </tbody></table></div>
        {localize(review.approvals.some(a => a.days > 0) && <div className="sr-assessment-approvals">{localize(review.approvals.filter(a => a.days > 0).slice().reverse().map(a => <AssessmentApprovalCard key={a.id} approval={a}>{localize(a.id === approval?.id && waiting && canActForUser(actor, a.approverId) && quotaEditable && <Button disabled={busy} onClick={() => void open('gap-decide')}>{localize("处理审批")}</Button>)}</AssessmentApprovalCard>))}</div>)}
        {localize(review.settlement && <div className="sr-assessment-note"><strong>{localize("已完成核销 ·")}{localize(stamp(review.settlement.at))}</strong>{localize(review.settlement.released.map(row => <p key={row.assetId}>{localize(row.name)} {localize(" · 已释放")}{localize(formatDays(row.days))} {localize(" 人天")}</p>))}{localize(review.settlement.releasedEntitlements.map((row, i) => <p key={`${row.objectId}:${i}`}>{localize(row.name)} {localize(" · 已释放")}{localize(entitlementLabel(row.kind))} {localize(row.quantity)} {localize(" 份")}</p>))}</div>)}
      </section>
      <section className="sr-assessment-plan">
        <div className="sr-assessment-section-title"><Step index={3} done={confirmation?.state === '已确认' && !confirmedStale}>{localize("客户确认")}</Step>{localize(ctx && canInitiateProjectConfirmation(project, actor, ctx) && project.status === '待复核' && <Button disabled={busy || !effective || needsFinal || !covered || waiting} onClick={() => void open('confirm')}>{localize(confirmation && !confirmation.invalidatedAt && confirmation.state !== '已拒绝' ? '核对并沿用确认' : '发送报告并发起确认')}</Button>)}</div>
        {localize(!confirmation && <p className="sr-help">{localize(project.status === '进行中' ? '工单完成并最终核定后，发起客户确认。' : '尚未发起客户确认')}</p>)}
        {localize(review.confirmations.slice().reverse().map((entry, i) => <ProjectConfirmationRecord key={entry.id} entry={entry} version={review.confirmations.length - i} />))}
      </section>
    </div>
    <Dialog open={mode !== null && !mailOpen} onOpenChange={open => { if (!open && !busy) setMode(null); }}><DialogContent className={`sr-ops-dialog${['effort', 'basis', 'confirm'].includes(mode ?? '') ? ' sr-ops-dialog--wide' : ''}${mode === 'confirm' ? ' project-confirmation-preview-dialog' : ''}`} showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{localize(mode === 'effort' ? '核定人天' : mode === 'basis' ? '补充服务依据' : mode === 'confirm' ? '客户确认预览' : mode === 'gap-submit' ? '发起额度审批' : '处理审批')}</DialogTitle><DialogDescription>{localize(project.name)}</DialogDescription></DialogHeader>
      <div className="sr-ops-form">
        {localize(mode === 'effort' && <><div className="sr-table-scroll"><table className="sr-table app-list-table project-review-input-table"><thead><tr><th>{localize("工单")}</th><th>{localize("服务方式")}</th><th>{localize("原核定计价人天")}</th><th>{localize("当前累计人天")}</th><th>{localize("计价系数")}</th><th>{localize("最终计价人天")}</th></tr></thead><tbody>{localize(defaults.map(line => { const baseline = projectBaselineLine(project, line.itemId); return <tr key={line.itemId}><td>{localize(line.serviceName)}</td><td>{localize(line.method)}</td><td>{localize(baseline ? formatDays(baseline.billableDays) : '—')}</td><td>{localize(formatDays(line.estimatedDays))}</td><td>{localize(line.kind === 'entitlement' ? '—' : line.priceCoefficient ?? '—')}</td><td>{localize(line.kind === 'entitlement' ? '—' : <Input aria-label={localize(`${line.serviceName}最终计价人天`)} type="number" min="0" max="100000" step="0.1" value={days[line.itemId] ?? ''} disabled={busy} onChange={event => setDays(current => ({ ...current, [line.itemId]: event.target.value }))} />)}</td></tr>; }))}</tbody></table></div>{localize(pricingIssue && <p className="sr-error" role="alert">{localize(pricingIssue)}</p>)}</>)}
        {localize(mode === 'gap-submit' && <><label className="sr-ops-field" htmlFor="review-approval-method"><span>{localize("服务方式")}</span><NativeSelect id="review-approval-method" aria-label={localize("服务方式")} value={approvalMethod} disabled={busy} onChange={event => setApprovalMethod(event.target.value as '远程' | '现场')}><option value="远程">{localize("远程")}</option><option value="现场">{localize("现场")}</option></NativeSelect></label><label className="sr-ops-field" htmlFor="review-approval-days"><span>{localize("申请人天")}</span><Input id="review-approval-days" aria-label={localize("申请人天")} type="number" min="0.1" max="100000" step="0.1" value={approvalDays} disabled={busy} onChange={event => setApprovalDays(event.target.value)} /></label>{localize(approvalDays !== '' && !validApprovalDays && <p className="sr-error" role="alert">{localize("申请人天须大于 0，按 0.1 粒度填写且不超过 100000。")}</p>)}</>)}
        {localize(mode === 'basis' && ctx && <><p>{localize(coverage.filter(row => row.gap > 0).map(row => `${row.method}待覆盖 ${formatDays(row.gap)} 人天`).join('、') || '当前依据已覆盖核定人天')}</p><div className="sr-table-scroll"><table className="sr-table app-list-table project-review-input-table"><thead><tr><th>{localize("资产")}</th><th>{localize("类别")}</th><th>{localize("已关联人天")}</th><th>{localize("剩余可用人天")}</th><th>{localize("本次补充")}</th></tr></thead><tbody>{localize(assets.map(asset => { const held = capacities.find(a => a.assetId === asset.id)?.days ?? 0; return <tr key={asset.id}><td>{localize(asset.name)}</td><td>{localize(assetDayMethod(asset))}</td><td>{localize(formatDays(held))}</td><td>{localize(Math.max(0, sumDays([projectAssetAvailable(project, asset, ctx) ?? 0, -held])))}</td><td><Input aria-label={localize(`${asset.name}补充人天`)} type="number" min="0" step="0.1" disabled={busy} value={allocations[asset.id] ?? ''} onChange={event => setAllocations(current => ({ ...current, [asset.id]: event.target.value }))} /></td></tr>; }))}{localize(!assets.length && <tr><td colSpan={5}>{localize("暂无可用人天资产")}</td></tr>)}</tbody></table></div></>)}
        {localize(mode === 'confirm' && <ProjectConfirmationPreview project={project} />)}
        {localize(mode !== 'basis' && <label className="sr-ops-field"><span>{localize(mode === 'effort' ? '核定备注／调整原因' : mode === 'confirm' ? '客户可见备注' : mode === 'gap-submit' ? '申请理由' : '审批意见')}</span><Textarea disabled={busy} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label>)}
        {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setMode(null)}>{localize("取消")}</Button>
        {localize(mode === 'gap-decide' ? <><Button variant="outline" disabled={busy || !note.trim()} onClick={() => void run({ type: 'gap-decide', id: approval!.id, approve: false, note })}>{localize("拒绝")}</Button><Button disabled={busy || !note.trim()} onClick={() => void run({ type: 'gap-decide', id: approval!.id, approve: true, note })}>{localize("通过")}</Button></> :
        <Button disabled={busy || !ctx || (mode === 'effort' && !!pricingIssue) || (mode === 'gap-submit' && (!note.trim() || !validApprovalDays))} onClick={() => {
          if (mode === 'effort') void run({ type: 'effort', items: defaults.map(line => ({ itemId: line.itemId, finalBillableDays: line.kind === 'entitlement' ? 0 : parseDayQuantity(days[line.itemId] ?? '') ?? NaN })), note });
          if (mode === 'basis') void run({ type: 'basis', allocations: Object.entries(allocations).filter(([, raw]) => raw.trim() !== '' && Number(raw) !== 0).map(([assetId, raw]) => ({ assetId, days: (parseDayQuantity(raw) ?? NaN) + (capacities.find(a => a.assetId === assetId)?.days ?? 0) })) });
          if (mode === 'gap-submit') void run({ type: 'gap-submit', method: approvalMethod, days: requestedDays ?? NaN, reason: note });
          if (mode === 'confirm') { if (confirmation && !confirmation.invalidatedAt && confirmation.state !== '已拒绝' && (confirmation.reportId || confirmation.state === '已确认')) void run({ type: 'confirm', note }); else setMailOpen(true); }
        }}>{localize(mode === 'confirm' ? confirmation && !confirmation.invalidatedAt && confirmation.state !== '已拒绝' ? '沿用客户确认' : '下一步：编辑确认邮件' : '保存')}</Button>)}
      </DialogFooter>
    </DialogContent></Dialog>
    {localize(mailOpen && <ProjectConfirmationMail project={project} actor={actor} note={note} busy={busy} onBusy={onBusy} onClose={() => setMailOpen(false)} onSaved={result => { onSaved(result); setMailOpen(false); setMode(null); }} />)}
  </section>;
}
