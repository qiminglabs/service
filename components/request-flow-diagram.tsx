'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { serviceProjectCreationEnabled } from '@/lib/request-projects';
import type { RequestFlowTab } from '@/lib/backend-settings';

function FlowNode({ x, y, width = 126, label, owners, optional = false, terminal = false, pending = false, href, active, navigationLabel, onNavigate }: {
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
  navigationLabel?: string;
  onNavigate?: () => void;
}) {
  const content = <>
    <rect x={x + 5} y={y + 4} width={width - 10} height={32} rx={6} />
    <text className="request-flow-map-node-title" x={x + width / 2} y={y + 20} dominantBaseline="middle" textAnchor="middle">{label}</text>
  </>;
  return <g className="request-flow-map-node" data-optional={optional || undefined} data-terminal={terminal || undefined} data-interactive={!!href || undefined} data-active={active || undefined}>
    <Tooltip>
      <TooltipTrigger delay={150} render={href
        ? <a href={href} aria-label={`${label}，${owners.join('，')}，打开下方${navigationLabel ?? label}配置`} onClick={event => { event.preventDefault(); onNavigate?.(); }} />
        : <g tabIndex={0} role="img" aria-label={`${label}，${owners.join('，')}`} />}
      >{content}</TooltipTrigger>
      <TooltipContent>
        <div>{owners.map(owner => <div key={owner}>{owner}</div>)}</div>
      </TooltipContent>
    </Tooltip>
    {pending && <text className="request-flow-map-pending" x={x + width / 2} y={y + 50} dominantBaseline="middle" textAnchor="middle">待开放</text>}
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
    <div className="request-flow-map-scroll">
      <svg className="request-flow-map" viewBox="0 0 1320 188" role="group" aria-label="服务请求流程及处理人：申请人提交，系统分配负责人；硬件产品经理先评估，负责项目经理完成材料评估及人天核定；内部申请人或客户所有人关联服务依据。额度不足时由内部申请人或负责销售发起特殊审批，指定审批人审批。客户确认后，由负责项目经理受理并转换服务项目。提交服务请求可跳转提交校验，两个分配节点及特殊审批可跳转对应配置。">
        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a8be" /></marker></defs>
        <g className="request-flow-map-links" markerEnd={`url(#${arrowId})`}>
          <line x1="140" y1="100" x2="194" y2="100" />
          <path d="M 166 100 V 40 H 194" />
          <line x1="334" y1="40" x2="380" y2="40" />
          <line x1="320" y1="100" x2="380" y2="100" />
          <line x1="443" y1="56" x2="443" y2="84" />
          <line x1="506" y1="100" x2="556" y2="100" />
          <line x1="670" y1="100" x2="714" y2="100" />
          <line x1="840" y1="100" x2="904" y2="100" />
          <line x1="777" y1="116" x2="777" y2="144" />
          <path d="M 840 160 H 964 V 116" />
          <line x1="1024" y1="100" x2="1060" y2="100" />
          <line x1="1144" y1="100" x2="1178" y2="100" />
        </g>
        <g className="request-flow-map-labels">
          <text x="194" y="12">命中触发条件</text>
          <text x="454" y="76">先通过</text>
          <text x="517" y="87">通过</text>
          <text x="858" y="87">足额</text>
          <text x="789" y="136">不足</text>
          <text x="884" y="148">通过</text>
        </g>
        <FlowNode x={14} y={80} label="提交服务请求" owners={['申请人']} terminal navigationLabel="提交校验" {...navigation('submission')} />
        <FlowNode x={194} y={20} width={140} label="硬件产品经理分配" owners={['系统按规则分配']} optional {...navigation('assessment-hardware')} />
        <FlowNode x={380} y={20} label="硬件产品经理评估" owners={['硬件产品经理']} optional />
        <FlowNode x={194} y={80} label="项目经理分配" owners={['系统按规则分配']} {...navigation('assessment-manager')} />
        <FlowNode x={380} y={80} label="项目经理评估" owners={['负责项目经理']} />
        <FlowNode x={556} y={80} width={114} label="人天核定" owners={['负责项目经理']} />
        <FlowNode x={714} y={80} label="服务依据关联" owners={['内部申请人或客户所有人']} />
        <FlowNode x={714} y={140} label="特殊审批" owners={['发起：内部申请人或负责销售', '审批：指定上级审批人']} optional {...navigation('approval-designer')} />
        <FlowNode x={904} y={80} width={120} label="客户确认" owners={['客户']} />
        <FlowNode x={1060} y={80} width={84} label="待受理" owners={['负责项目经理']} />
        <FlowNode x={1178} y={80} label="转换服务项目" owners={['负责项目经理']} terminal pending={!serviceProjectCreationEnabled} />
      </svg>
    </div>
  </details>;
}
