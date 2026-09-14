// Upgrade only the former default labels of the edition field. Stable field
// IDs, saved option values, version numbers and administrator labels stay intact.
export function requestFieldLabel(id: string, label: string): string {
  if (id === 'version' && label.trim() === '产品版本号') return '版本号';
  return id === 'edition' && ['产品版本', '产品版本类型'].includes(label.trim())
    ? '授权版本'
    : label;
}
