'use client';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { canCancelServiceProject } from '@/lib/service-project-cancellation';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import type { InternalUser } from '@/lib/service-requests';

export function ServiceProjectCancellation({ record, actor, users, busy, cancel }: {
  record: ServiceProjectRecord; actor: OperationActor; users: InternalUser[]; busy: boolean;
  cancel: (reason: string) => Promise<string | null>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  if (!canCancelServiceProject(record, actor, users)) return null;
  return <>
    <Button variant="outline" disabled={busy} onClick={() => { setReason(''); setError(''); setOpen(true); }}>取消服务项目</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy && !lock.current) setOpen(value); }}>
      <DialogContent className="sr-ops-dialog" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>取消服务项目</DialogTitle>
          <DialogDescription>取消后全部工单也将取消，且不可恢复。将释放当前项目已冻结的资产，当前项目的特批额度作废，保留项目资料及操作历史。此项目将结束，如需继续服务请新建项目。</DialogDescription>
        </DialogHeader>
        <div className="sr-confirmation-preview"><section className="sr-customer-visible-panel">
          <div className="sr-confirmation-note-label">
            <label htmlFor="project-cancellation-reason" className="sr-ops-field"><span>取消原因 <em aria-hidden="true">*</em></span></label>
            <CustomerVisibleBadge id="project-cancellation-reason-hint" />
          </div>
          <Textarea id="project-cancellation-reason" required aria-describedby="project-cancellation-reason-hint" value={reason} disabled={busy} onChange={event => setReason(event.target.value)} rows={3} placeholder="请说明取消原因" />
        </section></div>
        {error && <p className="sr-error" role="alert">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>暂不取消</Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={async () => {
            if (busy || lock.current) return;
            lock.current = true; setError('');
            try { const issue = await cancel(reason); if (issue) setError(issue); else setOpen(false); }
            catch (cause) { setError(cause instanceof Error ? cause.message : '取消失败，请重试。'); }
            finally { lock.current = false; }
          }}>{busy ? '正在取消…' : '确认取消'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
