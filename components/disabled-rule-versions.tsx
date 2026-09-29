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
  const title = showName ? '条件审批规则（已停用）' : '条件分配规则（已停用）';
  return <details className="routing-rules disabled-rule-versions" aria-label={title}>
    <summary className="submission-rules-toolbar"><strong>{title}</strong></summary>
    <div className="table-scroll"><table className={`reference-table app-list-table ${showName ? 'approval-rules-table' : 'routing-table'}`}>
      <thead><tr>
        <th>优先级</th>{showName && <th>规则名称</th>}<th>自然语言描述</th><th>{targetLabel}</th>
        <th>版本 / 状态</th><th>停用时间</th><th>停用人</th><th data-list-actions>操作</th>
      </tr></thead>
      <tbody>{versions.map(version => <tr key={version.key}>
        <td>{version.priority}</td>{showName && <td><strong>{version.name}</strong></td>}
        <td><div className="submission-rule-requirement">
          {version.requirement}
          <details><summary>查看执行条件</summary><p>{version.condition}</p></details>
        </div></td>
        <td>{version.target}</td>
        <td><span className="rule-version-status">v{version.version} · 已停用</span></td>
        <td>{version.disabledAt ? new Date(version.disabledAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
        <td>{version.disabledBy ?? '—'}</td><td />
      </tr>)}{!versions.length && <tr><td colSpan={showName ? 8 : 7} className="routing-empty">
        {ready ? '暂无已停用版本。' : '正在读取配置…'}
      </td></tr>}</tbody>
    </table></div>
  </details>;
}
