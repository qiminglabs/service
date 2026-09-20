'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { FlowNode } from '@/components/request-flow-diagram';
import type { ExecutionFlowTab } from '@/lib/backend-settings';

export function ExecutionFlowDiagram({ activeTab, tabId, onTabSelect }: {
  activeTab: string;
  tabId: (tab: ExecutionFlowTab) => string;
  onTabSelect: (tab: ExecutionFlowTab) => void;
}) {
  const arrowId = `execution-flow-arrow-${useId().replaceAll(':', '')}`;
  const navigation = (tab: ExecutionFlowTab) => ({ href: `#${tabId(tab)}`, active: activeTab === tab, onNavigate: () => onTabSelect(tab) });
  return <details className="request-flow-map-panel">
    <summary>服务执行流程图<ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="request-flow-map-scroll">
      <svg className="request-flow-map request-flow-map--execution" viewBox="0 0 1500 218" role="group" aria-label="服务执行流程：转换或创建服务项目，工单派发，工单执行。所有未取消工单完成后，内部创建项目由任意已指派执行工程师手动提交复核，由项目经理确认工时并核定最终人天，核对服务依据，足额后发起客户确认；可补充服务依据或发起独立的服务项目特殊审批，审批通过后增加服务依据。合作伙伴创建项目跳过复核和服务依据关联，直接发起客户确认。客户确认通过后系统自动完成项目，内部创建项目同时自动核销服务资产。转换项目、工单派发、工单执行及特殊审批节点可打开对应配置。">
        <defs><marker id={arrowId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#94a8be" /></marker></defs>
        <g className="request-flow-map-links" markerEnd={`url(#${arrowId})`}>
          <line x1="181" y1="100" x2="224" y2="100" />
          <line x1="341" y1="100" x2="394" y2="100" />
          <line x1="511" y1="100" x2="654" y2="100" />
          <line x1="789" y1="100" x2="904" y2="100" />
          <line x1="1039" y1="100" x2="1174" y2="100" />
          <line x1="1291" y1="100" x2="1364" y2="100" />
          <path d="M 565 100 V 40 H 1233 V 84" />
          <line x1="948" y1="116" x2="948" y2="164" />
          <line x1="996" y1="164" x2="996" y2="116" />
        </g>
        <g className="request-flow-map-labels">
          <text x="595" y="87">内部创建</text>
          <text x="580" y="28">合作伙伴创建</text>
          <text x="522" y="125">工单全部完成</text>
          <text x="1070" y="87">足额</text>
          <text x="936" y="144" textAnchor="end">按需申请</text>
          <text x="1008" y="144">通过</text>
          <text x="1306" y="87">通过</text>
        </g>
        <FlowNode x={14} y={80} width={172} label="转换／创建服务项目" owners={['转换：负责项目经理', '创建：内部人员或合作伙伴']} terminal navigationLabel="请求转项目映射" {...navigation('request-project-mapping')} />
        <FlowNode x={220} y={80} label="工单派发" owners={['负责项目经理或合作伙伴项目创建人']} navigationLabel="服务商管理" {...navigation('service-providers')} />
        <FlowNode x={390} y={80} label="工单执行" owners={['工单执行人']} navigationLabel="服务流程" {...navigation('service-flows')} />
        <FlowNode x={650} y={80} width={144} label="人天核定" owners={['负责项目经理']} />
        <FlowNode x={900} y={80} width={144} label="服务依据核销" owners={['内部申请人或客户所有人']} />
        <FlowNode x={900} y={160} width={144} label="特殊审批流程" owners={['发起：内部申请人或客户所有人', '审批：系统按规则分配']} optional {...navigation('project-approval-designer')} />
        <FlowNode x={1170} y={80} label="客户确认" owners={['客户协作人']} />
        <FlowNode x={1360} y={80} label="项目完成" owners={['客户确认后系统自动完成']} terminal />
      </svg>
    </div>
  </details>;
}
