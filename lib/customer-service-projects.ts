import { withWorkOrderCollaboratorRoles } from './project-work-order-collaborators.ts';
import { customerDailyReport, type ProjectDailyReportView } from './service-project-daily-reports.ts';
import { isPartnerCreatedProject } from './service-project-work-order-policy.ts';
import { projectDeliverables, type ProjectDeliverable } from './service-project-deliverables.ts';
import type { CustomerRef, RequestItem, StoredFile } from './service-requests';
import type { ProjectCollaboratorDirectory } from './service-project-collaborators';
import type { ServiceProjectRecord } from './service-projects';
import type { OperationActor } from './request-operations';
import { projectCollaboratorRoleLabels } from './service-project-collaborators.ts';
import type { SupplementMention } from './supplement-mentions';
import { internalProjectProvider } from './service-project-providers.ts';
import { projectCustomerConfirmationStale, type ProjectConfirmation } from './service-project-review.ts';

export type CustomerProjectDirectory = ProjectCollaboratorDirectory & { customers: CustomerRef[] };
export function customerProjectOrganization(actor: OperationActor, directory: CustomerProjectDirectory): string | undefined {
  if (actor.role !== '客户' || !actor.id) return undefined;
  const contact = directory.contacts.find(person => person.id === actor.id && person.status === '启用');
  return directory.customers.find(customer => customer.id === contact?.customerId && customer.status === '启用')?.id;
}
export function canViewCustomerProject(project: ServiceProjectRecord, actor: OperationActor, directory: CustomerProjectDirectory): boolean {
  const organizationId = customerProjectOrganization(actor, directory);
  return !!organizationId && project.customerId === organizationId
    && !!project.collaborators?.customer?.some(person => person.id === actor.id);
}
export type CustomerProjectContact = { id: string; name: string; phone: string; email: string; roles: string[] };
type CustomerProjectMentionUser = { id: string; name: string; email: string; companyName: string; isManager: boolean; group: 'internal' | 'partner' | 'customer' };
export function customerProjectMentionUsers(project: Pick<ServiceProjectRecord, 'customerId' | 'collaborators' | 'serviceProviderId'>, directory?: CustomerProjectDirectory): CustomerProjectMentionUser[] {
  const internal: CustomerProjectMentionUser[] = projectSmartxCollaborators(project, directory)
    .filter(person => directory?.users.some(user => user.id === person.id && user.status === '启用'))
    .map(person => ({ id: person.id, name: directory?.users.find(user => user.id === person.id)?.name ?? person.name, email: person.email, companyName: internalProjectProvider.name, group: 'internal', isManager: person.roles.includes('项目经理') }));
  const partner = directory?.partners.find(partner => partner.status === '启用' && project.serviceProviderId === `partner:${partner.id}`);
  const partners: CustomerProjectMentionUser[] = partner ? (directory?.partnerUsers ?? [])
    .filter(user => user.status === '启用' && user.partnerId === partner.id && project.collaborators?.partner?.some(person => person.id === user.id))
    .map(user => ({ id: user.id, name: user.name, email: user.email ?? '', companyName: partner.name, group: 'partner', isManager: false })) : [];
  const customers: CustomerProjectMentionUser[] = (directory?.contacts ?? [])
    .filter(person => person.status === '启用' && person.customerId === project.customerId && project.collaborators?.customer?.some(entry => entry.id === person.id))
    .map(person => ({ id: person.id, name: person.name, email: person.email ?? '', companyName: directory?.customers.find(customer => customer.id === project.customerId)?.name ?? '', group: 'customer', isManager: false }));
  return [...internal, ...partners, ...customers];
}
export type CustomerServiceProject = {
  skipsReview?: true;
  confirmation?: ProjectConfirmation;
  confirmationStale?: boolean;
  revision: number;
  id: string; name: string; status: ServiceProjectRecord['status']; expectedServiceDate: string; plannedCompletionDate?: string;
  serviceProviderName: string; note: string; createdAt: string; createdBy: string; updatedAt: string;
  cancellationReason?: string;
  suspensionReason?: string;
  pausedFromStatus?: ServiceProjectRecord['status'];
  cancelledFromStatus?: ServiceProjectRecord['status'];
  customerId: string;
  customerName: string;
  items: RequestItem[];
  deliverables: ProjectDeliverable[];
  dailyReports: ProjectDailyReportView[];
  collaborators: CustomerProjectContact[];
  internalCollaborators: CustomerProjectContact[];
  showPartnerCollaborators: boolean;
  partnerCollaborators: CustomerProjectContact[];
  supplementMentionUsers: CustomerProjectMentionUser[];
  supplements: { id: string; author: string; at: string; comment: string; files: StoredFile[]; mentions: SupplementMention[]; externalVisible: boolean }[];
};
export function projectSmartxCollaborators(project: Pick<ServiceProjectRecord, 'collaborators'>, directory?: CustomerProjectDirectory): CustomerProjectContact[] {
  return (project.collaborators?.internal ?? []).map(person => {
    const user = directory?.users.find(entry => entry.id === person.id);
    return { id: person.id, name: person.name, phone: '', email: user?.email ?? '', roles: projectCollaboratorRoleLabels(person.assignmentRoles) };
  });
}

// Explicit customer projection: internal assessments, quotas, worklogs, material
// files and unrelated directory users are never passed to the customer view.
export function customerServiceProject(project: ServiceProjectRecord, directory?: CustomerProjectDirectory): CustomerServiceProject {
  project = withWorkOrderCollaboratorRoles(project);
  const partnerId = project.serviceProviderId?.startsWith('partner:') ? project.serviceProviderId.slice('partner:'.length) : '';
  const customer = directory?.customers.find(entry => entry.id === project.customerId);
  return structuredClone({
    ...(isPartnerCreatedProject(project) ? { skipsReview: true as const } : {}),    ...(project.review?.confirmations.length ? { confirmation: project.review.confirmations.at(-1), confirmationStale: projectCustomerConfirmationStale(project) } : {}),
    revision: project.revision,
    id: project.id, name: project.name, status: project.status, expectedServiceDate: project.expectedServiceDate, plannedCompletionDate: project.plannedCompletionDate,
    serviceProviderName: project.serviceProviderName ?? '', note: project.note, createdAt: project.createdAt, createdBy: project.createdBy, updatedAt: project.updatedAt,
    cancellationReason: project.cancellation?.reason,
    cancelledFromStatus: project.cancellation?.fromStatus,
    ...(project.suspension ? { pausedFromStatus: project.suspension.fromStatus, suspensionReason: project.suspension.reason } : {}),
    customerId: project.customerId,
    customerName: customer?.name ?? project.customerId,
    deliverables: projectDeliverables(project),
    dailyReports: (project.dailyReports ?? []).map(customerDailyReport),
    items: (project.items ?? []).map(item => ({
      id: item.id, serviceId: item.serviceId, serviceName: item.serviceName,
      methods: item.methods, method: item.method, methodFieldType: item.methodFieldType,
      description: item.description, businessObjectIds: item.businessObjectIds,
      businessObjectSnapshot: item.businessObjectSnapshot ? {
        savedAt: item.businessObjectSnapshot.savedAt,
        objects: item.businessObjectSnapshot.objects.filter(entry => item.businessObjectIds.includes(entry.object.id) && entry.object.customerId === project.customerId),
      } : undefined,
      values: Object.fromEntries(Object.entries(item.values).filter(([key]) => item.config.fields.includes(key))),
      config: { ...item.config, materials: [] }, materials: [],
    })),
    collaborators: (project.collaborators?.customer ?? []).map(person => {
      const contact = directory?.contacts.find(entry => entry.id === person.id && entry.customerId === project.customerId);
      return { id: person.id, name: contact?.name ?? person.name, phone: contact?.phone ?? '', email: contact?.email ?? '', roles: person.assignmentRoles?.filter(role => role !== '原客户协作人') ?? [] };
    }),
    internalCollaborators: projectSmartxCollaborators(project, directory),
    showPartnerCollaborators: true,
    partnerCollaborators: partnerId ? (project.collaborators?.partner ?? []).flatMap(person => {
      const user = directory?.partnerUsers.find(user => user.id === person.id && user.partnerId === partnerId);
      return user ? [{ id: user.id, name: user.name, phone: user.phone ?? '', email: user.email ?? '', roles: person.assignmentRoles ?? [] }] : [];
    }) : [],
    supplementMentionUsers: customerProjectMentionUsers(project, directory),
    supplements: (project.supplements ?? []).filter(item => item.externalVisible).map(({ id, author, at, comment, files, mentions }) => ({ id, author, at, comment, files, mentions: mentions ?? [], externalVisible: true })),
  });
}
