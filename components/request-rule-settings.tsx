'use client';
import { useI18n } from '@/lib/i18n/context';


import { SubmissionRuleSettings } from '@/components/submission-rule-settings';
import type { OperationActor } from '@/lib/request-operations';

export function RequestRuleSettings({ tab, actor }: { tab: 'collaborators' | 'submission'; actor: OperationActor }) {
  const { localize } = useI18n();
  const collaborators = tab === 'collaborators';
  if (!collaborators) return <SubmissionRuleSettings actor={actor} />;
  return <div className="request-flow-settings">
    <section className="routing-rules" aria-label={localize("协作人分配规则")}>
    <div className="submission-rules-toolbar">
      <div><strong>{localize("协作人分配规则")}</strong></div>
    </div>
    <div className="table-scroll">
      {localize(collaborators ? <table className="reference-table app-list-table">
        <thead><tr><th>{localize("适用申请")}</th><th>{localize("添加时机")}</th><th>{localize("自动添加人员")}</th><th>{localize("加入位置")}</th><th>{localize("身份标记")}</th><th>{localize("允许移除")}</th></tr></thead>
        <tbody>
          <tr><td>{localize("全部申请")}</td><td>{localize("选择或切换客户时")}</td><td>{localize("客户所有人")}</td><td>{localize("内部协作人")}</td><td>{localize("客户所有人")}</td><td>{localize("否")}</td></tr>
          <tr><td>{localize("全部申请")}</td><td>{localize("负责人分配或重新分配成功时")}</td><td>{localize("分配的项目经理")}</td><td>{localize("内部协作人")}</td><td>{localize("项目经理")}</td><td>{localize("否")}</td></tr>
          <tr><td>{localize("触发硬件评估的申请")}</td><td>{localize("负责人分配或重新分配成功时")}</td><td>{localize("分配的硬件产品经理")}</td><td>{localize("内部协作人")}</td><td>{localize("硬件产品经理")}</td><td>{localize("否")}</td></tr>
          <tr><td>{localize("内部申请")}</td><td>{localize("创建申请时")}</td><td>{localize("申请创建人")}</td><td>{localize("内部协作人")}</td><td>{localize("申请人")}</td><td>{localize("否")}</td></tr>
          <tr><td>{localize("客户申请")}</td><td>{localize("创建申请时")}</td><td>{localize("申请创建人")}</td><td>{localize("客户协作人")}</td><td>{localize("申请人")}</td><td>{localize("否")}</td></tr>
        </tbody>
      </table> : null)}
    </div>
    </section>
  </div>;
}
