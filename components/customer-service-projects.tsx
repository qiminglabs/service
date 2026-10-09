'use client';
import { useI18n } from '@/lib/i18n/context';


import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CustomerProjectDailyReports } from '@/components/project-daily-report-history';
import { ServiceProjectBasicInfo } from '@/components/service-project-basic-info';
import { ServiceProjectDeliverables } from '@/components/service-project-deliverables';
import { ServiceProjectItems } from '@/components/service-project-items';
import { RequestFieldsContext, type RequestField } from '@/components/request-field-settings';
import { ServiceProjectNextStepBanner } from '@/components/service-project-next-step';
import { customerProjectNextStep } from '@/lib/service-project-next-step';
import { ServiceProjectProgress } from '@/components/service-project-progress';
import { CustomerProjectConfirmation } from '@/components/customer-project-confirmation';
import { CustomerProjectCollaborators } from '@/components/customer-project-collaborators';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { readCustomerServiceProjects, saveCustomerProjectSupplement } from '@/lib/service-project-store';
import { ProjectSupplementsPanel } from '@/components/service-project-supplements';
import { serviceProjectStatuses, serviceProjectStatusLabel } from '@/lib/service-project-status';
import type { CatalogService } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';
import type { CustomerServiceProject } from '@/lib/customer-service-projects';

const stamp = (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
function Status({ value }: { value: CustomerServiceProject['status'] }) {
  const { localize } = useI18n();
  return <span className="sr-badge" data-tone={value === '已取消' ? 'cancelled' : value === '已完成' ? 'green' : value === '待启动' ? 'muted' : 'blue'}>{localize(serviceProjectStatusLabel(value, true))}</span>;
}
export function CustomerServiceProjects({ actor, initialProjectId, itemFields, services }: { actor: OperationActor; initialProjectId?: string; itemFields: RequestField[]; services: CatalogService[] }) {
  const { localize } = useI18n();
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
  if (!ready) return <div className="sr-workspace"><p className="sr-help">{localize("正在读取服务项目…")}</p></div>;
  if (error) return <div className="sr-workspace"><p className="sr-error" role="alert">{localize(error)}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>{localize("重新读取")}</Button></div>;
  if (selectedId && !project) return <div className="sr-workspace"><p className="sr-error" role="alert">{localize("项目不存在或你已不在该项目的客户协作人名单中。")}</p><Button variant="outline" onClick={() => select('')}>{localize("返回服务项目列表")}</Button></div>;
  if (project) return <section className="sr-workspace sr-workspace--detail catalog-detail" data-project-detail="true" aria-label={localize("客户服务项目详情")}>
    <header className="detail-heading"><div>
      <button type="button" className="detail-back" onClick={() => select('')}><ArrowLeft aria-hidden="true" />{localize("返回服务项目列表")}</button>
      <div className="detail-title-row"><h2>{localize(project.name)}</h2><Status value={project.status} /></div>
      <p>{localize(project.id)} · {localize(project.customerName)}</p>
    </div></header>
    <ServiceProjectProgress external skipReview={project.skipsReview} status={project.status} pausedFromStatus={project.pausedFromStatus} cancelledFromStatus={project.cancelledFromStatus} />
    <ServiceProjectNextStepBanner key={project.id} next={customerProjectNextStep(project)} />
    {localize(notice && <output className="sr-notice">{localize(notice)}</output>)}
    <div className="sr-ops-workspace">
    <Tabs value={tab} onValueChange={value => setTab(String(value))} className="sr-ops-tabs">
      <TabsList variant="line" className="sr-ops-tab-list" aria-label={localize("客户服务项目工作区")}>
        <TabsTrigger value="overview">{localize("项目信息")}</TabsTrigger>
        <TabsTrigger value="service-reports">{localize("服务日报")}<span>{localize(project.dailyReports.length)}</span></TabsTrigger>
        <TabsTrigger value="deliverables">{localize("交付物")}</TabsTrigger>
        <TabsTrigger value="supplements">{localize("补充信息")}<span>{localize(project.supplements.length)}</span></TabsTrigger>
      </TabsList>
      <div className="sr-detail-layout">
      <div className="sr-detail-main">
      <TabsContent value="service-reports">
        <div className="service-report-sections">
          <CustomerProjectDailyReports key={`daily:${project.id}:${actor.id}`} reports={project.dailyReports} projectId={project.id} confirmation={project.confirmation} />
        </div>
      </TabsContent>
      <TabsContent value="deliverables"><ServiceProjectDeliverables projectName={project.name} key={project.id} items={project.deliverables} /></TabsContent>
      <TabsContent value="overview">
        {localize(['已取消', '已暂停'].includes(project.status) && <section className="sr-panel sr-ops-panel" role="status"><div className="sr-ops-heading"><div><h3>{localize(project.status === '已取消' ? '项目已取消' : '项目已暂停')}</h3><p className="whitespace-pre-wrap break-words">{localize(project.status === '已取消' ? `取消原因：${project.cancellationReason || '未记录'}` : `暂停原因：${project.suspensionReason || '未记录'}`)}</p></div></div></section>)}
        <CustomerProjectConfirmation key={project.id} project={project} actor={actor} onViewDeliverables={() => setTab('deliverables')} onSaved={updated => { ++sequence.current; setRecords(current => current.map(record => record.id === updated.id ? updated : record)); setNotice('客户确认已保存'); }} />
        <section className="sr-panel"><div className="sr-panel-heading"><h3>{localize("基本信息")}</h3></div>
          <ServiceProjectBasicInfo fields={[
            { id: 'name', label: '项目名称', value: project.name },
            { id: 'expectedServiceDate', label: '计划执行日期', value: project.expectedServiceDate },
            { id: 'customerId', label: '客户', value: project.customerName },
            { id: 'plannedCompletionDate', label: '计划完成日期', value: project.plannedCompletionDate },
            { id: 'serviceProviderId', label: '服务方', value: project.serviceProviderName },
            { id: 'note', label: '项目说明', value: project.note, fullWidth: true },
          ]} />
        </section>
        <RequestFieldsContext.Provider value={itemFields}>
          <ServiceProjectItems key={project.id} actor={actor} id={project.id} customerId={project.customerId}
            items={project.items} services={services.filter(service => project.items.some(item => item.serviceId === service.id))}
            objects={project.items.flatMap(item => item.businessObjectSnapshot?.objects.map(entry => entry.object) ?? [])}
            readonly busy={false} save={async () => '客户侧仅可查看服务项。'} />
        </RequestFieldsContext.Provider>
        <section className="sr-panel"><div className="sr-panel-heading"><h3>{localize("系统信息")}</h3></div>
          <dl className="sr-system-info"><div><dt>{localize("项目编号")}</dt><dd>{localize(project.id)}</dd></div><div><dt>{localize("创建时间")}</dt><dd>{localize(stamp(project.createdAt))}</dd></div><div><dt>{localize("更新时间")}</dt><dd>{localize(stamp(project.updatedAt))}</dd></div></dl>
        </section>
      </TabsContent>
      <TabsContent value="supplements" keepMounted>
        <ProjectSupplementsPanel key={`${project.id}:${actor.id}`} actor={actor} busy={false} editable={!supplementsClosed}
          emptyMessage={supplementsClosed ? '暂无补充信息' : '暂无补充资料'}
          record={{ supplements: project.supplements, collaborators: {
            internal: project.supplementMentionUsers.filter(user => user.group === 'internal').map(user => ({ id: user.id, name: user.name, details: '', assignmentRoles: user.isManager ? ['项目经理'] : [] })),
            partner: project.supplementMentionUsers.filter(user => user.group === 'partner').map(user => ({ id: user.id, name: user.name, details: '' })),
          } }}
          users={project.supplementMentionUsers.map(user => ({ id: user.id, name: user.name, status: '启用', email: user.email, companyName: user.companyName, department: '' }))}
          mentionCandidates={project.supplementMentionUsers.map(user => ({ ...user, status: '启用', department: '' }))}
          publish={async input => {
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
  return <section className="sr-workspace" aria-label={localize("客户服务项目")}>
    <section className="sr-panel sr-request-list-panel">
    <div className="sr-toolbar app-list-toolbar"><div className="sr-filter-group"><div className="sr-search"><Search size={16} /><Input aria-label={localize("搜索服务项目")} placeholder={localize("搜索项目名称、编号或服务方")} value={query} onChange={event => setQuery(event.target.value)} /></div><select aria-label={localize("筛选项目状态")} value={status} onChange={event => setStatus(event.target.value)}><option value={"全部状态"}>{localize("全部状态")}</option>{localize(serviceProjectStatuses.map(value => <option key={value} value={value}>{localize(serviceProjectStatusLabel(value, true))}</option>))}</select></div></div>
    <div className="sr-table-scroll"><table className="sr-table app-list-table"><thead><tr><th>{localize("项目名称")}</th><th>{localize("服务方")}</th><th>{localize("服务项")}</th><th>{localize("计划执行日期")}</th><th>{localize("计划完成日期")}</th><th>{localize("状态")}</th><th>{localize("创建时间/创建人")}</th><th data-list-actions>{localize("操作")}</th></tr></thead><tbody>
      {localize(filtered.map(record => <tr key={record.id}><td><button className="sr-title-link app-list-link" onClick={() => select(record.id)}>{localize(record.name)}</button><small>{localize(record.id)}</small></td><td>{localize(record.serviceProviderName || '未指定')}</td><td>{localize(record.items.length)} {localize(" 项")}</td><td>{localize(record.expectedServiceDate || '未填写')}</td><td>{localize(record.plannedCompletionDate || '未填写')}</td><td><Status value={record.status} /></td><td>{localize(stamp(record.createdAt))}<small>{localize(record.createdBy || '—')}</small></td><td><Button variant="outline" size="sm" onClick={() => select(record.id)}>{localize("查看项目")}</Button></td></tr>))}
      {localize(!filtered.length && <tr><td colSpan={8}>{localize(records.length ? '暂无符合筛选条件的项目' : '暂无参与的服务项目，加入客户协作人后将在此显示。')}</td></tr>)}
    </tbody></table></div>
    </section>
  </section>;
}
