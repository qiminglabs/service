import { demoSubmissionRuleReferences } from './demo-submission-rules.ts';
import { writeAddress } from './request-address.ts';
import {
  businessObjectsEnabled, matchesObjectProduct, newItem, newRequest, openDatabase,
  requestIssues, resolveRequestConfig, serviceAvailableForRequest, withRequestContact,
} from './service-requests.ts';
import type { CatalogService, ContactRef, CustomerRef, InternalUser, ObjectRef, RequestConfig, ServiceRequest } from './service-requests';
import { operationIdentities } from './internal-users.ts';
import { appendActivity, applyRequestAction } from './request-operations.ts';
import { addSupplement } from './request-supplements.ts';
import type { OperationActor, RequestAsset } from './request-operations';
import { applyAssessmentAction, assessmentOf, currentPlan, gapApproverOptions, planGap } from './request-assessment.ts';
import type { AssessmentAction } from './request-assessment';
import { entitlementPricingContext } from './request-pricing.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { assessmentRoutingId } from './assessment-routing-schema.ts';
import { routeAssessmentOnSave } from './assessment-routing.ts';
import { approvalRulesId, readApprovalRulesPayload } from './approval-rules.ts';
import { addSharedMaterialSample, fillSharedSampleMaterials } from './demo-shared-materials.ts';
import { hardwareItems } from './hardware-assessment-trigger.ts';

type Sources = {
  services: CatalogService[];
  customers: CustomerRef[];
  contacts: ContactRef[];
  businessObjects: ObjectRef[];
  users: InternalUser[];
  assets: RequestAsset[];
  partners?: { id: string; name?: string }[];
};
type Reference = { id: string; payload?: unknown };
export const requestSamplesMarker = 'service-request-samples-v1';
export const presalesRequestSamplesMarker = 'request-samples-presales-2026-09-16-v1';

// Build actual workflow snapshots, not status-only placeholders. Existing records
// participate in reservation calculations but are never changed by initialization.
export function buildRequestSamples(sources: Sources, existing: ServiceRequest[], configs: RequestConfig[] = [], references: Reference[] = [], now = new Date(), includeRoutingSamples = false, scope: 'all' | 'presales' = 'all') {
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
  if (includeRoutingSamples || scope === 'presales') {
    const hardware = catalogs.find(service => service.name === '硬件兼容性测试');
    selections.push([hardware ?? days], [hardware ?? days], [days], [days], [days, upgrade]);
    titles.push('硬件兼容性远程评估', '硬件兼容性现场评估', '现场服务逐级审批', '默认审批人分配演示', '缺少汇报人兜底演示');
    states.push('待评估', '待评估', '待确认', '待确认', '待确认');
    selections.push([days, upgrade], [days, upgrade, inspection], [days, inspection]);
    titles.push('共用环境材料－双服务项草稿', '共用环境材料－三服务项评估', '共用环境材料－巡检组合确认');
    states.push('草稿', '待评估', '待确认');
    selections.push([days], [days, inspection], [days, upgrade]);
    titles.push('售前评估－方案评估中', '售前评估－评估已完成', '售前评估转为服务交付－待关联服务依据');
    states.push('待评估', '评估完成', '待评估');
  }
  const routing = references.find(reference => reference.id === assessmentRoutingId)?.payload;
  const storedApprovalRules = references.find(reference => reference.id === approvalRulesId)?.payload;
  const approvalRules = storedApprovalRules !== undefined || includeRoutingSamples ? readApprovalRulesPayload(storedApprovalRules) : undefined;
  const result: ServiceRequest[] = [];
  for (let index = 0; index < selections.length; index++) {
    if (scope === 'presales' && index < 13) continue;
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
    const customer = eligible[(index === 6 ? 1 : index === 9 ? 0 : index) % eligible.length];
    if (!customer) throw new Error('初始化样例需要有关联联系人及匹配业务对象的有效客户。');
    const contact = sources.contacts.find(person => person.customerId === customer.id && person.status === '启用')!;
    const at = new Date(now.getTime() - (selections.length + 1 - index) * 86400000).toISOString();
    const expected = new Date(now.getTime() + (7 + index * 2) * 86400000).toISOString().slice(0, 10);
    const applicant = index === 9 ? identities.find(person => person.role === 'SmartX 系统管理员') ?? sales : sales;
    let record = newRequest(`【示例】${titles[index]}`, customer.id, applicant.name, contact.id, applicant.id, applicant.role);
    record = { ...record, id, createdAt: at, updatedAt: at, expectedServiceDate: expected,
      requestType: index >= 13 ? '售前评估' : '服务交付',
      description: '演示数据：用于展示服务申请、材料评估及客户确认流程，不代表真实交付承诺。',
      internalParticipants: [...new Map([applicant, sales, manager,
        identities.find(person => person.id === customer.ownerUserId)].filter(Boolean)
        .map(person => [person!.id, { userId: person!.id, name: person!.name }])).values()],
      items: selected.map((service, itemIndex) => {
        const item = newItem(service, resolveRequestConfig(service, configs));
        item.id = `${id}-ITEM-${itemIndex + 1}`;
        const preferredMethod = index === 6 || index === 7 ? '现场' : '远程';
        item.method = service.deliveryMethods.includes(preferredMethod) ? preferredMethod : service.deliveryMethods.find(method => ['远程', '现场'].includes(method))!;
        item.description = `申请${service.name}，请核对环境清单、确认维护窗口，并提供实施记录及服务报告。（示例）`;
        const object = sources.businessObjects.find(object => object.customerId === customer.id && object.status === '启用' && matchesObjectProduct(object, item.config));
        item.businessObjectIds = businessObjectsEnabled(item.config) && object ? [object.id] : [];
        const places = [
          { province: '北京市', city: '北京市', detail: '海淀区中关村软件园 A 座 3 层（演示地址）' },
          { province: '上海市', city: '上海市', detail: '浦东新区张江科技园 B 座 5 层（演示地址）' },
          { province: '广东省', city: '深圳市', detail: '南山区科技园 C 座 8 层（演示地址）' },
          { province: '浙江省', city: '杭州市', detail: '西湖区文三路 100 号（演示地址）' },
          { province: '四川省', city: '成都市', detail: '高新区软件园 D 座 6 层（演示地址）' },
        ];
        const partners = (sources.partners ?? []).filter(partner => partner.name);
        const values: Record<string, string> = {
          nodes: String(object?.nodeCount ?? 3), edition: ['基础版', '敏捷版', '标准版', '企业版'][index % 4], version: ['5.0.1', '5.0.2', '5.0.3'][index % 3],
          productForm: index % 2 ? '一体机' : '纯软件', address: writeAddress(places[index % places.length]),
          tibCount: String(24 + index * 16 + itemIndex * 8), instanceCount: String(12 + index * 8 + itemIndex * 4), clusterCount: String(1 + itemIndex),
          expectedProvider: partners[(index + itemIndex) % partners.length]?.name ?? '',
        };
        item.values = Object.fromEntries(item.config.fields.map(field => {
          const options = item.config.fieldOptions[field];
          return [field, options?.length ? options[(index + itemIndex) % options.length] : values[field] ?? '示例内容'];
        }));
        item.materials = item.config.materials.map(requirement => {
          const content = `# ${requirement.name}（示例）\n\n客户：${customer.name}\n联系人：${contact.name}\n服务：${service.name}\n业务对象：${object?.name ?? '待规划环境'}\n期望服务日期：${expected}\n\n${item.description}\n\n仅用于 Demo，正式服务前需重新核对环境与材料。`;
          const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
          return { requirementId: requirement.id, files: [{ id: `${item.id}-${requirement.id}`, name: `${requirement.name}（示例）.md`, size: blob.size, blob,
            uploadedAt: at, uploadedById: sales.id, uploaderAudience: 'internal' as const }] };
        });
        return item;
      }),
    };
    if (index >= 10 && index <= 12) record = addSharedMaterialSample(record, applicant);
    record = fillSharedSampleMaterials(record, applicant);
    record.externalCollaborators = [{ contactId: contact.id, name: contact.name, phone: contact.phone ?? '', email: contact.email ?? '' }];
    const presales = identities.find(person => person.role === 'SmartX 售前工程师');
    if (presales && !record.internalParticipants?.some(person => person.userId === presales.id)) record.internalParticipants = [...(record.internalParticipants ?? []), { userId: presales.id, name: presales.name }];
    record = withRequestContact(record, sources.contacts, sources.customers, sources.users);
    const issues = requestIssues(record, { ...sources, audience: 'internal' });
    if (issues.length) throw new Error(`样例申请校验未通过：${issues.join('、')}`);
    record = appendActivity(record, sales, '提交', '创建示例申请', '本地初始化的演示数据。', at);
    if (states[index] !== '草稿') {
      record = appendActivity({ ...record, status: '待评估', submittedAt: at }, sales, '提交', '提交服务申请', '示例材料已准备，等待项目经理评估。', at);
      if (routing) record = routeAssessmentOnSave(record, undefined, routing, sources.users, at, sources.customers);
    }
    const eventAt = (minutes: number) => new Date(Date.parse(at) + minutes * 60000).toISOString();
    const attachment = (suffix: string, name: string, text: string) => {
      const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
      return { id: `${id}-${suffix}`, name, size: blob.size, blob, uploadedAt: eventAt(2), uploadedById: sales.id, uploaderAudience: 'internal' as const };
    };
    record = addSupplement(record, sales, undefined, {
      id: `${id}-SUPPLEMENT-INTERNAL`, authorId: sales.id, author: sales.name, at: eventAt(2),
      comment: '【演示】已与售前核对服务范围，正式排期前需复核资源清单、备份状态及变更窗口。此条仅内部可见。',
      files: [attachment('ENVIRONMENT-NOTES', '环境核对清单（示例）.md', `# 环境核对清单\n\n客户：${customer.name}\n服务：${selected.map(service => service.name).join('、')}\n\n- 核对集群健康状态\n- 确认备份可恢复\n- 确认维护窗口\n\n仅用于演示。`)], externalVisible: false,
    }, sources.users);
    const customerActor: OperationActor = { id: contact.id, name: contact.name, role: '客户' };
    record = addSupplement(record, customerActor, customer.id, {
      id: `${id}-SUPPLEMENT-CUSTOMER`, authorId: contact.id, author: contact.name, at: eventAt(5),
      comment: `【演示】已确认期望服务日期为 ${expected}。请在实施前一天再次确认维护窗口，我们将安排运维联系人配合。`, files: [], externalVisible: true,
    }, sources.users);
    if (states[index] !== '草稿') {
      record = applyRequestAction(record, { type: 'meeting-create', title: '【演示】需求澄清与环境核对', participantNames: [...new Set([manager.name, sales.name, contact.name])] }, manager, sources.assets, eventAt(10));
      const meetingId = record.operations!.meetings[0].id;
      record = applyRequestAction(record, { type: 'meeting-end', id: meetingId }, manager, sources.assets, eventAt(40));
      record = applyRequestAction(record, { type: 'meeting-materials', id: meetingId, transcript: `【演示会议纪要】\n客户：${customer.name}\n1. 核对服务范围：${selected.map(service => service.name).join('、')}。\n2. 客户负责确认备份状态及维护窗口。\n3. 项目经理跟进服务评估和交付排期。\n待办：正式实施前再次确认环境清单。` }, manager, sources.assets, eventAt(42));
      record = applyRequestAction(record, { type: 'meeting-attachments-add', id: meetingId, files: [attachment('MEETING-NOTES', '需求澄清会议纪要（示例）.md', `# 需求澄清会议纪要\n\n${record.operations!.meetings[0].transcript}`)] }, manager, sources.assets, eventAt(43));
      record = applyRequestAction(record, { type: 'worklog-add', date: at.slice(0,10), startTime: '09:00', endTime: '10:30', category: '需求分析', description: '【演示】核对需求材料、整理风险及服务范围。' }, manager, sources.assets, eventAt(50));
      record = applyRequestAction(record, { type: 'worklog-add', date: at.slice(0,10), startTime: '14:00', endTime: '15:00', category: '客户沟通', description: '【演示】与客户确认维护窗口及服务依据。' }, sales, sources.assets, eventAt(51));
      if (index === 1) record = applyRequestAction(record, { type: 'meeting-schedule', title: '【演示】实施窗口确认会', scheduledDate: expected, scheduledTime: '14:00', durationMinutes: 30 }, manager, sources.assets, eventAt(52));
    }
    if (index >= 14) {
      const records = [...existing, ...result];
      const assignedManager = identities.find(person => person.id === record.operations?.assessment?.managerId) ?? manager;
      const pricing = entitlementPricingContext(references, records);
      pricing.businessObjects = sources.businessObjects;
      let step = 0;
      const act = (action: AssessmentAction, actor: OperationActor = assignedManager) => {
        record = applyAssessmentAction(record, action, actor, sources.assets, sources.users, records,
          new Date(Date.parse(at) + ++step * 3600000).toISOString(), sources.services, sources.customers, pricing);
      };
      if (hardwareItems(record).length) {
        const hardwareManager = identities.find(person => person.id === record.operations?.assessment?.hardware?.reviewerId);
        if (!hardwareManager) throw new Error('售前样例缺少有效的硬件评估负责人。');
        act({ type: 'hardware-review', outcome: '评估通过', opinion: '【演示】已核对硬件兼容性及环境配置，符合售前方案要求。' }, hardwareManager);
      }
      act({ type: 'review', outcome: '评估通过', opinion: '【演示】售前方案与环境材料已核对，服务范围可实施。' });
      act({ type: 'effort', items: record.items.map(item => ({ itemId: item.id,
        estimatedDays: Math.max(2, sources.services.find(service => service.id === item.serviceId)?.defaultQuantity ?? 1) })),
        note: '【演示】售前评估已完成，核定人天作为后续交付依据。' });
      if (index === 15) act({ type: 'convert-to-delivery' });
    }
    if (states[index] === '待确认' || states[index] === '待受理') {
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
          new Date(Date.parse(at) + ++step * 3600000).toISOString(), sources.services, historicalCustomers, pricing, approvalRules);
      };
      act({ type: 'review', outcome: '评估通过', opinion: '示例环境清单与需求材料已核对，可以进入服务评估。' });
      act({ type: 'effort', items: record.items.map(item => ({ itemId: item.id,
        estimatedDays: Math.max(2, sources.services.find(service => service.id === item.serviceId)?.defaultQuantity ?? 1) })), note: '演示估算，以实际服务评估为准。' });
      act({ type: 'plan', allocations: [], salesId: owner.id }, applicant);
      if (planGap(currentPlan(record)) > 0) {
        if (approvalRules) {
          act({ type: 'gap-submit', reason: '演示用特殊审批，按已保存规则依次处理。' }, owner);
          while (assessmentOf(record).approvals.at(-1)?.state === '待审批') {
            const approval = assessmentOf(record).approvals.at(-1)!;
            const approver = identities.find(person => person.id === approval.approverId);
            if (!approver) throw new Error('初始化样例无法确定当前环节的有效审批人。');
            act({ type: 'gap-decide', id: approval.id, approve: true, note: '已核对本环节服务需求，同意本次演示申请。' }, approver);
          }
        } else {
          const approver = gapApproverOptions(sources.users, owner.id, manager.id)[0];
          if (!approver) throw new Error('初始化样例需要有效的额度审批人。');
          act({ type: 'gap-submit', reason: '演示用额度特批，不扣减客户已有人天资产。', approverId: approver.id }, owner);
          act({ type: 'gap-decide', id: assessmentOf(record).approvals.at(-1)!.id, approve: true, note: '同意本次演示额度。' }, approver);
        }
      }
      act({ type: 'confirm', externalNote: '请确认服务范围与期望日期；此记录仅用于流程演示。' }, applicant);
      if (index === 3) record = applyCustomerDecision(record, { id: contact.id, name: contact.name, role: '客户' }, customer.id, true, '', new Date(Date.parse(record.updatedAt) + 3600000).toISOString());
    }
    if (index === 4) record = appendActivity({ ...record, status: '已取消', cancelledFromStatus: '待评估' }, sales, '提交', '取消服务请求', '客户调整季度维护计划，本次演示申请取消。', eventAt(55));
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
      const ruleReferences = refs.getAll();
      ruleReferences.onsuccess = () => {
        try {
          for (const reference of demoSubmissionRuleReferences(ruleReferences.result)) refs.put(reference);
        } catch (error) { reject(error); tx.abort(); }
      };
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
