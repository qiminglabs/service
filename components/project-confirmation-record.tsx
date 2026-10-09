
import { useI18n } from '@/lib/i18n/context';
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
  const { localize, localizeMessage } = useI18n();
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
        <strong>{localize("确认版本")}{localize(version)}</strong>
        <span
          className="project-confirmation-record-status"
          data-state={entry.invalidatedAt ? '已失效' : entry.state}
        >
          {localize(entry.invalidatedAt ? localizeMessage("已失效（{0}）", [String(localize(entry.state))]) : entry.state)}
        </span>
        {localize(entry.deliverables && (
          <span className="project-confirmation-record-files">
            {localize("交付物")}{localize(entry.deliverables.length)} {localize(" 份")}</span>
        ))}
      </header>
      <dl className="project-confirmation-record-meta">
        <div>
          <dt>{localize("发起人")}</dt>
          <dd>{localize(entry.by)}</dd>
        </div>
        <div>
          <dt>{localize("发起时间")}</dt>
          <dd>
            <time dateTime={entry.at}>{localize(stamp(entry.at))}</time>
          </dd>
        </div>
        {localize(entry.decidedAt && (
          <>
            <div>
              <dt>{localize("处理人")}</dt>
              <dd>{localize(entry.decidedBy || '—')}</dd>
            </div>
            <div>
              <dt>{localize("处理时间")}</dt>
              <dd>
                <time dateTime={entry.decidedAt}>{localize(stamp(entry.decidedAt))}</time>
              </dd>
            </div>
          </>
        ))}
      </dl>
      {localize(entry.note && (
        <p className="project-confirmation-record-note">
          <span>{localize("确认备注")}</span>
          {localize(entry.note)}
        </p>
      ))}
      {localize(entry.reason && (
        <p className="project-confirmation-record-note">
          <span>{localize("客户反馈")}</span>
          {localize(entry.reason)}
        </p>
      ))}
      <details>
        <summary>{localize("服务内容及消耗")}</summary>
        <div className="project-confirmation-record-content">
          <section>
            <h5>{localize("服务内容")}</h5>
            {localize(entry.services?.length ? (
              <ul>
                {localize(entry.services.map((service) => (
                  <li key={service.id}>
                    <span>{localize(service.name)}</span>
                    <span>{localize(service.method)}</span>
                  </li>
                )))}
              </ul>
            ) : (
              <p>{localize("暂无服务内容")}</p>
            ))}
          </section>
          <section>
            <h5>{localize("资产消耗")}</h5>
            {localize(assets.length ? (
              <ul>
                {localize(assets.map((asset, index) => (
                  <li key={index}>
                    <span>{localize(asset.name)}</span>
                    <span>{localize(asset.quantity)}</span>
                  </li>
                )))}
              </ul>
            ) : (
              <p>{localize("暂无资产消耗")}</p>
            ))}
          </section>
        </div>
      </details>
    </article>
  );
}
