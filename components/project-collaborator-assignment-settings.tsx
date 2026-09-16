'use client';

import { projectCollaboratorAssignmentRules } from '@/lib/project-collaborator-assignment';

export function ProjectCollaboratorAssignmentSettings() {
  return <div className="request-flow-settings">
    <section className="routing-rules" aria-label="项目协作人分配规则">
      <div className="submission-rules-toolbar"><div><strong>协作人分配规则</strong></div></div>
      <div className="table-scroll"><table className="reference-table app-list-table">
        <thead><tr><th>适用项目</th><th>添加时机</th><th>自动添加人员</th><th>加入位置</th><th>身份标记</th><th>允许移除</th></tr></thead>
        <tbody>{projectCollaboratorAssignmentRules.map(rule => <tr key={rule.id}>
          <td>{rule.scope}</td><td>{rule.timing}</td><td>{rule.source}</td><td>{rule.target}</td><td>{rule.identity}</td><td>否</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </div>;
}
