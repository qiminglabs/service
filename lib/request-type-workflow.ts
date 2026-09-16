import type { InternalUser, ServiceRequest } from './service-requests';
import { canPerformAssessmentRole } from './assessment-routing.ts';
import { routingUsers } from './assessment-routing-schema.ts';
import { appendActivity, operationsOf, type OperationActor } from './request-operations.ts';
import { isDayQuantity } from './day-quantity.ts';
import { requestTypeOf, requestTypes, type RequestType } from './request-types.ts';
import { requestMaterialIssues } from './request-materials.ts';
import { materialFiles } from './service-requests.ts';

const conversionDetail = '技术评估 → 服务交付；沿用评估结论和核定人天，进入服务依据关联。';
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function isDeliveryConversion(next: ServiceRequest, previous?: ServiceRequest): boolean {
  return !!previous && requestTypeOf(previous) === '技术评估' && previous.status === '评估完成'
    && requestTypeOf(next) === '服务交付' && next.status === '待评估';
}

export function deliveryConversionMaterialIssues(record: ServiceRequest): string[] {
  return requestMaterialIssues({ ...record, requestType: '服务交付' });
}

// Completed presales requests may receive additional delivery materials in detail.
export function canSupplementDeliveryMaterials(record: ServiceRequest, actor?: OperationActor): boolean {
  return requestTypeOf(record) === '技术评估' && record.status === '评估完成'
    && !!actor?.id && actor.role === 'SmartX 项目经理'
    && record.operations?.assessment?.managerId === actor.id;
}

// Conversion may add files, but preserves assessed items and existing materials.
export function deliveryConversionItemsIssue(next: ServiceRequest, previous: ServiceRequest): string | null {
  const withoutMaterials = (record: ServiceRequest) => record.items.map(({ materials, ...item }) => item);
  if (!same(withoutMaterials(next), withoutMaterials(previous))) return '转为服务交付须沿用已完成评估的申请内容。';
  for (const [index, item] of next.items.entries()) {
    if (item.materials.some(material => !item.config.materials.some(requirement => requirement.id === material.requirementId))) return '只能补充已配置的申请材料。';
    for (const material of previous.items[index].materials) {
      const files = materialFiles(item.materials.find(entry => entry.requirementId === material.requirementId));
      if (materialFiles(material).some(file => !files.some(nextFile => nextFile.id === file.id && same(nextFile, file))))
        return '转为服务交付时可补充材料，已评估的材料不可修改或删除。';
    }
  }
  return null;
}

export function deliveryConversionIssue(record: ServiceRequest, actor: OperationActor | undefined, users: InternalUser[]): string | null {
  if (requestTypeOf(record) !== '技术评估' || record.status !== '评估完成') return '仅评估完成的技术评估请求可转为服务交付。';
  if (!record.operations?.assessment?.managerId || !canPerformAssessmentRole(record, actor, 'manager', users)
    || !routingUsers(users, 'manager').some(user => user.id === actor?.id)) return '仅负责本请求的项目经理可转为服务交付。';
  const assessment = record.operations?.assessment;
  if (!assessment?.rounds.some(round => round.outcome === '评估通过') || !assessment.effort
    || !isDayQuantity(assessment.effort.days) || assessment.effort.days < 0) return '请先完成有效的材料评估和人天核定。';
  return null;
}

export function convertAssessmentToDelivery(record: ServiceRequest, actor: OperationActor, users: InternalUser[], now = new Date().toISOString()): ServiceRequest {
  const issue = deliveryConversionIssue(record, actor, users);
  if (issue) throw new Error(issue);
  const missing = deliveryConversionMaterialIssues(record);
  if (missing.length) throw new Error(`请补齐服务交付必传材料：${missing.join('；')}`);
  return appendActivity({ ...record, requestType: '服务交付', status: '待评估' }, actor, '评估', '转为服务交付', conversionDetail, now);
}

// Enforce type and branch transitions again against the latest stored request.
export function requestTypeSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, actor: OperationActor | undefined, users: InternalUser[]): string | null {
  const type = requestTypeOf(next);
  if (!requestTypes.includes(type as RequestType)) return '请选择申请类型。';
  const converting = isDeliveryConversion(next, previous);
  if (converting && previous) {
    const issue = deliveryConversionIssue(previous, actor, users);
    if (issue) return issue;
    const before = operationsOf(previous), after = operationsOf(next);
    if (!same({ ...before, activities: [] }, { ...after, activities: [] }))
      return '转为服务交付须沿用已完成的评估、核定人天和申请内容。';
    const itemIssue = deliveryConversionItemsIssue(next, previous);
    if (itemIssue) return itemIssue;
    const missing = deliveryConversionMaterialIssues(next);
    if (missing.length) return `请补齐服务交付必传材料：${missing.join('；')}`;
    const event = after.activities.at(-1);
    if (after.activities.length !== before.activities.length + 1 || !same(after.activities.slice(0, -1), before.activities)
      || !event?.id || !Number.isFinite(Date.parse(event.at)) || event.actorId !== actor?.id || event.actor !== actor?.name
      || event.category !== '评估' || event.title !== '转为服务交付' || event.detail !== conversionDetail)
      return '请通过“转为服务交付”操作变更申请类型。';
  } else if (previous && previous.status !== '草稿' && requestTypeOf(previous) !== type) {
    return '提交后申请类型不可直接修改，请通过“转为服务交付”操作变更。';
  }
  if (previous?.status === '评估完成' && !converting) {
    if (!same(next.items, previous.items)) {
      const issue = deliveryConversionIssue(previous, actor, users) ?? deliveryConversionItemsIssue(next, previous);
      if (issue) return issue;
    }
    if (next.status !== '评估完成' || !same(next.operations?.assessment, previous.operations?.assessment))
      return '评估完成后结论和核定人天已锁定，仅可按需转为服务交付。';
  }
  if (type === '技术评估') {
    const assessment = next.operations?.assessment;
    if (!['草稿', '待评估', '评估完成', '已取消'].includes(next.status)
      || assessment?.plans.some(plan => !plan.releasedAt) || assessment?.confirmation
      || assessment?.approvals.some(approval => approval.state !== '已失效') || next.operations?.projectCreation)
      return '技术评估请求须先完成评估并转为服务交付，再进入后续交付流程。';
    const changedEffort = !same(assessment?.effort, previous?.operations?.assessment?.effort);
    if (changedEffort && assessment?.effort && next.status !== '评估完成') return '技术评估完成人天核定后应进入“评估完成”。';
    if (next.status === '评估完成' && previous?.status !== '评估完成') {
      if (previous?.status !== '待评估' || requestTypeOf(previous) !== '技术评估'
        || !canPerformAssessmentRole(previous, actor, 'manager', users)
        || !previous.operations?.assessment?.rounds.some(round => round.outcome === '评估通过')
        || !same(previous.operations.assessment.rounds, assessment?.rounds)
        || !changedEffort || !assessment?.effort || assessment.effort.author !== actor?.name)
        return '仅负责项目经理在材料评估通过并完成人天核定后可结束技术评估。';
    }
  } else if (next.status === '评估完成') return '服务交付请求不能进入技术评估的结束状态。';
  return null;
}
