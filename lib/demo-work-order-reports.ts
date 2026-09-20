import { defaultReportBindings, parseReportTemplate, reportFieldNode, type ReportField, type ReportNode } from './report-templates.ts';
import type { ServiceFlow } from './service-flows';

const text = (value: string, bold = false): ReportNode => ({ type: 'text', text: value, ...(bold ? { marks: [{ type: 'bold' }] } : {}) });
const paragraph = (...content: ReportNode[]): ReportNode => ({ type: 'paragraph', content });
const heading = (value: string, level = 2): ReportNode => ({ type: 'heading', attrs: { level }, content: [text(value)] });
const list = (items: string[]): ReportNode => ({ type: 'bulletList', content: items.map(item => ({ type: 'listItem', content: [paragraph(text(item))] })) });

const profiles = {
  general: {
    name: '服务交付报告', subtitle: 'SERVICE DELIVERY',
    scope: '围绕本次工单约定范围，记录环境准备、服务实施、结果验证与运维交接。',
    focus: ['实施准备：核对服务范围、环境条件及备份状态。', '服务执行：按确认方案执行，记录关键操作和过程证据。', '交付验证：核验计算、存储和网络状态，形成可追溯的交付记录。'],
    next: ['近期：结合实际业务负载观察运行状态，对异常告警及时复核。', '日常：按既定策略执行备份与恢复演练，保留关键变更记录。', '后续变更：重新评估实施窗口、影响范围和回退条件。'],
  },
  upgrade: {
    name: '集群升级服务报告', subtitle: 'CLUSTER UPGRADE',
    scope: '记录升级前检查、升级执行过程及升级后验证，支持变更审阅与后续运维。具体版本及变更范围以已确认的实施方案和执行记录为准。',
    focus: ['升级准备：核对版本兼容性、集群健康状态、备份与回退条件。', '升级执行：按变更窗口实施，记录各阶段操作及异常处置。', '升级验证：检查节点、核心服务和关键业务访问，保留验证证据。'],
    next: ['观察期：持续关注集群告警、存储延迟及关键业务访问。', '版本管理：更新资产台账和运维文档中的版本信息。', '变更关闭：归档实施方案、执行记录及验证结果后再关闭变更。'],
  },
  inspection: {
    name: '集群健康巡检报告', subtitle: 'HEALTH ASSESSMENT',
    scope: '围绕计算、存储与网络开展健康检查，汇总现场记录和验证结果，为后续维护提供依据。',
    focus: ['计算：检查节点与核心服务状态，核对资源使用情况。', '存储：检查健康告警、容量趋势及读写延迟。', '网络：核对链路与关键访问路径，记录异常及处置建议。'],
    next: ['容量规划：结合业务增长持续跟踪资源使用率与容量趋势。', '告警治理：按影响范围梳理重复告警，明确处理人和完成时间。', '定期维护：按服务计划复查健康状态，并验证备份恢复能力。'],
  },
};

// Current demo templates bind to the same execution fields used by real reports.
export function withDemoWorkOrderReport(flow: ServiceFlow, at: string): ServiceFlow {
  const profile = profiles[flow.id.includes('upgrade') ? 'upgrade' : flow.id.includes('inspection') ? 'inspection' : 'general'];
  const field = (scope: ReportField['scope'], fieldId: string, label: string, sequence?: number, optional = false) => reportFieldNode({
    id: `${scope}:${sequence ?? ''}:${fieldId}`, scope, fieldId, label,
    ...(sequence ? { stepId: `${flow.id}-step-${sequence}` } : {}),
    emptyPolicy: optional ? 'default' : 'block', ...(optional ? { defaultText: '未填写' } : {}),
  });
  const row = (label: string, value: ReportNode) => paragraph(text(`${label}  `, true), value);
  const template = parseReportTemplate({
    id: `${flow.id}-service-report`, name: profile.name, scope: 'step', flowId: flow.id,
    version: 1, enabled: true, updatedAt: at,
    body: { type: 'doc', content: [
      paragraph(text(`SMARTX  /  ${profile.subtitle}`, true)),
      heading(profile.name, 1),
      paragraph(field('order', 'serviceName', '服务名称')),
      { type: 'blockquote', content: [paragraph(text(profile.scope))] },
      heading('01  服务概况'),
      row('项目名称', field('project', 'name', '项目名称')),
      row('客户名称', field('order', 'customerName', '客户名称')),
      row('工单编号', field('order', 'id', '工单编号')),
      row('服务方式', field('order', 'method', '服务方式')),
      row('服务方', field('order', 'providerName', '服务方')),
      row('执行工程师', field('order', 'engineers', '执行工程师')),
      row('验证日期', field('step', 'date', '验证日期', 5)),
      heading('02  服务范围与检查要点'),
      row('工单说明', field('order', 'description', '服务说明', undefined, true)),
      list(profile.focus),
      heading('03  环境基线'),
      row('集群名称', field('step', 'cluster', '集群名称', 1)),
      row('节点数量', field('step', 'nodes', '节点数量', 1)),
      row('健康检查', field('step', 'health', '健康检查结果', 1)),
      row('检查范围', field('step', 'checks', '已检查项目', 1)),
      row('存储延迟（毫秒）', field('step', 'latency', '存储延迟', 1, true)),
      heading('04  执行记录'),
      paragraph(field('step', 'general:description', '执行说明', 3)),
      row('过程附件', field('step', 'general:attachments', '附件名称', 3, true)),
      heading('05  结果验证'),
      row('验证通过', field('step', 'passed', '验证通过', 5)),
      { type: 'blockquote', content: [paragraph(field('step', 'notes', '验证记录', 5))] },
      heading('06  后续建议'),
      list(profile.next),
      { type: 'horizontalRule' },
      paragraph(text('服务记录 · ', true), field('order', 'id', '工单编号'), text('  /  '), field('step', 'date', '验证日期', 5)),
    ] },
  });
  const selection = { template, bindings: defaultReportBindings(template, flow.steps) };
  return { ...flow, reportTemplates: [template], steps: flow.steps.map(step => step.id !== `${flow.id}-step-7` ? step : {
    ...step, documents: (step.documents ?? []).map(doc => ({ ...doc, name: profile.name, instructions: '依据工单及步骤记录生成报告，核对正文后保存为客户交付物。', template: undefined, reportTemplate: structuredClone(selection) })),
  }) };
}
