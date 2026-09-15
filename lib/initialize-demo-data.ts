import { demoSubmissionRuleReferences } from './demo-submission-rules.ts';
import { buildRequestSamples, requestSamplesMarker, presalesRequestSamplesMarker } from './demo-service-requests.ts';
import { openDatabase, defaultConfig, resolveRequestConfig, customerRequestConfigId } from './service-requests.ts';
import type { CustomerRef, InternalUser } from './service-requests';
import { ensureConversionHistory } from './entitlement-conversions.ts';
import { requestFormOrder } from './request-form-layout.ts';
import { demoReportingUsers, demoWorkflowRuleReferences } from './demo-workflow-rules.ts';
import { ruleBasedRequestSamplesMarker } from './reinitialize-request-samples.ts';

export function initializeCustomerOwners<T extends CustomerRef>(customers: T[], users: InternalUser[]): T[] {
  const sales = users.find(user => user.status === '启用' && /销售/.test(user.department));
  return customers.map(customer => customer.ownerUserId && users.some(user => user.id === customer.ownerUserId && user.status === '启用')
    ? customer : sales ? { ...customer, ownerUserId: sales.id } : customer);
}

type InitialWorkspace = Parameters<typeof buildRequestSamples>[0] & {
  requestFields?: { id: string; name: string; options?: Array<string | { value: string; enabled: boolean }> }[];
};

// Call only for an explicitly requested reset. Validate/build first;
// then replace this application's three stores in a single rollback-safe commit.
export async function resetLocalDemoData<T extends InitialWorkspace>(initial: T) {
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
    const removedFields = new Set(['version', 'productForm', 'tibCount', 'clusterCount', 'instanceCount', 'expectedProvider']);
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
  const references = [...new Map([
    ...demoSubmissionRuleReferences([]),
    { id: 'workspace', payload: { ...workspace, customerOwnersInitialized: true } },
    ...configs.map(config => ({ id: customerRequestConfigId(config.serviceId), payload: structuredClone(config) })),
    ...(['inspection', 'upgrade'] as const).map(kind => ({ id: `entitlement-conversion-${kind}`, payload: ensureConversionHistory(undefined) })),
    { id: requestSamplesMarker, payload: { initializedAt: new Date().toISOString() } },
    ...demoWorkflowRuleReferences(workspace),
    { id: ruleBasedRequestSamplesMarker, payload: { initializedAt: new Date().toISOString() } },
    { id: presalesRequestSamplesMarker, payload: { initializedAt: new Date().toISOString() } },
  ].map(reference => [reference.id, reference])).values()];
  const samples = buildRequestSamples(workspace, [], configs, references, new Date(), true);
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['requests', 'configs', 'references'], 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('初始化未完成，原数据已保留。'));
      tx.onerror = () => reject(tx.error);
      try {
        const requests = tx.objectStore('requests');
        const settings = tx.objectStore('configs');
        const refs = tx.objectStore('references');
        requests.clear();
        settings.clear();
        refs.clear();
        samples.forEach(record => requests.add(record));
        configs.forEach(record => settings.add(record));
        references.forEach(record => refs.add(record));
      } catch (error) {
        tx.abort();
        reject(error);
      }
    });
  } finally {
    db.close();
  }
}
