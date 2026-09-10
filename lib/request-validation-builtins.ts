import { businessImpactOptions, itemIssues, businessObjectsEnabled, matchesObjectProduct, serviceAvailableForRequest } from './service-requests.ts';
import type { ServiceRequest, CustomerRef, ContactRef, ObjectRef, CatalogService, RequestAudience, InternalUser, BusinessImpact } from './service-requests';
import type { OperationActor } from './request-operations';
import { submissionCollaboratorsIssue } from './request-collaboration.ts';
function businessImpactIssue(value: unknown) { return businessImpactOptions.includes(value as BusinessImpact) ? null : '请选择业务影响：生产环境、测试环境或不涉及业务。'; }
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
  if (!request.title.trim()) issues.push('填写申请主题');
  const impactIssue = businessImpactIssue(request.businessImpact);
  if (impactIssue) issues.push(impactIssue);
  if (
    !refs.customers.some(
      (c) => c.id === request.customerId && c.status === '启用',
    )
  )
    issues.push('选择有效客户');
  if (!request.items.length) issues.push('至少添加一个申请项');
  request.items.forEach((item, index) => {
    const prefix = `申请项 ${index + 1}：`;
    issues.push(...itemIssues(item, refs.audience, refs.materialActorId ?? refs.currentActor?.id).map((issue) => prefix + issue));
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
  return issues;
}
export function requestIssues(request: ServiceRequest, refs: Parameters<typeof requestCompletenessIssues>[1]): string[] {
  const issues = requestCompletenessIssues(request, refs);
  const collaboration = submissionCollaboratorsIssue(request, refs.contacts, refs.users ?? []);
  if (collaboration) issues.push(collaboration);
  return issues;
}
