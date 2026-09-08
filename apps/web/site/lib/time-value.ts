// Time-of-day only: never convert this value into a date or UTC timestamp.
export function normalizeTime(value: string): string | null {
  const text = value.trim().replace('：', ':');
  const match =
    /^(\d{1,2}):(\d{1,2})$/.exec(text) ?? /^(\d{1,2})(\d{2})$/.exec(text);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return null;
  return `${match[1].padStart(2, '0')}:${match[2].padStart(2, '0')}`;
}
