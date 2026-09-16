import type { ServiceRequest } from './service-requests';

export const convertedRequestReadonlyMessage = '请求已转为服务项目，全部信息只读，不能编辑或增删协作人。';
export function isConvertedRequest(record?: Pick<ServiceRequest, 'status'> | null): boolean {
  return record?.status === '已转服务项目';
}
