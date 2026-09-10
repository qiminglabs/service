'use client';
import type { ValidationFailure } from '@/lib/submission-validation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { activeEntitlementAllocations, entitlementLabel } from '@/lib/request-entitlement-reservations';
import { applyCustomerDecision } from '@/lib/request-customer-decision';
import { formatDays } from '@/lib/day-quantity';
import type { ServiceRequest } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

export function RequestCustomerConfirmation({ record, actor, customerId, busy, save, validationFailures }: {
  record: ServiceRequest;
  actor: OperationActor;
  customerId?: string;
  busy: boolean;
  save: (record: ServiceRequest, message?: string) => Promise<boolean>;
  validationFailures?: ValidationFailure[];
}) {
  const [mode, setMode] = useState<'accept' | 'reject' | null>(null);
  useEffect(() => { if (validationFailures?.length) setMode(null); }, [validationFailures]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const disabled = busy || working;
  const confirmation = record.operations?.assessment?.confirmation;
  const latest = record.operations?.customerDecisions?.at(-1);
  const canDecide = actor.role === '客户' && customerId === record.customerId && record.status === '待确认' && !!confirmation;
  const plan = record.operations?.assessment?.plans.find(plan => plan.id === confirmation?.planId);
  const entitlements = confirmation?.entitlementAllocations ?? activeEntitlementAllocations(record);
  const allocations = confirmation?.allocations ?? plan?.allocations ?? [];
  async function submit() {
    if (!mode || disabled || lock.current) return;
    lock.current = true;
    setWorking(true);
    setError('');
    try {
      const next = applyCustomerDecision(record, actor, customerId, mode === 'accept', reason);
      if (await save(next, mode === 'accept' ? '已确认，请求进入待受理' : '已拒绝，已退回客户确认步骤')) setMode(null);
      else setError('保存未完成，请检查页面提示后重试。');
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally { lock.current = false; setWorking(false); }
  }
  if (['草稿', '已取消'].includes(record.status) || (!canDecide && !latest?.accepted)) return null;
  return <section className="sr-panel sr-ops-panel">
    <div className="sr-ops-heading">
      <div>
        <h3>{canDecide ? '服务请求待确认' : '已确认服务请求'}</h3>
        <p>{canDecide ? '请核对申请信息及预计消耗资产后，确认或拒绝本次服务请求。' : '请求已进入后续受理流程。'}</p>
      </div>
      {canDecide && <div className="flex gap-2">
        <Button variant="outline" disabled={disabled} onClick={() => { setReason(''); setError(''); setMode('reject'); }}>拒绝</Button>
        <Button disabled={disabled} onClick={() => { setError(''); setMode('accept'); }}>确认</Button>
      </div>}
    </div>
    {confirmation && <div className="sr-customer-confirmation-body">
      <section className="sr-customer-confirmation-assets">
      <h4 className="mb-3 font-medium">预计消耗资产</h4>
      {allocations.length || entitlements.length ? <div className="sr-assessment-allocations">{entitlements.map(allocation => <div key={`${allocation.itemId}:${allocation.objectId}:${allocation.kind}`}>
        <span>{allocation.name} · {entitlementLabel(allocation.kind)}</span><strong>{allocation.quantity}</strong>
      </div>)}{allocations.map(asset => <div key={asset.assetId}>
        <span>{asset.name} <small>{asset.assetId}</small></span><strong>{formatDays(asset.days)} 人天</strong>
      </div>)}</div> : <p className="sr-help">本次不消耗客户资产。</p>}
      </section>
      {confirmation.externalNote && <section className="sr-customer-confirmation-note">
        <h4 className="mb-3 font-medium">说明</h4>
        <p className="whitespace-pre-wrap break-words">{confirmation.externalNote}</p>
      </section>}
    </div>}
    <Dialog open={!!mode} onOpenChange={open => { if (!open && !disabled) setMode(null); }}>
      <DialogContent showCloseButton={!disabled}>
        <DialogHeader>
          <DialogTitle>{mode === 'accept' ? '确认服务请求' : '拒绝服务请求'}</DialogTitle>
          <DialogDescription>{mode === 'accept' ? `确认“${record.title}”后，请求将进入待受理。` : '拒绝后退回客户确认步骤，项目经理将根据原因处理后重新发起确认。'}</DialogDescription>
        </DialogHeader>
        {mode === 'reject' && <label className="sr-ops-field"><span>拒绝原因（必填）</span><Textarea value={reason} onChange={event => setReason(event.target.value)} disabled={disabled} placeholder="请说明拒绝原因" /></label>}
        {error && <p className="sr-error" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={disabled} onClick={() => setMode(null)}>取消</Button>
          <Button disabled={disabled || (mode === 'reject' && !reason.trim())} onClick={() => void submit()}>{working ? '提交中…' : mode === 'accept' ? '确认' : '确认拒绝'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
