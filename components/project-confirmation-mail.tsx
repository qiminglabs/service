'use client';
import { useI18n } from '@/lib/i18n/context';

import { useEffect, useState } from 'react';
import { isPartnerCreatedProject } from '@/lib/service-project-work-order-policy';
import { ServiceProjectDailyReports } from '@/components/service-project-daily-reports';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  readProjectReviewContext,
  saveProjectReview,
} from '@/lib/service-project-review-store';
import type { ProjectReviewContext } from '@/lib/service-project-review';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';

export function ProjectConfirmationMail({
  project,
  actor,
  note,
  busy,
  onBusy,
  onSaved,
  onClose,
  beforeSubmit,
}: {
  project: ServiceProjectRecord;
  actor: OperationActor;
  note: string;
  busy: boolean;
  onBusy: (value: boolean) => void;
  onSaved: (project: ServiceProjectRecord) => void;
  onClose: () => void;
  beforeSubmit?: () => boolean;
}) {
  const { localize } = useI18n();
  const [context, setContext] = useState<ProjectReviewContext>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void readProjectReviewContext(isPartnerCreatedProject(project))
      .then((value) => {
        if (active) setContext(value);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error ? cause.message : '邮件信息读取失败。',
          );
      });
    return () => {
      active = false;
    };
  }, [project]);
  if (!context)
    return (
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{localize("发送报告并发起确认")}</DialogTitle>
          </DialogHeader>
          <p role={error ? 'alert' : 'status'}>
            {localize(error || '正在读取邮件信息…')}
          </p>
        </DialogContent>
      </Dialog>
    );
  return (
    <ServiceProjectDailyReports
      project={project}
      actor={actor}
      customerName={
        context.customers.find((customer) => customer.id === project.customerId)
          ?.name ?? project.customerId
      }
      directory={{
        users: context.users,
        contacts: context.contacts,
        partners: context.partners ?? [],
        partnerUsers: context.partnerUsers ?? [],
      }}
      busy={busy}
      onBusy={onBusy}
      onSaved={onSaved}
      confirmationFlow={{
        onClose,
        onSend: async (mail) => {
          if (beforeSubmit && !beforeSubmit())
            throw new Error('请先保存当前工单的修改。');
          return (await saveProjectReview(
            project.id,
            project.revision,
            { type: 'confirm', note, mail },
            actor,
          )) as ServiceProjectRecord;
        },
      }}
    />
  );
}
