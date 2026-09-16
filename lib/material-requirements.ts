import type { MaterialRequirement } from './service-requests';
import { requestTypes, type RequestType } from './request-types.ts';

export function materialRequiredFor(requirement: MaterialRequirement, type: RequestType | '' = '服务交付'): boolean {
  return type !== '' && (requirement.requiredByType?.[type] ?? requirement.required);
}

export function materialRequiredTypes(requirement: MaterialRequirement): Record<RequestType, boolean> {
  return { '技术评估': materialRequiredFor(requirement, '技术评估'), '服务交付': materialRequiredFor(requirement, '服务交付') };
}

export function materialRequirementLabel(requirement: MaterialRequirement): string {
  const types = requestTypes.filter(type => materialRequiredFor(requirement, type));
  return types.length ? `${types.join('、')}必须上传` : '选填';
}
