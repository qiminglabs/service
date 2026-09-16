import type { ServiceRequest } from './service-requests';
import type { ServiceProjectRecord } from './service-projects';

// A view of project service items for the shared material components; not a stored request.
export function projectMaterialRecord(project: Pick<ServiceProjectRecord, 'id' | 'customerId' | 'items'>): ServiceRequest {
  return {
    id: project.id, customerId: project.customerId, items: project.items ?? [],
    requestType: '服务交付', createdByAudience: 'internal',
    title: '', contactId: '', owner: '', description: '', expectedServiceDate: '',
    status: '草稿', createdAt: '', updatedAt: '',
  };
}
