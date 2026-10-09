
import { useI18n } from '@/lib/i18n/context';
import type { ReactNode } from 'react';

type DisabledVersion = {
  key: string;
  name?: string;
  priority: number;
  requirement: string;
  condition: string;
  target: ReactNode;
  version: number;
  disabledAt?: string;
  disabledBy?: string;
};

export function DisabledRuleVersions({ versions, targetLabel, showName = false, ready }: {
  versions: DisabledVersion[];
  targetLabel: string;
  showName?: boolean;
  ready: boolean;
}) {
  const { localize } = useI18n();
  const title = showName ? '条件审批规则（已停用）' : '条件分配规则（已停用）';
  return <details className="routing-rules disabled-rule-versions" aria-label={localize(title)}>
    <summary className="submission-rules-toolbar"><strong>{localize(title)}</strong></summary>
    <div className="table-scroll"><table className={`reference-table app-list-table ${showName ? 'approval-rules-table' : 'routing-table'}`}>
      <thead><tr>
        <th>{localize("优先级")}</th>{localize(showName && <th>{localize("规则名称")}</th>)}<th>{localize("自然语言描述")}</th><th>{localize(targetLabel)}</th>
        <th>{localize("版本 / 状态")}</th><th>{localize("停用时间")}</th><th>{localize("停用人")}</th><th data-list-actions>{localize("操作")}</th>
      </tr></thead>
      <tbody>{localize(versions.map(version => <tr key={version.key}>
        <td>{localize(version.priority)}</td>{localize(showName && <td><strong>{localize(version.name)}</strong></td>)}
        <td><div className="submission-rule-requirement">
          {localize(version.requirement)}
          <details><summary>{localize("查看执行条件")}</summary><p>{localize(version.condition)}</p></details>
        </div></td>
        <td>{localize(version.target)}</td>
        <td><span className="rule-version-status">v{localize(version.version)} {localize(" · 已停用")}</span></td>
        <td>{localize(version.disabledAt ? new Date(version.disabledAt).toLocaleString('zh-CN', { hour12: false }) : '—')}</td>
        <td>{localize(version.disabledBy ?? '—')}</td><td />
      </tr>))}{localize(!versions.length && <tr><td colSpan={showName ? 8 : 7} className="routing-empty">
        {localize(ready ? '暂无已停用版本。' : '正在读取配置…')}
      </td></tr>)}</tbody>
    </table></div>
  </details>;
}
