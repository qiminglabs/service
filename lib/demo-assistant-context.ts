// Navigation metadata; full page and stored content travel separately as siteContent.
export const assistantPages = {
  requests: '服务请求', catalog: '服务目录', 'reference-data': '引用数据', 'field-settings': '后台配置',
} as const;
export const assistantStatuses = ['草稿', '待评估', '待确认', '待受理', '已转服务项目', '已取消'] as const;
export const assistantTabs = ['申请信息', '补充信息', '评估', '会议', '工时', '活动', 'customers', 'contacts', 'assets', 'business-objects', 'users', 'partners', 'partner-users', 'service-certifications'] as const;
export type AssistantContext = { page: keyof typeof assistantPages; tab?: string; status?: string };
export function normalizeAssistantContext(value: unknown): AssistantContext {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    page: typeof source.page === 'string' && Object.hasOwn(assistantPages, source.page) ? source.page as AssistantContext['page'] : 'requests',
    ...(assistantTabs.includes(source.tab as never) ? { tab: source.tab as string } : {}),
    ...(assistantStatuses.includes(source.status as never) ? { status: source.status as string } : {}),
  };
}
