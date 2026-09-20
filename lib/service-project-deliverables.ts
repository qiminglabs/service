import type { ServiceProjectRecord } from './service-projects';
import type { StoredFile } from './service-requests';
import { stepDocuments, stepFiles } from './service-step-deliverables.ts';

export type ProjectDeliverable = {
  id: string;
  orderId: string;
  serviceName: string;
  stepName: string;
  requirementName: string;
  kind: '附件' | '文档';
  file: StoredFile;
};

// Only configured customer deliverables are exposed; never include templates,
// execution guides, form values, or internal step attachments.
export function projectDeliverables(project: Pick<ServiceProjectRecord, 'workOrders'>): ProjectDeliverable[] {
  return (project.workOrders ?? []).filter(order => order.status !== '已取消').flatMap(order => order.steps.flatMap(step => {
    const definition = step.definition;
    if (definition.type !== 'document' && definition.type !== 'upload') return [];
    const entries = definition.type === 'document' ? stepDocuments(definition) : stepFiles(definition);
    return entries.filter(entry => entry.deliverToCustomer).flatMap(entry =>
      (step.data.deliverables?.[entry.id] ?? []).map(file => ({
        id: JSON.stringify([order.id, definition.id, entry.id, file.id]),
        orderId: order.id,
        serviceName: order.item.serviceName,
        stepName: definition.name,
        requirementName: entry.name,
        kind: definition.type === 'document' ? '文档' as const : '附件' as const,
        file: {
          id: file.id, name: file.name, size: file.blob.size,
          uploadedAt: file.uploadedAt, blob: file.blob,
        },
      })),
    );
  }));
}
