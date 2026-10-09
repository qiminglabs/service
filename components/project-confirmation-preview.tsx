
import { useI18n } from '@/lib/i18n/context';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { ServiceProjectDeliverables } from '@/components/service-project-deliverables';
import { projectConfirmationContent, projectConfirmationChanges, projectReviewOf } from '@/lib/service-project-review';
import { formatDays } from '@/lib/day-quantity';
import { entitlementLabel } from '@/lib/request-entitlement-reservations';
import type { ServiceProjectRecord } from '@/lib/service-projects';

export function ProjectConfirmationPreview({ project }: { project: ServiceProjectRecord }) {
  const { localize } = useI18n();
  const content = projectConfirmationContent(project);
  const changes = projectConfirmationChanges(project);
  const basis = projectReviewOf(project).basis;
  const assets = [
    ...(basis?.allocations ?? []).map(row => ({ key: `asset:${row.assetId}`, name: row.name, quantity: `${formatDays(row.days)} 人天` })),
    ...(basis?.entitlementAllocations ?? []).map((row, index) => ({ key: `entitlement:${row.objectId}:${index}`, name: `${row.name} · ${entitlementLabel(row.kind)}`, quantity: `${row.quantity} 份` })),
  ];
  return <div className="project-confirmation-preview">
    <div className="sr-panel-title-with-visibility"><h4>{localize("交付及最终资产消耗")}</h4><CustomerVisibleBadge /></div>
    <div className="project-confirmation-preview-summary">
      <section className="sr-panel" aria-label={localize("服务内容")}>
        <div className="sr-panel-heading"><h3>{localize("服务内容")}</h3></div>
        <table className="sr-table"><thead><tr><th>{localize("服务名称")}</th><th>{localize("服务方式")}</th></tr></thead>
          <tbody>{localize(content.services.map(service => <tr key={service.id}><td>{localize(service.name)}</td><td>{localize(service.method)}</td></tr>))}
            {localize(!content.services.length && <tr><td colSpan={2}>{localize("暂无服务内容")}</td></tr>)}
          </tbody>
        </table>
      </section>
      <section className="sr-panel" aria-label={localize("最终资产消耗")}>
        <div className="sr-panel-heading"><h3>{localize("最终资产消耗")}</h3></div>
        <table className="sr-table"><thead><tr><th>{localize("资产 / 权益")}</th><th>{localize("消耗数量")}</th></tr></thead>
          <tbody>{localize(assets.map(asset => <tr key={asset.key}><td>{localize(asset.name)}</td><td>{localize(asset.quantity)}</td></tr>))}
            {localize(!assets.length && <tr><td colSpan={2}>{localize("暂无资产消耗")}</td></tr>)}
          </tbody>
        </table>
      </section>
    </div>
    {localize(changes.length > 0 && <section className="project-confirmation-preview-changes"><h4>{localize("较原约定的消耗变化")}</h4>{localize(changes.map((change, index) => <p key={index}><span>{localize(change.name)}</span><span>{localize(formatDays(change.before))} → {localize(formatDays(change.after))} {localize(change.unit)}</span></p>))}</section>)}
    <ServiceProjectDeliverables projectName={project.name} items={content.deliverables} selectable={false} />
  </div>;
}
