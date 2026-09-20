export type ProjectSchedule = { expectedServiceDate: string; plannedCompletionDate?: string };

export function projectScheduleIssue(schedule: ProjectSchedule, requireCompletion = false, allowUnscheduled = false): string | null {
  const validDate = (value: string) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  };
  if ((!allowUnscheduled || schedule.expectedServiceDate !== '') && !validDate(schedule.expectedServiceDate)) return '请选择有效的计划执行日期。';
  const completion = schedule.plannedCompletionDate;
  if ((requireCompletion || (completion !== undefined && completion !== '')) && !validDate(completion ?? '')) return '请选择有效的计划完成日期。';
  if (completion && schedule.expectedServiceDate && completion < schedule.expectedServiceDate) return '计划完成日期不能早于计划执行日期。';
  return null;
}
