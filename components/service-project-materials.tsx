'use client';

import { useState } from 'react';
import { RequestMaterialsPanel } from '@/components/request-materials-panel';
import { RequestMaterialDialog } from '@/components/request-material-dialog';
import { projectMaterialRecord } from '@/lib/service-project-materials';
import { requestMaterialGroup, materialDialogItem } from '@/lib/request-materials';
import { projectItemReadonly } from '@/lib/service-project-readonly';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import type { RequestItem } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';
import { isInternal } from '@/lib/request-operations';
import type { ProjectItemChange } from '@/lib/service-project-items';

export function ServiceProjectMaterials({ id, customerId, items, actor, readonly, busy, save, project }: {
  project?: ServiceProjectRecord;
  id: string; customerId: string; items: RequestItem[]; actor: OperationActor;
  readonly: boolean; busy: boolean; save: (change: ProjectItemChange) => Promise<string | null>;
}) {
  const [target, setTarget] = useState<{ itemId: string; requirementId: string } | null>(null);
  const [error, setError] = useState('');
  const record = projectMaterialRecord({ id, customerId, items });
  const group = target ? requestMaterialGroup(record, target.itemId, target.requirementId) : undefined;
  return <>
    <RequestMaterialsPanel title="项目材料" showCustomerVisibility={isInternal(actor.role)} record={record} actor={actor} audience="internal" readonly={readonly} busy={busy} isGroupReadonly={group => group.members.some(member => projectItemReadonly(project, member.item.id, 'materials'))}
      onMaterial={value => { setError(''); setTarget(value); }} />
    {group && <RequestMaterialDialog key={group.key} record={record} actor={actor} item={materialDialogItem(group)}
      requirement={group.requirement} readonly={readonly || group.members.some(member => projectItemReadonly(project, member.item.id, 'materials'))} busy={busy} error={error} onClose={() => setTarget(null)}
      onSave={async material => {
        const issue = await save({ type: 'materials', id: group.members[0].item.id, material });
        if (issue) { setError(issue); return false; }
        setTarget(null);
        return true;
      }} />}
  </>;
}
