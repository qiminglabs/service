import { projectWorklogsLocked } from './service-project-work-order-policy.ts';
import { withWorkOrderCollaboratorRoles } from './project-work-order-collaborators.ts';
import { isPartnerCreatedProject, projectCustomerConfirmationLocked, isResponsibleProjectManager } from './service-project-work-order-policy.ts';
import { projectScheduleIssue } from './service-project-dates.ts';
import { isInternal } from './request-operations.ts';
import { assertProjectFieldsWritable } from './service-project-readonly.ts';
import type {
  CustomerRef,
  RequestItem,
  CatalogFormAudience,
} from './service-requests';
import type { OperationActor } from './request-operations';
import type {
  ProjectCollaborators,
  ProjectCollaboratorDirectory,
} from './service-project-collaborators';
import type { ProjectSupplement } from './service-project-supplements';
import type { Partner } from './partner-directory';
import { projectServiceProviders } from './service-project-providers.ts';
import type { ProjectOperations } from './service-project-activity';

import { serviceProjectStatuses } from './service-project-status.ts';
export { serviceProjectStatuses } from './service-project-status.ts';
export type ServiceProjectStatus = (typeof serviceProjectStatuses)[number];
export type ServiceProjectInput = {
  name: string;
  expectedServiceDate: string;
  plannedCompletionDate?: string;
  customerId: string;
  serviceProviderId?: string;
  note: string;
  customValues?: Record<string, string>;
};
export type ServiceProjectRecord = ServiceProjectInput & {
  id: string;
  status: ServiceProjectStatus;
  worklogsLocked?: boolean;
  createdViaAdmin?: { id: string; name: string };
  createdById: string;
  createdBy: string;
  createdAt: string;
  createdSite?: string;
  updatedAt: string;
  submittedAt?: string;
  // Reserved for system association; excluded from editable project input.
  readonly sourceServiceRequestId?: string;
  requestConversion?: { mapping: import('./request-project-mapping').RequestProjectMapping; assessmentSnapshot?: import('./project-request-snapshot').ProjectRequestSnapshot; workOrders: { id: string; sourceItemId: string; pricing?: import('./request-pricing').EffortPricingLine }[] };
  revision: number;
  // Derived for partner views whose internal review details are omitted.
  readonly customerConfirmationLocked?: boolean;
  suspension?: { reason?: string; at: string; actorId: string; actor: string; fromStatus: '待启动' | '进行中' | '待复核' | '待确认' };
  cancellation?: { at: string; actorId: string; actor: string; reason: string; fromStatus: ServiceProjectStatus };
  collaborators?: ProjectCollaborators;
  collaboratorAssignmentsVersion?: 1;
  supplements?: ProjectSupplement[];
  serviceProviderName?: string;
  items?: RequestItem[];
  operations?: ProjectOperations;
  review?: import('./service-project-review').ProjectReview;
  dailyReports?: import('./service-project-daily-reports').ProjectDailyReport[];
  workOrders?: import('./service-work-orders').ServiceWorkOrder[];
};

export function projectItemAudience(
  actor: OperationActor,
): CatalogFormAudience {
  return actor.role === '合作伙伴服务工程师'
    ? 'partner'
    : actor.role === '客户'
      ? 'customer'
      : 'internal';
}

export function canManageServiceProjects(
  actor: OperationActor,
  project?: ServiceProjectRecord,
) {
  if (!actor.id) return false;
  if (actor.role === 'SmartX 系统管理员') return true;
  if (actor.role === 'SmartX 项目经理') return !project || isResponsibleProjectManager(project, actor);
  if (actor.role !== '合作伙伴服务工程师') return false;
  return (
    !project ||
    (project.createdSite === '合作伙伴中心' &&
      project.createdById === actor.id) ||
    !!project.collaborators?.partner?.some((person) => person.id === actor.id && !person.workOrderAssignmentOnly)
  );
}

export function canViewServiceProject(actor: OperationActor, project?: ServiceProjectRecord) {
  if (project && actor.role === 'SmartX 项目经理') return isResponsibleProjectManager(project, actor);
  if (project && actor.id && isInternal(actor.role) && project.review?.approvals.some(a => a.days > 0 && a.state === '待审批' && a.approverId === actor.id)) return true;
  if (actor.id && actor.role === '合作伙伴服务工程师' && project?.collaborators?.partner?.some(person => person.id === actor.id && person.workOrderAssignmentOnly)) return true;
  return canManageServiceProjects(actor, project) || (!!actor.id && isInternal(actor.role)
    && (!project || !!project.collaborators?.internal?.some(person => person.id === actor.id)));
}

export function projectForActor(
  project: ServiceProjectRecord,
  actor: OperationActor,
): ServiceProjectRecord {
  project = withWorkOrderCollaboratorRoles(project);
  return projectItemAudience(actor) === 'internal'
    ? project
    : {
        ...project,
        worklogsLocked: projectWorklogsLocked(project),
        customerConfirmationLocked: projectCustomerConfirmationLocked(project),
        review: isPartnerCreatedProject(project) && project.review ? { approvals: [], confirmations: structuredClone(project.review.confirmations) } : undefined,
        supplements: project.supplements?.filter(
          (supplement) => supplement.externalVisible,
        ),
        ...(project.operations
          ? {
              operations: {
                ...project.operations,
                worklogs: project.operations.worklogs.filter(
                  (log) => log.userId === actor.id,
                ),
                activities: project.operations.activities.filter(
                  (activity) =>
                    activity.externalVisible !== false ||
                    activity.actorId === actor.id,
                ),
              },
            }
          : {}),
      };
}

export function assertActiveProjectActor(
  actor: OperationActor,
  directory: Pick<ProjectCollaboratorDirectory, 'partners' | 'partnerUsers'>,
) {
  if (!canViewServiceProject(actor))
    throw new Error('当前身份无权访问服务项目。');
  if (projectItemAudience(actor) !== 'partner') return;
  const person = directory.partnerUsers.find(
    (person) => person.id === actor.id && person.status === '启用',
  );
  if (
    !person ||
    !directory.partners.some(
      (partner) => partner.id === person.partnerId && partner.status === '启用',
    )
  )
    throw new Error('合作伙伴用户或所属合作伙伴已停用，请切换有效身份。');
}

export function projectStatusChoices(
  status: ServiceProjectStatus,
): ServiceProjectStatus[] {
  if (status === '已完成' || status === '已取消' || status === '已暂停') return [status];
  return [
    status,
    serviceProjectStatuses[serviceProjectStatuses.indexOf(status) + 1],
  ];
}

function projectInput(input: ServiceProjectInput): ServiceProjectInput {
  return {
    name: input.name.trim(),
    expectedServiceDate: input.expectedServiceDate,
    ...(input.plannedCompletionDate !== undefined ? { plannedCompletionDate: input.plannedCompletionDate } : {}),
    customerId: input.customerId,
    note: input.note.trim(),
    ...(input.customValues !== undefined ? { customValues: structuredClone(input.customValues) } : {}),
  };
}

export function serviceProjectIssue(
  input: ServiceProjectInput,
  customers: CustomerRef[],
  previous?: ServiceProjectRecord,
  partners: Partner[] = [],
): string | null {
  if (!input.name.trim()) return '请填写项目名称。';
  if (input.name.trim().length > 100) return '项目名称不能超过 100 字。';
  const scheduleIssue = projectScheduleIssue({ ...input, plannedCompletionDate: input.plannedCompletionDate ?? previous?.plannedCompletionDate },
    !!previous?.plannedCompletionDate && previous.status !== '待启动', !previous || previous.status === '待启动');
  if (scheduleIssue) return scheduleIssue;
  if (!input.customerId) return '请选择客户。';
  if (
    input.customerId !== previous?.customerId &&
    !customers.some(
      (customer) =>
        customer.id === input.customerId && customer.status === '启用',
    )
  )
    return '请选择已启用的客户。';
  const providerId =
    input.serviceProviderId ?? previous?.serviceProviderId ?? '';
  if (
    providerId &&
    providerId !== previous?.serviceProviderId &&
    !projectServiceProviders(partners).some(
      (provider) => provider.id === providerId,
    )
  )
    return '请选择北京志凌海纳科技有限公司或引用数据中的合作伙伴。';
  return null;
}

function providerFields(
  input: ServiceProjectInput,
  partners: Partner[],
  previous?: ServiceProjectRecord,
) {
  const serviceProviderId =
    input.serviceProviderId ?? previous?.serviceProviderId ?? '';
  return {
    serviceProviderId,
    serviceProviderName: serviceProviderId
      ? (projectServiceProviders(partners).find(
          (provider) => provider.id === serviceProviderId,
        )?.name ??
        previous?.serviceProviderName ??
        serviceProviderId)
      : '',
  };
}

export function newServiceProject(
  input: ServiceProjectInput,
  actor: OperationActor,
  customers: CustomerRef[],
  partners: Partner[] = [],
): ServiceProjectRecord {
  if (!canManageServiceProjects(actor))
    throw new Error('当前身份不能创建服务项目。');
  const issue = serviceProjectIssue(input, customers, undefined, partners);
  if (issue) throw new Error(issue);
  const now = new Date();
  return {
    ...projectInput(input),
    ...providerFields(input, partners),
    id: `SP-${now.getTime().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`,
    status: '待启动',
    createdById: actor.id,
    createdBy: actor.name,
    createdAt: now.toISOString(),
    createdSite:
      projectItemAudience(actor) === 'partner' ? '合作伙伴中心' : '内部系统',
    updatedAt: now.toISOString(),
    revision: 1,
  };
}

// Only mutable business fields are copied. System values always come from the saved record.
export function editServiceProject(
  previous: ServiceProjectRecord,
  input: ServiceProjectInput & { status: ServiceProjectStatus },
  actor: OperationActor,
  customers: CustomerRef[],
  partners: Partner[] = [],
): ServiceProjectRecord {
  if (!canManageServiceProjects(actor, previous))
    throw new Error('当前身份无权维护此服务项目。');
  if (previous.status === '已暂停') throw new Error('项目已暂停，请先恢复项目。');
  if (previous.status === '已完成' || previous.status === '已取消')
    throw new Error('已结束的项目不可编辑。');
  if (!projectStatusChoices(previous.status).includes(input.status))
    throw new Error('请按项目流程变更状态，不可跳过阶段。');
  if (input.status !== previous.status && ['待确认', '已完成'].includes(input.status))
    throw new Error('请在复核选项卡中发起客户确认或完成项目。');
  if ((previous.createdSite === '合作伙伴中心' || projectItemAudience(actor) === 'partner')
    && (input.serviceProviderId ?? previous.serviceProviderId ?? '') !== (previous.serviceProviderId ?? ''))
    throw new Error(previous.createdSite === '合作伙伴中心' ? '合作伙伴创建的项目，服务方固定为所属企业，不能修改。' : '内部项目的服务方仅内部人员可调整。');
  if (input.customerId !== previous.customerId && previous.collaborators?.customer?.some(person => person.assignmentRoles?.length))
    throw new Error('客户协作人包含默认分配成员，不能通过更换客户移除。');
  if (previous.status !== '待启动' && input.customerId !== previous.customerId) throw new Error('项目已启动，服务项已锁定，不能更换客户。');
  if (input.status === '待复核' && input.status !== previous.status && isPartnerCreatedProject(previous)) throw new Error('合作伙伴创建的项目无需复核，工单完成后请发起客户确认。');
  if (previous.status === '进行中' && input.status === '待复核') {
    throw new Error('请由项目执行工程师通过「提交复核」操作手动提交，不能直接修改项目状态。');
  }
  const issue = serviceProjectIssue(input, customers, previous, partners);
  if (issue) throw new Error(issue);
  assertProjectFieldsWritable(previous, { ...projectInput(input), serviceProviderId: input.serviceProviderId });
  const now = new Date().toISOString();
  return {
    ...previous,
    ...projectInput(input),
    ...providerFields(input, partners, previous),
    ...(input.customerId !== previous.customerId && previous.items
      ? {
          items: previous.items.map((item) => ({
            ...item,
            businessObjectIds: [],
            businessObjectSnapshot: undefined,
            materials: [],
          })),
        }
      : {}),
    ...(previous.collaborators &&
    (input.customerId !== previous.customerId ||
      (input.serviceProviderId ?? previous.serviceProviderId ?? '') !==
        (previous.serviceProviderId ?? ''))
      ? {
          collaborators: {
            ...previous.collaborators,
            ...(input.customerId !== previous.customerId
              ? { customer: [] }
              : {}),
            ...((input.serviceProviderId ??
              previous.serviceProviderId ??
              '') !== (previous.serviceProviderId ?? '')
              ? { partner: [] }
              : {}),
          },
        }
      : {}),
    status: input.status,
    ...(previous.status === '待启动' &&
    input.status === '进行中' &&
    !previous.submittedAt
      ? { submittedAt: now }
      : {}),
    revision: previous.revision + 1,
    updatedAt: now,
  };
}
