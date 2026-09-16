import type { ServiceRequest } from './service-requests';

export const requestTypes = ['技术评估', '服务交付'] as const;
export type RequestType = typeof requestTypes[number];

// Records saved before request types were introduced retain the delivery flow.
export function requestTypeOf(record: Pick<ServiceRequest, 'requestType'>): RequestType | '' {
  return record.requestType ?? '服务交付';
}
