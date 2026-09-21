'use client';

import { RequiredMark } from '@/components/required-mark';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';

export function ServiceProjectPause({ name, busy, pause }: { name: string; busy: boolean; pause: (reason: string) => Promise<string | null> }) {
  const [open, setOpen] = useState(false), [reason, setReason] = useState(''), [error, setError] = useState('');
  const lock = useRef(false);
  return <>
    <Button variant="outline" disabled={busy} onClick={() => { setOpen(true); setReason(''); setError(''); }}>暂停项目</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy && !lock.current) setOpen(value); }}><DialogContent showCloseButton={!busy}>
      <DialogHeader><DialogTitle>暂停项目</DialogTitle><DialogDescription>{name}</DialogDescription></DialogHeader>
      <div className="sr-ops-field"><label htmlFor="project-pause-reason">暂停原因 <RequiredMark /></label><CustomerVisibleBadge id="project-pause-reason-hint" /><Textarea id="project-pause-reason" aria-describedby="project-pause-reason-hint" required maxLength={2000} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} /></div>
      {error && <p className="sr-error" role="alert">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button disabled={busy || !reason.trim()} onClick={async () => {
        if (lock.current || busy) return;
        lock.current = true; setError('');
        try { const issue = await pause(reason); if (issue) setError(issue); else setOpen(false); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '暂停失败，请重试。'); }
        finally { lock.current = false; }
      }}>确认暂停</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
