'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bell,
  BookOpenCheck,
  Boxes,
  BriefcaseBusiness,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  Filter,
  LayoutDashboard,
  ListChecks,
  Menu,
  MoreHorizontal,
  PackageCheck,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Users,
  Wrench,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type ModuleKey = 'catalog' | 'templates';
type ServiceStatus = '已启用' | '已停用';
type SortDirection = 'asc' | 'desc';

type StepTemplate = {
  name: string;
  type: '表单' | '附件' | '布尔确认' | '文档';
  required: boolean;
  deliverable: boolean;
};

type Service = {
  id: string;
  name: string;
  category: string;
  delivery: string;
  unit: string;
  status: ServiceStatus;
  version: string;
  updatedAt: string;
  owner: string;
  description: string;
  prerequisites: string[];
  steps: StepTemplate[];
};

const services: Service[] = [
  {
    id: 'SV-IMPL-001',
    name: '超融合核心平台实施交付',
    category: '产品实施交付',
    delivery: '远程 / 现场',
    unit: '人天',
    status: '已启用',
    version: 'v3.2',
    updatedAt: '2026-08-28 16:40',
    owner: '张昕',
    description:
      '新建 SMTX OS 集群并完成 CloudTower、可观测性平台与备份能力的规划、部署、验证及运维移交。',
    prerequisites: ['实施方案已确认', '管理网络已就绪', 'License 信息可用'],
    steps: [
      { name: '确认实施范围与前置条件', type: '布尔确认', required: true, deliverable: false },
      { name: '填写实施调研表', type: '表单', required: true, deliverable: true },
      { name: '完成网络与资源规划', type: '文档', required: true, deliverable: true },
      { name: '部署 SMTX OS 集群', type: '布尔确认', required: true, deliverable: false },
      { name: '接入 CloudTower 管理平台', type: '表单', required: true, deliverable: false },
      { name: '执行功能与性能验证', type: '附件', required: true, deliverable: true },
      { name: '完成运维培训', type: '附件', required: true, deliverable: true },
      { name: '上传实施交付报告', type: '文档', required: true, deliverable: true },
    ],
  },
  {
    id: 'SV-HC-001',
    name: '超融合核心平台健康巡检',
    category: '运维保障服务',
    delivery: '远程',
    unit: '次',
    status: '已启用',
    version: 'v2.6',
    updatedAt: '2026-08-21 10:18',
    owner: '林岚',
    description:
      '采集集群运行数据，检查容量、硬件、告警与数据保护状态，输出风险分级、处理建议及正式巡检报告。',
    prerequisites: ['远程访问已授权', '集群处于正常服务时段'],
    steps: [
      { name: '核对巡检范围与资产', type: '表单', required: true, deliverable: false },
      { name: '采集集群健康数据', type: '附件', required: true, deliverable: false },
      { name: '检查容量与资源水位', type: '表单', required: true, deliverable: false },
      { name: '分析告警与硬件状态', type: '表单', required: true, deliverable: false },
      { name: '整理风险与处理建议', type: '文档', required: true, deliverable: true },
      { name: '上传健康巡检报告', type: '文档', required: true, deliverable: true },
    ],
  },
];

const COPY = {
  appName: '服务管理中心',
  workspace: 'SmartX 专业服务',
  catalogTitle: '服务目录',
  catalogDescription: '统一维护可交付服务的范围、计量方式与标准执行模板。',
  templateTitle: '服务模板',
  templateDescription: '配置服务工单生成时使用的结构化步骤、采集项与交付物要求。',
};

const navigation: Array<{
  label: string;
  items: Array<{ label: string; icon: LucideIcon; badge?: string; active?: boolean }>;
}> = [
  {
    label: '工作台',
    items: [
      { label: '概览', icon: LayoutDashboard },
      { label: '服务申请', icon: ClipboardCheck, badge: '6' },
      { label: '服务项目', icon: BriefcaseBusiness },
      { label: '工单调度', icon: Wrench, badge: '12' },
    ],
  },
  {
    label: '服务配置',
    items: [
      { label: '服务目录与模板', icon: Boxes, active: true },
      { label: '交付物配置', icon: FileCheck2 },
      { label: '服务能力', icon: ShieldCheck },
    ],
  },
  {
    label: '系统',
    items: [
      { label: '成员与角色', icon: Users },
      { label: '操作记录', icon: Activity },
      { label: '系统设置', icon: Settings },
    ],
  },
];

type WebMcpContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: Record<string, unknown>;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => unknown;
    },
    options?: { signal?: AbortSignal },
  ) => void | Promise<void>;
};

function StatusCapsule({ status }: { status: ServiceStatus }) {
  return (
    <span className="ct-status" data-status={status === '已启用' ? 'positive' : 'neutral'}>
      <span className="ct-status__dot" aria-hidden="true" />
      {status}
    </span>
  );
}

function SideNavigation({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="brand-mark">
        <span className="brand-symbol" aria-hidden="true"><span /><span /><span /></span>
        <span><strong>{COPY.appName}</strong><small>Service Operations</small></span>
      </div>

      <div className="workspace-switcher">
        <span className="workspace-icon"><PackageCheck aria-hidden="true" /></span>
        <span className="workspace-copy"><small>当前空间</small><strong>{COPY.workspace}</strong></span>
        <ChevronDown aria-hidden="true" />
      </div>

      <nav className="sidebar-groups">
        {navigation.map((group) => (
          <div className="sidebar-group" key={group.label}>
            <p>{group.label}</p>
            {group.items.map((item) => (
              <button
                type="button"
                key={item.label}
                className="sidebar-item"
                data-active={item.active || undefined}
                aria-current={item.active ? 'page' : undefined}
                onClick={onNavigate}
              >
                <item.icon aria-hidden="true" />
                <span>{item.label}</span>
                {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
        <BookOpenCheck aria-hidden="true" />
        <span><strong>流程配置完成度 72%</strong><small>2 个目录 · 14 个步骤模板</small></span>
      </div>
    </aside>
  );
}

function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <header className="topbar">
      <Button className="mobile-menu" variant="ghost" size="icon" aria-label="打开导航" onClick={onOpenMenu}><Menu /></Button>
      <div className="crumb" aria-label="面包屑"><span>服务配置</span><ChevronRight aria-hidden="true" /><strong>服务目录与模板</strong></div>
      <div className="topbar-actions">
        <Button variant="ghost" size="icon" aria-label="通知" className="notification-button"><Bell /><span aria-hidden="true" /></Button>
        <span className="topbar-divider" aria-hidden="true" />
        <button className="user-menu" type="button" aria-label="打开用户菜单">
          <span className="avatar">林</span><span className="user-copy"><strong>林岚</strong><small>项目经理</small></span><ChevronDown aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}

function EmptyResult({ reset }: { reset: () => void }) {
  return (
    <div className="empty-result">
      <Search aria-hidden="true" /><strong>未找到匹配的服务</strong><p>请检查搜索关键词或清除当前筛选条件。</p>
      <Button variant="outline" onClick={reset}>清除筛选</Button>
    </div>
  );
}

export default function Home() {
  const [activeModule, setActiveModule] = useState<ModuleKey>('catalog');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部状态' | ServiceStatus>('全部状态');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedServiceId, setSelectedServiceId] = useState(services[0].id);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const register = (tool: Parameters<WebMcpContext['registerTool']>[0]) => {
      void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    };

    register({
      name: 'filter_service_catalog',
      title: '筛选服务目录',
      description: '切换到服务目录并按关键词与启用状态筛选可见服务。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          status: { type: 'string', enum: ['全部状态', '已启用', '已停用'] },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const value = (input ?? {}) as { query?: unknown; status?: unknown };
        if (value.query !== undefined && typeof value.query !== 'string') throw new Error('query 必须是字符串');
        if (value.status !== undefined && (typeof value.status !== 'string' || !['全部状态', '已启用', '已停用'].includes(value.status))) throw new Error('status 不受支持');
        const nextQuery = typeof value.query === 'string' ? value.query : '';
        const nextStatus = (value.status ?? '全部状态') as '全部状态' | ServiceStatus;
        setActiveModule('catalog');
        setQuery(nextQuery);
        setStatusFilter(nextStatus);
        const normalized = nextQuery.trim().toLowerCase();
        const matchedCount = services.filter((service) =>
          (!normalized || `${service.name} ${service.id} ${service.category}`.toLowerCase().includes(normalized)) &&
          (nextStatus === '全部状态' || service.status === nextStatus),
        ).length;
        return { view: 'catalog', query: nextQuery, status: nextStatus, matchedCount };
      },
    });

    register({
      name: 'show_service_template',
      title: '查看服务模板',
      description: '打开指定服务目录的标准步骤模板。',
      inputSchema: {
        type: 'object',
        properties: { serviceId: { type: 'string', enum: services.map((service) => service.id) } },
        required: ['serviceId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const serviceId = (input as { serviceId?: unknown })?.serviceId;
        const service = services.find((item) => item.id === serviceId);
        if (!service) throw new Error('服务编码不存在');
        setSelectedServiceId(service.id);
        setActiveModule('templates');
        return { view: 'templates', serviceId: service.id, stepCount: service.steps.length };
      },
    });

    register({
      name: 'start_service_creation',
      title: '开始新建服务目录',
      description: '打开新建服务目录表单，不会在确认保存前创建记录。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        setActiveModule('catalog');
        setCreateOpen(true);
        return { started: true, view: 'catalog', dialog: 'create-service' };
      },
    });

    return () => lifecycle.abort();
  }, []);

  const filteredServices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return services
      .filter((service) => {
        const matchesQuery = !normalized || service.name.toLowerCase().includes(normalized) || service.id.toLowerCase().includes(normalized) || service.category.toLowerCase().includes(normalized);
        const matchesStatus = statusFilter === '全部状态' || service.status === statusFilter;
        return matchesQuery && matchesStatus;
      })
      .sort((a, b) => {
        const comparison = a.name.localeCompare(b.name, 'zh-CN');
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [query, sortDirection, statusFilter]);

  const selectedService = services.find((service) => service.id === selectedServiceId) ?? services[0];
  const allVisibleSelected = filteredServices.length > 0 && filteredServices.every((service) => selectedIds.includes(service.id));

  function toggleAll(checked: boolean) {
    setSelectedIds(checked ? filteredServices.map((service) => service.id) : []);
  }

  function toggleRow(id: string, checked: boolean) {
    setSelectedIds((current) => (checked ? [...new Set([...current, id])] : current.filter((item) => item !== id)));
  }

  function saveDraft() {
    setCreateOpen(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2600);
  }

  const totalDeliverables = services.reduce((total, service) => total + service.steps.filter((step) => step.deliverable).length, 0);

  return (
    <div className="app-shell">
      <SideNavigation />

      {mobileNavOpen ? (
        <div className="mobile-nav-layer">
          <button className="mobile-nav-backdrop" type="button" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} />
          <div className="mobile-nav-panel">
            <Button variant="ghost" size="icon" aria-label="关闭导航" className="mobile-nav-close" onClick={() => setMobileNavOpen(false)}><X /></Button>
            <SideNavigation onNavigate={() => setMobileNavOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="app-main">
        <Header onOpenMenu={() => setMobileNavOpen(true)} />
        <main className="content-area">
          <section className="page-header">
            <div><h1>{activeModule === 'catalog' ? COPY.catalogTitle : COPY.templateTitle}</h1><p>{activeModule === 'catalog' ? COPY.catalogDescription : COPY.templateDescription}</p></div>
            <Button className="ct-button ct-button--primary" onClick={() => setCreateOpen(true)}>
              <Plus data-icon="inline-start" />{activeModule === 'catalog' ? '新建服务目录' : '新建步骤模板'}
            </Button>
          </section>

          <div className="module-tabs" role="tablist" aria-label="服务配置视图">
            <button type="button" role="tab" aria-selected={activeModule === 'catalog'} onClick={() => setActiveModule('catalog')}>服务目录 <span>2</span></button>
            <button type="button" role="tab" aria-selected={activeModule === 'templates'} onClick={() => setActiveModule('templates')}>服务模板 <span>14</span></button>
          </div>

          {activeModule === 'catalog' ? (
            <CatalogView
              query={query} setQuery={setQuery} statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              services={filteredServices} selectedIds={selectedIds} allVisibleSelected={allVisibleSelected}
              toggleAll={toggleAll} toggleRow={toggleRow} sortDirection={sortDirection} setSortDirection={setSortDirection}
              resetFilters={() => { setQuery(''); setStatusFilter('全部状态'); }} totalDeliverables={totalDeliverables}
            />
          ) : (
            <TemplateView selectedService={selectedService} selectedServiceId={selectedServiceId} setSelectedServiceId={setSelectedServiceId} />
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="create-dialog">
          <DialogHeader>
            <DialogTitle>{activeModule === 'catalog' ? '新建服务目录' : '新建步骤模板'}</DialogTitle>
            <DialogDescription>{activeModule === 'catalog' ? '先建立服务的基础信息，保存后可继续配置前置条件和步骤模板。' : `为“${selectedService.name}”增加一个标准执行步骤。`}</DialogDescription>
          </DialogHeader>
          {activeModule === 'catalog' ? (
            <div className="dialog-form">
              <label htmlFor="service-name"><span>服务名称 <em>*</em></span><Input id="service-name" placeholder="例如：数据库迁移实施服务" /></label>
              <div className="dialog-grid"><label htmlFor="service-code"><span>服务编码 <em>*</em></span><Input id="service-code" placeholder="SV-000" /></label><label htmlFor="service-unit"><span>计量单位 <em>*</em></span><select id="service-unit" defaultValue="人天"><option>人天</option><option>次</option><option>节点</option></select></label></div>
              <label htmlFor="service-description"><span>服务说明</span><textarea id="service-description" placeholder="说明服务范围、交付边界与成功标准" rows={3} /></label>
            </div>
          ) : (
            <div className="dialog-form">
              <label htmlFor="step-name"><span>步骤名称 <em>*</em></span><Input id="step-name" placeholder="例如：上传最终交付报告" /></label>
              <div className="dialog-grid"><label htmlFor="step-type"><span>步骤类型 <em>*</em></span><select id="step-type" defaultValue="文档"><option>文档</option><option>表单</option><option>附件</option><option>布尔确认</option></select></label><label htmlFor="step-required"><span>完成要求</span><select id="step-required" defaultValue="必做"><option>必做</option><option>可选</option></select></label></div>
              <label htmlFor="deliverable" className="dialog-checkbox"><Checkbox defaultChecked id="deliverable" /><span>将步骤产出归类为客户交付物</span></label>
            </div>
          )}
          <DialogFooter className="dialog-footer">
            <DialogClose render={<Button variant="outline" className="ct-button ct-button--ordinary" />}>取消</DialogClose>
            <Button className="ct-button ct-button--primary" onClick={saveDraft}>保存草稿</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {saved ? <output className="toast-message"><span><Check aria-hidden="true" /></span><span className="toast-copy"><strong>草稿已保存</strong><small>可在列表中继续完善配置。</small></span></output> : null}
    </div>
  );
}

type CatalogViewProps = {
  query: string;
  setQuery: (value: string) => void;
  statusFilter: '全部状态' | ServiceStatus;
  setStatusFilter: (value: '全部状态' | ServiceStatus) => void;
  services: Service[];
  selectedIds: string[];
  allVisibleSelected: boolean;
  toggleAll: (checked: boolean) => void;
  toggleRow: (id: string, checked: boolean) => void;
  sortDirection: SortDirection;
  setSortDirection: (value: SortDirection) => void;
  resetFilters: () => void;
  totalDeliverables: number;
};

function CatalogView(props: CatalogViewProps) {
  return (
    <div role="tabpanel" className="catalog-view">
      <section className="metric-strip" aria-label="服务目录摘要">
        <div><span className="metric-icon metric-icon--blue"><Boxes aria-hidden="true" /></span><span><small>服务目录</small><strong>2</strong></span><em>均已启用</em></div>
        <div><span className="metric-icon metric-icon--purple"><ListChecks aria-hidden="true" /></span><span><small>步骤模板</small><strong>14</strong></span><em>14 个必做</em></div>
        <div><span className="metric-icon metric-icon--green"><FileCheck2 aria-hidden="true" /></span><span><small>交付物要求</small><strong>{props.totalDeliverables}</strong></span><em>自动归类</em></div>
        <div><span className="metric-icon metric-icon--orange"><Clock3 aria-hidden="true" /></span><span><small>最近更新</small><strong className="metric-date">08-28</strong></span><em>张昕 更新</em></div>
      </section>

      <section className="table-panel" aria-label="服务目录列表">
        <div className="toolbar">
          <search className="search-field">
            <Search aria-hidden="true" />
            <Input value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="搜索服务名称、编码或分类" aria-label="搜索服务目录" />
            {props.query ? <button type="button" aria-label="清除搜索" onClick={() => props.setQuery('')}><X aria-hidden="true" /></button> : null}
          </search>
          <div className="toolbar-actions">
            <div className="filter-select"><Filter aria-hidden="true" /><select aria-label="按启用状态筛选" value={props.statusFilter} onChange={(event) => props.setStatusFilter(event.target.value as '全部状态' | ServiceStatus)}><option>全部状态</option><option>已启用</option><option>已停用</option></select><ChevronDown aria-hidden="true" /></div>
            <Button variant="outline" className="ct-button ct-button--ordinary">更多筛选</Button>
          </div>
        </div>

        {props.selectedIds.length ? <output className="selection-ribbon"><strong>已选择 {props.selectedIds.length} 项</strong><span>批量操作将应用到所选服务目录</span><Button variant="ghost" size="sm">启用</Button><Button variant="ghost" size="sm">停用</Button><button type="button" aria-label="清除选择" onClick={() => props.toggleAll(false)}><X /></button></output> : null}

        {props.services.length ? (
          <div className="table-scroll">
            <table className="service-table">
              <thead><tr>
                <th className="check-column"><Checkbox aria-label="选择当前页全部服务" checked={props.allVisibleSelected} onCheckedChange={(value) => props.toggleAll(Boolean(value))} /></th>
                <th aria-sort={props.sortDirection === 'asc' ? 'ascending' : 'descending'}><button type="button" className="sort-button" onClick={() => props.setSortDirection(props.sortDirection === 'asc' ? 'desc' : 'asc')}>服务名称 <span aria-hidden="true">{props.sortDirection === 'asc' ? '↑' : '↓'}</span></button></th>
                <th>服务分类</th><th>交付方式</th><th>计量单位</th><th>步骤</th><th>状态</th><th>版本</th><th>最近更新</th><th className="actions-column">操作</th>
              </tr></thead>
              <tbody>{props.services.map((service) => (
                <tr key={service.id} data-selected={props.selectedIds.includes(service.id) || undefined}>
                  <td><Checkbox aria-label={`选择 ${service.name}`} checked={props.selectedIds.includes(service.id)} onCheckedChange={(value) => props.toggleRow(service.id, Boolean(value))} /></td>
                  <td><div className="service-identity"><button type="button" aria-label={`查看服务 ${service.name}`}>{service.name}</button><code>{service.id}</code></div></td>
                  <td>{service.category}</td><td>{service.delivery}</td><td>{service.unit}</td>
                  <td><button type="button" className="step-link" aria-label={`查看 ${service.name} 的 ${service.steps.length} 个步骤`}>{service.steps.length} 个步骤</button></td>
                  <td><StatusCapsule status={service.status} /></td><td><span className="version-tag">{service.version}</span></td>
                  {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- this cell is read-only metadata and contains no control */}
                  <td><div className="updated-cell"><span>{service.updatedAt.split(' ')[0]}</span><small>{service.owner}</small></div></td>
                  <td><div className="row-actions"><button type="button" aria-label={`查看 ${service.name}`}>查看</button><button type="button" aria-label={`更多 ${service.name} 操作`}><MoreHorizontal /></button></div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <EmptyResult reset={props.resetFilters} />}

        <div className="pagination-row"><span>共 {props.services.length} 条</span><div className="pagination" aria-label="分页"><button type="button" disabled aria-label="上一页"><ChevronRight className="rotate-icon" /></button><button type="button" aria-current="page">1</button><button type="button" disabled aria-label="下一页"><ChevronRight /></button></div><label><span>每页</span><select defaultValue="20" aria-label="每页显示数量"><option>20</option><option>50</option></select><span>条</span></label></div>
      </section>
    </div>
  );
}

type TemplateViewProps = { selectedService: Service; selectedServiceId: string; setSelectedServiceId: (id: string) => void; };

function TemplateView({ selectedService, selectedServiceId, setSelectedServiceId }: TemplateViewProps) {
  return (
    <div role="tabpanel" className="template-layout">
      <aside className="service-list-panel" aria-label="选择服务目录">
        <div className="panel-heading"><span><strong>服务目录</strong><small>选择后查看步骤配置</small></span><Button variant="ghost" size="icon" aria-label="收起服务目录"><PanelLeftClose /></Button></div>
        <search className="compact-search"><Search aria-hidden="true" /><Input aria-label="搜索服务目录" placeholder="搜索服务" /></search>
        <div className="service-choice-list">{services.map((service) => (
          <button type="button" key={service.id} aria-label={`查看 ${service.name} 的服务模板`} onClick={() => setSelectedServiceId(service.id)} data-active={selectedServiceId === service.id || undefined}>
            <span className="choice-icon"><Boxes aria-hidden="true" /></span><span><strong>{service.name}</strong><small>{service.id} · {service.steps.length} 个步骤</small></span><ChevronRight aria-hidden="true" />
          </button>
        ))}</div>
      </aside>

      <section className="template-detail">
        <div className="template-summary">
          <div className="template-summary-top"><span className="template-object-icon"><ListChecks aria-hidden="true" /></span><div><small>当前服务</small><h2>{selectedService.name}</h2><p>{selectedService.description}</p></div><StatusCapsule status={selectedService.status} /></div>
          <dl><div><dt>服务编码</dt><dd>{selectedService.id}</dd></div><div><dt>交付方式</dt><dd>{selectedService.delivery}</dd></div><div><dt>计量单位</dt><dd>{selectedService.unit}</dd></div><div><dt>当前版本</dt><dd>{selectedService.version}</dd></div></dl>
        </div>

        <div className="steps-panel">
          <div className="steps-heading"><div><h3>标准执行步骤</h3><p>工单创建时，将按下列顺序生成可执行步骤。</p></div><div><Button variant="outline" className="ct-button ct-button--ordinary">版本记录</Button><Button className="ct-button ct-button--primary"><Plus data-icon="inline-start" />添加步骤</Button></div></div>
          <ol className="step-template-list">{selectedService.steps.map((step, index) => (
            <li key={step.name}>
              <button type="button" className="drag-handle" aria-label={`调整步骤 ${index + 1} 顺序`}>⋮⋮</button><span className="step-number">{String(index + 1).padStart(2, '0')}</span>
              <span className="step-copy"><strong>{step.name}</strong><small>{step.type} · {step.required ? '必须完成' : '可选完成'}</small></span>
              <span className="step-tags"><span className="type-tag">{step.type}</span>{step.deliverable ? <span className="deliverable-tag"><FileCheck2 aria-hidden="true" />交付物</span> : null}</span>
              <StatusCapsule status="已启用" /><button type="button" className="more-button" aria-label={`更多 ${step.name} 操作`}><MoreHorizontal /></button>
            </li>
          ))}</ol>
          <div className="steps-footer"><span><Check aria-hidden="true" /> {selectedService.steps.length} 个步骤均已配置完成判定</span><span>最近更新：{selectedService.updatedAt} · {selectedService.owner}</span></div>
        </div>
      </section>
    </div>
  );
}
