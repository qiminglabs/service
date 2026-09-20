'use client';

import { ProjectConfirmationMail } from '@/components/project-confirmation-mail';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ServiceProjectDeliverables } from '@/components/service-project-deliverables';
import { canManagePartnerProjectConfirmation, partnerProjectConfirmationIssue, isPartnerCreatedProject, isAssignedProjectEngineer } from '@/lib/service-project-work-order-policy';
import { projectConfirmationContent, projectCustomerConfirmationStale } from '@/lib/service-project-review';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';

export function PartnerProjectConfirmation({ project, actor, busy, onBusy, onSaved, beforeSubmit }: {
  project: ServiceProjectRecord; actor: OperationActor; busy: boolean; onBusy: (busy: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void; beforeSubmit: () => boolean;
}) {
  const [mailOpen, setMailOpen] = useState(false);
  const [open, setOpen] = useState(false), [note, setNote] = useState(''), [error, setError] = useState('');
  const confirmation = project.review?.confirmations.at(-1);
  const partnerCreated = isPartnerCreatedProject(project);
  const manager = partnerCreated ? canManagePartnerProjectConfirmation(project, actor) : isAssignedProjectEngineer(project, actor);
  const stale = partnerCreated && projectCustomerConfirmationStale(project);
  const canStart = manager && !project.customerConfirmationLocked && confirmation?.state !== '已确认' && (partnerCreated ? ['进行中', '待复核'].includes(project.status) || project.status === '待确认' && stale : project.status === '待复核');
  const issue = partnerProjectConfirmationIssue(project);
  const content = projectConfirmationContent(project);
  return <section className="sr-panel sr-assessment" aria-label="项目客户确认">
    <div className="sr-ops-heading"><h3>客户确认</h3>
      {canStart && <Button disabled={busy || !!issue} onClick={() => { setError(''); setNote(''); setOpen(true); }}>发送报告并发起确认</Button>}
    </div>
    <div className="sr-assessment-body">
      {error && !open && <p className="sr-error" role="alert">{error}</p>}
      {canStart && issue && <p className="sr-help">{issue}</p>}
      {stale && confirmation && <p className="sr-error">交付内容已变化，请重新发起客户确认。</p>}
      {!confirmation && !issue && !['待确认', '已完成'].includes(project.status) && <p className="sr-help">尚未发起客户确认</p>}
      {project.review?.confirmations.slice().reverse().map(entry => <article className="sr-assessment-note" key={entry.id}>
        <strong>{entry.invalidatedAt ? '已失效' : entry.state}</strong>
        <div className="sr-assessment-record-meta">{entry.by} · {new Date(entry.at).toLocaleString('zh-CN', { hour12: false })}</div>
        {entry.services?.map(service => <p key={service.id}>{service.name} · {service.method}</p>)}

        {!!entry.deliverables?.length && <ServiceProjectDeliverables projectName={project.name} items={entry.deliverables} />}

        {entry.note && <p>{entry.note}</p>}
        {entry.decidedAt && <p>{entry.decidedBy} · {new Date(entry.decidedAt).toLocaleString('zh-CN', { hour12: false })}</p>}
        {entry.reason && <p>{entry.reason}</p>}
      </article>)}
    </div>
    <Dialog open={open && !mailOpen} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="sr-ops-dialog sr-ops-dialog--wide" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>发起客户确认</DialogTitle><DialogDescription>{project.name}</DialogDescription></DialogHeader>
      <div className="sr-ops-form">
        {content.services.map(service => <p key={service.id}>{service.name} · {service.method}{service.description && ` · ${service.description}`}</p>)}
        <ServiceProjectDeliverables projectName={project.name} items={content.deliverables} />
        <label className="sr-ops-field" htmlFor="partner-confirmation-note"><span>客户可见备注</span><Textarea id="partner-confirmation-note" value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
        {error && <p className="sr-error" role="alert">{error}</p>}
      </div>
      <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button disabled={busy || !!issue} onClick={() => setMailOpen(true)}>下一步：编辑确认邮件</Button></DialogFooter>
    </DialogContent></Dialog>
    {mailOpen && <ProjectConfirmationMail project={project} actor={actor} note={note} busy={busy} onBusy={onBusy} beforeSubmit={beforeSubmit} onClose={() => setMailOpen(false)} onSaved={result => { onSaved(result); setMailOpen(false); setOpen(false); }} />}
  </section>;
}
