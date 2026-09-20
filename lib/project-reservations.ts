// Project review owns these holds. Directory autosaves may contain an older
// workspace snapshot, so only the saved reservation ledger is authoritative.
type ReservedRow = { id: string; projectReservations?: unknown[]; projectConsumptions?: unknown[] };
type Workspace = { assets?: ReservedRow[]; businessObjects?: ReservedRow[] };
export function preserveProjectReservations<T extends Workspace>(incoming: T, previous?: Workspace): T {
  const result = { ...incoming };
  for (const key of ['assets', 'businessObjects'] as const) {
    if (!incoming[key]) continue;
    result[key] = incoming[key].map(row => {
      const saved = previous?.[key]?.find(item => item.id === row.id);
      const { projectReservations: _ignored, projectConsumptions: _consumed, ...rest } = row;
      return { ...rest, ...(saved?.projectReservations ? { projectReservations: structuredClone(saved.projectReservations) } : {}), ...(saved?.projectConsumptions ? { projectConsumptions: structuredClone(saved.projectConsumptions) } : {}) };
    });
    if (previous?.[key]?.some(row => (row.projectReservations?.length || row.projectConsumptions?.length) && !incoming[key]!.some(item => item.id === row.id)))
      throw new Error('该资产或业务对象已被项目复核占用，不能删除。');
  }
  return result;
}
