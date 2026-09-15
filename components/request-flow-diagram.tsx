'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { serviceProjectCreationEnabled } from '@/lib/request-projects';
import type { RequestFlowTab } from '@/lib/backend-settings';

function FlowNode({ x, y, width = 126, label, owners, optional = false, terminal = false, pending = false, href, active, onNavigate }: {
  x: number;
  y: number;
  width?: number;
  label: string;
  owners: string[];
  optional?: boolean;
  terminal?: boolean;
  pending?: boolean;
  href?: string;
  active?: boolean;
  onNavigate?: () => void;
}) {
  const content = <>
    <rect x={x + 5} y={y + 4} width={width - 10} height={72} rx={6} />
    <text className="request-flow-map-node-title" x={x + width / 2} y={y + 23} dominantBaseline="middle" textAnchor="middle">{label}</text>
    {owners.map((owner, index) => <text key={owner} className="request-flow-map-owner" x={x + width / 2} y={y + 44 + index * 16} dominantBaseline="middle" textAnchor="middle">{owner}</text>)}
    {pending && <text className="request-flow-map-pending" x={x + width / 2} y={y + 62} dominantBaseline="middle" textAnchor="middle">待开放</text>}
  </>;
  return <g className="request-flow-map-node" data-optional={optional || undefined} data-terminal={terminal || undefined} data-interactive={!!href || undefined} data-active={active || undefined}>
    {href ? <a href={href} aria-label={`${label}，${owners.join('，')}，打开下方${label}配置`} onClick={event => { event.preventDefault(); onNavigate?.(); }}>{content}</a> : content}
  </g>;
}

export function RequestFlowDiagram({ activeTab, tabId, onTabSelect }: {
  activeTab: string;
  tabId: (tab: RequestFlowTab) => string;
  onTabSelect: (tab: RequestFlowTab) => void;
}) {
  const arrowId = `request-flow-arrow-${useId().replaceAll(':', '')}`;
  const navigation = (tab: RequestFlowTab) => ({ href: `#${tabId(tab)}`, active: activeTab === tab, onNavigate: () => onTabSelect(tab) });
  return <details className="request-flow-map-panel">
    <summary>服务请求流程图<ChevronDown size={16} aria-hidden="true" /></summary>
    <p className="request-flow-map-help">各环节下方标注处理人；点击蓝色节点，打开下方对应配置。</p>
    <div className="request-flow-map-scroll">
      <svg className="request-flow-map" viewBox="0 0 1320 356" role="group" aria-label="服务请求流程及处理人：申请人提交，系统分配负责人；硬件产品经理先评估，负责项目经理完成材料评估及人天核定；内部申请人或客户所有人关联服务依据。额度不足时由负责销售发起特殊审批，指定审批人审批。客户确认后，由负责项目经理受理并转换服务项目。两个分配节点及特殊审批流程可跳转配置。">
        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a8be" /></marker></defs>
        <g className="request-flow-map-links" markerEnd={`url(#${arrowId})`}>
          <path d="M 140 194 H 194" />
          <path d="M 166 194 V 70 H 194" />
          <path d="M 334 70 H 380" />
          <path d="M 320 194 H 380" />
          <path d="M 443 106 V 158" />
          <path d="M 506 194 H 556" />
          <path d="M 670 194 H 714" />
          <path d="M 840 194 H 904" />
          <path d="M 777 230 V 270" />
          <path d="M 840 306 H 964 V 230" />
          <path d="M 1024 194 H 1060" />
          <path d="M 1144 194 H 1178" />
        </g>
        <g className="request-flow-map-labels">
          <text x="194" y="20">命中触发条件</text>
          <text x="454" y="136">先通过</text>
          <text x="517" y="181">通过</text>
          <text x="858" y="181">足额</text>
          <text x="789" y="255">不足</text>
          <text x="910" y="296">通过</text>
        </g>
        <FlowNode x={14} y={154} label="提交服务请求" owners={['申请人']} terminal />
        <FlowNode x={194} y={30} width={140} label="硬件产品经理分配" owners={['系统按规则分配']} optional {...navigation('assessment-hardware')} />
        <FlowNode x={380} y={30} label="硬件产品经理评估" owners={['硬件产品经理']} optional />
        <FlowNode x={194} y={154} label="项目经理分配" owners={['系统按规则分配']} {...navigation('assessment-manager')} />
        <FlowNode x={380} y={154} label="项目经理评估" owners={['负责项目经理']} />
        <FlowNode x={556} y={154} width={114} label="人天核定" owners={['负责项目经理']} />
        <FlowNode x={714} y={154} label="服务依据关联" owners={['内部申请人', '或客户所有人']} />
        <FlowNode x={714} y={266} label="特殊审批流程" owners={['负责销售发起', '指定上级审批人审批']} optional {...navigation('approval-designer')} />
        <FlowNode x={904} y={154} width={120} label="客户确认" owners={['客户']} />
        <FlowNode x={1060} y={154} width={84} label="待受理" owners={['项目经理']} />
        <FlowNode x={1178} y={154} label="转换服务项目" owners={['负责项目经理']} terminal pending={!serviceProjectCreationEnabled} />
      </svg>
    </div>
    <p className="request-flow-map-help request-flow-map-responsibility">内部申请由内部申请人关联服务依据并发起客户确认；外部申请由客户所有人处理，客户完成确认。两个分配节点由系统执行，分配规则由系统管理员维护。</p>
  </details>;
}
