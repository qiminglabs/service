'use client';
import { useI18n } from '@/lib/i18n/context';


import { normalizeServiceProjectStatus } from '@/lib/service-project-status';
import { useContext, useEffect, useRef, useState } from 'react';
import { Folder, Plus, Trash2, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
import { isInternal } from '@/lib/request-operations';
import { DateField } from '@/components/date-field';
import { readProjectMapping } from '@/lib/request-project-mapping-store';
import { mappedProjectName, type RequestProjectMapping } from '@/lib/request-project-mapping';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import { readLocal, itemDisplayFields, type ServiceRequest, type ObjectRef } from '@/lib/service-requests';
import { RequestFieldsContext } from '@/components/request-field-settings';
import type { OperationActor } from '@/lib/request-operations';
import { canCreateServiceProjects, createServiceProjects, projectSplitIssue, moveProjectItem, serviceProjectCreationEnabled, serviceProjectPendingMessage, type ProjectGroup } from '@/lib/request-projects';

const groupId = () => `SP-${crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase()}`;
export function RequestProjectDialog({ record, actor, busy, save, close, objects, saveError }: {
  record: ServiceRequest; actor: OperationActor; busy: boolean; objects: ObjectRef[]; saveError?: string;
  save: (record: ServiceRequest, message?: string) => Promise<boolean>; close: () => void;
}) {
  const { localize } = useI18n();
  const fieldNames = Object.fromEntries(useContext(RequestFieldsContext).map(field => [field.id, field.name]));
  const [groups, setGroups] = useState<ProjectGroup[]>(() => [{ id: groupId(), name: record.title, note: '', itemIds: record.items.map(item => item.id) }]);
  const [mapping, setMapping] = useState<RequestProjectMapping | null>(null);
  const [created, setCreated] = useState<ServiceRequest | null>(null);

  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const dragItem = useRef<string | null>(null);
  const lock = useRef(false);
  const initialRecord = useRef(record);
  useEffect(() => {
    let active = true;
    readProjectMapping().then(config => {
      if (!active) return;
      setMapping(config);
      setGroups(old => old.map(group => ({ ...group, name: mappedProjectName(initialRecord.current, config), expectedServiceDate: initialRecord.current.expectedServiceDate || '' })));
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : '映射读取失败，请重新打开弹窗。'); });
    return () => { active = false; };
  }, []);
  const disabled = busy || working || !mapping;
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
      const next = createServiceProjects(record, actor, groups, crypto.randomUUID(), new Date().toISOString(), mapping!);
      if (await save(next, `已创建 ${groups.length} 个服务项目、${record.items.length} 个服务项`)) setCreated(next);
      else setError('创建未完成，分组已保留，请重试。');
    } catch (error) { setError(error instanceof Error ? error.message : '创建失败，请重试。'); }
    finally { lock.current = false; setWorking(false); }
  }
  if (created) return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent className="sr-project-dialog" aria-describedby={undefined}>
      <DialogHeader><DialogTitle>{localize("服务项目已创建")}</DialogTitle></DialogHeader>
      <RequestProjects record={created} actor={actor} compact />
      <DialogFooter className="sr-project-footer sr-project-success-footer"><Button onClick={close}>{localize("完成")}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
  return <Dialog open onOpenChange={open => { if (!open && !busy && !working) close(); }}>
    <DialogContent className="sr-project-dialog" showCloseButton={!busy && !working}>
      <DialogHeader>
        <DialogTitle>{localize("创建服务项目")}</DialogTitle>
        <DialogDescription>{localize("将申请项拖到不同项目中，每项带入一个项目服务项及对应材料。")}</DialogDescription>
      </DialogHeader>
      <div className="sr-project-board-body">
        <div className="sr-project-board-heading"><span title={localize(record.title)}>{localize(record.title)}</span><Button variant="outline" disabled={disabled || groups.length >= record.items.length} onClick={() => setGroups(old => [...old, { id: groupId(), name: `${mappedProjectName(record, mapping!)} · ${old.length + 1}`.slice(0, 100), expectedServiceDate: record.expectedServiceDate || '', note: '', itemIds: [] }])}><Plus size={16} />{localize("新增项目")}</Button></div>
        <div className="sr-project-board" data-single={groups.length === 1}>
          {localize(groups.map((group, groupIndex) => <section className="sr-project-group sr-project-dropzone" data-over={dropTarget === group.id} key={group.id}
            aria-label={localize(`项目 ${groupIndex + 1}：${group.name}`)}
            onDragOver={event => { if (!disabled && dragItem.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(group.id); } }}
            onDragLeave={event => { if (!event.relatedTarget || !event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(old => old === group.id ? null : old); }}
            onDrop={event => { event.preventDefault(); if (dragItem.current) move(dragItem.current, group.id); }}>
            <div className="sr-project-group-header"><Folder size={18} /><span>{localize("项目")}{localize(groupIndex + 1)}</span><span className="sr-project-count">{localize(group.itemIds.length)} {localize(" 个服务项")}</span>
              {localize(groups.length > 1 && <Button size="sm" variant="ghost" aria-label={localize(`移除空项目 ${groupIndex + 1}`)} title={localize(group.itemIds.length ? '移出全部申请项后可删除项目' : '删除空项目')} disabled={disabled || group.itemIds.length > 0} onClick={() => setGroups(old => old.filter(item => item.id !== group.id))}><Trash2 size={15} /></Button>)}
            </div>
            <div className="sr-project-name"><Input aria-label={localize(`项目 ${groupIndex + 1} 名称`)} placeholder={localize("填写项目名称")} value={group.name} maxLength={100} disabled={disabled} onChange={event => setGroups(old => old.map(item => item.id === group.id ? { ...item, name: event.target.value } : item))} /></div>
            {localize(!record.expectedServiceDate && <div className="sr-project-name"><DateField id={`project-date-${group.id}`} label={localize("计划执行日期")} required value={group.expectedServiceDate || ''} disabled={disabled} onChange={value => setGroups(old => old.map(item => item.id === group.id ? { ...item, expectedServiceDate: value } : item))} /></div>)}
            <div className="sr-project-drag-items">
              {localize(group.itemIds.map(itemId => {
                const item = record.items.find(item => item.id === itemId)!;
                return <div className="sr-project-drag-item" key={itemId} draggable={!disabled} data-dragging={dragging === itemId}
                  onDragStart={event => { if (disabled) { event.preventDefault(); return; } dragItem.current = itemId; setDragging(itemId); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', itemId); }}
                  onDragEnd={() => { dragItem.current = null; setDragging(null); setDropTarget(null); }}>
                  <GripVertical size={16} aria-hidden="true" /><div className="sr-project-item-info"><strong>{localize(item.serviceName)}</strong>
                    <dl className="sr-project-item-fields">{localize(itemDisplayFields(item, fieldNames, objects).map(field => <div key={field.key}><dt>{localize(field.label)}：</dt><dd>{localize(field.value)}</dd></div>))}</dl>
                  </div>

                </div>;
              }))}
              {localize(!group.itemIds.length && <div className="sr-project-empty"><Plus size={20} /><span>{localize("拖动申请项到这里")}</span></div>)}
            </div>
          </section>))}
        </div>
        <output className="sr-only" aria-live="polite">{localize(announcement)}</output>
        {localize((saveError || error || issue) && <p className="sr-project-validation" role={error ? 'alert' : 'status'}>{localize(saveError || error || issue)}</p>)}
      </div>
      <DialogFooter className="sr-project-footer">
        <span>{localize(groups.length)} {localize(" 个项目 ·")}{localize(record.items.length)} {localize(" 个服务项")}</span>
        <Button variant="outline" disabled={busy || working} onClick={close}>{localize("取消")}</Button>
        <Button className={!serviceProjectCreationEnabled ? 'ct-button ct-button--project-pending' : undefined} title={localize(!serviceProjectCreationEnabled ? serviceProjectPendingMessage : undefined)} disabled={disabled || !!issue || groups.some(group => !group.expectedServiceDate && !record.expectedServiceDate) || !canCreateServiceProjects(record, actor)} onClick={() => void submit()}>{localize(!serviceProjectCreationEnabled ? '创建项目（待开发）' : working ? '创建中…' : '创建项目')}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function RequestProjects({ record, actor, compact = false }: { record: ServiceRequest; actor?: OperationActor; compact?: boolean }) {
  const { localize } = useI18n();
  const internal = !!actor && isInternal(actor.role);
  const creation = record.operations?.projectCreation;
  const [linkedProjects, setLinkedProjects] = useState<{ requestId: string; projects: Record<string, Pick<ServiceProjectRecord, 'name' | 'status'>> }>({ requestId: '', projects: {} });
  useEffect(() => {
    if (compact || !creation?.mapping) return;
    let active = true;
    const refresh = () => {
      void readLocal<{ id: string; payload?: ServiceProjectRecord }>('references').then(rows => {
        if (!active) return;
        const projects: Record<string, Pick<ServiceProjectRecord, 'name' | 'status'>> = {};
        for (const project of creation.projects) {
          const saved = rows.find(row => row.id === `service-project:${project.id}`)?.payload;
          if (saved?.sourceServiceRequestId === record.id) projects[project.id] = { name: saved.name, status: normalizeServiceProjectStatus(saved).status };
        }
        setLinkedProjects({ requestId: record.id, projects });
      }).catch(() => { /* Keep the saved creation result if local storage is temporarily unavailable. */ });
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [record.id, creation, compact]);
  if (!creation) return null;
  if (compact) return <section className="sr-project-results sr-project-results--compact" aria-label={localize("已创建的服务项目")}>
    {localize(creation.projects.map(project => <article className="sr-project-group sr-project-result-heading" key={project.id}>
      <Folder size={18} aria-hidden="true" />
      <strong>{localize(project.name)}</strong>
      <code>{localize(project.id)}</code>
      <span className="sr-project-order-state">{localize("已创建")}</span>
      {localize(actor && creation.mapping && <a className="sr-project-execute" href={`/?project=${encodeURIComponent(project.id)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">{localize("去执行")}</a>)}
    </article>))}
  </section>;
  return <section className={`sr-panel sr-request-projects${internal ? ' sr-customer-visible-panel' : ''}`} aria-label={localize("服务项目")}>
    <div className="sr-panel-heading"><div className="sr-panel-title-with-visibility"><h3>{localize("服务项目")}</h3>{localize(internal && <CustomerVisibleBadge />)}</div></div>
    <div className="sr-request-project-list">{localize(creation.projects.map(project => {
      const saved = linkedProjects.requestId === record.id ? linkedProjects.projects[project.id] : undefined;
      return <article className="sr-request-project-row" key={project.id}>
        <strong>{localize(saved?.name ?? project.name)}</strong>
        <span className="sr-project-order-state">{localize(saved?.status ?? (creation.mapping ? '已创建' : project.status))}</span>
        {localize(actor && creation.mapping
          ? <a className="sr-project-execute" href={`/?project=${encodeURIComponent(project.id)}&user=${encodeURIComponent(actor.id)}`} target="_blank" rel="noopener noreferrer">{localize("查看项目")}</a>
          : <Button variant="outline" disabled title={localize("此历史记录没有可打开的独立项目")}>{localize("查看项目")}</Button>)}
      </article>;
    }))}</div>
  </section>;
}
