export const serviceProjectStatuses = [
  '待启动',
  '进行中',
  '待复核',
  '待确认',
  '已完成',
  '已取消',
  '已暂停',
] as const;

// Rename saved projects on read without resetting project data or historical activities.
export function normalizeServiceProjectStatus(project: import('./service-projects').ServiceProjectRecord): import('./service-projects').ServiceProjectRecord {
  const initial = String(project.status) === '草稿';
  const cancelledInitial = String(project.cancellation?.fromStatus) === '草稿';
  if (!initial && !cancelledInitial) return project;
  return {
    ...project,
    ...(initial ? { status: '待启动' as const } : {}),
    ...(cancelledInitial && project.cancellation ? { cancellation: { ...project.cancellation, fromStatus: '待启动' as const } } : {}),
  };
}

// Keep stored workflow states unchanged; external portals use customer-facing labels.
export function serviceProjectStatusLabel(status: string, external = false): string {
  return external && status === '待复核' ? '待服务方审核' : status;
}
