'use client';
import { useContext, useRef, useState } from 'react';
import { FolderPlus, Folder, FileText, Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { itemDisplayFields, type ServiceRequest, type ObjectRef } from '@/lib/service-requests';
import { RequestFieldsContext } from '@/components/request-field-settings';
import type { OperationActor } from '@/lib/request-operations';
import { canCreateServiceProjects, createServiceProjects, projectSplitIssue, moveProjectItem, type ProjectGroup } from '@/lib/request-projects';

const groupId = () => `PRJ-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
export function RequestProjectDialog({ record, actor, busy, save, close, objects }: {
  record: ServiceRequest; actor: OperationActor; busy: boolean; objects: ObjectRef[];
  save: (record: ServiceRequest, message?: string) => Promise<boolean>; close: () => void;
}) {
  const fieldNames = Object.fromEntries(useContext(RequestFieldsContext).map(field => [field.id, field.name]));
  const [groups, setGroups] = useState<ProjectGroup[]>(() => [{ id: groupId(), name: record.title, note: '', itemIds: record.items.map(item => item.id) }]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dragItem = useRef<string | null>(null);
  const lock = useRef(false);
  const disabled = busy || working;
  const issue = projectSplitIssue(record, groups);
  function move(itemId: string, target: string) {
    if (disabled || lock.current) return;
    setGroups(old => moveProjectItem(old, itemId, target));
    setError(''); setDropTarget(null); setDragging(null); dragItem.current = null;
    const item = record.items.find(item => item.id === itemId);
    const group = groups.find(group => group.id === target);
    if (item && group) setAnnouncement(`${item.serviceName}已移至${group.name || '目标项目'}`);
  }
  async function submit() {
    if (disabled || lock.current) return;
    lock.current = true; setWorking(true); setError('');
    try {
      const next = createServiceProjects(record, actor, groups);
      if (await save(next, `已创建 ${groups.length} 个服务项目、${record.items.length} 个工单`)) close();
      else setError('创建未完成，分组已保留，请重试。');
    } catch (error) { setError(error instanceof Error ? error.message : '创建失败，请重试。'); }
    finally { lock.current = false; setWorking(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !disabled) close(); }}>
    <DialogContent className="sr-project-dialog" showCloseButton={!disabled}>
      <DialogHeader>
        <DialogTitle>创建服务项目</DialogTitle>
        <DialogDescription>将申请项拖到不同项目中，每项生成一个工单。</DialogDescription>
      </DialogHeader>
      <div className="sr-project-board-body">
        <div className="sr-project-board-heading"><span title={record.title}>{record.title}</span><Button variant="outline" disabled={disabled || groups.length >= record.items.length} onClick={() => setGroups(old => [...old, { id: groupId(), name: `${record.title} · ${old.length + 1}`, note: '', itemIds: [] }])}><Plus size={16} />新增项目</Button></div>
        <div className="sr-project-board" data-single={groups.length === 1}>
          {groups.map((group, groupIndex) => <section className="sr-project-group sr-project-dropzone" data-over={dropTarget === group.id} key={group.id}
            aria-label={`项目 ${groupIndex + 1}：${group.name}`}
            onDragOver={event => { if (!disabled && dragItem.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(group.id); } }}
            onDragLeave={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(old => old === group.id ? null : old); }}
            onDrop={event => { event.preventDefault(); if (dragItem.current) move(dragItem.current, group.id); }}>
            <div className="sr-project-group-header"><Folder size={18} /><span>项目 {groupIndex + 1}</span><span className="sr-project-count">{group.itemIds.length} 个工单</span>
              {groups.length > 1 && <Button size="sm" variant="ghost" aria-label={`移除空项目 ${groupIndex + 1}`} title={group.itemIds.length ? '移出全部申请项后可删除项目' : '删除空项目'} disabled={disabled || group.itemIds.length > 0} onClick={() => setGroups(old => old.filter(item => item.id !== group.id))}><Trash2 size={15} /></Button>}
            </div>
            <div className="sr-project-name"><Input aria-label={`项目 ${groupIndex + 1} 名称`} placeholder="填写项目名称" value={group.name} maxLength={100} disabled={disabled} onChange={event => setGroups(old => old.map(item => item.id === group.id ? { ...item, name: event.target.value } : item))} /></div>
            <div className="sr-project-drag-items">
              {group.itemIds.map(itemId => {
                const item = record.items.find(item => item.id === itemId)!;
                return <div className="sr-project-drag-item" key={itemId} draggable={!disabled} data-dragging={dragging === itemId}
                  onDragStart={event => { if (disabled) { event.preventDefault(); return; } dragItem.current = itemId; setDragging(itemId); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', itemId); }}
                  onDragEnd={() => { dragItem.current = null; setDragging(null); setDropTarget(null); }}>
                  <GripVertical size={16} aria-hidden="true" /><div className="sr-project-item-info"><strong>{item.serviceName}</strong>
                    <dl className="sr-project-item-fields">{itemDisplayFields(item, fieldNames, objects).map(field => <div key={field.key}><dt>{field.label}：</dt><dd>{field.value}</dd></div>)}</dl>
                  </div>

                </div>;
              })}
              {!group.itemIds.length && <div className="sr-project-empty"><Plus size={20} /><span>拖动申请项到这里</span></div>}
            </div>
          </section>)}
        </div>
        <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
        {(error || issue) && <p className="sr-project-validation" role={error ? 'alert' : 'status'}>{error || issue}</p>}
      </div>
      <DialogFooter className="sr-project-footer">
        <span>{groups.length} 个项目 · {record.items.length} 个工单</span>
        <Button variant="outline" disabled={disabled} onClick={close}>取消</Button>
        <Button disabled={disabled || !!issue || !canCreateServiceProjects(record, actor)} onClick={() => void submit()}>{working ? '创建中…' : '创建项目'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function RequestProjects({ record }: { record: ServiceRequest }) {
  const creation = record.operations?.projectCreation;
  if (!creation) return null;
  return <section className="sr-panel sr-ops-panel">
    <div className="sr-ops-heading"><div><h3>服务项目</h3><p>{creation.actor} 已创建 {creation.projects.length} 个项目、{creation.projects.reduce((sum, project) => sum + project.workOrders.length, 0)} 个工单。</p></div><FolderPlus size={22} /></div>
    <div className="sr-project-results">{creation.projects.map(project => <details className="sr-project-group" key={project.id} open>
      <summary><Folder size={18} /><strong>{project.name}</strong><code>{project.id}</code><span className="sr-project-order-state">{project.status}</span></summary>
      {project.note && <p className="sr-project-note">{project.note}</p>}
      <div className="sr-project-items">{project.workOrders.map(order => <div className="sr-project-item" key={order.id}><FileText size={18} /><div className="sr-project-item-info"><strong>{order.serviceName}</strong><span>{order.id} · 申请项 {record.items.findIndex(item => item.id === order.sourceItemId) + 1}</span></div><span className="sr-project-order-state">{order.status}</span></div>)}</div>
    </details>)}</div>
  </section>;
}
