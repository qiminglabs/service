export type EntitlementField = 'upgradeEntitlement' | 'inspectionEntitlement';

export const sampleAssetBalanceDays: Readonly<Record<string, number>> = {
  'AST-001': 10,
  'AST-002': 5,
  'AST-003': 0,
};

export function withDefaultAssetBalances<
  T extends { id: string; status: string; balanceDays?: number },
>(records: T[]): T[] {
  return records.map((record) =>
    record.balanceDays === undefined &&
    Object.hasOwn(sampleAssetBalanceDays, record.id)
      ? {
          ...record,
          balanceDays:
            record.status === '已使用' ? 0 : sampleAssetBalanceDays[record.id],
        }
      : record,
  );
}

export function parseEntitlementQuantity(
  raw: string,
  nodeCount: number,
): number | null {
  if (!raw.trim()) return null;
  const quantity = Number(raw);
  return Number.isInteger(nodeCount) &&
    nodeCount > 0 &&
    Number.isInteger(quantity) &&
    quantity >= 0 &&
    quantity <= nodeCount
    ? quantity
    : null;
}
