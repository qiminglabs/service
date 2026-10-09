import { activityMessage, activityList, activityLabel, type ActivityText } from './activity-events.ts';
import type { RequestField } from '../components/request-field-settings';
import { snapshotWorkOrderForm, workOrderField, workOrderFieldValue } from './work-order-form.ts';
import {
  projectCollaboratorOptions,
  type ProjectCollaboratorDirectory,
  type ProjectCollaboratorGroup,
} from './service-project-collaborators.ts';
import type { OperationActor } from './request-operations';
import type { ServiceProjectRecord } from './service-projects';
import {
  canExecuteSpecificWorkOrder,
  type ServiceWorkOrder,
} from './service-work-orders.ts';
import { projectScheduleIssue } from './service-project-dates.ts';
import {
  addressComplete,
  addressLabel,
  readAddress,
  writeAddress,
} from './request-address.ts';
import { itemBasicIssues, requestFieldIsVisible, requestFieldIsRequired } from './service-requests.ts';
import { appendProjectActivity } from './service-project-activity.ts';

export type WorkOrderBasicInfoInput = {
  orderId: string;
  expectedServiceDate: string;
  plannedCompletionDate: string;
  address?: string;
  values?: Record<string, string>;
  method?: string;
  description: string;
  contact?: { id: string; group: ProjectCollaboratorGroup } | null;
};
export function workOrderContactOptions(
  project: ServiceProjectRecord,
  directory: ProjectCollaboratorDirectory,
) {
  const available = projectCollaboratorOptions(
    project.customerId,
    directory,
    project.serviceProviderId,
  );
  return (['customer', 'internal', 'partner'] as const).flatMap((group) =>
    available[group]
      .filter((person) =>
        project.collaborators?.[group]?.some(
          (member) => member.id === person.id,
        ),
      )
      .map((person) => ({
        id: person.id,
        group,
        name: person.name,
        phone:
          (group === 'customer'
            ? directory.contacts
            : group === 'internal'
              ? directory.users
              : directory.partnerUsers
          )
            .find((user) => user.id === person.id)
            ?.phone?.trim() ?? '',
      })),
  );
}
export function canEditWorkOrderBasicInfo(
  project: ServiceProjectRecord,
  order: ServiceWorkOrder,
  actor: OperationActor,
) {
  return (
    ['待执行', '进行中'].includes(order.status) &&
    [
      'SmartX 项目经理',
      'SmartX 系统管理员',
      '合作伙伴服务工程师',
      'SmartX 服务工程师',
    ].includes(actor.role) &&
    canExecuteSpecificWorkOrder(project, order, actor)
  );
}
export function workOrderAddressRequired(order: ServiceWorkOrder) {
  return (
    order.item.config.fields.includes('address') &&
    requestFieldIsRequired(
      order.item.config,
      'address',
      order.item.method,
      order.item.values,
    )
  );
}
export function editWorkOrderBasicInfo(
  project: ServiceProjectRecord,
  actor: OperationActor,
  input: WorkOrderBasicInfoInput,
  directory: ProjectCollaboratorDirectory,
  now = new Date().toISOString(),
  directoryFields: RequestField[] = [],
): ServiceProjectRecord {
  const order = project.workOrders?.find((order) => order.id === input.orderId);
  if (!order) throw new Error('工单不存在。');
  if (!canEditWorkOrderBasicInfo(project, order, actor))
    throw new Error('当前身份或工单状态不允许编辑基本信息。');
  const issue = projectScheduleIssue(input, true);
  if (issue) throw new Error(issue);
  if (typeof input.description !== 'string' || input.description.length > 60000)
    throw new Error('服务说明格式无效或超过 60000 字。');
  let item = { ...order.item, values: { ...order.item.values } };
  if (input.method !== undefined) {
    if (typeof input.method !== 'string' || input.method.length > 60000) throw new Error('服务方式格式无效。');
    const methodType = workOrderField(item, 'method').type;
    item = { ...item, method: input.method.trim(), methodFieldType: methodType === 'lookup' || methodType === 'address' ? 'single' : methodType };
    if (itemBasicIssues(item).includes('服务方式')) throw new Error('请选择或填写有效的服务方式。');
    if (methodType === 'date') {
      const date = new Date(`${item.method}T00:00:00Z`);
      if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== item.method) throw new Error('服务方式须为有效日期。');
    }
  }
  if (input.values !== undefined || input.method !== undefined) {
    if (input.values !== undefined && (!input.values || typeof input.values !== 'object' || Array.isArray(input.values))) throw new Error('动态字段格式无效。');
    const submittedValues = input.values ?? {};
    const ids = item.config.fields.filter(id => !['method', 'description', 'businessObjects'].includes(id));
    for (const id of Object.keys(submittedValues)) {
      if (!ids.includes(id)) throw new Error('不能修改工单表单配置以外的字段。');
      if (typeof submittedValues[id] !== 'string' || submittedValues[id].length > 60000) throw new Error('动态字段格式无效或超过 60000 字。');
    }
    item = snapshotWorkOrderForm(item, directoryFields);
    item.values = { ...item.values, ...submittedValues };
    for (const id of ids) {
      if (!requestFieldIsVisible(item.config, id, item.method, item.values)) {
        delete item.values[id];
        continue;
      }
      const field = workOrderField(item, id);
      const value = (item.values[id] ?? '').trim();
      const required = requestFieldIsRequired(item.config, id, item.method, item.values);
      if (!value || value === '[]') {
        if (required) throw new Error(`请填写${field.name}。`);
        item.values[id] = '';
        continue;
      }
      if (field.type === 'address') {
        if (value.length > 2000 || !addressComplete(value)) throw new Error(`请填写完整的${field.name}。`);
        item.values[id] = writeAddress(readAddress(value));
      } else if (field.type === 'integer') {
        if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || (id === 'nodes' && Number(value) <= 0))
          throw new Error(`${field.name}须为${id === 'nodes' ? '正' : ''}整数。`);
      } else if (field.type === 'decimal') {
        if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`${field.name}须为有效数字。`);
      } else if (field.type === 'date') {
        const date = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${field.name}须为有效日期。`);
      } else if (field.type === 'single' && !field.options.some(option => option.value === value) && value !== order.item.values[id]) {
        throw new Error(`请选择${field.name}中的有效选项。`);
      } else if (field.type === 'multiple') {
        let selected: unknown;
        try { selected = JSON.parse(value); } catch { selected = value === order.item.values[id] ? [value] : null; }
        if (!Array.isArray(selected) || selected.some(entry => typeof entry !== 'string' || !field.options.some(option => option.value === entry)) && value !== order.item.values[id]) throw new Error(`请选择${field.name}中的有效选项。`);
        item.values[id] = JSON.stringify([...new Set(selected)]);
      }
    }
  } else if (input.address !== undefined) {
    // Compatibility for callers that predate configurable work-order fields.
    if (typeof input.address !== 'string' || input.address.length > 2000) throw new Error('地址格式无效或超过 2000 字。');
    const address = writeAddress(readAddress(input.address));
    if ((workOrderAddressRequired(order) || address) && !addressComplete(address)) throw new Error('请填写详细地址。');
    item.values.address = address;
  }
  const description = item.config.basicFields?.description?.enabled === false ? order.item.description : input.description.trim();
  if (item.config.basicFields?.description?.enabled !== false && item.config.basicFields?.description?.required !== false && !description)
    throw new Error('请填写服务说明。');
  item.description = description;
  const selected = input.contact
    ? workOrderContactOptions(project, directory).find(
        (person) =>
          person.id === input.contact!.id &&
          person.group === input.contact!.group,
      )
    : undefined;
  if (input.contact && !selected)
    throw new Error('所选联系人已不在项目协作人中或已停用，请重新选择。');
  const contactRef =
    input.contact === undefined
      ? order.contactRef
      : selected
        ? { id: selected.id, group: selected.group }
        : undefined;
  const contactName =
    input.contact === undefined
      ? (order.contactName ?? '')
      : (selected?.name ?? '');
  const contactPhone =
    input.contact === undefined
      ? (order.contactPhone ?? '')
      : (selected?.phone ?? '');
  const changes: ActivityText[] = [];
  for (const [label, before, after] of [
    ['计划执行日期', order.expectedServiceDate, input.expectedServiceDate],
    ['计划完成日期', order.plannedCompletionDate, input.plannedCompletionDate],
    [
      '地址',
      addressLabel(order.item.values.address ?? ''),
      addressLabel(item.values.address ?? ''),
    ],
    ['现场联系人', order.contactName, contactName],
    ['联系电话', order.contactPhone, contactPhone],
  ])
    if ((before ?? '') !== after)
      changes.push(activityMessage('{0}：{1} → {2}', [activityLabel(String(label)), before || activityMessage('未填写'), after || activityMessage('未填写')]));
  for (const id of item.config.fields.filter(id => !['address', 'method', 'description', 'businessObjects'].includes(id))) {
    if ((order.item.values[id] ?? '') !== (item.values[id] ?? '')) changes.push(activityMessage('{0}：{1} → {2}', [activityLabel(workOrderField(item, id).name), workOrderFieldValue(order.item, id), workOrderFieldValue(item, id)]));
  }
  if (order.item.method !== item.method) changes.push(activityMessage('服务方式：{0} → {1}', [activityLabel(workOrderFieldValue(order.item, 'method')), activityLabel(workOrderFieldValue(item, 'method'))]));
  if (order.item.description !== description) changes.push(activityMessage('服务说明已更新'));
  if (
    order.contactRef?.id !== contactRef?.id ||
    order.contactRef?.group !== contactRef?.group
  )
    changes.push(activityMessage('现场联系人关联已更新'));
  if (!changes.length) return project;
  const updated: ServiceWorkOrder = {
    ...order,
    expectedServiceDate: input.expectedServiceDate,
    plannedCompletionDate: input.plannedCompletionDate,
    contactRef,
    contactName,
    contactPhone,
    updatedAt: now,
    item,
  };
  return appendProjectActivity(
    {
      ...project,
      revision: project.revision + 1,
      updatedAt: now,
      workOrders: project.workOrders!.map((entry) =>
        entry.id === order.id ? updated : entry,
      ),
    },
    actor,
    '工单',
    activityMessage("编辑工单基本信息"),
    activityMessage("{0}；{1}", [order.id, activityList(changes, '；')]),
    now,
    false,
  );
}
