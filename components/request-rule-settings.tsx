'use client';

import { SubmissionRuleSettings } from '@/components/submission-rule-settings';
import type { OperationActor } from '@/lib/request-operations';

export function RequestRuleSettings({ tab, actor }: { tab: 'collaborators' | 'submission'; actor: OperationActor }) {
  const collaborators = tab === 'collaborators';
  if (!collaborators) return <SubmissionRuleSettings actor={actor} />;
  return <>
    <p className="backend-rules-note">现行规则，仅供查看。</p>
    <div className="table-scroll">
      {collaborators ? <table className="reference-table app-list-table">
        <thead><tr><th>适用申请</th><th>自动添加人员</th><th>加入位置</th><th>身份标记</th><th>允许移除</th></tr></thead>
        <tbody>
          <tr><td>全部申请</td><td>客户所有人</td><td>内部协作人</td><td>客户所有人</td><td>否</td></tr>
          <tr><td>内部申请</td><td>申请创建人</td><td>内部协作人</td><td>申请人</td><td>否</td></tr>
          <tr><td>客户申请</td><td>申请创建人</td><td>客户协作人</td><td>申请人</td><td>否</td></tr>
        </tbody>
      </table> : null}
    </div>
  </>;
}
