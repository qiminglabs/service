import type { ServiceProjectRecord } from './service-projects';
import type { StoredFile } from './service-requests';

export type ProjectFile = {
  id: string;
  file: StoredFile;
  kind: '附件' | '文档' | '在线文档';
  orderId: string;
  orderName: string;
  stepName: string;
  submittedBy: string;
  submittedAt: string;
};
export function projectFiles(project: Pick<ServiceProjectRecord, 'workOrders'>, users: { id: string; name: string }[] = []): ProjectFile[] {
  const names = new Map(users.map(user => [user.id, user.name]));
  return (project.workOrders ?? []).flatMap(order => order.steps.flatMap(step => {
    const groups: [string, StoredFile[]][] = [
      ['attachments', step.data.attachments ?? []],
      ...Object.entries(step.data.deliverables ?? {}),
    ];
    return groups.flatMap(([group, files]) => files.map(file => ({
      id: JSON.stringify([order.id, step.definition.id, group, file.id]),
      file,
      kind: file.onlineDocument ? '在线文档' as const : step.definition.type === 'document' ? '文档' as const : '附件' as const,
      orderId: order.id,
      orderName: order.item.serviceName,
      stepName: step.definition.name,
      submittedBy: file.submittedBy || names.get(file.uploadedById ?? '') || step.updatedBy || '—',
      submittedAt: file.submittedAt || file.uploadedAt || step.updatedAt || '',
    })));
  }));
}
