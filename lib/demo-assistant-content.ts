// All Demo records are eligible, independently of the selected business identity.
export const MAX_SITE_CONTENT = 180_000;
export type SiteContent = { pageText: string; records: string; incomplete: boolean; notes: string[] };
export function normalizeSiteContent(value: unknown): SiteContent {
  if (!value || typeof value !== 'object') throw new Error('缺少站点上下文。');
  const source = value as Record<string, unknown>;
  if (typeof source.pageText !== 'string' || typeof source.records !== 'string' || source.pageText.length + source.records.length > MAX_SITE_CONTENT || typeof source.incomplete !== 'boolean' || !Array.isArray(source.notes) || source.notes.length > 20 || source.notes.some(note => typeof note !== 'string' || note.length > 500)) throw new Error('站点上下文格式或长度不正确。');
  return { pageText: source.pageText, records: source.records, incomplete: source.incomplete, notes: source.notes as string[] };
}
export function serializeSiteRecords(value: unknown) {
  return JSON.stringify(value, (_key, item) => item instanceof Blob ? { attachmentContent: '二进制附件正文未提取', type: item.type, size: item.size } : item);
}
export function packSiteContent(pageText: string, records: string, notes: string[] = []): SiteContent {
  const page = pageText.slice(0, 30_000);
  const remaining = MAX_SITE_CONTENT - page.length;
  const incomplete = page.length < pageText.length || records.length > remaining || notes.length > 0;
  return { pageText: page, records: records.slice(0, remaining), incomplete, notes: [...notes, ...(page.length < pageText.length || records.length > remaining ? ['站点内容超过本次上下文容量，部分文字未发送；不能据此断言全站没有某项内容。'] : [])].slice(0, 20) };
}
