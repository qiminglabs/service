'use client';
import { useI18n } from '@/lib/i18n/context';

import { useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { saveProjectReview } from '@/lib/service-project-review-store';
import { formatDays } from '@/lib/day-quantity';
import { entitlementLabel } from '@/lib/request-entitlement-reservations';
import type { CustomerServiceProject } from '@/lib/customer-service-projects';
import type { OperationActor } from '@/lib/request-operations';
function subscribeConfirmationLink(update: () => void) { window.addEventListener('popstate', update); return () => window.removeEventListener('popstate', update); }
export function CustomerProjectConfirmation({ project, actor, onSaved, onViewDeliverables }: { project: CustomerServiceProject; actor: OperationActor; onSaved: (p: CustomerServiceProject) => void; onViewDeliverables: () => void }) {
  const { localize } = useI18n();
  const [choice, setChoice] = useState<boolean | null>(null), [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), confirmation = project.confirmation;
  const linkedVersion = useSyncExternalStore(subscribeConfirmationLink, () => new URLSearchParams(window.location.search).get('confirmation') ?? '', () => '');
  const oldLink = !!linkedVersion && linkedVersion !== confirmation?.id;
  const pending = project.status === '待确认' && confirmation?.state === '待确认' && !confirmation.invalidatedAt;
  async function save() {
    if (lock.current || choice === null || !confirmation || oldLink) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const result = await saveProjectReview(project.id, project.revision, { type: 'customer-decision', confirmationId: confirmation.id, accepted: choice, reason }, actor);
      onSaved(result as CustomerServiceProject); setChoice(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '确认未保存，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (!confirmation) return null;
  return <section className="sr-panel sr-ops-panel" aria-label={localize("项目客户确认")}>
    <div className="sr-ops-heading">
      <div>
        <h3>{localize(pending ? '服务项目待确认' : '客户确认')}</h3>
        {localize(pending && <p>{localize(project.skipsReview ? '请核对交付内容后，确认或拒绝本次服务项目。' : '请核对交付内容及预计消耗资产后，确认或拒绝本次服务项目。')}</p>)}
      </div>
      {localize(pending && !oldLink ? <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => { setChoice(false); setReason(''); setError(''); }}>{localize("拒绝")}</Button>
        <Button disabled={busy || project.confirmationStale} onClick={() => { setChoice(true); setReason(''); setError(''); }}>{localize("确认")}</Button>
      </div> : <span className="sr-assessment-badge">{localize(confirmation.invalidatedAt ? '待重新发起' : confirmation.state)}</span>)}
    </div>
    <div className="sr-customer-confirmation-body">
      {localize(oldLink && <div className="sr-assessment-note" role="alert">
        <p>{localize("此邮件对应的确认版本已失效，请核对最新报告后再确认。")}</p>
        <Button variant="outline" onClick={() => { const url = new URL(window.location.href); url.searchParams.delete('confirmation'); window.history.replaceState(null, '', url); window.dispatchEvent(new PopStateEvent('popstate')); }}>{localize("查看最新确认")}</Button>
      </div>)}
      {localize((project.confirmationStale || confirmation.invalidatedAt) && !['已暂停', '已取消', '已完成'].includes(project.status) && <p className="sr-error">{localize("确认内容已失效，等待重新发起确认。")}</p>)}
      <section className="sr-customer-confirmation-note flex items-center justify-between gap-4">
        <h4>{localize("交付内容")}</h4>
        <Button variant="outline" onClick={onViewDeliverables}>{localize("查看交付物")}</Button>
      </section>
      {localize(!project.skipsReview && <section className="sr-customer-confirmation-assets">
        <h4 className="mb-3 font-medium">{localize(project.status === '已完成' ? '已消耗资产' : '预计消耗资产')}</h4>
        {localize(confirmation.allocations.length || confirmation.entitlementAllocations.length ? <div className="sr-assessment-allocations">
          {localize(confirmation.entitlementAllocations.map(row => <div key={`${row.itemId}:${row.objectId}:${row.kind}`}>
            <span>{localize(row.name)} · {localize(entitlementLabel(row.kind))}</span><strong>{localize(row.quantity)} {localize(" 份")}</strong>
          </div>))}
          {localize(confirmation.allocations.map(row => <div key={row.assetId}>
            <span>{localize(row.name)}</span><strong>{localize(formatDays(row.days))} {localize(" 人天")}</strong>
          </div>))}
        </div> : <p className="sr-help">{localize("本次不消耗客户资产。")}</p>)}
      </section>)}
      {localize(!!confirmation.changes?.length && <section className="sr-customer-confirmation-note">
        <h4>{localize("较原约定的消耗变化")}</h4>
        {localize(confirmation.changes.map((change, i) => <p key={i}>{localize(change.name)} · {localize(formatDays(change.before))} → {localize(formatDays(change.after))} {localize(change.unit)}</p>))}
      </section>)}
      {localize(confirmation.note && <section className="sr-customer-confirmation-note">
        <h4 className="mb-3 font-medium">{localize("说明")}</h4>
        <p className="whitespace-pre-wrap break-words">{localize(confirmation.note)}</p>
      </section>)}
      {localize(confirmation.decidedAt && <section className="sr-customer-confirmation-note">
        <h4>{localize("处理记录")}</h4>
        <p>{localize(confirmation.decidedBy)} · {localize(new Date(confirmation.decidedAt).toLocaleString('zh-CN'))}</p>
        {localize(confirmation.reason && <p className="whitespace-pre-wrap break-words">{localize(confirmation.reason)}</p>)}
      </section>)}
    </div>
    <Dialog open={choice !== null} onOpenChange={open => { if (!open && !busy) setChoice(null); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{localize(choice ? '确认服务项目' : '拒绝服务项目')}</DialogTitle><DialogDescription>{localize(project.name)}</DialogDescription></DialogHeader>
        <label className="sr-ops-field"><span>{localize(choice ? '备注' : '拒绝原因（必填）')}</span><Textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setChoice(null)}>{localize("取消")}</Button>
          <Button disabled={busy || (choice === false && !reason.trim())} onClick={() => void save()}>{localize(busy ? '提交中…' : choice ? '确认' : '确认拒绝')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
