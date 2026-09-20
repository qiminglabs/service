import { demoServiceExecution } from './demo-service-execution.ts';
import { buildRequestSamples } from './demo-service-requests.ts';
import { openDatabase,defaultConfig,resolveRequestConfig,customerRequestConfigId,partnerRequestConfigId } from './service-requests.ts';
import type { CustomerRef, InternalUser } from './service-requests';
import { ensureConversionHistory } from './entitlement-conversions.ts';
import { requestFormOrder } from './request-form-layout.ts';
import { demoReportingUsers, demoWorkflowRuleReferences } from './demo-workflow-rules.ts';
import { buildProjectSamples } from './demo-service-projects.ts';
import { serviceMailTemplatesId, parseMailConfig } from './service-mail-templates.ts';
import { initialProjectApprovalRules, projectApprovalRulesId } from './approval-scope.ts';

export function initializeCustomerOwners<T extends CustomerRef>(customers: T[], users: InternalUser[]): T[] {
  const sales = users.find(user => user.status === '启用' && /销售/.test(user.department));
  return customers.map(customer => customer.ownerUserId && users.some(user => user.id === customer.ownerUserId && user.status === '启用')
    ? customer : sales ? { ...customer, ownerUserId: sales.id } : customer);
}

type InitialWorkspace = Parameters<typeof buildRequestSamples>[0] & {
  requestFields?: { id: string; name: string; options?: Array<string | { value: string; enabled: boolean }> }[];
};

export const requestedDemoResetMarker = 'demo-reset-2026-09-20-service-reports-v3';

// Call only for an explicitly requested reset. Validate/build first;
// then replace this application's three stores in a single rollback-safe commit.
export async function resetLocalDemoData<T extends InitialWorkspace>(initial: T, onlyIfNeeded = false) {
  const workspace = structuredClone(initial);
  workspace.users = demoReportingUsers(workspace.users);
  workspace.customers = initializeCustomerOwners(workspace.customers, workspace.users);
  if (workspace.customers.some(customer => !customer.ownerUserId))
    throw new Error('初始化失败：客户缺少可分配的销售经理。');
  const configs = workspace.services.map(service => {
    const config = structuredClone(defaultConfig(service));
    for (const field of workspace.requestFields ?? []) {
      config.fieldNames[field.id] = field.name;
      config.fieldOptions[field.id] = (field.options ?? []).flatMap(option =>
        typeof option === 'string' ? [option] : option.enabled ? [option.value] : []);
    }
    const removedFields = new Set(['version', 'productForm', 'tibCount', 'clusterCount', 'instanceCount']);
    config.fields = config.fields.filter(id => !removedFields.has(id));
    config.fieldOrder = config.fieldOrder?.filter(id => !removedFields.has(id));
    for (const id of removedFields) {
      delete config.fieldOptions[id];
      delete config.fieldNames[id];
      delete config.fieldRequired?.[id];
    }
    const resolved = resolveRequestConfig(service, [config]);
    resolved.fields = [...resolved.fields.filter(id => id !== 'address'), 'address'];
    resolved.fieldNames.address = '地址';
    resolved.fieldRequired = { ...resolved.fieldRequired, address: false };
    resolved.fieldRequiredWhen = { ...resolved.fieldRequiredWhen, address: 'onsite' };
    resolved.basicFields = { ...resolved.basicFields, description: { enabled: true, required: false } };
    resolved.fieldOrder = [...requestFormOrder(resolved).filter(id => !['description', 'address'].includes(id)), 'description', 'address'];
    resolved.fieldWidths = { ...resolved.fieldWidths, description: 'half', address: 'half' };
    resolved.fieldRowStarts = ['description'];
    return resolved;
  });
  const now = new Date();
  const execution = demoServiceExecution(workspace, new Date(now.getTime() - 2 * 86400000).toISOString());
  const references: { id: string; payload: unknown }[] = [...new Map([
    { id: requestedDemoResetMarker, payload: { initializedAt: new Date().toISOString() } },
    { id: serviceMailTemplatesId, payload: parseMailConfig(undefined) },
    { id: 'workspace', payload: { ...workspace, customerOwnersInitialized: true } },
    ...configs.flatMap(config => [customerRequestConfigId(config.serviceId), partnerRequestConfigId(config.serviceId)].map(id => ({ id, payload: structuredClone(config) }))),
    ...(['inspection', 'upgrade'] as const).map(kind => ({ id: `entitlement-conversion-${kind}`, payload: ensureConversionHistory(undefined) })),
    ...demoWorkflowRuleReferences(workspace),
    ...execution.references,
  ].map(reference => [reference.id, reference])).values()];
  const projectApprovalRules = initialProjectApprovalRules(references);
  const generated = buildProjectSamples(workspace, buildRequestSamples(workspace, [], configs, references, now, true), now, execution.config, projectApprovalRules);
  const samples = generated.requests;
  const workspaceReference = references.find(row => row.id === 'workspace')!;
  workspaceReference.payload = { ...workspace, customerOwnersInitialized: true, assets: generated.assets, businessObjects: generated.businessObjects };
  references.push({ id: projectApprovalRulesId, payload: projectApprovalRules });
  references.push(...generated.projects.map(project => ({ id: `service-project:${project.id}`, payload: project })));
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['requests', 'configs', 'references'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('初始化未完成，原数据已保留。'));
      tx.onerror = () => reject(tx.error);
      const replace = () => {
        try {
          const requests = tx.objectStore('requests');
          const settings = tx.objectStore('configs');
          const refs = tx.objectStore('references');
          requests.clear(); settings.clear(); refs.clear();
          samples.forEach(record => requests.add(record));
          configs.forEach(record => settings.add(record));
          references.forEach(record => refs.add(record));
        } catch (error) { tx.abort(); reject(error); }
      };
      if (onlyIfNeeded) {
        const marker = tx.objectStore('references').get(requestedDemoResetMarker);
        marker.onsuccess = () => { if (!marker.result) replace(); };
      } else replace();
    });
  } finally {
    db.close();
  }
}
