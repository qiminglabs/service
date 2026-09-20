'use client';

import { lazy, Suspense, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { downloadFile } from '@/lib/service-requests';
import { createDownloadZip, safeDownloadName } from '@/lib/download-zip';
import type { ProjectFile } from '@/lib/service-project-files';

const LocalDocumentEditor = lazy(() => import('@/components/local-document-editor').then(module => ({ default: module.LocalDocumentEditor })));
const stamp = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
const size = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export function ServiceProjectFiles({ projectName, items }: { projectName: string; items: ProjectFile[] }) {
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
  return <section className="sr-panel" aria-label="全部文件">
    <div className="sr-panel-heading"><h3>全部文件</h3>
      <Button variant="outline" disabled={busy || !chosen.length} onClick={download}>{busy ? '正在打包…' : `批量下载${chosen.length ? `（${chosen.length}）` : ''}`}</Button>
    </div>
    {error && <p className="sr-error" role="alert">{error}</p>}
    <div className="sr-table-scroll"><table className="sr-table app-list-table sr-project-files-table">
      <colgroup><col style={{ width: 56 }} /><col style={{ width: 200 }} /><col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 220 }} /><col style={{ width: 160 }} /><col style={{ width: 100 }} /><col style={{ width: 175 }} /><col style={{ width: 160 }} /></colgroup>
      <thead><tr>
        <th><Checkbox aria-label="全选全部文件" disabled={!items.length || busy} checked={!!items.length && chosen.length === items.length} indeterminate={chosen.length > 0 && chosen.length < items.length} onCheckedChange={checked => setSelected(checked ? items.map(item => item.id) : [])} /></th>
        <th>名称</th><th>类型</th><th>大小</th><th>来源工单</th><th>来源步骤</th><th>提交人</th><th>提交时间</th><th>操作</th>
      </tr></thead>
      <tbody>{items.map(item => <tr key={item.id}>
        <td><Checkbox aria-label={`选择 ${item.file.name}`} checked={selected.includes(item.id)} disabled={busy} onCheckedChange={checked => setSelected(current => checked ? [...current, item.id] : current.filter(id => id !== item.id))} /></td>
        <td title={item.file.name}>{item.file.name}</td><td>{item.kind}</td><td>{size(item.file.blob.size)}</td>
        <td>{item.orderName}<small>{item.orderId}</small></td><td>{item.stepName}</td><td>{item.submittedBy}</td><td>{stamp(item.submittedAt)}</td>
        <td>{item.file.onlineDocument && <Button variant="ghost" onClick={() => setViewingId(item.id)}>查看</Button>}<Button variant="ghost" onClick={() => downloadFile(item.file)}>下载</Button></td>
      </tr>)}
      {!items.length && <tr><td colSpan={9}>暂无文件</td></tr>}
      </tbody>
    </table></div>
    <Dialog open={!!viewing?.file.onlineDocument} onOpenChange={open => { if (!open) setViewingId(''); }}>
      <DialogContent className="sr-project-file-viewer" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{viewing?.file.name}</DialogTitle></DialogHeader>
        {viewing?.file.onlineDocument && <Suspense fallback={<p className="sr-help">正在打开在线文档…</p>}>
          <LocalDocumentEditor key={viewing.id} value={viewing.file.onlineDocument} readonly busy={false} dirty={false} onChange={() => {}} onBack={() => setViewingId('')} />
        </Suspense>}
      </DialogContent>
    </Dialog>
  </section>;
}
