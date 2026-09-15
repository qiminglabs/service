import type { ServiceRequest } from './service-requests';

// Initial configuration and compatibility for requests created before configurable
// triggers. Runtime workflow decisions use the request's saved requirement.
export const hardwareCompatibilityServiceId = 'SC-IMP-008';
export type HardwareAssessmentTrigger = {
  enabled: boolean;
  serviceIds: string[];
};
export type HardwareAssessmentRequirement = {
  serviceIds: string[];
  configRevision: number;
};
export const defaultHardwareAssessmentTrigger =
  (): HardwareAssessmentTrigger => ({
    enabled: true,
    serviceIds: [hardwareCompatibilityServiceId],
  });
export function parseHardwareAssessmentTrigger(
  value: unknown,
): HardwareAssessmentTrigger {
  if (value === undefined) return defaultHardwareAssessmentTrigger();
  const data = value as HardwareAssessmentTrigger;
  if (
    !data ||
    typeof data !== 'object' ||
    typeof data.enabled !== 'boolean' ||
    !Array.isArray(data.serviceIds) ||
    data.serviceIds.length > 200 ||
    data.serviceIds.some(
      (id) => typeof id !== 'string' || !id || id.length > 150,
    ) ||
    new Set(data.serviceIds).size !== data.serviceIds.length ||
    (data.enabled && !data.serviceIds.length)
  )
    throw new Error('请选择至少一个触发服务项，或关闭硬件产品经理评估。');
  return { enabled: data.enabled, serviceIds: [...data.serviceIds] };
}
export function hardwareRequirement(
  record: ServiceRequest,
): HardwareAssessmentRequirement {
  return (
    record.operations?.assessment?.hardwareRequirement ?? {
      serviceIds: defaultHardwareAssessmentTrigger().serviceIds,
      configRevision: 0,
    }
  );
}
export function captureHardwareRequirement(
  trigger: HardwareAssessmentTrigger,
  configRevision: number,
): HardwareAssessmentRequirement {
  return {
    serviceIds: trigger.enabled ? [...trigger.serviceIds] : [],
    configRevision,
  };
}
export function hardwareItems(record: ServiceRequest) {
  const ids = hardwareRequirement(record).serviceIds;
  return record.items.filter((item) => ids.includes(item.serviceId));
}
export function matchesHardwareTrigger(
  record: ServiceRequest,
  trigger: HardwareAssessmentTrigger,
): boolean {
  return (
    trigger.enabled &&
    record.items.some((item) => trigger.serviceIds.includes(item.serviceId))
  );
}
