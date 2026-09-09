'use client';
import { useRef, useState } from 'react';
import { Paperclip, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { storedFile, downloadFile, type ServiceRequest, type StoredFile } from '@/lib/service-requests';
import { isInternal, meetingAttachmentAccept, meetingAttachmentIssue, type OperationActor } from '@/lib/request-operations';
import { addSupplement, canAddSupplement, visibleSupplements } from '@/lib/request-supplements';

export function RequestSupplements({ record, actor, customerId, busy, save }: {
  record: ServiceRequest; actor: OperationActor; customerId?: string; busy: boolean;
  save: (record: ServiceRequest, message?: string) => Promise<boolean>;
}) {
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [externalVisible, setExternalVisible] = useState(true);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const uploadInput = useRef<HTMLInputElement>(null);
  const disabled = busy || working;
  const editable = canAddSupplement(record, actor, customerId);
  const items = visibleSupplements(record, actor);
  return <section className="sr-panel sr-ops-panel">
    <div className="sr-ops-heading"><div><h3>补充信息</h3><p>提交补充文件和说明。</p></div></div>
    <div className="sr-supplements-body">
      {editable ? <div className="sr-supplement-composer">
        <Textarea aria-label="补充说明或评论" placeholder="填写补充说明或评论，也可仅上传附件" value={comment} onChange={event => setComment(event.target.value)} disabled={disabled} rows={4} />
        {files.length > 0 && <div className="sr-supplement-files">{files.map(file => <div className="sr-supplement-file" key={file.id}>
          <FileText size={16} aria-hidden="true" /><span title={file.name}>{file.name}</span><small>{(file.size / 1024).toFixed(1)} KB</small>
          <Button variant="ghost" disabled={disabled} aria-label={`移除 ${file.name}`} onClick={() => setFiles(old => old.filter(item => item.id !== file.id))}>移除</Button>
        </div>)}</div>}
        <div className="sr-supplement-toolbar">
          <div className="sr-supplement-upload">
            <Button variant="outline" disabled={disabled} onClick={() => uploadInput.current?.click()}><Paperclip size={16} />上传附件</Button>
            <span>单文件不超过 20 MB</span>
            <input ref={uploadInput} hidden aria-label="上传补充资料附件" type="file" multiple accept={meetingAttachmentAccept} disabled={disabled} onChange={event => {
              const selected = Array.from(event.target.files ?? []).map(storedFile);
              event.target.value = '';
              const issue = selected.map(meetingAttachmentIssue).find(Boolean);
              setError(issue ?? ''); if (!issue) setFiles(old => [...old, ...selected]);
            }} />
          </div>
          <div className="sr-supplement-actions">
          {isInternal(actor.role) && <label className="sr-supplement-visibility"><span>可见范围</span><NativeSelect aria-label="补充资料可见范围" value={externalVisible ? 'public' : 'internal'} disabled={disabled} onChange={event => setExternalVisible(event.target.value === 'public')}><option value="public">客户可见</option><option value="internal">仅内部可见</option></NativeSelect></label>}
        <Button className="sr-supplement-publish" disabled={disabled || (!comment.trim() && !files.length)} onClick={async () => {
          if (disabled || lock.current) return;
          lock.current = true; setWorking(true); setError('');
          try {
            const next = addSupplement(record, actor, customerId, { id: crypto.randomUUID(), authorId: actor.id, author: actor.name, at: new Date().toISOString(), comment: comment.trim(), files, externalVisible: isInternal(actor.role) ? externalVisible : true });
            if (await save(next, '补充资料已发布')) { setComment(''); setFiles([]); }
            else setError('保存失败，填写内容已保留，请重试。');
          } catch (error) { setError(error instanceof Error ? error.message : '发布失败'); }
          finally { lock.current = false; setWorking(false); }
        }}>{working ? '发布中…' : '发布'}</Button>
          </div>
        </div>
        {error && <p role="alert" className="sr-error">{error}</p>}

      </div> : <p className="sr-help">当前阶段仅可查看已提交的补充资料。</p>}
      <div className="sr-supplement-records">
        {[...items].reverse().map(item => <article key={item.id} className="sr-assessment-plan">
          <div className="sr-assessment-round-title"><strong>{item.author}</strong><time className="sr-help" dateTime={item.at}>{new Date(item.at).toLocaleString('zh-CN', { hour12: false })}</time>{isInternal(actor.role) && (item.externalVisible ? <CustomerVisibleBadge /> : <span className="sr-assessment-badge">仅内部可见</span>)}</div>
          {item.comment && <p className="whitespace-pre-wrap break-words my-3">{item.comment}</p>}
          {item.files.map(file => <div key={file.id} className="sr-supplement-file"><FileText size={16} aria-hidden="true" /><span title={file.name}>{file.name}</span><Button variant="ghost" onClick={() => downloadFile(file)}>下载</Button></div>)}
        </article>)}
        {!items.length && <p className="sr-help">暂无补充资料</p>}
      </div>
    </div>
  </section>;
}
