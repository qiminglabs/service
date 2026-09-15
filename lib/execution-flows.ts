export type ExecutionAttachment = { id: string; name: string; data: string; size: number };
export type ExecutionStep = {
  id: string; name: string; description: string; links: string[]; attachments: ExecutionAttachment[];
  enabled: boolean; required: boolean; deliverable: boolean; type: 'form' | 'upload' | 'document';
  formFields: string[]; fileExtensions: string; maxFiles: number; maxFileSizeMB: number; documentTemplate: string;
};
export type ExecutionFlow = {
  id: string; name: string; description: string; enabled: boolean; steps: ExecutionStep[];
  updatedAt?: string; updatedBy?: string;
};
export type ExecutionAssignment = {
  id: string; name: string; serviceId: string; customerTeams: string[]; flowId: string; priority: number; enabled: boolean;
};
export type ExecutionConfig = { version: 1; revision: number; flows: ExecutionFlow[]; assignments: ExecutionAssignment[] };
export const executionConfigId = 'execution-flows-v1';
export const emptyExecutionConfig = (): ExecutionConfig => ({ version: 1, revision: 0, flows: [], assignments: [] });
export const executionStepTypes = { form: '表单', upload: '上传文件', document: '文档' } as const;
export function newExecutionStep(): ExecutionStep {
  return { id: crypto.randomUUID(), name: '', description: '', links: [], attachments: [], enabled: true, required: true,
    deliverable: false, type: 'form', formFields: [], fileExtensions: '', maxFiles: 5, maxFileSizeMB: 20, documentTemplate: '' };
}
export function copyExecutionStep(step: ExecutionStep): ExecutionStep {
  return { ...structuredClone(step), id: crypto.randomUUID() };
}
export function copyExecutionFlow(flow: ExecutionFlow): ExecutionFlow {
  return { ...structuredClone(flow), id: crypto.randomUUID(), name: `${flow.name}（副本）`, enabled: false,
    steps: flow.steps.map(copyExecutionStep), updatedAt: undefined, updatedBy: undefined };
}
export function assignmentsOverlap(a: ExecutionAssignment, b: ExecutionAssignment) {
  return a.serviceId === b.serviceId && (!a.customerTeams.length || !b.customerTeams.length || a.customerTeams.some(team => b.customerTeams.includes(team)));
}
export function executionConfigIssue(config: ExecutionConfig, services: { id: string }[]): string | undefined {
  if (new Set(config.flows.map(flow => flow.id)).size !== config.flows.length || new Set(config.assignments.map(rule => rule.id)).size !== config.assignments.length) return '存在重复记录。';
  for (const flow of config.flows) {
    if (!flow.name.trim()) return '请填写流程名称。';
    if (flow.enabled && !flow.steps.some(step => step.enabled)) return `「${flow.name}」至少需要一个启用步骤才能启用。`;
    if (new Set(flow.steps.map(step => step.id)).size !== flow.steps.length) return '流程内存在重复步骤。';
    for (const step of flow.steps) {
      if (!step.name.trim()) return '请填写每个步骤的名称。';
      if (!(step.type in executionStepTypes)) return '请选择有效的步骤类型。';
      if (step.links.some(link => { try { return !['https:', 'http:'].includes(new URL(link).protocol); } catch { return true; } })) return '说明链接必须是完整的 http 或 https 地址。';
      if (step.attachments.some(file => file.size > 5 * 1024 * 1024 || !file.data.startsWith('data:'))) return '说明附件无效或超过 5 MB。';
      if (step.type === 'form' && step.enabled && !step.formFields.some(field => field.trim())) return `请为「${step.name}」添加表单字段。`;
      if (step.type === 'form' && new Set(step.formFields.map(field => field.trim())).size !== step.formFields.length) return '表单字段名称不能重复。';
      if (step.type === 'upload' && (!Number.isInteger(step.maxFiles) || step.maxFiles < 1 || step.maxFiles > 50 || !Number.isFinite(step.maxFileSizeMB) || step.maxFileSizeMB < 1 || step.maxFileSizeMB > 100)) return '文件数量须为 1–50，单文件大小须为 1–100 MB。';
    }
  }
  for (const rule of config.assignments) {
    if (!rule.name.trim() || !rule.serviceId || !rule.flowId) return '请填写规则名称、服务目录和执行流程。';
    if (!Number.isInteger(rule.priority) || rule.priority < 0 || rule.priority > 9999) return '优先级须为 0–9999 的整数，数值越大越优先。';
    const flow = config.flows.find(flow => flow.id === rule.flowId);
    if (!flow) return '分配规则引用的流程不存在。';
    if (rule.enabled && !flow.enabled) return `请先停用「${rule.name}」分配规则，再停用其流程。`;
    if (rule.enabled && !services.some(service => service.id === rule.serviceId)) return '分配规则的服务目录已不存在，请重新选择或停用规则。';
    if (rule.enabled && config.assignments.some(other => other.id !== rule.id && other.enabled && other.priority === rule.priority && assignmentsOverlap(rule, other))) return '同优先级的启用规则存在条件重叠，请调整条件或优先级。';
  }
}
export function matchExecutionFlow(config: ExecutionConfig, serviceId: string, customerTeam: string) {
  const rule = config.assignments.filter(rule => rule.enabled && rule.serviceId === serviceId &&
    (!rule.customerTeams.length || rule.customerTeams.includes(customerTeam)) && config.flows.some(flow => flow.id === rule.flowId && flow.enabled))
    .sort((a, b) => b.priority - a.priority)[0];
  return rule ? { rule, flow: config.flows.find(flow => flow.id === rule.flowId)! } : undefined;
}
// Capture at execution creation; future template edits cannot alter this snapshot.
export function executionFlowSnapshot(flow: ExecutionFlow) {
  return { ...structuredClone(flow), steps: structuredClone(flow.steps.filter(step => step.enabled)) };
}
