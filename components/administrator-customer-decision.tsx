'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { isDemoAdministrator } from '@/lib/demo-permissions';
import { projectCustomerConfirmationStale } from '@/lib/service-project-review';
import { saveProjectReview } from '@/lib/service-project-review-store';
import type { OperationActor } from '@/lib/request-operations';
import type { ServiceProjectRecord } from '@/lib/service-projects';

export function AdministratorCustomerDecision({ project, actor, busy, onBusy, onSaved }: {
  project: ServiceProjectRecord; actor: OperationActor; busy: boolean;
  onBusy: (busy: boolean) => void; onSaved: (project: ServiceProjectRecord) => void;
}) {
  const [choice, setChoice] = useState<boolean | null>(null);
  const [reason, setReason] = useState(''), [error, setError] = useState('');
  const lock = useRef(false);
  const confirmation = project.review?.confirmations.at(-1);
  if (!isDemoAdministrator(actor) || project.status !== '待确认' || confirmation?.state !== '待确认' || confirmation.invalidatedAt) return null;
  async function save() {
    if (busy || lock.current || choice === null || !confirmation) return;
    lock.current = true; onBusy(true); setError('');
    try {
      const result = await saveProjectReview(project.id, project.revision, { type: 'customer-decision', confirmationId: confirmation.id, accepted: choice, reason }, actor);
      onSaved(result as ServiceProjectRecord); setChoice(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '确认未保存。'); }
    finally { lock.current = false; onBusy(false); }
  }
  return <>
    <div className="flex gap-2">
      <Button variant="outline" disabled={busy} onClick={() => { setChoice(false); setReason(''); setError(''); }}>代客户拒绝</Button>
      <Button disabled={busy || projectCustomerConfirmationStale(project)} onClick={() => { setChoice(true); setReason(''); setError(''); }}>代客户确认</Button>
    </div>
    <Dialog open={choice !== null} onOpenChange={open => { if (!open && !busy) setChoice(null); }}>
      <DialogContent showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{choice ? '代客户确认' : '代客户拒绝'}</DialogTitle><DialogDescription>{project.name}</DialogDescription></DialogHeader>
        <label className="sr-ops-field"><span>{choice ? '备注' : '拒绝原因（必填）'}</span><Textarea value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
        {error && <p className="sr-error" role="alert">{error}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setChoice(null)}>取消</Button><Button disabled={busy || choice === false && !reason.trim()} onClick={() => void save()}>确认提交</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
