'use client';
import { useI18n } from '@/lib/i18n/context';


import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { downloadFile } from '@/lib/service-requests';
import { createDownloadZip, safeDownloadName } from '@/lib/download-zip';
import type { ProjectFile } from '@/lib/service-project-files';

import { ReportBody } from '@/components/report-body';
import type { ReportNode } from '@/lib/report-templates';
const stamp = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function ServiceProjectFiles({ projectName, items }: { projectName: string; items: ProjectFile[] }) {
  const { localize, localizeMessage } = useI18n();
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [viewingId, setViewingId] = useState('');
  const viewing = items.find(item => item.id === viewingId);
  const chosen = items.filter(item => selected.includes(item.id));
  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await createDownloadZip(chosen.map(item => item.file));
      downloadFile({ id: 'project-files', name: `${safeDownloadName(projectName)}-全部文件.zip`, blob, size: blob.size, uploadedAt: new Date().toISOString() });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '下载失败，请重试。');
    } finally { setBusy(false); }
  };
  return <section className="sr-panel" aria-label={localize("全部文件")}>
    <div className="sr-panel-heading"><h3>{localize("全部文件")}</h3>
      <Button variant="outline" disabled={busy || !chosen.length} onClick={download}>{localize(busy ? '正在打包…' : localizeMessage("批量下载{0}", [String(localize(chosen.length ? localizeMessage("（{0}）", [String(localize(chosen.length))]) : ''))]))}</Button>
    </div>
    {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}
    <div className="sr-table-scroll"><table className="sr-table app-list-table sr-project-files-table">
      <colgroup><col style={{ width: 56 }} /><col style={{ width: 200 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 220 }} /><col style={{ width: 160 }} /><col style={{ width: 100 }} /><col style={{ width: 175 }} /><col style={{ width: 160 }} /></colgroup>
      <thead><tr>
        <th><Checkbox aria-label={localize("全选全部文件")} disabled={!items.length || busy} checked={!!items.length && chosen.length === items.length} indeterminate={chosen.length > 0 && chosen.length < items.length} onCheckedChange={checked => setSelected(checked ? items.map(item => item.id) : [])} /></th>
        <th>{localize("名称")}</th><th>{localize("类型")}</th><th>{localize("大小")}</th><th>{localize("来源工单")}</th><th>{localize("来源步骤")}</th><th>{localize("提交人")}</th><th>{localize("提交时间")}</th><th data-list-actions>{localize("操作")}</th>
      </tr></thead>
      <tbody>{localize(items.map(item => <tr key={item.id}>
        <td><Checkbox aria-label={localizeMessage("选择 {0}", [localize(item.file.name)])} checked={selected.includes(item.id)} disabled={busy} onCheckedChange={checked => setSelected(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))} /></td>
        <td title={localize(item.file.name)}>{localize(item.file.name)}</td><td>{localize(item.kind)}</td><td>{localize(size(item.file.blob.size))}</td>
        <td>{localize(item.orderName)}<small>{localize(item.orderId)}</small></td><td>{localize(item.stepName)}</td><td>{localize(item.submittedBy)}</td><td>{localize(stamp(item.submittedAt))}</td>
        <td><div className="sr-project-file-actions">{localize(item.file.onlineDocument && <Button variant="ghost" onClick={() => setViewingId(item.id)}>{localize("查看")}</Button>)}<Button className="sr-project-file-download" variant="ghost" onClick={() => downloadFile(item.file)}>{localize("下载")}</Button></div></td>
      </tr>))}
      {localize(!items.length && <tr><td colSpan={9}>{localize("暂无文件")}</td></tr>)}
      </tbody>
    </table></div>
    <Dialog open={!!viewing?.file.onlineDocument} onOpenChange={open => { if (!open) setViewingId(''); }}>
      <DialogContent className="daily-report-dialog sr-project-file-viewer" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{localize("查看项目文件")}</DialogTitle></DialogHeader>
        {localize(viewing?.file.onlineDocument && (
          <div className="sr-project-file-reading" role="region" aria-label={localize("项目文件正文")} tabIndex={0}>
            <div className="sr-project-file-reading-inner">
              <p className="sr-project-file-meta">
                <span>{localize(viewing.orderName)} · {localize(viewing.stepName)}</span>
                <span>{localize(viewing.submittedBy)} · {localize(stamp(viewing.submittedAt))}</span>
              </p>
              <article className="sr-project-file-paper" aria-label={localize(viewing.file.onlineDocument.title || viewing.file.name)}>
                <header><h2>{localize(viewing.file.onlineDocument.title || viewing.file.name)}</h2></header>
                {localize(viewing.file.onlineDocument.richText
                  ? <ReportBody body={viewing.file.onlineDocument.richText as ReportNode} />
                  : <div className="report-paper">{localize(viewing.file.onlineDocument.content)}</div>)}
              </article>
            </div>
          </div>
        ))}
        <DialogFooter><Button variant="outline" onClick={() => setViewingId('')}>{localize("关闭")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
