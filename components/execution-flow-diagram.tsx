'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { FlowNode } from '@/components/request-flow-diagram';

const executionStages = [
  { label: '转换/创建服务项目', owner: '项目经理', x: 20, width: 172 },
  { label: '分派工单', owner: '项目经理', x: 240, width: 120 },
  { label: '执行服务', owner: '服务工程师', x: 408, width: 126 },
  { label: '项目经理复核', owner: '项目经理', x: 582, width: 144 },
  { label: '服务依据关联', owner: '内部申请人或客户所有人', x: 774, width: 144 },
  { label: '客户确认', owner: '客户', x: 966, width: 126 },
  { label: '项目完成', owner: '项目经理', x: 1140, width: 144 },
] as const;

export function ExecutionFlowDiagram() {
  const arrowId = `execution-flow-arrow-${useId().replaceAll(':', '')}`;
  return <details className="request-flow-map-panel" open>
    <summary>服务执行流程图<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="request-flow-map-scroll">
      <svg className="request-flow-map" viewBox="0 0 1320 148" role="group" aria-label={`服务执行流程及处理人：${executionStages.map(stage => `${stage.label}（${stage.owner}）`).join(' → ')}。所有项目复核后均须关联服务依据，足额后进入客户确认。不足时由内部申请人或客户所有人发起特殊审批，审批人由系统按规则分配，通过后进入客户确认。特殊项目完成后可进行项目复盘，由项目经理负责，待开放。`}>
        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a8be" /></marker></defs>
        <g className="request-flow-map-links" markerEnd={`url(#${arrowId})`}>
          {executionStages.slice(0, -1).map((stage, index) => <line key={stage.label} x1={stage.x + stage.width - 5} y1={40} x2={executionStages[index + 1].x + 4} y2={40} />)}
          <line x1={846} y1={56} x2={846} y2={84} />
          <path d="M 913 100 H 1029 V 56" />
          <line x1={1212} y1={56} x2={1212} y2={84} />
        </g>
        <g className="request-flow-map-labels">
          <text x={931} y={27}>足额</text>
          <text x={858} y={76}>不足</text>
          <text x={956} y={88}>通过</text>
          <text x={1224} y={76}>特殊项目</text>
        </g>
        {executionStages.map((stage, index) => <FlowNode key={stage.label} x={stage.x} y={20} width={stage.width} label={stage.label} owners={[stage.owner]} terminal={index === 0 || index === executionStages.length - 1} />)}
        <FlowNode x={774} y={80} width={144} label="特殊审批" owners={['发起：内部申请人或客户所有人', '审批：系统按规则分配']} optional />
        <FlowNode x={1140} y={80} width={144} label="项目复盘" owners={['项目经理']} optional pending />
      </svg>
    </div>
  </details>;
}
