'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { serviceProjectCreationEnabled } from '@/lib/request-projects';

function FlowNode({
  x,
  y,
  width = 126,
  label,
  optional = false,
  terminal = false,
  pending = false,
}: {
  x: number;
  y: number;
  width?: number;
  label: string;
  optional?: boolean;
  terminal?: boolean;
  pending?: boolean;
}) {
  return (
    <g
      className="request-flow-map-node"
      data-optional={optional || undefined}
      data-terminal={terminal || undefined}
    >
      <rect x={x + 5} y={y + 4} width={width - 10} height={40} rx={6} />
      <text
        x={x + width / 2}
        y={y + (pending ? 18 : 24)}
        dominantBaseline="middle"
        textAnchor="middle"
      >
        {label}
      </text>
      {pending && (
        <text
          className="request-flow-map-pending"
          x={x + width / 2}
          y={y + 33}
          dominantBaseline="middle"
          textAnchor="middle"
        >
          待开放
        </text>
      )}
    </g>
  );
}

export function RequestFlowDiagram() {
  const arrowId = `request-flow-arrow-${useId().replaceAll(':', '')}`;
  return (
    <details className="request-flow-map-panel">
      <summary>
        服务请求流程图
        <ChevronDown size={16} aria-hidden="true" />
      </summary>
      <div className="request-flow-map-scroll">
        <svg
          className="request-flow-map"
          viewBox="0 0 1320 238"
          aria-label="服务请求流程：提交后分配项目经理；命中触发条件时增加硬件产品经理分配和评估，硬件先通过后项目经理才能通过整体材料评估。之后进行人天核定、服务依据关联，额度不足时先特批，再由客户确认，进入待受理，最后转换服务项目。"
        >
          <defs>
            <marker
              id={arrowId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a8be" />
            </marker>
          </defs>
          <g className="request-flow-map-links" markerEnd={`url(#${arrowId})`}>
            <path d="M 140 132 H 194" />
            <path d="M 166 132 V 50 H 194" />
            <path d="M 334 50 H 380" />
            <path d="M 320 132 H 380" />
            <path d="M 443 74 V 108" />
            <path d="M 506 132 H 556" />
            <path d="M 670 132 H 714" />
            <path d="M 840 132 H 904" />
            <path d="M 777 156 V 184" />
            <path d="M 840 208 H 964 V 156" />
            <path d="M 1024 132 H 1060" />
            <path d="M 1144 132 H 1178" />
          </g>
          <g className="request-flow-map-labels">
            <text x="194" y="14">
              命中触发条件
            </text>
            <text x="454" y="90">
              先通过
            </text>
            <text x="517" y="119">
              通过
            </text>
            <text x="858" y="119">
              足额
            </text>
            <text x="789" y="177">
              不足
            </text>
            <text x="910" y="198">
              通过
            </text>
          </g>
          <FlowNode x={14} y={108} label="提交服务请求" terminal />
          <FlowNode
            x={194}
            y={26}
            width={140}
            label="硬件产品经理分配"
            optional
          />
          <FlowNode x={380} y={26} label="硬件产品经理评估" optional />
          <FlowNode x={194} y={108} label="项目经理分配" />
          <FlowNode x={380} y={108} label="项目经理评估" />
          <FlowNode x={556} y={108} width={114} label="人天核定" />
          <FlowNode x={714} y={108} label="服务依据关联" />
          <FlowNode x={714} y={184} label="额度特批" optional />
          <FlowNode x={904} y={108} width={120} label="客户确认" />
          <FlowNode x={1060} y={108} width={84} label="待受理" />
          <FlowNode
            x={1178}
            y={108}
            label="转换服务项目"
            terminal
            pending={!serviceProjectCreationEnabled}
          />
        </svg>
      </div>
    </details>
  );
}
