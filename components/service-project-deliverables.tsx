'use client';
import { useI18n } from '@/lib/i18n/context';


import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { downloadFile } from '@/lib/service-requests';
import { createDownloadZip, safeDownloadName } from '@/lib/download-zip';
import type { ProjectDeliverable } from '@/lib/service-project-deliverables';

export function ServiceProjectDeliverables({ projectName, items, showCustomerVisibility = false, selectable = true }: { projectName: string; items: ProjectDeliverable[]; showCustomerVisibility?: boolean; selectable?: boolean }) {
  const { localize } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const chosen = items.filter(item => selected.includes(item.id));
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await createDownloadZip(chosen.map(item => item.file));
      downloadFile({ id: 'deliverables', name: `${safeDownloadName(projectName)}-交付物.zip`, blob, size: blob.size, uploadedAt: new Date().toISOString() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载失败，请重试。');
    } finally { setBusy(false); }
  };
  return <section className={`sr-panel${showCustomerVisibility ? ' sr-customer-visible-panel' : ''}`} aria-label={localize("项目交付物")}>
    <div className="sr-panel-heading">
      <div className="sr-panel-title-with-visibility"><h3>{localize("交付物")}</h3>{localize(showCustomerVisibility && <CustomerVisibleBadge />)}</div>
      {localize(selectable && <Button variant="outline" disabled={busy || !chosen.length} onClick={download}>{localize(busy ? '正在打包…' : `批量下载${chosen.length ? `（${chosen.length}）` : ''}`)}</Button>)}
    </div>
    {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
    <div className="sr-table-scroll"><table className="sr-table app-list-table sr-project-deliverables-table" data-selectable={selectable}>
      <colgroup>{localize(selectable && <col className="deliverables-select-column" />)}<col /><col className="deliverables-type-column" /><col className="deliverables-size-column" /><col className="deliverables-action-column" /></colgroup>
      <thead><tr>
        {localize(selectable && <th><Checkbox aria-label={localize("全选交付物")} disabled={!items.length || busy} checked={!!items.length && chosen.length === items.length} indeterminate={chosen.length > 0 && chosen.length < items.length} onCheckedChange={checked => setSelected(checked ? items.map(item => item.id) : [])} /></th>)}
        <th>{localize("名称")}</th><th>{localize("类型")}</th><th>{localize("大小")}</th><th data-list-actions>{localize("操作")}</th>
      </tr></thead>
      <tbody>{localize(items.map(item => <tr key={item.id}>
        {localize(selectable && <td><Checkbox aria-label={localize(`选择 ${item.file.name}`)} checked={selected.includes(item.id)} disabled={busy} onCheckedChange={checked => setSelected(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))} /></td>)}
        <td>{localize(item.file.name)}</td><td>{localize(item.kind)}</td>
        <td>{localize(item.file.size < 1024 ? `${item.file.size} B` : item.file.size < 1024 * 1024 ? `${(item.file.size / 1024).toFixed(1)} KB` : `${(item.file.size / (1024 * 1024)).toFixed(1)} MB`)}</td>
        <td><Button variant="ghost" onClick={() => downloadFile(item.file)}>{localize("下载")}</Button></td>
      </tr>))}
      {localize(!items.length && <tr><td colSpan={selectable ? 5 : 4}>{localize("暂无交付物")}</td></tr>)}
      </tbody>
    </table></div>
  </section>;
}
