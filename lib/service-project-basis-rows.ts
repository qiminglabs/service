import type { ServiceProjectRecord } from './service-projects';
import { sumDays } from './day-quantity.ts';
import { matchingApprovals, sourceBasis, projectEntitlementCoverage, projectReviewCapacities, type ProjectReviewContext } from './service-project-review.ts';

export type ProjectAssetBasisRow = {
  id: string; name: string; category: string; source: '客户资产' | '服务权益' | '服务请求审批' | '服务项目审批';
  method: '远程' | '现场' | '—';
  unit: '人天' | '巡检权益' | '升级权益';
  held: number; usage: number; remaining: number | null;
  pending?: number; approvalId?: string;
};

export function projectAssetBasisRows(p: ServiceProjectRecord, ctx: ProjectReviewContext, projection = p): ProjectAssetBasisRow[] {
  const rows: ProjectAssetBasisRow[] = projectReviewCapacities(projection, ctx).map(asset => {
    const usage = sumDays(projection.review?.basis?.allocations.filter(a => a.assetId === asset.assetId).map(a => a.days) ?? []);
    return { id: `asset:${asset.assetId}`, name: asset.name, category: '', unit: '人天',
      source: '客户资产', method: asset.method ?? '—',
      held: asset.days, usage, remaining: Math.max(0, sumDays([asset.days, -usage])) };
  });
  for (const row of projectEntitlementCoverage(p, projection)) rows.push({
    id: `object:${row.objectId}:${row.kind}`, name: row.kind === 'inspection' ? '巡检权益' : '升级权益',
    category: '', unit: row.kind === 'inspection' ? '巡检权益' : '升级权益',
    source: '服务权益', method: '—',
    held: row.held, usage: row.usage, remaining: Math.max(0, row.held - row.usage),
  });
  const inherited = p.review?.settlement ? p.requestConversion?.assessmentSnapshot : sourceBasis(p, ctx);
  for (const method of ['远程', '现场'] as const) {
    let uncovered = Math.max(0, sumDays([
      ...(projection.review?.effort?.lines.filter(line => line.method === method).map(line => line.billableDays) ?? []),
      ...(projection.review?.basis?.allocations.filter(a => a.method === method).map(a => -a.days) ?? []),
    ]));
    const approved = [
      ...(inherited?.approvals ?? []).filter(a => a.state === '已通过').map(a => ({ approval: a, source: '服务请求审批' as const,
        held: sumDays(a.gaps?.filter(g => g.method === method).map(g => g.days) ?? (inherited?.basis?.requirements?.length === 1 && inherited.basis.requirements[0].method === method ? [a.days] : [])) })),
      ...matchingApprovals(p).filter(a => a.state === '已通过').map(a => ({ approval: a, source: '服务项目审批' as const,
        held: sumDays(a.gaps?.filter(g => g.method === method).map(g => g.days) ?? []) })),
    ];
    for (const { approval, source, held } of approved) {
      if (held <= 0) continue;
      const usage = Math.min(held, uncovered);
      rows.push({ id: `approval:${source}:${approval.id}:${method}`, name: `${method}额度审批`, category: '已通过', unit: '人天',
        source, method, held, usage, remaining: null, approvalId: approval.id });
      uncovered = sumDays([uncovered, -usage]);
    }
  }
  return rows;
}

export function projectAssetBasisTotals(rows: ProjectAssetBasisRow[]) {
  return (['人天', '巡检权益', '升级权益'] as const).flatMap(unit => {
    const matching = rows.filter(row => row.unit === unit);
    return matching.length ? [{ unit, held: sumDays(matching.map(row => row.held)), usage: sumDays(matching.map(row => row.usage)),
      remaining: matching.every(row => row.remaining === null) ? null : sumDays(matching.map(row => row.remaining ?? 0)) }] : [];
  });
}
