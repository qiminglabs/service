'use client';

import type { ServiceProjectRecord } from '@/lib/service-projects';
import { formatDays, sumDays } from '@/lib/day-quantity';
import { entitlementLabel } from '@/lib/request-entitlement-reservations';
import { assetDayMethod } from '@/lib/request-asset-coverage';

const stamp = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
function Meta({ author, at }: { author?: string; at?: string }) {
  return <span className="sr-help">{author || '—'} · {stamp(at)}</span>;
}

export function ServiceProjectOther({ record }: { record: ServiceProjectRecord }) {
  const snapshot = record.requestConversion?.assessmentSnapshot;
  if (!record.sourceServiceRequestId || !snapshot) return <section className="sr-panel sr-ops-panel service-project-other-empty">
    <p className="sr-help">{record.sourceServiceRequestId ? '此项目转换时未保存人天核定及服务依据副本。' : '此项目未从服务请求转换，暂无其他信息。'}</p>
  </section>;
  const { effort, basis, approvals } = snapshot;
  const itemName = (id: string) => snapshot.items.find(item => item.id === id)?.name ?? id;
  const method = (id: string) => snapshot.items.find(item => item.id === id)?.method || '—';
  const frozen = new Map<string, { type: string; source: '资产' | '特批'; quantity: number; unit: string }>();
  const addFrozen = (type: string, source: '资产' | '特批', quantity: number, unit = '人天') => {
    if (quantity <= 0) return;
    const key = `${source}:${type}`;
    const previous = frozen.get(key);
    frozen.set(key, { type, source, quantity: sumDays([previous?.quantity ?? 0, quantity]), unit });
  };
  for (const asset of basis?.allocations ?? []) {
    addFrozen(asset.method ?? assetDayMethod(asset) ?? '未区分', '资产', asset.days);
  }
  for (const asset of basis?.entitlementAllocations ?? []) {
    addFrozen(entitlementLabel(asset.kind), '资产', asset.quantity, '份');
  }
  for (const approval of approvals) {
    if (approval.gaps?.length) {
      for (const gap of approval.gaps) addFrozen(gap.method, '特批', gap.days);
    } else {
      const methods = [...new Set(basis?.requirements?.map(requirement => requirement.method) ?? [])];
      addFrozen(methods.length === 1 ? methods[0] : '未区分', '特批', approval.days);
    }
  }
  return <div className="service-project-other">
    <section className="sr-panel sr-ops-panel" aria-labelledby="project-effort-heading">
      <div className="sr-panel-heading"><h3 id="project-effort-heading">人天核定记录</h3>{effort && <Meta author={effort.author} at={effort.at} />}</div>
      <div className="service-project-snapshot-body">
      {effort ? <>
        <div className="sr-pricing-overview">
          <div className="sr-pricing-primary"><span>计价总人天</span><strong>{formatDays(effort.days)} <small>人天</small></strong></div>
          {effort.estimatedDays !== undefined && <div className="sr-pricing-primary"><span>预估总人天</span><strong>{formatDays(effort.estimatedDays)} <small>人天</small></strong></div>}
        </div>
        {!!effort.lines?.length && <ul className="sr-pricing-details" aria-label="项目人天核定明细">
          {effort.lines.map(line => <li key={line.itemId}>
            <div className="sr-pricing-service"><strong>{line.serviceName || itemName(line.itemId)}</strong><span>{method(line.itemId)}</span></div>
            <div className="sr-pricing-equation">
              <span><small>{line.kind === 'entitlement' ? '差额权益' : '预估人天'}</small> {formatDays(line.kind === 'entitlement' ? line.deficitEntitlements ?? 0 : line.estimatedDays)}</span>
              <span className="sr-pricing-operator">×</span>
              <span><small>{line.kind === 'entitlement' ? '换算系数' : '计价系数'}</small> {line.priceCoefficient}</span>
              <span className="sr-pricing-operator">=</span>
              <strong>{formatDays(line.billableDays)} <small>人天</small></strong>
            </div>
            {line.entitlementObjects?.map(object => <p className="sr-help" key={object.objectId}>{object.name} · 节点 {object.nodes} · 可用权益 {object.available} · 差额权益 {object.deficit}</p>)}
          </li>)}
        </ul>}
      </> : <p className="sr-help">转换时暂无人天核定记录。</p>}
      </div>
    </section>
    <section className="sr-panel sr-ops-panel" aria-labelledby="project-basis-heading">
      <div className="sr-panel-heading"><h3 id="project-basis-heading">服务依据</h3></div>
      <div className="service-project-snapshot-body">
        <div className="table-scroll"><table className="reference-table app-list-table" aria-label="冻结额度">
          <thead><tr><th>类型</th><th>来源</th><th>冻结数量</th></tr></thead>
          <tbody>
            {[...frozen.entries()].map(([key, row]) => <tr key={key}>
              <td>{row.type}{row.unit === '人天' ? '人天' : ''}</td>
              <td>{row.source}</td>
              <td>{formatDays(row.quantity)} {row.unit}{record.cancellation ? row.source === '资产' ? '（已解冻）' : '（已作废）' : ''}</td>
            </tr>)}
            {!frozen.size && <tr><td colSpan={3}>暂无冻结额度</td></tr>}
          </tbody>
        </table></div>
      </div>
    </section>
  </div>;
}
