import { itemBasicIssues, businessObjectsEnabled, matchesObjectProduct, serviceAvailableForRequest } from './service-requests.ts';
import { requestMaterialIssues } from './request-materials.ts';
import type { ServiceRequest, CustomerRef, ContactRef, ObjectRef, CatalogService, RequestAudience, InternalUser } from './service-requests';
import type { OperationActor } from './request-operations';
import { submissionCollaboratorsIssue } from './request-collaboration.ts';
import { requestTypeOf, requestTypes, type RequestType } from './request-types.ts';
export function requestCompletenessIssues(
  request: ServiceRequest,
  refs: {
    customers: CustomerRef[];
    contacts: ContactRef[];
    businessObjects: ObjectRef[];
    services: CatalogService[];
    audience?: RequestAudience;
    currentActor?: OperationActor;
    materialActorId?: string;
    users?: InternalUser[];
  },
): string[] {
  const issues: string[] = [];
  if (!requestTypes.includes(requestTypeOf(request) as RequestType)) issues.push('选择申请类型');
  if (!request.expectedServiceDate && request.expectedServiceDateUncertain !== true)
    issues.push('请选择期望服务日期，或点击“暂不确定”');
  if (request.expectedServiceDate && request.expectedServiceDateUncertain === true)
    issues.push('期望服务日期不能同时指定具体日期和暂不确定，请重新选择');
  if (!request.title.trim()) issues.push('填写申请主题');
  if (
    !refs.customers.some(
      (c) => c.id === request.customerId && c.status === '启用',
    )
  )
    issues.push('选择有效客户');
  if (!request.items.length) issues.push('至少添加一个申请项');
  request.items.forEach((item, index) => {
    const prefix = `申请项 ${index + 1}：`;
    issues.push(...itemBasicIssues(item).map((issue) => prefix + issue));
    const service = refs.services.find((s) => s.id === item.serviceId);
    if (!service || service.status !== '已启用')
      issues.push(prefix + '服务目录已停用或不存在');
    else if (refs.audience && !serviceAvailableForRequest(service, refs.audience))
      issues.push(prefix + '服务目录未开放给当前申请站点');
    if (
      businessObjectsEnabled(item.config) &&
      item.businessObjectIds.some(
        (id) =>
          !refs.businessObjects.some(
            (o) =>
              o.id === id &&
              o.customerId === request.customerId &&
              matchesObjectProduct(o, item.config) &&
              o.status === '启用',
          ),
      )
    )
      issues.push(
        prefix + '业务对象不属于当前客户、已停用、不符合可搜索产品或不存在',
      );
  });
  issues.push(...requestMaterialIssues(request, refs.audience));
  return issues;
}
export function requestIssues(request: ServiceRequest, refs: Parameters<typeof requestCompletenessIssues>[1]): string[] {
  const issues = requestCompletenessIssues(request, refs);
  const collaboration = submissionCollaboratorsIssue(request, refs.contacts, refs.users ?? []);
  if (collaboration) issues.push(collaboration);
  return issues;
}
