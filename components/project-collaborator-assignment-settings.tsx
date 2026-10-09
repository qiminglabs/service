'use client';
import { useI18n } from '@/lib/i18n/context';


import { projectCollaboratorAssignmentRules } from '@/lib/project-collaborator-assignment';

export function ProjectCollaboratorAssignmentSettings() {
  const { localize } = useI18n();
  return <div className="request-flow-settings">
    <section className="routing-rules" aria-label={localize("项目协作人分配规则")}>
      <div className="submission-rules-toolbar"><div><strong>{localize("协作人分配规则")}</strong></div></div>
      <div className="table-scroll"><table className="reference-table app-list-table">
        <thead><tr><th>{localize("适用项目")}</th><th>{localize("添加时机")}</th><th>{localize("自动添加人员")}</th><th>{localize("加入位置")}</th><th>{localize("身份标记")}</th><th>{localize("允许移除")}</th></tr></thead>
        <tbody>{localize(projectCollaboratorAssignmentRules.map(rule => <tr key={rule.id}>
          <td>{localize(rule.scope)}</td><td>{localize(rule.timing)}</td><td>{localize(rule.source)}</td><td>{localize(rule.target)}</td><td>{localize(rule.identity)}</td><td>{localize("否")}</td>
        </tr>))}</tbody>
      </table></div>
    </section>
  </div>;
}
