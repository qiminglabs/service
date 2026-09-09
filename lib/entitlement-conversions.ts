export const entitlementNames = {
  inspection: '巡检权益',
  upgrade: '升级权益',
} as const;
export type EntitlementKind = keyof typeof entitlementNames;
export type ConversionVersion = {
  id: string;
  version: number;
  days: number;
  updatedAt: string;
  updatedBy: string;
  note: string;
};
export function parseConversionDays(value: string): number | null {
  if (!/^\d+(\.\d{1,4})?$/.test(value.trim())) return null;
  const days = Number(value);
  return Number.isFinite(days) && days > 0 && days <= 1000000 ? days : null;
}
export function appendConversionVersion(
  history: ConversionVersion[],
  days: number,
  actor: string,
  note: string,
): ConversionVersion[] {
  if (parseConversionDays(String(days)) === null)
    throw new Error('请输入大于 0、不超过 1000000 的系数，最多四位小数。');
  if (history.at(-1)?.days === days)
    throw new Error('换算系数未变化，无需生成新版本。');
  return [
    ...history,
    {
      id: crypto.randomUUID(),
      version: (history.at(-1)?.version ?? 0) + 1,
      days,
      updatedAt: new Date().toISOString(),
      updatedBy: actor || '未选择用户',
      note: note.trim(),
    },
  ];
}

export function ensureConversionHistory(
  history: ConversionVersion[] | undefined,
): ConversionVersion[] {
  return history?.length
    ? history
    : appendConversionVersion([], 0.3, '系统预置', '默认换算系数');
}
