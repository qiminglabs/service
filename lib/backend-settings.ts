export const backendSettingsSections = [
  { key: 'forms', label: '服务请求字段', tabs: [{ key: 'request-items', label: '服务项字段' }, { key: 'application-fields', label: '服务申请字段' }] },
  { key: 'project-forms', label: '服务项目字段', tabs: [{ key: 'project-fields', label: '服务项目字段' }] },
  { key: 'request-flow', label: '服务请求流程', tabs: [
    { key: 'collaborators', label: '协作人分配' },
    { key: 'submission', label: '提交校验' },
    { key: 'assessment-manager', label: '项目经理分配' },
    { key: 'assessment-hardware', label: '硬件产品经理分配' },
    { key: 'approval-designer', label: '特殊审批' },
  ] },
  { key: 'execution-flow', label: '服务执行流程', tabs: [
    { key: 'project-collaborators', label: '协作人分配' },
    { key: 'request-project-mapping', label: '请求转项目映射' },
    { key: 'service-providers', label: '服务商管理' },
    { key: 'service-flows', label: '服务流程' },
    { key: 'execution-form-library', label: '服务步骤表单' },
    { key: 'project-approval-designer', label: '特殊审批流程' },
    { key: 'service-mail-templates', label: '邮件模板' },
  ] },
  { key: 'pricing', label: '计价与权益', tabs: [{ key: 'entitlement-conversions', label: '权益换算' }] },
] as const;

export type BackendSettingsSection = typeof backendSettingsSections[number]['key'];
export type RequestFlowTab = Extract<typeof backendSettingsSections[number], { key: 'request-flow' }>['tabs'][number]['key'];
export type ExecutionFlowTab = Extract<typeof backendSettingsSections[number], { key: 'execution-flow' }>['tabs'][number]['key'];
