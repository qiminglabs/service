import type { RequestWorklog } from './request-operations';
import type { CatalogService } from './service-requests';
import type { ServiceWorkOrder } from './service-work-orders';
import type { ServiceProjectRecord } from './service-projects';

export type WorklogPricing =
  | { kind: 'hourly'; serviceId: string; serviceName: string; coefficient: number; hours: number }
  | { kind: 'entitlement'; serviceId: string; serviceName: string; unit: string }
  | { kind: 'pending'; reason: string };
export type ProjectWorklog = RequestWorklog & {
  // Optional only for historical records; all new and edited logs require an order.
  workOrderId?: string;
  confirmedAt?: string;
  confirmedById?: string;
  confirmedBy?: string;
  pricing?: WorklogPricing;
};

export function calculateWorklogPricing(order: ServiceWorkOrder, hours: number, services: CatalogService[] = [], saved?: WorklogPricing): WorklogPricing {
  if (saved?.kind === 'hourly') return { ...saved, hours: hours * saved.coefficient };
  if (saved?.kind === 'entitlement') return saved;
  const catalog = order.catalogSnapshot ?? services.find(service => service.id === order.item.serviceId);
  if (!catalog) return { kind: 'pending', reason: '待补充服务目录' };
  const service = { serviceId: order.item.serviceId, serviceName: catalog.name };
  if (['巡检权益', '升级权益'].includes(catalog.priceUnit ?? ''))
    return { ...service, kind: 'entitlement', unit: catalog.priceUnit! };
  const coefficient = catalog.priceCoefficient;
  if (typeof coefficient !== 'number' || !Number.isFinite(coefficient) || coefficient <= 0 || coefficient > 100000
    || Math.abs(coefficient * 100 - Math.round(coefficient * 100)) > 1e-7)
    return { kind: 'pending', reason: '待补充计价系数' };
  // Retain precision until display/summing so splitting a work session cannot inflate its price.
  return { ...service, kind: 'hourly', coefficient, hours: hours * coefficient };
}

export function projectWorklogPricing(project: ServiceProjectRecord, log: ProjectWorklog, services: CatalogService[] = []): WorklogPricing {
  const order = project.workOrders?.find(order => order.id === log.workOrderId);
  if (!order) return { kind: 'pending', reason: log.workOrderId ? '关联工单不存在' : '待关联工单' };
  return calculateWorklogPricing(order, log.hours, services, log.pricing);
}

export function projectWorklogTotals(project: ServiceProjectRecord, services: CatalogService[] = []) {
  let actualHours = 0;
  let billableHours = 0;
  let pending = 0;
  let entitlement = 0;
  for (const log of project.operations?.worklogs ?? []) {
    if (log.voidedAt) continue;
    actualHours += log.hours;
    const pricing = projectWorklogPricing(project, log, services);
    if (pricing.kind === 'hourly') billableHours += pricing.hours;
    else if (pricing.kind === 'pending') pending++;
    else entitlement++;
  }
  return { actualHours, billableHours, pending, entitlement };
}
