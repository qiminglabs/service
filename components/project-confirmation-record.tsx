import type { ProjectConfirmation } from '@/lib/service-project-review';
import { formatDays } from '@/lib/day-quantity';
import { entitlementLabel } from '@/lib/request-entitlement-reservations';

const stamp = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false });

export function ProjectConfirmationRecord({
  entry,
  version,
}: {
  entry: ProjectConfirmation;
  version: number;
}) {
  const assets = [
    ...entry.allocations.map((row) => ({
      name: row.name,
      quantity: `${formatDays(row.days)} 人天`,
    })),
    ...entry.entitlementAllocations.map((row) => ({
      name: `${row.name} · ${entitlementLabel(row.kind)}`,
      quantity: `${row.quantity} 份`,
    })),
  ];
  return (
    <article className="project-confirmation-record">
      <header>
        <strong>确认版本 {version}</strong>
        <span
          className="project-confirmation-record-status"
          data-state={entry.invalidatedAt ? '已失效' : entry.state}
        >
          {entry.invalidatedAt ? `已失效（${entry.state}）` : entry.state}
        </span>
        {entry.deliverables && (
          <span className="project-confirmation-record-files">
            交付物 {entry.deliverables.length} 份
          </span>
        )}
      </header>
      <dl className="project-confirmation-record-meta">
        <div>
          <dt>发起人</dt>
          <dd>{entry.by}</dd>
        </div>
        <div>
          <dt>发起时间</dt>
          <dd>
            <time dateTime={entry.at}>{stamp(entry.at)}</time>
          </dd>
        </div>
        {entry.decidedAt && (
          <>
            <div>
              <dt>处理人</dt>
              <dd>{entry.decidedBy || '—'}</dd>
            </div>
            <div>
              <dt>处理时间</dt>
              <dd>
                <time dateTime={entry.decidedAt}>{stamp(entry.decidedAt)}</time>
              </dd>
            </div>
          </>
        )}
      </dl>
      {entry.note && (
        <p className="project-confirmation-record-note">
          <span>确认备注</span>
          {entry.note}
        </p>
      )}
      {entry.reason && (
        <p className="project-confirmation-record-note">
          <span>客户反馈</span>
          {entry.reason}
        </p>
      )}
      <details>
        <summary>服务内容及消耗</summary>
        <div className="project-confirmation-record-content">
          <section>
            <h5>服务内容</h5>
            {entry.services?.length ? (
              <ul>
                {entry.services.map((service) => (
                  <li key={service.id}>
                    <span>{service.name}</span>
                    <span>{service.method}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>暂无服务内容</p>
            )}
          </section>
          <section>
            <h5>资产消耗</h5>
            {assets.length ? (
              <ul>
                {assets.map((asset, index) => (
                  <li key={index}>
                    <span>{asset.name}</span>
                    <span>{asset.quantity}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>暂无资产消耗</p>
            )}
          </section>
        </div>
      </details>
    </article>
  );
}
