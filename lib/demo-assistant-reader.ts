import { readLocal } from './service-requests';
import { packSiteContent, serializeSiteRecords } from './demo-assistant-content';

// Only reads this application's known stores. No role/customer filtering or mutation.
export async function readSiteContent() {
  const notes: string[] = [];
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.demo-assistant,script,style,noscript').forEach(element => element.remove());
  // Form properties need an explicit snapshot; cloneNode does not preserve all live values.
  const fields = (Array.from(document.querySelectorAll('input,textarea,select')) as unknown as Array<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>)
    .filter(field => !field.closest('.demo-assistant') && !['password', 'hidden', 'file'].includes(field.type))
    .map(field => ({ name: field.labels?.[0]?.textContent?.trim() || field.getAttribute('aria-label') || field.name || field.id, value: field.value, ...('checked' in field && ['checkbox', 'radio'].includes(field.type) ? { checked: field.checked } : {}), disabled: field.disabled }));
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).filter(button => !button.closest('.demo-assistant')).map(button => ({ label: button.textContent?.trim() || button.getAttribute('aria-label'), disabled: button.disabled }));
  const stores = ['requests', 'configs', 'references'] as const;
  const results = await Promise.allSettled(stores.map(store => readLocal<unknown>(store)));
  const records: Record<string, unknown> = {};
  results.forEach((result, index) => { if (result.status === 'fulfilled') records[stores[index]] = result.value; else notes.push(`无法读取 ${stores[index]}，该部分内容未包含在本次上下文中。`); });
  const serialized = serializeSiteRecords(records);
  if (serialized.includes('二进制附件正文未提取')) notes.push('附件元数据和在线文档正文可读；上传的二进制附件未提取正文。');
  return packSiteContent(`${clone.textContent || ''}\n当前表单值：${JSON.stringify(fields)}\n按钮状态：${JSON.stringify(buttons)}`, serialized, notes);
}
