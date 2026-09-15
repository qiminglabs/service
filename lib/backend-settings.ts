export const backendSettingsSections = [
  { key: 'forms', label: '服务请求表单', tabs: [{ key: 'request-items', label: '服务项字段' }, { key: 'application-fields', label: '申请项字段' }] },
  { key: 'request-rules', label: '服务请求规则', tabs: [
    { key: 'collaborators', label: '协作人规则' },
    { key: 'submission', label: '提交检验规则' },
  ] },
  { key: 'request-flow', label: '服务请求流程', tabs: [
    { key: 'assessment-manager', label: '项目经理分配' },
    { key: 'assessment-hardware', label: '硬件产品经理分配' },
    { key: 'approval-designer', label: '特殊审批流程' },
  ] },
  { key: 'pricing', label: '计价与权益', tabs: [{ key: 'entitlement-conversions', label: '权益换算' }] },
  { key: 'execution-flow', label: '服务执行流程', tabs: [
    { key: 'execution-flows', label: '执行流程' },
    { key: 'execution-assignments', label: '执行流程分配' },
  ] },
] as const;

export type BackendSettingsSection = typeof backendSettingsSections[number]['key'];
export type RequestFlowTab = Extract<typeof backendSettingsSections[number], { key: 'request-flow' }>['tabs'][number]['key'];
