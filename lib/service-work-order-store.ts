import { canonicalMailTemplate, mailConfigFromRows } from './service-mail-templates.ts';
import { sendProjectDailyReport, type DailyReportInput } from './service-project-daily-reports.ts';
import type { RequestField } from '../components/request-field-settings';
import type { ProjectSchedule } from './service-project-dates';
import { editWorkOrderBasicInfo, type WorkOrderBasicInfoInput } from './work-order-basic-info.ts';
import { assertProjectFieldsWritable } from './service-project-readonly.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import type { ProjectCollaboratorDirectory } from './service-project-collaborators';
import type { FlowDictionary } from './service-flows';
import { openDatabase, readLocal, partnerRequestConfigId, type RequestConfig, type ServiceRequest, type ObjectRef, type RequestItem, type CatalogService } from './service-requests.ts';
import { parseServiceProviderConfig, serviceProviderSettingsId } from './service-provider-settings.ts';
import { assignWorkOrders, canAssignWorkOrders, type AssignmentDirectory, type WorkOrderAssignmentInput } from './work-order-assignment.ts';
import { assignmentScheduleEntries } from './work-order-assignment-schedule.ts';
import {
  parseServiceFlowConfig,
  serviceFlowConfigId,
} from './service-flows.ts';
import { normalizeServiceProjectStatus } from './service-project-status.ts';
import {
  canViewServiceProject,
  assertActiveProjectActor,
  projectForActor,
  type ServiceProjectRecord,
} from './service-projects.ts';
import type { OperationActor } from './request-operations';
import {
applyWorkStep,
changeProjectWorkOrderSuspension,
addProjectWorkOrder,cancelProjectWorkOrder,submitProjectReview,type ManualWorkOrderInput,
returnProjectReview,type ReturnProjectReviewInput,startProjectWorkOrders,
type WorkStepAction
} from './service-work-orders.ts';
import { executionFormsFromRows } from './service-execution-form-store.ts';

export function assignmentDirectoryFromRows(rows: { id: string; payload?: unknown }[]): AssignmentDirectory {
  const workspace = (rows.find(row => row.id === 'workspace')?.payload ?? {}) as Partial<AssignmentDirectory>;
  return {
    users: workspace.users ?? [], contacts: workspace.contacts ?? [], partners: workspace.partners ?? [], partnerUsers: workspace.partnerUsers ?? [],
    services: workspace.services ?? [], serviceCertifications: workspace.serviceCertifications ?? [],
    providers: parseServiceProviderConfig(rows.find(row => row.id === serviceProviderSettingsId)?.payload),
  };
}
export async function readWorkOrderAssignmentDirectory() {
  return assignmentDirectoryFromRows(await readLocal<{ id: string; payload?: unknown }>('references'));
}
export async function readWorkOrderAssignmentContext(actor: OperationActor, projectId: string, orderIds: string[]) {
  const rows = await readLocal<{ id: string; payload?: unknown }>('references');
  const projects = rows.filter(row => row.id === `service-project:${(row.payload as ServiceProjectRecord)?.id}`)
    .map(row => normalizeServiceProjectStatus(row.payload as ServiceProjectRecord));
  const project = projects.find(project => project.id === projectId);
  if (!project || !canAssignWorkOrders(project, actor)) throw new Error('当前身份或项目状态不允许指派工单。');
  return { directory: assignmentDirectoryFromRows(rows), schedules: assignmentScheduleEntries(projects, actor, projectId, orderIds) };
}
export async function saveStoredWorkOrderAssignment(id: string, revision: number, actor: OperationActor, input: WorkOrderAssignmentInput) {
  return mutateProject(id, revision, actor, (project, rows) => assignWorkOrders(project, actor, input, assignmentDirectoryFromRows(rows)));
}
export async function saveStoredWorkOrderBasicInfo(id: string, revision: number, actor: OperationActor, input: WorkOrderBasicInfoInput) {
  return mutateProject(id, revision, actor, (project, rows) => editWorkOrderBasicInfo(project, actor, input, assignmentDirectoryFromRows(rows), new Date().toISOString(), ((rows.find(row => row.id === 'workspace')?.payload ?? {}) as { requestFields?: RequestField[] }).requestFields));
}

async function mutateProject(
  id: string,
  revision: number,
  actor: OperationActor,
  change: (
    project: ServiceProjectRecord,
    rows: { id: string; payload?: unknown }[],
    form: { configs: RequestConfig[]; requests: ServiceRequest[] },
  ) => ServiceProjectRecord,
  withFormData = false,
) {
  const db = await openDatabase();
  try {
    return await new Promise<ServiceProjectRecord>((resolve, reject) => {
      const tx = db.transaction(withFormData ? ['references', 'configs', 'requests'] : ['references'], 'readwrite');
      const store = tx.objectStore('references');
      const read = store.getAll();
      const configsRead = withFormData ? tx.objectStore('configs').getAll() : undefined;
      const requestsRead = withFormData ? tx.objectStore('requests').getAll() : undefined;
      let pending = withFormData ? 3 : 1;
      let result: ServiceProjectRecord;
      tx.oncomplete = () => resolve(projectForActor(result, actor));
      tx.onabort = () =>
        reject(tx.error ?? new Error('工单保存失败，未修改项目。'));
      tx.onerror = () =>
        reject(tx.error ?? new Error('工单保存失败，请重试。'));
      const finish = () => {
        if (--pending) return;
        try {
          const rows = read.result as { id: string; payload?: unknown }[];
          const workspace = (rows.find((row) => row.id === 'workspace')
            ?.payload ?? {}) as Partial<
            ProjectCollaboratorDirectory & FlowDictionary
          >;
          assertActiveProjectActor(actor, {
            partners: workspace.partners ?? [],
            partnerUsers: workspace.partnerUsers ?? [],
          });
          if (
            actor.role.startsWith('SmartX ') &&
            (!workspace.users?.some(
              (user) => user.id === actor.id && user.status === '启用',
            ) ||
              fixedIdentityRoles[actor.id] !== actor.role)
          )
            throw new Error('当前内部用户已停用或不存在。');
          const project = rows.find((row) => row.id === `service-project:${id}`)
            ?.payload as ServiceProjectRecord | undefined;
          if (!project || !canViewServiceProject(actor, project)) throw new Error('项目不存在或无权访问。');
          if (project.revision !== revision)
            throw new Error(
              '项目已被其他页面更新，请重新打开详情后重试，当前填写内容已保留。',
            );
          result = change(normalizeServiceProjectStatus(project), rows, { configs: configsRead?.result ?? [], requests: requestsRead?.result ?? [] });
          store.put({ id: `service-project:${id}`, payload: result });
        } catch (error) {
          reject(error);
          tx.abort();
        }
      };
      read.onsuccess = finish;
      if (configsRead) configsRead.onsuccess = finish;
      if (requestsRead) requestsRead.onsuccess = finish;
    });
  } finally {
    db.close();
  }
}
export async function startStoredServiceProject(
  id: string,
  revision: number,
  actor: OperationActor,
  schedule?: ProjectSchedule,
) {
  return mutateProject(id, revision, actor, (project, rows) => {
    const workspace = (rows.find((row) => row.id === 'workspace')?.payload ??
      {}) as Partial<ProjectCollaboratorDirectory & FlowDictionary & { requestFields: RequestField[] }>;
    const config = currentFlowConfig(rows);
    if (schedule)
      assertProjectFieldsWritable(project, { ...project, ...schedule });
    return startProjectWorkOrders(
      {
        ...project,
        ...(schedule
          ? {
              expectedServiceDate: schedule.expectedServiceDate,
              plannedCompletionDate: schedule.plannedCompletionDate ?? '',
            }
          : {}),
      },
      actor,
      workspace.users ?? [],
      config,
      {
        customers: workspace.customers ?? [],
        services: workspace.services ?? [],
        workOrderFields: workspace.requestFields,
      },
    );
  });
}
export async function saveStoredWorkStep(
  id: string,
  revision: number,
  actor: OperationActor,
  action: WorkStepAction,
) {
  return mutateProject(id, revision, actor, (project) =>
    applyWorkStep(project, actor, action),
  );
}

function currentFlowConfig(rows: { id: string; payload?: unknown }[]) {
    const config = parseServiceFlowConfig(
      rows.find((row) => row.id === serviceFlowConfigId)?.payload,
    );
    const forms = executionFormsFromRows(rows).library.forms;
    for (const flow of config.flows)
      for (const step of flow.steps) {
        if (step.type !== 'form') continue;
        const form = forms.find(
          (form) =>
            form.id ===
            (step.executionFormId),
        );
        if (form) {
          step.executionFormId = form.id;
          step.executionForm = structuredClone(form);
        }
      }
    return config;
}
export async function addStoredProjectWorkOrder(id: string, revision: number, actor: OperationActor, input: ManualWorkOrderInput) {
  return mutateProject(id, revision, actor, (project, rows, form) => {
    const workspace = (rows.find(row => row.id === 'workspace')?.payload ?? {}) as Partial<Omit<FlowDictionary, 'services'> & { services: CatalogService[]; businessObjects: ObjectRef[]; requestFields: RequestField[] }>;
    const configs = actor.role === '合作伙伴服务工程师' ? rows.filter(row => {
      const value = row.payload as RequestConfig | undefined;
      return value?.serviceId && row.id === partnerRequestConfigId(value.serviceId);
    }).map(row => row.payload as RequestConfig) : form.configs;
    const fieldType = workspace.requestFields?.find(field => field.id === 'method')?.type;
    const methodFieldType = fieldType && !['lookup', 'address'].includes(fieldType) ? fieldType as RequestItem['methodFieldType'] : 'single';
    return addProjectWorkOrder(project, actor, input, currentFlowConfig(rows), { customers: workspace.customers ?? [], services: workspace.services ?? [], workOrderFields: workspace.requestFields }, new Date().toISOString(), { configs, requests: form.requests, businessObjects: workspace.businessObjects ?? [], methodFieldType });
  }, true);
}
export async function cancelStoredProjectWorkOrder(id: string, revision: number, actor: OperationActor, orderId: string, reason: string) {
  return mutateProject(id, revision, actor, project => cancelProjectWorkOrder(project, actor, orderId, reason));
}
export async function submitStoredProjectReview(id: string, revision: number, actor: OperationActor) {
  return mutateProject(id, revision, actor, project => submitProjectReview(project, actor));
}
export async function returnStoredProjectReview(id: string, revision: number, actor: OperationActor, input: ReturnProjectReviewInput) {
  return mutateProject(id, revision, actor, project => returnProjectReview(project, actor, input));
}

export async function sendStoredProjectDailyReport(id: string, revision: number, actor: OperationActor, input: DailyReportInput) {
  return mutateProject(id, revision, actor, (project, rows) => {
    const directory = assignmentDirectoryFromRows(rows);
    const person = actor.role === '合作伙伴服务工程师'
      ? directory.partnerUsers.find(person => person.id === actor.id)
      : directory.users.find(person => person.id === actor.id);
    if (!person || person.status !== '启用') throw new Error('当前执行工程师已停用或不存在。');
    const workspace = rows.find(row => row.id === 'workspace')?.payload as { customers?: { id: string; name: string }[] } | undefined;
    const emailTemplate = canonicalMailTemplate(mailConfigFromRows(rows), input.kind === 'project' ? 'project' : 'daily', input.emailTemplate, workspace?.customers?.find(customer => customer.id === project.customerId)?.name ?? project.customerId);
    return sendProjectDailyReport(project, { ...actor, name: person.name }, { ...input, emailTemplate });
  });
}

export async function saveStoredWorkOrderSuspension(id: string, revision: number, actor: OperationActor, orderId: string, action: 'pause' | 'resume') {
  return mutateProject(id, revision, actor, project => changeProjectWorkOrderSuspension(project, actor, orderId, action));
}
