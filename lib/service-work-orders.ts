import { isPartnerProjectCreator, isResponsibleProjectManager } from './service-project-work-order-policy.ts';
import { snapshotWorkOrderForm } from './work-order-form.ts';
import { fixedIdentityRoles } from './internal-users.ts';
import { canManageProjectAsManager, canChangeProjectWorkOrders, canSubmitProjectReview, canReturnProjectReview, projectReviewIssue, projectCustomerConfirmationLocked } from './service-project-work-order-policy.ts';
import { projectScheduleIssue } from './service-project-dates.ts';
import type { ServiceProjectRecord } from './service-projects';
import { projectItemAudience, canViewServiceProject } from './service-projects.ts';
import type { OperationActor } from './request-operations';
import { isInternal } from './request-operations.ts';
import { routingUsers } from './assessment-routing-schema.ts';
import type { CatalogService, InternalUser, RequestItem, StoredFile } from './service-requests';
import { checkFile, newItem, resolveRequestConfig, type RequestConfig } from './service-requests.ts';
import { prepareProjectItem, type ProjectItemContext } from './service-project-items.ts';
import {
  resolveServiceFlow,
  type ServiceFlowConfig,
  type FlowDictionary,
} from './service-flows.ts';
import type { ServiceFlowStep } from './service-flow-steps';
import { stepDocuments, stepFiles } from './service-step-deliverables.ts';
import type { ExecutionForm } from './service-execution-forms';
import { appendProjectActivity } from './service-project-activity.ts';

export type WorkStepData = {
  values: Record<string, string | boolean>;
  description: string;
  attachments: StoredFile[];
  deliverables: Record<string, StoredFile[]>;
};
export type WorkOrderStep = {
  definition: ServiceFlowStep;
  phaseName: string;
  status: '待执行' | '进行中' | '已完成' | '已跳过';
  data: WorkStepData;
  updatedAt?: string;
  updatedBy?: string;
  skipReason?: string;
};
export type ServiceWorkOrder = {
  id: string;
  item: RequestItem;
  customerName: string;
  providerName: string;
  expectedServiceDate: string;
  plannedCompletionDate?: string;
  contactRef?: { id: string; group: 'customer' | 'internal' | 'partner' };
  startedAt?: string;
  contactName?: string;
  contactPhone?: string;
  flowId: string;
  flowName: string;
  flowRevision: number;
  matchedRuleName?: string;
  createdAt: string;
  createdBy: string;
  status: '待执行' | '进行中' | '已完成' | '已取消' | '已暂停';
  createdById?: string;
  origin?: 'service-item' | 'manual';
  catalogSnapshot?: Pick<CatalogService, 'id' | 'name'> & Partial<CatalogService>;
  cancellation?: { reason: string; at: string; actorId: string; actorName: string; previousStatus: '待执行' | '进行中' | '已完成' | '已暂停' };
  suspension?: { at: string; actorId: string; actorName: string; fromStatus: '待执行' | '进行中' };
  completedAt?: string;
  assignee?: WorkOrderAssignee;
  assignees?: WorkOrderAssignee[];
  updatedAt?: string;
  steps: WorkOrderStep[];
};
export type WorkOrderAssignee = {
  id: string;
  name: string;
  group: 'internal' | 'partner';
};
export function assignedEngineers(order: Pick<ServiceWorkOrder, 'assignee' | 'assignees'>): WorkOrderAssignee[] {
  return order.assignees ?? (order.assignee ? [order.assignee] : []);
}
export function canViewWorkOrderOverview(
  project: ServiceProjectRecord,
  actor: OperationActor,
) {
  return (isInternal(actor.role) || actor.role === '合作伙伴服务工程师') && canViewServiceProject(actor, project);
}
export function canManageWorkOrders(
  project: ServiceProjectRecord,
  actor: OperationActor,
) {
  return (
    canViewWorkOrderOverview(project, actor) &&
    project.status === '进行中' &&
    canManageProjectAsManager(project, actor)
  );
}
export function workOrderProgress(order: ServiceWorkOrder) {
  const completed = order.steps.filter(
    (step) => step.status === '已完成',
  ).length;
  const skipped = order.steps.filter((step) => step.status === '已跳过').length;
  return { completed, skipped, total: order.steps.length };
}
export function workOrderOverdue(
  project: ServiceProjectRecord,
  order: ServiceWorkOrder,
  today: string,
) {
  return (
    !['已完成', '已取消'].includes(project.status) &&
    !['已完成', '已取消'].includes(order.status) &&
    !!order.plannedCompletionDate &&
    order.plannedCompletionDate < today
  );
}
export function workOrderUpdatedAt(order: ServiceWorkOrder) {
  return (
    [
      order.createdAt,
      order.updatedAt,
      order.completedAt,
      ...order.steps.map((step) => step.updatedAt),
    ]
      .filter((value): value is string => !!value)
      .sort()
      .at(-1) ?? ''
  );
}
export const emptyWorkStepData = (): WorkStepData => ({
  values: {},
  description: '',
  attachments: [],
  deliverables: {},
});
export const projectItemsLocked = (project?: ServiceProjectRecord | null) =>
  !!project && (project.status !== '待启动' || !!project.workOrders?.length);
export function canStartServiceProject(
  project: ServiceProjectRecord,
  actor: OperationActor,
  users: InternalUser[],
) {
  return (
    project.status === '待启动' &&
    !project.workOrders?.length &&
    (actor.role === 'SmartX 系统管理员' ? fixedIdentityRoles[actor.id] === actor.role && users.some(user => user.id === actor.id && user.status === '启用') : isPartnerProjectCreator(project, actor) || isResponsibleProjectManager(project, actor) && routingUsers(users, 'manager').some((user) => user.id === actor.id))
  );
}
export function canExecuteWorkOrders(
  project: ServiceProjectRecord,
  actor: OperationActor,
) {
  if (projectCustomerConfirmationLocked(project) || project.status !== '进行中' || !canViewServiceProject(actor, project)) return false;
  if (['SmartX 系统管理员', 'SmartX 项目经理'].includes(actor.role)) return true;
  const group = actor.role === 'SmartX 服务工程师' ? 'internal'
    : actor.role === '合作伙伴服务工程师' ? 'partner' : undefined;
  return !!group && !!actor.id && !!project.collaborators?.[group]?.some(person => person.id === actor.id);
}
export function canExecuteSpecificWorkOrder(project: ServiceProjectRecord, order: ServiceWorkOrder, actor: OperationActor) {
  if (['已取消', '已暂停'].includes(order.status) || !canExecuteWorkOrders(project, actor)) return false;
  if (['SmartX 项目经理', 'SmartX 系统管理员'].includes(actor.role)) return true;
  return assignedEngineers(order).some(person => person.id === actor.id && person.group === (actor.role === '合作伙伴服务工程师' ? 'partner' : 'internal'));
}

export function workStepForm(step: ServiceFlowStep): ExecutionForm {
  if (!step.executionForm) throw new Error('服务步骤缺少表单快照，请重新配置流程。');
  return step.executionForm;
}
export function startProjectWorkOrders(
  project: ServiceProjectRecord,
  actor: OperationActor,
  users: InternalUser[],
  config: ServiceFlowConfig,
  dictionary: FlowDictionary,
  now = new Date().toISOString(),
): ServiceProjectRecord {
  if (!canStartServiceProject(project, actor, users))
    throw new Error(
      '仅启用的项目经理或系统管理员可启动待启动项目，已生成的工单不能重复生成。',
    );
  const scheduleIssue = projectScheduleIssue(project, true);
  if (scheduleIssue) throw new Error(scheduleIssue);
  if (!project.items?.length) throw new Error('请先添加服务项，再启动项目。');
  if (
    new Set(project.items.map((item) => item.id)).size !== project.items.length
  )
    throw new Error('服务项编号重复，无法生成工单。');
  const workOrders: ServiceWorkOrder[] = project.items.map((item, index) => {
    return buildWorkOrder(project, item, `WO-${project.id}-${String(index + 1).padStart(2, '0')}`, actor, config, dictionary, now);
  });
  return appendProjectActivity(
    {
      ...project,
      workOrders,
      status: '进行中',
      submittedAt: now,
      updatedAt: now,
      revision: project.revision + 1,
    },
    actor,
    '项目',
    '启动项目并生成工单',
    `已锁定 ${workOrders.length} 个服务项并生成工单`,
    now,
    false,
  );
}
function validateFiles(files: StoredFile[]) {
  if (!Array.isArray(files) || files.length > 50)
    throw new Error('每项最多保存 50 个附件。');
  if (new Set(files.map((file) => file.id)).size !== files.length)
    throw new Error('附件编号重复。');
  for (const file of files) {
    if (
      !file?.id ||
      !file.name ||
      !(file.blob instanceof Blob) ||
      !file.blob.size ||
      file.size !== file.blob.size ||
      file.size > 20 * 1024 * 1024
    )
      throw new Error('附件须为非空文件，单个不超过 20 MB。');
  }
}
export function validateWorkStepData(
  step: ServiceFlowStep,
  input: WorkStepData,
  complete: boolean,
): WorkStepData {
  const data = structuredClone(input);
  if (
    !data ||
    typeof data.description !== 'string' ||
    data.description.length > 60000 ||
    !data.values ||
    typeof data.values !== 'object' ||
    !data.deliverables ||
    typeof data.deliverables !== 'object'
  )
    throw new Error('步骤内容格式无效。');
  validateFiles(data.attachments);
  if (step.type === 'form') {
    const form = workStepForm(step);
    const values: WorkStepData['values'] = {};
    for (const id of form.layout.order) {
      const field = form.fields.find((field) => field.id === id)!;
      const value = data.values[id] ?? '';
      if (!['string', 'boolean'].includes(typeof value))
        throw new Error(`${field.name}内容无效。`);
      if (
        complete &&
        field.required &&
        typeof value === 'string' &&
        !value.trim()
      )
        throw new Error(`请填写${field.name}。`);
      if (value !== '') {
        if (
          field.type === 'boolean'
            ? typeof value !== 'boolean'
            : typeof value !== 'string'
        )
          throw new Error(`${field.name}类型无效。`);
        if (typeof value === 'string' && value.length > 60000)
          throw new Error(`${field.name}内容过长。`);
        if (
          ['integer', 'decimal'].includes(field.type) &&
          (!Number.isFinite(Number(value)) ||
            !String(value).trim() ||
            (field.type === 'integer' && !Number.isInteger(Number(value))))
        )
          throw new Error(`${field.name}须填写有效数字。`);
        if (field.type === 'single' && !field.options.includes(String(value)))
          throw new Error(`${field.name}选项无效。`);
        if (field.type === 'multiple') {
          let selected: unknown;
          try {
            selected = JSON.parse(String(value));
          } catch {
            throw new Error(`${field.name}选项无效。`);
          }
          if (
            !Array.isArray(selected) ||
            selected.some((option) => !field.options.includes(option)) ||
            (complete && field.required && !selected.length)
          )
            throw new Error(`请选择${field.name}的有效选项。`);
        }
        if (
          field.type === 'date' &&
          (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ||
            !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) ||
            new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value)
        )
          throw new Error(`${field.name}日期无效。`);
      }
      values[id] = value;
    }
    return { ...emptyWorkStepData(), values };
  }
  if (step.type === 'combined') {
    if (complete && step.recordRequired && !data.description.trim())
      throw new Error('请填写执行说明。');
    if (complete && step.attachmentRequired && !data.attachments.length)
      throw new Error('请上传执行附件。');
    return {
      ...emptyWorkStepData(),
      description: data.description,
      attachments: data.attachments.map((file) => ({
        ...file,
        deliverToCustomer: false,
      })),
    };
  }
  const deliverables: WorkStepData['deliverables'] = {};
  for (const item of step.type === 'document'
    ? stepDocuments(step)
    : stepFiles(step)) {
    const files = data.deliverables[item.id] ?? [];
    validateFiles(files);
    const min = 'minFiles' in item ? item.minFiles : 1;
    if (complete && item.required && files.length < min)
      throw new Error(`「${item.name}」至少需要 ${min} 个文件。`);
    for (const file of files) {
      if (step.type === 'document') {
        const issue = checkFile(
          new File([file.blob], file.name, { type: file.blob.type }),
        );
        if (issue) throw new Error(issue);
      }
      if (
        'formats' in item &&
        item.formats &&
        !item.formats
          .split(',')
          .some((format) =>
            file.name.toLowerCase().endsWith(format.trim().toLowerCase()),
          )
      )
        throw new Error(`${file.name}不符合允许的格式。`);
    }
    deliverables[item.id] = files.map((file) => ({
      ...file,
      deliverToCustomer: item.deliverToCustomer,
    }));
  }
  return { ...emptyWorkStepData(), deliverables };
}
export type WorkStepAction = {
  orderId: string;
  stepId: string;
  type: 'save' | 'complete' | 'skip';
  data: WorkStepData;
  reason?: string;
};
export function applyWorkStep(
  project: ServiceProjectRecord,
  actor: OperationActor,
  action: WorkStepAction,
  now = new Date().toISOString(),
): ServiceProjectRecord {
  if (!canExecuteWorkOrders(project, actor))
    throw new Error('当前身份或项目状态不允许执行工单。');
  const next = structuredClone(project);
  const order = next.workOrders?.find((order) => order.id === action.orderId);
  const step = order?.steps.find(
    (step) => step.definition.id === action.stepId,
  );
  if (!order || !step) throw new Error('工单或步骤不存在。');
  if (order.status === '已暂停') throw new Error('工单已暂停，请由项目经理恢复后继续执行。');
  if (!canExecuteSpecificWorkOrder(project, order, actor)) throw new Error('当前工程师未被指派此工单，不能修改执行内容。');
  if (order.status === '已完成')
    throw new Error('该工单已完成，不能修改步骤或重复提交。');
  const wasCompleted = step.status === '已完成';
  if (step.status === '已跳过' || (wasCompleted && action.type !== 'save'))
    throw new Error('该步骤已结束，不能重复提交。');
  if (action.type === 'skip') {
    if (step.definition.required) throw new Error('必做步骤不能跳过。');
    if (!action.reason?.trim()) throw new Error('请填写跳过原因。');
    step.skipReason = action.reason.trim().slice(0, 2000);
    step.status = '已跳过';
  } else {
    if (!['save', 'complete'].includes(action.type))
      throw new Error('无效步骤操作。');
    const data = validateWorkStepData(
      step.definition,
      action.data,
      action.type === 'complete' || wasCompleted,
    );
    const previousFiles = new Map(
      [
        ...step.data.attachments,
        ...Object.values(step.data.deliverables).flat(),
      ].map((file) => [file.id, file]),
    );
    const attributeSubmission = (file: StoredFile): StoredFile => {
      const previous = previousFiles.get(file.id);
      const unchanged = previous && previous.uploadedAt === file.uploadedAt;
      return {
        ...file,
        uploadedById: unchanged ? previous.uploadedById : actor.id,
        submittedBy: unchanged
          ? previous.submittedBy ||
            (previous.uploadedById ? undefined : step.updatedBy)
          : actor.name,
        submittedAt: unchanged
          ? previous.submittedAt || previous.uploadedAt
          : now,
      };
    };
    data.attachments = data.attachments.map(attributeSubmission);
    data.deliverables = Object.fromEntries(
      Object.entries(data.deliverables).map(([id, files]) => [
        id,
        files.map(attributeSubmission),
      ]),
    );
    step.data = data;
    step.status =
      action.type === 'complete' || wasCompleted ? '已完成' : '进行中';
  }
  if (order.status === '待执行' && !order.startedAt) order.startedAt = now;
  step.updatedAt = now;
  step.updatedBy = actor.name;
  order.status = order.steps.every((step) =>
    ['已完成', '已跳过'].includes(step.status),
  )
    ? '已完成'
    : '进行中';
  if (order.status === '已完成') order.completedAt = now;
  next.revision++;
  next.updatedAt = now;
  return appendProjectActivity(
    next,
    actor,
    '工单',
    action.type === 'complete'
      ? '完成工单步骤'
      : action.type === 'skip'
        ? '跳过工单步骤'
        : wasCompleted
          ? '修改已完成工单步骤'
          : '保存工单步骤',
    `${order.item.serviceName} · ${step.definition.name}`,
    now,
    false,
  );
}

function buildWorkOrder(project: ServiceProjectRecord, item: RequestItem, id: string, actor: OperationActor, config: ServiceFlowConfig, dictionary: FlowDictionary, now: string): ServiceWorkOrder {
    const result = resolveServiceFlow(config, {
      serviceId: item.serviceId,
      method: item.method,
      customerId: project.customerId,
      customerTeam:
        dictionary.customers.find(
          (customer) => customer.id === project.customerId,
        )?.team ?? '',
    });
    if (!result.flow || !result.steps.length)
      throw new Error(
        `「${item.serviceName}」未匹配到包含启用步骤的服务流程，请先配置分配规则或默认流程。`,
      );
    return {
      id: id,
      item: snapshotWorkOrderForm(item, dictionary.workOrderFields),
      customerName:
        dictionary.customers.find(
          (customer) => customer.id === project.customerId,
        )?.name ?? project.customerId,
      providerName: project.serviceProviderName ?? '',
      expectedServiceDate: project.expectedServiceDate,
      plannedCompletionDate: project.plannedCompletionDate,
      flowId: result.flow.id,
      flowName: result.flow.name,
      flowRevision: config.revision,
      matchedRuleName: result.rule?.name,
      createdAt: now,
      createdBy: actor.name,
      createdById: actor.id,
      origin: 'service-item',
      catalogSnapshot: structuredClone(dictionary.services.find(service => service.id === item.serviceId)),
      status: '待执行',
      steps: result.steps.map((definition) => ({
        definition: structuredClone(definition),
        phaseName:
          result.flow!.phases?.find((phase) => phase.id === definition.phaseId)
            ?.name ??
          definition.phase ??
          '',
        status: '待执行',
        data: emptyWorkStepData(),
      })),
    };
}
export type ManualWorkOrderInput = { item: RequestItem };
export type WorkOrderFormContext = Omit<ProjectItemContext, 'services'> & {
  configs: RequestConfig[];
  methodFieldType?: RequestItem['methodFieldType'];
};
export function addProjectWorkOrder(project: ServiceProjectRecord, actor: OperationActor, input: ManualWorkOrderInput, config: ServiceFlowConfig, dictionary: Omit<FlowDictionary, 'services'> & { services: CatalogService[] }, now = new Date().toISOString(), form: WorkOrderFormContext = { configs: [], businessObjects: [], requests: [] }): ServiceProjectRecord {
  if (!canChangeProjectWorkOrders(project, actor)) throw new Error('当前身份或项目状态不允许新增工单，仅进行中项目可操作。');
  const service = dictionary.services.find(service => service.id === input.item?.serviceId && service.status === '已启用');
  if (!service) throw new Error('请选择已启用的服务目录。');
  const base = newItem(service, { ...resolveRequestConfig(service, form.configs), materials: [] });
  const submitted = input.item;
  const item = prepareProjectItem({ ...base,
    method: submitted.method, methodFieldType: form.methodFieldType ?? 'single',
    description: submitted.description, values: submitted.values,
    businessObjectIds: submitted.businessObjectIds,
    materials: [],
  }, project.customerId, { ...form, services: dictionary.services }, projectItemAudience(actor));
  let sequence = (project.workOrders?.length ?? 0) + 1;
  let id = '';
  do { id = `WO-${project.id}-${String(sequence++).padStart(2, '0')}`; } while (project.workOrders?.some(order => order.id === id));
  const order = { ...buildWorkOrder(project, item, id, actor, config, dictionary, now), origin: 'manual' as const };
  return appendProjectActivity({ ...project, revision: project.revision + 1, updatedAt: now, workOrders: [...(project.workOrders ?? []), order] }, actor, '工单', '创建工单', `${order.id} · ${order.item.serviceName}`, now, false);
}
export function canPauseProjectWorkOrder(project: ServiceProjectRecord, actor: OperationActor, order: ServiceWorkOrder) {
  return project.status === '进行中' && canManageProjectAsManager(project, actor) && ['待执行', '进行中'].includes(order.status);
}
export function canResumeProjectWorkOrder(project: ServiceProjectRecord, actor: OperationActor, order: ServiceWorkOrder) {
  return project.status === '进行中' && canManageProjectAsManager(project, actor) && order.status === '已暂停'
    && !!order.suspension && ['待执行', '进行中'].includes(order.suspension.fromStatus);
}
export function changeProjectWorkOrderSuspension(project: ServiceProjectRecord, actor: OperationActor, orderId: string, action: 'pause' | 'resume', now = new Date().toISOString()): ServiceProjectRecord {
  const order = project.workOrders?.find(entry => entry.id === orderId);
  if (!order) throw new Error('工单不存在。');
  if (action === 'pause' ? !canPauseProjectWorkOrder(project, actor, order) : action === 'resume' ? !canResumeProjectWorkOrder(project, actor, order) : true)
    throw new Error('仅项目经理可在项目进行中暂停或恢复未完成工单。');
  const next = structuredClone(project);
  const target = next.workOrders!.find(entry => entry.id === orderId)!;
  if (action === 'pause') {
    target.suspension = { at: now, actorId: actor.id, actorName: actor.name, fromStatus: order.status as '待执行' | '进行中' };
    target.status = '已暂停';
  } else {
    target.status = order.suspension!.fromStatus;
    delete target.suspension;
  }
  target.updatedAt = now;
  next.revision += 1; next.updatedAt = now;
  return appendProjectActivity(next, actor, '工单', action === 'pause' ? '暂停工单' : '恢复工单', `${order.id} · ${order.item.serviceName}；${order.status} → ${target.status}`, now, false);
}
export function cancelProjectWorkOrder(project: ServiceProjectRecord, actor: OperationActor, orderId: string, reason: string, now = new Date().toISOString()): ServiceProjectRecord {
  if (!canChangeProjectWorkOrders(project, actor)) throw new Error('当前身份或项目状态不允许取消工单，仅进行中项目可操作。');
  const order = project.workOrders?.find(order => order.id === orderId);
  if (!order) throw new Error('工单不存在。');
  if (order.status === '已取消') throw new Error('工单已取消，不能重复取消或恢复。');
  const previousStatus = order.status;
  if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 2000) throw new Error('请填写取消原因，不超过 2000 字。');
  return appendProjectActivity({ ...project, revision: project.revision + 1, updatedAt: now,
    workOrders: project.workOrders!.map(entry => entry.id === orderId ? { ...entry, status: '已取消', suspension: undefined, updatedAt: now,
      cancellation: { reason: reason.trim(), at: now, actorId: actor.id, actorName: actor.name, previousStatus } } : entry),
  }, actor, '工单', '取消工单', `${order.id} · ${order.item.serviceName}；${reason.trim()}`, now, false);
}
export function submitProjectReview(project: ServiceProjectRecord, actor: OperationActor, now = new Date().toISOString()): ServiceProjectRecord {
  if (!canSubmitProjectReview(project, actor)) throw new Error('仅本项目已指派的执行工程师可手动提交进行中的项目复核。');
  const issue = projectReviewIssue(project);
  if (issue) throw new Error(issue);
  return appendProjectActivity({ ...project, status: '待复核', revision: project.revision + 1, updatedAt: now }, actor, '项目', '提交复核', '进行中 → 待复核', now, false);
}

export type ReturnProjectReviewInput = { reason: string };
export function returnProjectReview(project: ServiceProjectRecord, actor: OperationActor, input: ReturnProjectReviewInput, now = new Date().toISOString()): ServiceProjectRecord {
  if (!canReturnProjectReview(project, actor)) throw new Error('仅负责项目经理或系统管理员可将待复核项目退回执行。');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.trim().length > 2000) throw new Error('请填写退回原因，不超过 2000 字。');
  if (project.workOrders?.some(order => order.status === '已完成' && !order.steps.length)) throw new Error('工单执行步骤缺失，无法退回执行。');
  const next = structuredClone(project);
  next.status = '进行中'; next.revision++; next.updatedAt = now;
  for (const order of next.workOrders ?? []) {
    if (order.status !== '已完成') continue;
    order.status = '进行中'; order.updatedAt = now; delete order.completedAt;
    // Keep the submitted content; reopen the last completed step for correction and resubmission.
    const completedIndex = order.steps.map(step => step.status).lastIndexOf('已完成');
    const step = order.steps[completedIndex >= 0 ? completedIndex : order.steps.length - 1];
    step.status = '进行中'; delete step.skipReason;
    step.updatedAt = now; step.updatedBy = actor.name;
  }
  if (next.review?.effort) next.review.effort.stage = '过程';
  next.review?.confirmations.forEach(confirmation => { confirmation.invalidatedAt ??= now; });
  return appendProjectActivity(next, actor, '项目', '退回执行',
    `待复核 → 进行中；${input.reason.trim()}`, now, false);
}
