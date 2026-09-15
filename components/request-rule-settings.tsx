'use client';

import { SubmissionRuleSettings } from '@/components/submission-rule-settings';
import type { OperationActor } from '@/lib/request-operations';

export function RequestRuleSettings({ tab, actor }: { tab: 'collaborators' | 'submission'; actor: OperationActor }) {
  const collaborators = tab === 'collaborators';
  if (!collaborators) return <SubmissionRuleSettings actor={actor} />;
  return <div className="request-flow-settings">
    <section className="routing-rules" aria-label="协作人分配规则">
    <div className="submission-rules-toolbar">
      <div><strong>协作人分配规则</strong></div>
    </div>
    <div className="table-scroll">
      {collaborators ? <table className="reference-table app-list-table">
        <thead><tr><th>适用申请</th><th>添加时机</th><th>自动添加人员</th><th>加入位置</th><th>身份标记</th><th>允许移除</th></tr></thead>
        <tbody>
          <tr><td>全部申请</td><td>选择或切换客户时</td><td>客户所有人</td><td>内部协作人</td><td>客户所有人</td><td>否</td></tr>
          <tr><td>全部申请</td><td>负责人分配或重新分配成功时</td><td>分配的项目经理</td><td>内部协作人</td><td>项目经理</td><td>否</td></tr>
          <tr><td>触发硬件评估的申请</td><td>负责人分配或重新分配成功时</td><td>分配的硬件产品经理</td><td>内部协作人</td><td>硬件产品经理</td><td>否</td></tr>
          <tr><td>内部申请</td><td>创建申请时</td><td>申请创建人</td><td>内部协作人</td><td>申请人</td><td>否</td></tr>
          <tr><td>客户申请</td><td>创建申请时</td><td>申请创建人</td><td>客户协作人</td><td>申请人</td><td>否</td></tr>
        </tbody>
      </table> : null}
    </div>
    </section>
  </div>;
}
