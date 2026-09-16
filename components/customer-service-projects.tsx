'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { DateField } from '@/components/date-field';
import { ServiceProjectItems } from '@/components/service-project-items';
import { RequestFieldsContext, type RequestField } from '@/components/request-field-settings';
import { ServiceProjectProgress } from '@/components/service-project-progress';
import { CustomerProjectCollaborators } from '@/components/customer-project-collaborators';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { readCustomerServiceProjects, saveCustomerProjectSupplement } from '@/lib/service-project-store';
import { ProjectSupplementsPanel } from '@/components/service-project-supplements';
import { serviceProjectStatuses } from '@/lib/service-project-status';
import type { CatalogService } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';
import type { CustomerServiceProject } from '@/lib/customer-service-projects';

const stamp = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
function Status({ value }: { value: CustomerServiceProject['status'] }) {
  return <span className="sr-badge" data-tone={value === '已取消' ? 'cancelled' : value === '已完成' ? 'green' : value === '待启动' ? 'muted' : 'blue'}>{value}</span>;
}
export function CustomerServiceProjects({ actor, initialProjectId, itemFields, services }: { actor: OperationActor; initialProjectId?: string; itemFields: RequestField[]; services: CatalogService[] }) {
  const [records, setRecords] = useState<CustomerServiceProject[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [selectedId, setSelectedId] = useState(initialProjectId ?? '');
  const [tab, setTab] = useState('overview');
  const [reload, setReload] = useState(0);
  const [notice, setNotice] = useState('');
  const sequence = useRef(0);
  useEffect(() => { setSelectedId(initialProjectId ?? ''); setTab('overview'); }, [initialProjectId]);
  useEffect(() => {
    let active = true;
    async function load() {
      const token = ++sequence.current;
      setError('');
      try {
        const projects = await readCustomerServiceProjects(actor);
        if (active && token === sequence.current) setRecords(projects);
      } catch (cause) {
        if (active && token === sequence.current) { setRecords([]); setError(cause instanceof Error ? cause.message : '项目读取失败，请重试。'); }
      } finally { if (active && token === sequence.current) setReady(true); }
    }
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [actor.id, actor.role, reload]);
  const select = (id: string) => { setSelectedId(id); setTab('overview'); setNotice(''); setReload(value => value + 1); window.scrollTo({ top: 0 }); };
  const project = records.find(record => record.id === selectedId);
  const supplementsClosed = project?.status === '已完成' || project?.status === '已取消';
  if (!ready) return <div className="sr-workspace"><p className="sr-help">正在读取服务项目…</p></div>;
  if (error) return <div className="sr-workspace"><p className="sr-error" role="alert">{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>重新读取</Button></div>;
  if (selectedId && !project) return <div className="sr-workspace"><p className="sr-error" role="alert">项目不存在或你已不在该项目的客户协作人名单中。</p><Button variant="outline" onClick={() => select('')}>返回服务项目列表</Button></div>;
  if (project) return <section className="sr-workspace sr-workspace--detail catalog-detail" aria-label="客户服务项目详情">
    <header className="detail-heading"><div>
      <button type="button" className="detail-back" onClick={() => select('')}><ArrowLeft aria-hidden="true" />返回服务项目列表</button>
      <div className="detail-title-row"><h2>{project.name}</h2><Status value={project.status} /></div>
      <p>{project.id} · {project.customerName}</p>
    </div></header>
    <ServiceProjectProgress status={project.status} cancelledFromStatus={project.cancelledFromStatus} />
    {notice && <output className="sr-notice">{notice}</output>}
    <div className="sr-ops-workspace">
    <Tabs value={tab} onValueChange={value => setTab(String(value))} className="sr-ops-tabs">
      <TabsList variant="line" className="sr-ops-tab-list" aria-label="客户服务项目工作区">
        <TabsTrigger value="overview">项目信息</TabsTrigger>
        <TabsTrigger value="supplements">补充信息 <span>{project.supplements.length}</span></TabsTrigger>
      </TabsList>
      <div className="sr-detail-layout">
      <div className="sr-detail-main">
      <TabsContent value="overview">
        {project.cancellationReason && <section className="sr-panel sr-ops-panel" role="status"><div className="sr-ops-heading"><div><h3>取消原因</h3><p className="whitespace-pre-wrap break-words">{project.cancellationReason}</p></div></div></section>}
        <section className="sr-panel"><div className="sr-panel-heading"><h3>基本信息</h3></div>
          <fieldset className="sr-form-grid" disabled>
            <label htmlFor="customer-project-name">项目名称<Input id="customer-project-name" value={project.name} readOnly /></label>
            <DateField id="customer-project-date" label="期望服务时间" value={project.expectedServiceDate} readonly onChange={() => {}} />
            <label htmlFor="customer-project-customer">客户<Input id="customer-project-customer" value={project.customerName} readOnly /></label>
            <label htmlFor="customer-project-provider">服务方<Input id="customer-project-provider" value={project.serviceProviderName || '未指定'} readOnly /></label>
            <label className="sr-span" htmlFor="customer-project-note">项目说明<Textarea id="customer-project-note" value={project.note} readOnly rows={3} /></label>
          </fieldset>
        </section>
        <RequestFieldsContext.Provider value={itemFields}>
          <ServiceProjectItems key={project.id} actor={actor} id={project.id} customerId={project.customerId}
            items={project.items} services={services.filter(service => project.items.some(item => item.serviceId === service.id))}
            objects={project.items.flatMap(item => item.businessObjectSnapshot?.objects.map(entry => entry.object) ?? [])}
            readonly busy={false} save={async () => '客户侧仅可查看服务项。'} />
        </RequestFieldsContext.Provider>
        <section className="sr-panel"><div className="sr-panel-heading"><h3>系统信息</h3></div>
          <dl className="sr-system-info"><div><dt>项目编号</dt><dd>{project.id}</dd></div><div><dt>创建时间</dt><dd>{stamp(project.createdAt)}</dd></div><div><dt>更新时间</dt><dd>{stamp(project.updatedAt)}</dd></div></dl>
        </section>
      </TabsContent>
      <TabsContent value="supplements" keepMounted>
        <ProjectSupplementsPanel key={`${project.id}:${actor.id}`} actor={actor} busy={false} editable={!supplementsClosed}
          hideReadonlyWhenEmpty emptyMessage={supplementsClosed ? '暂无补充信息' : '暂无补充资料'}
          record={{ supplements: project.supplements, collaborators: { internal: project.supplementMentionUsers.map(user => ({ id: user.id, name: user.name, details: '', assignmentRoles: user.isManager ? ['项目经理'] : [] })) } }}
          users={project.supplementMentionUsers.map(user => ({ id: user.id, name: user.name, status: '启用', email: '', department: '' }))}
          joinMention={async () => '客户仅可 @ 已加入项目的内部协作人。'} publish={async input => {
          try {
            setNotice('');
            const updated = await saveCustomerProjectSupplement(project.id, project.revision, input, actor);
            ++sequence.current;
            setRecords(current => current.map(record => record.id === updated.id ? updated : record));
            setNotice('补充信息已发布');
            return null;
          } catch (cause) { return cause instanceof Error ? cause.message : '发布失败，请重试。'; }
        }} />
      </TabsContent>
      </div>
      <CustomerProjectCollaborators project={project} />
      </div>
    </Tabs>
    </div>
  </section>;
  const filtered = records.filter(record => (status === '全部状态' || record.status === status) && `${record.name} ${record.id} ${record.serviceProviderName}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section className="sr-workspace" aria-label="客户服务项目">
    <div className="sr-toolbar"><div className="sr-filter-group"><div className="sr-search"><Search size={16} /><Input aria-label="搜索服务项目" placeholder="搜索项目名称、编号或服务方" value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label="筛选项目状态" value={status} onChange={event => setStatus(event.target.value)}><option>全部状态</option>{serviceProjectStatuses.map(value => <option key={value}>{value}</option>)}</select></div></div>
    <div className="sr-table-scroll"><table className="sr-table app-list-table"><thead><tr><th>项目名称 / 编号</th><th>服务方</th><th>期望服务时间</th><th>状态</th><th>操作</th></tr></thead><tbody>
      {filtered.map(record => <tr key={record.id}><td><button className="sr-title-link app-list-link" onClick={() => select(record.id)}>{record.name}</button><small>{record.id}</small></td><td>{record.serviceProviderName || '未指定'}</td><td>{record.expectedServiceDate || '未填写'}</td><td><Status value={record.status} /></td><td><Button variant="outline" size="sm" onClick={() => select(record.id)}>查看项目</Button></td></tr>)}
      {!filtered.length && <tr><td colSpan={5}>{records.length ? '暂无符合筛选条件的项目' : '暂无参与的服务项目，加入客户协作人后将在此显示。'}</td></tr>}
    </tbody></table></div>
  </section>;
}
