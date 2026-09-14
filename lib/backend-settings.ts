export const backendSettingsSections = [
  { key: 'forms', label: '表单配置', tabs: [{ key: 'request-items', label: '服务项字段' }] },
  { key: 'request-rules', label: '服务请求规则', tabs: [
    { key: 'collaborators', label: '协作人规则' },
    { key: 'submission', label: '提交检验规则' },
  ] },
  { key: 'pricing', label: '计价与权益', tabs: [{ key: 'entitlement-conversions', label: '权益换算' }] },
] as const;

export type BackendSettingsSection = typeof backendSettingsSections[number]['key'];
