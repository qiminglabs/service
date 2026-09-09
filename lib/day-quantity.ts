// New person-day quantities use tenths. Dimensionless pricing coefficients do not.
export function isDayQuantity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    && Math.abs(value * 10 - Math.round(value * 10)) < 1e-8;
}

export function parseDayQuantity(raw: string): number | null {
  if (!/^\d+(\.\d)?$/.test(raw.trim())) return null;
  const value = Number(raw);
  return isDayQuantity(value) ? value : null;
}

export const roundDays = (value: number) =>
  Math.round((value + Number.EPSILON * Math.max(1, Math.abs(value))) * 10) / 10;

// Do not round previously agreed quantities or balances into different amounts.
export function formatDays(value: number): string {
  return String(isDayQuantity(value) ? roundDays(value) : value);
}

export function sumDays(values: number[]): number {
  const scale = values.every(isDayQuantity) ? 10 : 10000;
  return Math.round(values.reduce((sum, value) => sum + Math.round(value * scale), 0)) / scale;
}

type DayWorkspace = {
  assets?: { id: string; balanceDays?: number }[];
  services?: { id: string; priceUnit?: string; defaultQuantity?: number }[];
};

export function workspaceDayQuantityIssue(next: DayWorkspace, previous?: DayWorkspace): string | null {
  for (const asset of next.assets ?? []) {
    const old = previous?.assets?.find(item => item.id === asset.id);
    if (asset.balanceDays !== old?.balanceDays && asset.balanceDays !== undefined && !isDayQuantity(asset.balanceDays))
      return '余额人天须为非负数，最多一位小数。';
  }
  for (const service of next.services ?? []) {
    const old = previous?.services?.find(item => item.id === service.id);
    if (service.priceUnit === '巡检权益' || service.priceUnit === '升级权益') continue;
    if (service.defaultQuantity !== old?.defaultQuantity && service.defaultQuantity !== undefined
      && (!isDayQuantity(service.defaultQuantity) || service.defaultQuantity <= 0))
      return '最小人天数量须大于 0，最多一位小数。';
  }
  return null;
}
