import {
  businessObjectsEnabled, matchesObjectProduct, newItem, newRequest, openDatabase,
  requestIssues, resolveRequestConfig, serviceAvailableForRequest, withRequestContact,
} from './service-requests.ts';
import type { CatalogService, ContactRef, CustomerRef, InternalUser, ObjectRef, RequestConfig, ServiceRequest } from './service-requests';
import { operationIdentities } from './internal-users.ts';
import { appendActivity } from './request-operations.ts';
import type { OperationActor, RequestAsset } from './request-operations';
import { applyAssessmentAction, assessmentOf, currentPlan, gapApproverOptions, planGap } from './request-assessment.ts';
import type { AssessmentAction } from './request-assessment';
import { entitlementPricingContext } from './request-pricing.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';

type Sources = {
  services: CatalogService[];
  customers: CustomerRef[];
  contacts: ContactRef[];
  businessObjects: ObjectRef[];
  users: InternalUser[];
  assets: RequestAsset[];
};
type Reference = { id: string; payload?: unknown };
export const requestSamplesMarker = 'service-request-samples-v1';

// Build actual workflow snapshots, not status-only placeholders. Existing records
// participate in reservation calculations but are never changed by initialization.
export function buildRequestSamples(sources: Sources, existing: ServiceRequest[], configs: RequestConfig[] = [], references: Reference[] = [], now = new Date()) {
  const identities = operationIdentities(sources.users);
  const manager = identities.find(person => person.role === 'SmartX 项目经理');
  const sales = identities.find(person => person.role === 'SmartX 销售经理'
    && sources.users.some(user => user.id === person.id && /销售/.test(user.department)));
  if (!manager || !sales) throw new Error('初始化样例需要启用的项目经理和销售经理。');
  const catalogs = sources.services.filter(service => serviceAvailableForRequest(service, 'internal')
    && service.deliveryMethods.some(method => ['远程', '现场'].includes(method)));
  const days = catalogs.find(service => service.priceUnit === '服务人天');
  const upgrade = catalogs.find(service => service.priceUnit === '升级权益');
  const inspection = catalogs.find(service => service.priceUnit === '巡检权益');
  if (!days || !upgrade || !inspection) throw new Error('初始化样例需要启用的人天、升级权益及巡检权益目录。');
  const selections = [[days], [days, inspection], [days, upgrade, inspection], [days, upgrade], [inspection]];
  const titles = ['平台建设服务准备', '集群维护与巡检申请', '集群升级及综合巡检', '平台建设与升级交付', '季度巡检计划调整'];
  const states: ServiceRequest['status'][] = ['草稿', '待评估', '待确认', '待受理', '已取消'];
  const result: ServiceRequest[] = [];
  for (let index = 0; index < selections.length; index++) {
    const id = `SR-DEMO-${String(index + 1).padStart(3, '0')}`;
    if (existing.some(record => record.id === id)) continue;
    const selected = selections[index];
    const eligible = sources.customers.filter(customer => customer.status === '启用'
      && sources.contacts.some(contact => contact.customerId === customer.id && contact.status === '启用')
      && selected.every(service => {
        const config = resolveRequestConfig(service, configs);
        return !businessObjectsEnabled(config) || !config.basicFields?.businessObjects?.required
          || sources.businessObjects.some(object => object.customerId === customer.id && object.status === '启用' && matchesObjectProduct(object, config));
      }));
    const customer = eligible[index % eligible.length];
    if (!customer) throw new Error('初始化样例需要有关联联系人及匹配业务对象的有效客户。');
    const contact = sources.contacts.find(person => person.customerId === customer.id && person.status === '启用')!;
    const at = new Date(now.getTime() - (6 - index) * 86400000).toISOString();
    const expected = new Date(now.getTime() + (7 + index * 2) * 86400000).toISOString().slice(0, 10);
    let record = newRequest(`【示例】${titles[index]}`, customer.id, sales.name, contact.id, sales.id, sales.role);
    record = { ...record, id, createdAt: at, updatedAt: at, expectedServiceDate: expected,
      description: '演示数据：用于展示服务申请、材料评估及客户确认流程，不代表真实交付承诺。',
      internalParticipants: [...new Map([sales, manager,
        identities.find(person => person.id === customer.ownerUserId)].filter(Boolean)
        .map(person => [person!.id, { userId: person!.id, name: person!.name }])).values()],
      items: selected.map((service, itemIndex) => {
        const item = newItem(service, resolveRequestConfig(service, configs));
        item.id = `${id}-ITEM-${itemIndex + 1}`;
        item.method = service.deliveryMethods.find(method => ['远程', '现场'].includes(method))!;
        item.description = `申请${service.name}，请核对环境清单、确认维护窗口，并提供实施记录及服务报告。（示例）`;
        const object = sources.businessObjects.find(object => object.customerId === customer.id && object.status === '启用' && matchesObjectProduct(object, item.config));
        item.businessObjectIds = businessObjectsEnabled(item.config) && object ? [object.id] : [];
        item.values = Object.fromEntries(item.config.fields.map(field => [field,
          item.config.fieldOptions[field]?.[0] ?? ({ nodes: String(object?.nodeCount ?? 3), edition: '企业版', version: '6.3.0' }[field] ?? '示例内容')]));
        item.materials = item.config.materials.map(requirement => {
          const content = `# ${requirement.name}（示例）\n\n客户：${customer.name}\n联系人：${contact.name}\n服务：${service.name}\n业务对象：${object?.name ?? '待规划环境'}\n期望服务日期：${expected}\n\n${item.description}\n\n仅用于 Demo，正式服务前需重新核对环境与材料。`;
          const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
          return { requirementId: requirement.id, files: [{ id: `${item.id}-${requirement.id}`, name: `${requirement.name}（示例）.md`, size: blob.size, blob,
            uploadedAt: at, uploadedById: sales.id, uploaderAudience: 'internal' as const }] };
        });
        return item;
      }),
    };
    record = withRequestContact(record, sources.contacts);
    const issues = requestIssues(record, { ...sources, audience: 'internal' });
    if (issues.length) throw new Error(`样例申请校验未通过：${issues.join('、')}`);
    record = appendActivity(record, sales, '提交', '创建示例申请', '本地初始化的演示数据。', at);
    if (index > 0) {
      record = appendActivity({ ...record, status: '待评估', submittedAt: at }, sales, '提交', '提交服务申请', '示例材料已准备，等待项目经理评估。', at);
    }
    if (index === 2 || index === 3) {
      const records = [...existing, ...result];
      const pricing = entitlementPricingContext(references, records);
      pricing.businessObjects = sources.businessObjects;
      // A historical sample retains a real sales identity even if today's customer
      // owner is unconfigured. Never change the user's master data to seed history.
      const owner = identities.find(person => person.id === customer.ownerUserId && person.role === sales.role) ?? sales;
      const historicalCustomers = sources.customers.map(entry => entry.id === customer.id ? { ...entry, ownerUserId: owner.id } : entry);
      let step = 0;
      const act = (action: AssessmentAction, actor: OperationActor = manager) => {
        record = applyAssessmentAction(record, action, actor, sources.assets, sources.users, records,
          new Date(Date.parse(at) + ++step * 3600000).toISOString(), sources.services, historicalCustomers, pricing);
      };
      act({ type: 'review', outcome: '评估通过', scope: record.items.map(item => item.serviceName).join('、'), opinion: '示例环境清单与需求材料已核对，可以进入服务评估。', risks: '正式执行前再次确认维护窗口和备份情况。' });
      act({ type: 'effort', items: record.items.map(item => ({ itemId: item.id,
        estimatedDays: Math.max(2, sources.services.find(service => service.id === item.serviceId)?.defaultQuantity ?? 1) })), note: '演示估算，以实际服务评估为准。' });
      act({ type: 'plan', allocations: [], salesId: owner.id });
      if (planGap(currentPlan(record)) > 0) {
        const approver = gapApproverOptions(sources.users, owner.id, manager.id)[0];
        if (!approver) throw new Error('初始化样例需要有效的额度审批人。');
        act({ type: 'gap-submit', reason: '演示用额度特批，不扣减客户已有人天资产。', approverId: approver.id }, owner);
        act({ type: 'gap-decide', id: assessmentOf(record).approvals.at(-1)!.id, approve: true, note: '同意本次演示额度。' }, approver);
      }
      act({ type: 'confirm', externalNote: '请确认服务范围与期望日期；此记录仅用于流程演示。' });
      if (index === 3) record = applyCustomerDecision(record, { id: contact.id, name: contact.name, role: '客户' }, customer.id, true, '', new Date(Date.parse(record.updatedAt) + 3600000).toISOString());
    }
    if (index === 4) record = appendActivity({ ...record, status: '已取消' }, sales, '提交', '取消服务请求', '客户调整季度维护计划，本次演示申请取消。', at);
    if (record.status !== states[index]) throw new Error('样例状态与流程不一致。');
    result.push(record);
  }
  return result;
}

// Marker and all five requests commit together. This also serializes concurrent
// tabs/React effects and prevents deleted or edited samples from being recreated.
export async function initializeRequestSamples(sources: Sources) {
  const db = await openDatabase();
  try {
    return await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['requests', 'references', 'configs'], 'readwrite');
      const requests = tx.objectStore('requests');
      const refs = tx.objectStore('references');
      const marker = refs.get(requestSamplesMarker);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('初始化服务申请已中止。'));
      tx.onerror = () => reject(tx.error);
      marker.onsuccess = () => {
        if (marker.result) return;
        const records = requests.getAll();
        const references = refs.getAll();
        const configs = tx.objectStore('configs').getAll();
        let pending = 3;
        const finish = () => {
          if (--pending) return;
          try {
            const samples = buildRequestSamples(sources, records.result, configs.result, references.result);
            for (const sample of samples) requests.add(sample);
            refs.add({ id: requestSamplesMarker, payload: { initializedAt: new Date().toISOString() } });
          } catch (error) {
            reject(error);
            tx.abort();
          }
        };
        records.onsuccess = references.onsuccess = configs.onsuccess = finish;
      };
    });
  } finally {
    db.close();
  }
}
