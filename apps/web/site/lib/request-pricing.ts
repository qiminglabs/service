import type { CatalogService, RequestItem, ServiceRequest } from './service-requests';

export type EffortPricingInput = { itemId: string; estimatedDays: number; priceCoefficient?: number };
export type EffortPricingLine = {
  itemId: string;
  serviceId: string;
  serviceName: string;
  estimatedDays: number;
  priceCoefficient: number;
  billableDays: number;
};
export const roundDays = (days: number) => Math.round(days * 10000) / 10000;
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
    total.estimatedDays = roundDays(total.estimatedDays + line.estimatedDays);
    total.days = roundDays(total.days + line.billableDays);
    totals.set(method, total);
  }
  return ['远程', '现场', '未区分'].flatMap(method => totals.has(method) ? [totals.get(method)!] : []);
}
const validInput = (value: number) => Number.isFinite(value) && value > 0 && value <= 100000
  && Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
export function itemMinimumDays(item: RequestItem, services: CatalogService[]): number | undefined {
  // Always use the current catalog. Never read a request or pricing snapshot.
  const minimum = services.find(service => service.id === item.serviceId)?.defaultQuantity;
  return typeof minimum === 'number' && validInput(minimum) ? minimum : undefined;
}
export function itemPriceCoefficient(item: RequestItem, services: CatalogService[]): number | undefined {
  const service = services.find(service => service.id === item.serviceId);
  const value = service ? service.priceCoefficient : item.priceCoefficient;
  return typeof value === 'number' && validInput(value) ? value : undefined;
}
export function calculateBillableDays(estimatedDays: number, coefficient: number) {
  return roundDays((Math.round(estimatedDays * 100) * Math.round(coefficient * 100)) / 10000);
}
export function calculateEffortPricing(record: ServiceRequest, inputs: EffortPricingInput[], services: CatalogService[]) {
  if (!record.items.length || !Array.isArray(inputs) || inputs.length !== record.items.length
    || new Set(inputs.map(input => input.itemId)).size !== inputs.length)
    throw new Error('请为每个服务目录申请项填写预估人天，不可遗漏或重复。');
  const lines: EffortPricingLine[] = record.items.map(item => {
    const input = inputs.find(input => input.itemId === item.id);
    if (!input || !validInput(input.estimatedDays))
      throw new Error(`${item.serviceName}：预估人天须为大于 0、最多两位小数的数字。`);
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
  if (!Number.isFinite(days) || days <= 0 || days > 100000) throw new Error('计价总人天须大于 0 且不超过 100000。');
  return { lines, estimatedDays: roundDays(lines.reduce((sum, line) => sum + line.estimatedDays, 0)), days };
}

// Unchanged legacy totals remain valid. New/changed calculations must match the catalog.
export function effortPricingSaveIssue(next: ServiceRequest, previous: ServiceRequest | undefined, services: CatalogService[]): string | null {
  const effort = next.operations?.assessment?.effort;
  if (!effort || JSON.stringify(effort) === JSON.stringify(previous?.operations?.assessment?.effort)) return null;
  try {
    const calculated = calculateEffortPricing(next, effort.lines ?? [], services);
    if (JSON.stringify(calculated.lines) !== JSON.stringify(effort.lines)
      || calculated.days !== effort.days || calculated.estimatedDays !== effort.estimatedDays)
      return '计价人天与目录明细不一致，请重新核定。';
    const plan = next.operations?.assessment?.plans.at(-1);
    if (plan && !plan.releasedAt && plan.effort !== calculated.days)
      return '计价人天已变更，请重新关联服务依据。';
    return null;
  } catch (error) { return error instanceof Error ? error.message : '计价人天校验失败。'; }
}
