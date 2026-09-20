import { isDemoAdministrator } from './demo-permissions.ts';
import { changeServiceProjectSuspension } from './service-project-suspension.ts';
import { fixedIdentityRoles, operationIdentities } from './internal-users.ts';
import { normalizeServiceProjectStatus } from './service-project-status.ts';
import { ownProjectServiceProvider } from './service-project-providers.ts';
import { cancelServiceProject } from './service-project-cancellation.ts';
import { customerProjectOrganization, canViewCustomerProject, customerServiceProject, type CustomerProjectDirectory } from './customer-service-projects.ts';
import { assignInitialProjectCollaborators, withProjectAssignmentRoles } from './project-collaborator-assignment.ts';
import { validateCustomValues } from './custom-field-mapping.ts';
import { normalizeProjectFields, isSystemProjectField } from './service-project-fields.ts';
import type { RequestField } from '../components/request-field-settings';
import {
  readLocal,
  openDatabase,
  readRequestConfigs,
  newItem,
  resolveRequestConfig,
  serviceAvailableForRequest,
  updateLocalReference,
  type CustomerRef,
  type RequestItem,
  type CatalogService,
  type ObjectRef,
  type ServiceRequest,
} from './service-requests.ts';
import {
  newServiceProject,
  editServiceProject,
  canManageServiceProjects,
  canViewServiceProject,
  assertActiveProjectActor,
  projectItemAudience,
  projectForActor,
  type ServiceProjectRecord,
  type ServiceProjectInput,
  type ServiceProjectStatus,
} from './service-projects.ts';
import type { OperationActor } from './request-operations';
import { appendProjectActivity } from './service-project-activity.ts';
import {
  applyProjectOperation,
  type ProjectOperationAction,
} from './service-project-operations.ts';
import {
  addProjectSupplement,
  type ProjectSupplementInput,
} from './service-project-supplements.ts';
import {
  editProjectCollaborators,
  resolveProjectCollaborators,
  type ProjectCollaborators,
  type ProjectCollaboratorDirectory,
  type ProjectCollaboratorGroup,
} from './service-project-collaborators.ts';

const prefix = 'service-project:';

import { prepareMaterialDeduplication } from './request-materials.ts';

export async function newProjectServiceItem(
  service: CatalogService,
  actor: OperationActor,
  options: { formOnly?: boolean } = {},
): Promise<RequestItem> {
  const audience = projectItemAudience(actor);
  if (
    !canManageServiceProjects(actor) ||
    !serviceAvailableForRequest(service, audience)
  )
    throw new Error('当前身份不能添加此服务目录。');
  const configs = await readRequestConfigs(audience);
  const config = resolveRequestConfig(service, configs);
  return newItem(
    service,
    options.formOnly ? { ...config, materials: [] } : await prepareMaterialDeduplication(config),
  );
}

import {
  editProjectItems,
  prepareProjectItem,
  type ProjectItemChange,
  type ProjectItemContext,
} from './service-project-items.ts';

export async function readProjectItemContext(): Promise<ProjectItemContext> {
  const [references, requests] = await Promise.all([
    readLocal<{
      id: string;
      payload?: { services?: CatalogService[]; businessObjects?: ObjectRef[] };
    }>('references'),
    readLocal<ServiceRequest>('requests'),
  ]);
  const workspace = references.find((row) => row.id === 'workspace')?.payload;
  if (!workspace) throw new Error('无法读取服务目录和业务对象，请刷新后重试。');
  return {
    services: workspace.services ?? [],
    businessObjects: workspace.businessObjects ?? [],
    requests,
  };
}

export async function saveProjectItems(
  id: string,
  revision: number,
  change: ProjectItemChange,
  actor: OperationActor,
) {
  assertActiveProjectActor(actor, await savedProjectDirectory());
  const context = await readProjectItemContext();
  return updateLocalReference<ServiceProjectRecord>(
    `${prefix}${id}`,
    (previous) => {
      if (!previous) throw new Error('项目不存在，请刷新后重试。');
      previous = normalizeServiceProjectStatus(previous);
      if (previous.revision !== revision)
        throw new Error('项目已被更新，请重新打开详情后重试。');
      return appendProjectActivity(
        editProjectItems(previous, change, actor, context),
        actor,
        '服务项',
        change.type === 'copy'
          ? '复制服务项'
          : change.type === 'remove'
            ? '移除服务项'
            : change.type === 'materials' ? '保存项目材料' : '保存服务项',
        change.type === 'save'
          ? change.item.serviceName
          : (previous.items?.find((item) => item.id === change.id)
              ?.serviceName ?? ''),
      );
    },
  ).then((project) => projectForActor(project, actor));
}

export async function saveProjectSupplement(
  id: string,
  revision: number,
  input: ProjectSupplementInput,
  actor: OperationActor,
) {
  const directory = await savedProjectDirectory();
  assertActiveProjectActor(actor, directory);
  return updateLocalReference<ServiceProjectRecord>(
    `${prefix}${id}`,
    (previous) => {
      if (!previous) throw new Error('项目不存在，请刷新后重试。');
      previous = normalizeServiceProjectStatus(previous);
      if (previous.revision !== revision)
        throw new Error('项目已被更新，请重新打开详情后重试。');
      const updated = addProjectSupplement(previous, actor, input, directory.users, directory);
      return appendProjectActivity(
        updated,
        actor,
        '补充信息',
        '发布补充信息',
        '',
        updated.updatedAt,
        updated.supplements!.at(-1)!.externalVisible,
      );
    },
  ).then((project) => projectForActor(project, actor));
}

export async function readServiceProjects(
  actor: OperationActor,
): Promise<ServiceProjectRecord[]> {
  const directory = await savedProjectDirectory();
  assertActiveProjectActor(actor, directory);
  const requests = await readLocal<ServiceRequest>('requests');
  const rows = await readLocal<{ id: string; payload: ServiceProjectRecord }>(
    'references',
  );
  return rows
    .filter((row) => row.id === `${prefix}${row.payload?.id}`)
    .map((row) => normalizeServiceProjectStatus(row.payload))
    .filter((project) => canViewServiceProject(actor, project))
    .map((project) => projectForActor(withProjectAssignmentRoles(project, directory, requests.find(request => request.id === project.sourceServiceRequestId)), actor))
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    );
}

async function savedProjectDirectory() {
  const rows = await readLocal<{
    id: string;
    payload?: Partial<ProjectCollaboratorDirectory> & {
      customers?: CustomerRef[];
    };
  }>('references');
  const workspace = rows.find((row) => row.id === 'workspace')?.payload;
  return {
    customers: workspace?.customers ?? [],
    partners: workspace?.partners ?? [],
    contacts: workspace?.contacts ?? [],
    users: workspace?.users ?? [],
    partnerUsers: workspace?.partnerUsers ?? [],
  };
}

async function savedProjectCustomFields() {
  const rows = await readLocal<{ id: string; payload: { projectFields?: RequestField[] } }>('references');
  return normalizeProjectFields(rows.find(row => row.id === 'workspace')?.payload?.projectFields).filter(field => !isSystemProjectField(field.id));
}

export async function createStoredServiceProject(
  input: ServiceProjectInput,
  actor: OperationActor,
  collaborators: ProjectCollaborators = {},
  items: RequestItem[] = [],
  creatorId?: string,
) {
  const directory = await savedProjectDirectory();
  assertActiveProjectActor(actor, directory);
  const creator = creatorId && creatorId !== actor.id
    ? isDemoAdministrator(actor, directory.users) && operationIdentities(directory.users, directory).find(person => person.id === creatorId)
    : actor;
  if (!creator || !canManageServiceProjects(creator)) throw new Error('当前身份不能创建项目，或代发起用户不可用。');
  if (projectItemAudience(creator) === 'partner') {
    if (collaborators.internal?.length) throw new Error('合作伙伴不能指定 SmartX 协作人。');
    const provider = ownProjectServiceProvider(creator.id, directory.partners, directory.partnerUsers);
    if (!provider) throw new Error('所属合作伙伴不可用，无法创建项目。');
    if (input.serviceProviderId && input.serviceProviderId !== provider.id) throw new Error('合作伙伴创建项目时，服务方只能是自己所属企业。');
    input = { ...input, serviceProviderId: provider.id };
  }
  validateCustomValues(input.customValues, await savedProjectCustomFields());
  const itemContext = items.length ? await readProjectItemContext() : undefined;
  const project = {
    ...newServiceProject(input, creator, directory.customers, directory.partners),
    items: itemContext
      ? items.map((item) =>
          prepareProjectItem(
            item,
            input.customerId,
            itemContext,
            projectItemAudience(creator),
          ),
        )
      : [],
    ...(creator.id !== actor.id ? { createdViaAdmin: { id: actor.id!, name: actor.name } } : {}),
    collaboratorAssignmentsVersion: 1 as const,
    collaborators: assignInitialProjectCollaborators(input.customerId, creator, directory, resolveProjectCollaborators(
      input.customerId,
      collaborators,
      directory,
      input.serviceProviderId,
    )),
  };
  return updateLocalReference<ServiceProjectRecord>(
    `${prefix}${project.id}`,
    (previous) => {
      if (previous) throw new Error('项目编号重复，请重试。');
      return appendProjectActivity(
        project,
        actor,
        '项目',
        '创建项目',
        project.id,
        project.createdAt,
      );
    },
  );
}

export async function updateStoredServiceProject(
  id: string,
  revision: number,
  input: ServiceProjectInput & { status: ServiceProjectStatus },
  actor: OperationActor,
) {
  const requests = await readLocal<ServiceRequest>('requests');
  const customFields = await savedProjectCustomFields();
  const directory = await savedProjectDirectory();
  assertActiveProjectActor(actor, directory);
  const { customers, partners } = directory;
  return updateLocalReference<ServiceProjectRecord>(
    `${prefix}${id}`,
    (previous) => {
      if (!previous) throw new Error('项目不存在，请刷新后重试。');
      previous = normalizeServiceProjectStatus(previous);
      if (previous.revision !== revision)
        throw new Error('项目已被更新，请关闭详情并刷新列表后重试。');
      previous = withProjectAssignmentRoles(previous, directory, requests.find(request => request.id === previous!.sourceServiceRequestId));
      validateCustomValues(input.customValues, customFields, previous.customValues);
      if (previous.status === '待启动' && input.status === '进行中') throw new Error('请通过“启动项目”生成工单后进入执行阶段。');
      const updated = editServiceProject(
        previous,
        input,
        actor,
        customers,
        partners,
      );
      return appendProjectActivity(
        updated,
        actor,
        '项目',
        '更新项目信息',
        previous.status !== updated.status
          ? `${previous.status} → ${updated.status}`
          : '保存项目基本信息',
        updated.updatedAt,
      );
    },
  ).then((project) => projectForActor(project, actor));
}

export async function saveProjectCollaborators(
  id: string,
  revision: number,
  group: ProjectCollaboratorGroup,
  ids: string[],
  actor: OperationActor,
) {
  const directory = await savedProjectDirectory();
  const requests = await readLocal<ServiceRequest>('requests');
  assertActiveProjectActor(actor, directory);
  return updateLocalReference<ServiceProjectRecord>(
    `${prefix}${id}`,
    (previous) => {
      if (!previous) throw new Error('项目不存在，请刷新后重试。');
      previous = normalizeServiceProjectStatus(previous);
      if (previous.revision !== revision)
        throw new Error('项目已被更新，请重新打开详情后重试。');
      previous = withProjectAssignmentRoles(previous, directory, requests.find(request => request.id === previous!.sourceServiceRequestId));
      return appendProjectActivity(
        editProjectCollaborators(previous, group, ids, actor, directory),
        actor,
        '协作',
        '更新协作人',
        `${group === 'customer' ? '客户' : group === 'internal' ? '内部' : '合作伙伴'}协作人`,
        undefined,
        group !== 'internal',
      );
    },
  ).then((project) => projectForActor(project, actor));
}

export async function saveProjectOperation(
  id: string,
  revision: number,
  action: ProjectOperationAction,
  actor: OperationActor,
) {
  if (action.type === 'worklog-confirm') return confirmStoredProjectWorklogs(id, revision, action, actor);
  assertActiveProjectActor(actor, await savedProjectDirectory());
  const services = action.type === 'worklog-add' || action.type === 'worklog-edit'
    ? (await readProjectItemContext()).services : [];
  return updateLocalReference<ServiceProjectRecord>(
    `${prefix}${id}`,
    (previous) => {
      if (!previous) throw new Error('项目不存在，请刷新后重试。');
      previous = normalizeServiceProjectStatus(previous);
      if (previous.revision !== revision)
        throw new Error('项目已被更新，请重新打开详情后重试。');
      return applyProjectOperation(previous, action, actor, new Date().toISOString(), services);
    },
  ).then((project) => projectForActor(project, actor));
}

/** Project termination and its share of the request reservation commit together. */
export async function cancelStoredServiceProject(id: string, revision: number, reason: string, actor: OperationActor) {
  const db = await openDatabase();
  try {
    return await new Promise<ServiceProjectRecord>((resolve, reject) => {
      const transaction = db.transaction(['requests', 'references'], 'readwrite');
      const references = transaction.objectStore('references');
      const requests = transaction.objectStore('requests');
      const projectRead = references.get(`${prefix}${id}`);
      const workspaceRead = references.get('workspace');
      const requestsRead = requests.getAll();
      let pending = 3;
      let result: ServiceProjectRecord;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error ?? new Error('取消未保存，请重试。'));
      transaction.onerror = () => reject(transaction.error ?? new Error('取消失败，请重试。'));
      const commit = () => {
        if (--pending) return;
        try {
          let previous = projectRead.result?.payload as ServiceProjectRecord | undefined;
          if (!previous) throw new Error('项目不存在，请刷新后重试。');
          previous = normalizeServiceProjectStatus(previous);
          if (previous.revision !== revision) throw new Error('项目已被更新，请刷新后重新取消。');
          assertActiveProjectActor(actor, { partners: workspaceRead.result?.payload?.partners ?? [], partnerUsers: workspaceRead.result?.payload?.partnerUsers ?? [] });
          const users = workspaceRead.result?.payload?.users ?? [];
          const source = (requestsRead.result as ServiceRequest[]).find(request => request.id === previous.sourceServiceRequestId);
          const cancelled = cancelServiceProject(previous, actor, users, reason, source);
          result = cancelled.project;
          if (workspaceRead.result?.payload) {
            const workspace = workspaceRead.result.payload;
            references.put({ ...workspaceRead.result, payload: { ...workspace,
              assets: (workspace.assets ?? []).map((asset: import('./request-operations').RequestAsset) => (asset.projectReservations?.some(row => row.projectId === id) ? { ...asset, projectReservations: asset.projectReservations.filter(row => row.projectId !== id) } : asset)),
              businessObjects: (workspace.businessObjects ?? []).map((object: ObjectRef) => (object.projectReservations?.some(row => row.projectId === id) ? { ...object, projectReservations: object.projectReservations.filter(row => row.projectId !== id) } : object)),
            } });
          }
          if (cancelled.source) requests.put(cancelled.source);
          references.put({ id: `${prefix}${id}`, payload: result });
        } catch (error) { reject(error); transaction.abort(); }
      };
      projectRead.onsuccess = commit;
      workspaceRead.onsuccess = commit;
      requestsRead.onsuccess = commit;
    });
  } finally { db.close(); }
}

export async function saveCustomerProjectSupplement(
  id: string,
  revision: number,
  input: ProjectSupplementInput,
  actor: OperationActor,
) {
  const directory = await savedProjectDirectory();
  if (!customerProjectOrganization(actor, directory))
    throw new Error('客户联系人或所属企业不可用，请切换有效身份。');
  const project = await updateLocalReference<ServiceProjectRecord>(`${prefix}${id}`, previous => {
    if (!previous || !canViewCustomerProject(previous, actor, directory))
      throw new Error('项目不存在或你已不在该项目的客户协作人名单中。');
    previous = normalizeServiceProjectStatus(previous);
    if (previous.revision !== revision)
      throw new Error('项目已被更新，请刷新后重试。');
    const contact = directory.contacts.find(person => person.id === actor.id)!;
    const author = { ...actor, name: contact.name };
    const updated = addProjectSupplement(previous, author, { ...input, externalVisible: true }, directory.users, directory);
    return appendProjectActivity(updated, author, '补充信息', '发布补充信息', '', updated.updatedAt, true);
  });
  return customerServiceProject(project, directory);
}

export async function readCustomerServiceProjects(actor: OperationActor) {
  const rows = await readLocal<{ id: string; payload: unknown }>('references');
  const workspace = rows.find(row => row.id === 'workspace')?.payload as Partial<CustomerProjectDirectory> | undefined;
  const directory: CustomerProjectDirectory = { contacts: workspace?.contacts ?? [], customers: workspace?.customers ?? [],
    users: workspace?.users ?? [], partners: workspace?.partners ?? [], partnerUsers: workspace?.partnerUsers ?? [] };
  if (!customerProjectOrganization(actor, directory)) throw new Error('客户联系人或所属企业不可用，请切换有效身份。');
  return rows.filter(row => row.id === `${prefix}${(row.payload as ServiceProjectRecord)?.id}`)
    .map(row => normalizeServiceProjectStatus(row.payload as ServiceProjectRecord))
    .filter(project => canViewCustomerProject(project, actor, directory))
    .map(project => customerServiceProject(project, directory))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function confirmStoredProjectWorklogs(id: string, revision: number, action: Extract<ProjectOperationAction, { type: 'worklog-confirm' }>, actor: OperationActor): Promise<ServiceProjectRecord> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction('references', 'readwrite'), refs = tx.objectStore('references'), read = refs.getAll();
    let result: ServiceProjectRecord;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('工时确认未保存。'));
    tx.onerror = () => reject(tx.error);
    read.onsuccess = () => {
      try {
        const rows = read.result as { id: string; payload: any }[];
        const workspace = rows.find(row => row.id === 'workspace')?.payload;
        const user = workspace?.users?.find((entry: { id: string; status: string }) => entry.id === actor.id && entry.status === '启用');
        if (!user || fixedIdentityRoles[actor.id] !== actor.role) throw new Error('仅已启用的项目经理或系统管理员可确认工时。');
        const project = rows.find(row => row.id === `${prefix}${id}`)?.payload as ServiceProjectRecord | undefined;
        if (!project || project.revision !== revision) throw new Error('项目已被更新，请重新打开详情后重试。');
        result = applyProjectOperation(project, action, { ...actor, name: user.name });
        refs.put({ id: `${prefix}${id}`, payload: result });
      } catch (error) { tx.abort(); reject(error); }
    };
  }); } finally { db.close(); }
}

/** Re-read both permissions and project state in the same transaction. */
export async function saveServiceProjectSuspension(id: string, revision: number, action: 'pause' | 'resume', actor: OperationActor, reason = '') {
  const db = await openDatabase();
  try {
    return await new Promise<ServiceProjectRecord>((resolve, reject) => {
      const tx = db.transaction('references', 'readwrite');
      const refs = tx.objectStore('references');
      const projectRead = refs.get(`${prefix}${id}`), workspaceRead = refs.get('workspace');
      let pending = 2, result: ServiceProjectRecord;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('项目状态未保存，请重试。'));
      tx.onerror = () => reject(tx.error ?? new Error('项目状态保存失败。'));
      const commit = () => {
        if (--pending) return;
        try {
          const previous = projectRead.result?.payload as ServiceProjectRecord | undefined;
          if (!previous) throw new Error('项目不存在，请重新打开。');
          if (previous.revision !== revision) throw new Error('项目已被更新，请重新打开后再操作。');
          assertActiveProjectActor(actor, { partners: workspaceRead.result?.payload?.partners ?? [], partnerUsers: workspaceRead.result?.payload?.partnerUsers ?? [] });
          result = changeServiceProjectSuspension(normalizeServiceProjectStatus(previous), actor, workspaceRead.result?.payload?.users ?? [], action, undefined, reason);
          refs.put({ id: `${prefix}${id}`, payload: result });
        } catch (error) { reject(error); tx.abort(); }
      };
      projectRead.onsuccess = commit; workspaceRead.onsuccess = commit;
    });
  } finally { db.close(); }
}
