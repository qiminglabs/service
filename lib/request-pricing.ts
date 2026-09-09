import { entitlementAvailable } from './request-entitlement-reservations.ts';
import { isDayQuantity, roundDays, sumDays } from './day-quantity.ts';
export { roundDays } from './day-quantity.ts';
import type { CatalogService, RequestItem, ServiceRequest, ObjectRef } from './service-requests';

export type EntitlementPricingContext = {
  records?: ServiceRequest[];
  businessObjects: ObjectRef[];
  conversions: Partial<Record<'inspection' | 'upgrade', { days: number; version: number }>>;
};
export function entitlementPricingContext(references: { id: string; payload?: any }[], records: ServiceRequest[] = []): EntitlementPricingContext {
  return {
    records,
    businessObjects: references.find(reference => reference.id === 'workspace')?.payload?.businessObjects ?? [],
    conversions: Object.fromEntries(['inspection', 'upgrade'].map(kind => {
      const history = references.find(reference => reference.id === `entitlement-conversion-${kind}`)?.payload;
      const current = Array.isArray(history) && history.length ? history.at(-1) : { days: 0.3, version: 1 };
      return [kind, { days: current?.days, version: current?.version }];
    })),
  };
}
export function itemEntitlementKind(item: RequestItem, services: CatalogService[]) {
  const unit = services.find(service => service.id === item.serviceId)?.priceUnit;
  return unit === '巡检权益' ? 'inspection' : unit === '升级权益' ? 'upgrade' : undefined;
}
export type EffortPricingInput = { itemId: string; estimatedDays: number; priceCoefficient?: number };
export type EffortPricingLine = {
  kind?: 'entitlement';
  entitlementKind?: 'inspection' | 'upgrade';
  deficitEntitlements?: number;
  conversionVersion?: number;
  entitlementObjects?: { objectId: string; name: string; nodes: number; available: number; deficit: number }[];
  itemId: string;
  serviceId: string;
  serviceName: string;
  estimatedDays: number;
  priceCoefficient: number;
  billableDays: number;
};
export function effortTotalsByMethod(record: ServiceRequest, lines: EffortPricingLine[]) {
  const totals = new Map<string, { method: string; estimatedDays: number; days: number }>();
  for (const line of lines) {
    let method = record.items.find(item => item.id === line.itemId)?.method.trim() ?? '';
    // Single selections saved by a multiple-choice field can still be classified.
    if (method.startsWith('[')) {
      try {
        const values: unknown = JSON.parse(method);
        if (Array.isArray(values) && values.length === 1 && typeof values[0] === 'string') method = values[0].trim();
      } catch { /* Preserve an unclassified total for unknown legacy values. */ }
    }
    if (method !== '远程' && method !== '现场') method = '未区分';
    const total = totals.get(method) ?? { method, estimatedDays: 0, days: 0 };
    total.estimatedDays = sumDays([total.estimatedDays, line.estimatedDays]);
    total.days = sumDays([total.days, line.billableDays]);
    totals.set(method, total);
  }
  return ['远程', '现场', '未区分'].flatMap(method => totals.has(method) ? [totals.get(method)!] : []);
}
const validInput = (value: number) => isDayQuantity(value) && value > 0 && value <= 100000;
export function itemMinimumDays(item: RequestItem, services: CatalogService[]): number | undefined {
  // Always use the current catalog. Never read a request or pricing snapshot.
  const minimum = services.find(service => service.id === item.serviceId)?.defaultQuantity;
  return typeof minimum === 'number' && validInput(minimum) ? minimum : undefined;
}
export function itemPriceCoefficient(item: RequestItem, services: CatalogService[]): number | undefined {
  const service = services.find(service => service.id === item.serviceId);
  const value = service ? service.priceCoefficient : item.priceCoefficient;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 100000
    && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7 ? value : undefined;
}
export function calculateBillableDays(estimatedDays: number, coefficient: number) {
  return Math.round((Math.round(estimatedDays * 100) * Math.round(coefficient * 100)) / 1000) / 10;
}
export function calculateEntitlementPricing(record: ServiceRequest, item: RequestItem, services: CatalogService[], context?: EntitlementPricingContext, used = new Map<string, number>()): EffortPricingLine {
  const kind = itemEntitlementKind(item, services);
  if (!kind) throw new Error('申请项不是权益类目录。');
  if (!item.businessObjectIds.length || new Set(item.businessObjectIds).size !== item.businessObjectIds.length)
    throw new Error(`${item.serviceName}：请选择业务对象，不可重复关联。`);
  const objects = item.businessObjectIds.map(id => {
    const object = context?.businessObjects.find(object => object.id === id && object.customerId === record.customerId && object.status === '启用' && object.product === 'SMTX OS 系统');
    if (!object) throw new Error(`${item.serviceName}：业务对象已失效或不属于当前客户，请重新选择。`);
    const balance = kind === 'inspection' ? object.inspectionEntitlement : object.upgradeEntitlement;
    const free = entitlementAvailable(object, kind, context?.records ?? [], record.id);
    const key = `${object.id}:${kind}`;
    const available = free === undefined ? undefined : Math.max(0, free - (used.get(key) ?? 0));
    if (!Number.isInteger(object.nodeCount) || object.nodeCount <= 0 || typeof available !== 'number' || !Number.isInteger(available) || available < 0 || (balance ?? 0) > object.nodeCount)
      throw new Error(`${object.name}：节点数或可用权益未正确维护。`);
    used.set(key, (used.get(key) ?? 0) + Math.min(object.nodeCount, available));
    return { objectId: object.id, name: object.name, nodes: object.nodeCount, available, deficit: Math.max(0, object.nodeCount - available) };
  });
  const conversion = context?.conversions[kind];
  if (!conversion || !isDayQuantity(conversion.days) || conversion.days <= 0 || conversion.days > 1000000)
    throw new Error(`${item.serviceName}：无法获取有效的权益换算系数。`);
  const deficit = objects.reduce((sum, object) => sum + object.deficit, 0);
  return { itemId: item.id, serviceId: item.serviceId, serviceName: item.serviceName,
    estimatedDays: 0, priceCoefficient: conversion.days, billableDays: roundDays(deficit * conversion.days),
    kind: 'entitlement', entitlementKind: kind, deficitEntitlements: deficit,
    conversionVersion: conversion.version, entitlementObjects: objects };
}
export function calculateEntitlementLines(record: ServiceRequest, services: CatalogService[], context?: EntitlementPricingContext) {
  const used = new Map<string, number>();
  return record.items.filter(item => itemEntitlementKind(item, services)).map(item => calculateEntitlementPricing(record, item, services, context, used));
}
export function calculateEffortPricing(record: ServiceRequest, inputs: EffortPricingInput[], services: CatalogService[], context?: EntitlementPricingContext) {
  if (!record.items.length || !Array.isArray(inputs) || inputs.length !== record.items.length
    || new Set(inputs.map(input => input.itemId)).size !== inputs.length)
    throw new Error('请为每个服务目录申请项填写预估人天，不可遗漏或重复。');
  const entitlementLines = calculateEntitlementLines(record, services, context);
  const lines: EffortPricingLine[] = record.items.map(item => {
    if (itemEntitlementKind(item, services)) return entitlementLines.find(line => line.itemId === item.id)!;
    const input = inputs.find(input => input.itemId === item.id);
    if (!input || !validInput(input.estimatedDays))
      throw new Error(`${item.serviceName}：预估人天须为大于 0、最多一位小数的数字。`);
    const minimumDays = itemMinimumDays(item, services);
    if (minimumDays === undefined)
      throw new Error(`${item.serviceName}：无法获取目录最新的最小人天数量，请维护服务目录后重试。`);
    if (input.estimatedDays < minimumDays)
      throw new Error(`${item.serviceName}：预估人天不能小于当前最小人天数量 ${minimumDays} 人天。`);
    const priceCoefficient = itemPriceCoefficient(item, services);
    if (priceCoefficient === undefined) throw new Error(`${item.serviceName}：服务目录未配置有效计价系数，请先维护服务目录。`);
    if (input.priceCoefficient !== undefined && input.priceCoefficient !== priceCoefficient)
      throw new Error(`${item.serviceName}：计价系数已变更，请刷新后重新核定。`);
    return { itemId: item.id, serviceId: item.serviceId, serviceName: item.serviceName,
      estimatedDays: input.estimatedDays, priceCoefficient,
      billableDays: calculateBillableDays(input.estimatedDays, priceCoefficient) };
  });
  const days = roundDays(lines.reduce((sum, line) => sum + line.billableDays, 0));
  if (!Number.isFinite(days) || days < 0 || days > 100000) throw new Error('计价总人天须为非负数且不超过 100000。');
  return { lines, estimatedDays: roundDays(lines.reduce((sum, line) => sum + line.estimatedDays, 0)), days };
}

// Unchanged legacy totals remain valid. New/changed calculations must match the catalog.
export function effortPricingSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, services: CatalogService[], context?: EntitlementPricingContext): string | null {
  const effort = next.operations?.assessment?.effort;
  if (!effort || JSON.stringify(effort) === JSON.stringify(previous?.operations?.assessment?.effort)) return null;
  try {
    const calculated = calculateEffortPricing(next, effort.lines ?? [], services, context);
    if (JSON.stringify(calculated.lines) !== JSON.stringify(effort.lines)
      || calculated.days !== effort.days || calculated.estimatedDays !== effort.estimatedDays)
      return '计价人天与目录明细不一致，请重新核定。';
    const plan = next.operations?.assessment?.plans.at(-1);
    if (plan && !plan.releasedAt && plan.effort !== calculated.days)
      return '计价人天已变更，请重新关联服务依据。';
    return null;
  } catch (error) { return error instanceof Error ? error.message : '计价人天校验失败。'; }
}
