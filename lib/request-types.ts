import type { ServiceRequest } from './service-requests';

export const requestTypes = ['技术评估', '服务交付'] as const;
export type RequestType = typeof requestTypes[number];

// Missing types remain unselected and must pass current submission validation.
export function requestTypeOf(record: Pick<ServiceRequest, 'requestType'>): RequestType | '' {
  return record.requestType ?? '';
}
