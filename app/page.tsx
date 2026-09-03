'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
  Bell,
  Boxes,
  Building2,
  Check,
  ChevronDown,
  ContactRound,
  Database,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Server,
  Trash2,
  X,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type ServiceStatus = '草稿' | '已启用' | '已停用';
type SortDirection = 'asc' | 'desc';
type ViewKey = 'catalog' | 'reference-data';
type ReferenceTab = 'customers' | 'contacts' | 'assets' | 'business-objects';
type AssetStatus = '启用' | '停用' | '使用中' | '已使用';
type RoleName = (typeof roles)[number];
type ServiceCategory = (typeof serviceCategories)[number];
type CatalogForm = {
  category: ServiceCategory;
  name: string;
  description: string;
  priceUnit: '人天' | '权益';
  priceCoefficient: string;
  defaultQuantity: string;
  deliveryMethods: string[];
  certifications: string[];
  providers: string[];
  internalNote: string;
};

const roles = ['系统管理员', '销售', '项目经理', '服务工程师', '客户'] as const;
const serviceCategories = [
  '产品实施交付',
  '产品增值服务',
  '运维支持或培训',
  '技术保障或支持',
] as const;
const categoryCodes: Record<ServiceCategory, string> = {
  产品实施交付: 'IMP',
  产品增值服务: 'ADV',
  运维支持或培训: 'OPS',
  技术保障或支持: 'SUP',
};
const emptyCatalogForm: CatalogForm = {
  category: '产品实施交付',
  name: '',
  description: '',
  priceUnit: '人天',
  priceCoefficient: '',
  defaultQuantity: '',
  deliveryMethods: [],
  certifications: [],
  providers: [],
  internalNote: '',
};

type Service = {
  id: string;
  name: string;
  category: ServiceCategory;
  deliveryMethods: string[];
  priceUnit: '人天' | '权益';
  priceCoefficient: number;
  defaultQuantity: number;
  certifications: string[];
  providers: string[];
  internalNote: string;
  status: ServiceStatus;
  updatedAt: string;
  owner: string;
  description: string;
};

const services: Service[] = [
  {
    id: 'SC-IMP-001',
    name: '超融合核心平台实施交付',
    category: '产品实施交付',
    deliveryMethods: ['远程', '现场'],
    priceUnit: '人天',
    priceCoefficient: 1.25,
    defaultQuantity: 5,
    certifications: ['SMTX OS 认证', 'CloudTower 认证'],
    providers: ['原厂', '代理商'],
    internalNote: '适用于新建集群标准实施项目，复杂改造场景需单独评估。',
    status: '已启用',
    updatedAt: '2026-08-28 16:40',
    owner: '张昕',
    description:
      '新建 SMTX OS 集群并完成 CloudTower、可观测性平台与备份能力的规划、部署、验证及运维移交。',
  },
  {
    id: 'SC-OPS-001',
    name: '超融合核心平台健康巡检',
    category: '运维支持或培训',
    deliveryMethods: ['远程'],
    priceUnit: '权益',
    priceCoefficient: 0.75,
    defaultQuantity: 1,
    certifications: ['SMTX OS 认证'],
    providers: ['原厂', '服务商'],
    internalNote: '标准巡检按单集群核算，多集群项目按实际数量调整。',
    status: '已启用',
    updatedAt: '2026-08-21 10:18',
    owner: '林岚',
    description:
      '采集集群运行数据，检查容量、硬件、告警与数据保护状态，输出风险分级、处理建议及正式巡检报告。',
  },
];

type Customer = { id: string; name: string; team: string };
type Contact = { id: string; name: string; customerId: string; phone: string };
type Asset = {
  id: string;
  customerId: string;
  name: '远程人天' | '现场人天';
  status: AssetStatus;
};
type BusinessObject = {
  id: string;
  customerId: string;
  name: string;
  product: 'SMTX OS';
  nodeCount: number;
  upgradeEntitlement: number;
  inspectionEntitlement: number;
};

const initialCustomers: Customer[] = [
  { id: 'CUS-001', name: '北京星海科技有限公司', team: '华北大客户团队' },
  { id: 'CUS-002', name: '上海远帆数据有限公司', team: '华东商业团队' },
  { id: 'CUS-003', name: '深圳云岭信息技术有限公司', team: '华南生态团队' },
];

const initialContacts: Contact[] = [
  {
    id: 'CON-001',
    name: '周宁',
    customerId: 'CUS-001',
    phone: '138 0013 8000',
  },
  {
    id: 'CON-002',
    name: '沈奕',
    customerId: 'CUS-002',
    phone: '139 0013 9000',
  },
  {
    id: 'CON-003',
    name: '梁雯',
    customerId: 'CUS-003',
    phone: '136 0013 6000',
  },
];

const initialAssets: Asset[] = [
  { id: 'AST-001', customerId: 'CUS-001', name: '远程人天', status: '使用中' },
  { id: 'AST-002', customerId: 'CUS-001', name: '现场人天', status: '启用' },
  { id: 'AST-003', customerId: 'CUS-002', name: '远程人天', status: '已使用' },
];

const initialBusinessObjects: BusinessObject[] = [
  {
    id: 'OBJ-001',
    customerId: 'CUS-001',
    name: '生产超融合集群',
    product: 'SMTX OS',
    nodeCount: 8,
    upgradeEntitlement: 8,
    inspectionEntitlement: 8,
  },
  {
    id: 'OBJ-002',
    customerId: 'CUS-002',
    name: '核心数据库集群',
    product: 'SMTX OS',
    nodeCount: 6,
    upgradeEntitlement: 6,
    inspectionEntitlement: 4,
  },
  {
    id: 'OBJ-003',
    customerId: 'CUS-003',
    name: '研发测试集群',
    product: 'SMTX OS',
    nodeCount: 4,
    upgradeEntitlement: 4,
    inspectionEntitlement: 0,
  },
];

const referenceTabs: Array<{
  value: ReferenceTab;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'customers', label: '客户', icon: Building2 },
  { value: 'contacts', label: '联系人', icon: ContactRound },
  { value: 'assets', label: '资产', icon: Server },
  { value: 'business-objects', label: '业务对象', icon: Network },
];

const COPY = {
  appName: '服务管理中心',
  workspace: '北京志凌海纳',
  catalogTitle: '服务目录',
  catalogDescription: '统一维护可交付服务的范围、计价规则与交付约束。',
};

const navigation: Array<{
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}> = [
  {
    key: 'catalog',
    label: '服务目录',
    icon: Boxes,
  },
  {
    key: 'reference-data',
    label: '引用数据',
    icon: Database,
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
    <span
      className="ct-status"
      data-status={status === '已启用' ? 'positive' : 'neutral'}
    >
      {status}
    </span>
  );
}

function SideNavigation({
  activeView,
  onSelect,
  onNavigate,
}: {
  activeView: ViewKey;
  onSelect: (view: ViewKey) => void;
  onNavigate?: () => void;
}) {
  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="workspace-switcher">
        <strong>{COPY.workspace}</strong>
      </div>

      <nav className="sidebar-groups">
        {navigation.map((item) => (
          <div className="sidebar-group" key={item.label}>
            <button
              type="button"
              className="sidebar-item"
              data-active={activeView === item.key || undefined}
              aria-current={activeView === item.key ? 'page' : undefined}
              onClick={() => {
                onSelect(item.key);
                onNavigate?.();
              }}
            >
              <item.icon aria-hidden="true" />
              <span>{item.label}</span>
            </button>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function Header({
  currentRole,
  onRoleChange,
  onOpenMenu,
}: {
  currentRole: RoleName;
  onRoleChange: (role: RoleName) => void;
  onOpenMenu: () => void;
}) {
  return (
    <header className="topbar">
      <div className="topbar-brand" aria-label="SmartX 服务管理中心">
        {/* oxlint-disable-next-line next/no-img-element -- using the exact SmartX CDN wordmark from the reference console */}
        <img
          src="https://cdn.smartx.com/partner-connect/navigation/smartx-badge-on-light-horizontal.svg"
          alt="SmartX"
        />
        <span className="topbar-brand-divider" aria-hidden="true" />
        <strong>服务管理中心</strong>
      </div>
      <Button
        className="mobile-menu"
        variant="ghost"
        size="icon"
        aria-label="打开导航"
        onClick={onOpenMenu}
      >
        <Menu />
      </Button>
      <nav className="primary-nav" aria-label="顶部导航">
        <button type="button" aria-current="page">
          企业工作台
        </button>
      </nav>
      <div className="topbar-actions">
        <Button variant="outline" className="switch-console">
          切换至后台
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="通知"
          className="notification-button"
        >
          <Bell />
          <span aria-hidden="true" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                className="user-menu role-switcher"
                type="button"
                aria-label={`当前角色：${currentRole}，切换角色`}
              />
            }
          >
            <span>{currentRole}</span>
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="role-menu-content"
            align="end"
            sideOffset={6}
          >
            <DropdownMenuRadioGroup
              value={currentRole}
              onValueChange={(value) => onRoleChange(value as RoleName)}
            >
              <DropdownMenuLabel>切换角色</DropdownMenuLabel>
              {roles.map((role) => (
                <DropdownMenuRadioItem
                  className="role-menu-item"
                  key={role}
                  value={role}
                >
                  {role}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

function EmptyResult({ reset }: { reset: () => void }) {
  return (
    <div className="empty-result">
      <Search aria-hidden="true" />
      <strong>未找到匹配的服务</strong>
      <p>请检查搜索关键词或清除当前筛选条件。</p>
      <Button variant="outline" onClick={reset}>
        清除筛选
      </Button>
    </div>
  );
}

function MultiChoiceField({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <fieldset className="choice-fieldset">
      <legend>
        {label} <em>*</em>
      </legend>
      <div className="choice-options">
        {options.map((option) => (
          <label key={option}>
            <input
              type="checkbox"
              checked={values.includes(option)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, option]
                    : values.filter((value) => value !== option),
                )
              }
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function Home() {
  const [activeView, setActiveView] = useState<ViewKey>('catalog');
  const [serviceRecords, setServiceRecords] = useState<Service[]>(services);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部状态' | ServiceStatus>(
    '全部状态',
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [currentRole, setCurrentRole] = useState<RoleName>('系统管理员');
  const [catalogForm, setCatalogForm] = useState<CatalogForm>(emptyCatalogForm);
  const [formError, setFormError] = useState('');
  const [detailServiceId, setDetailServiceId] = useState<string | null>(null);
  const [referenceTab, setReferenceTab] = useState<ReferenceTab>('customers');
  const [customers, setCustomers] = useState<Customer[]>(initialCustomers);
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [assets, setAssets] = useState<Asset[]>(initialAssets);
  const [businessObjects, setBusinessObjects] = useState<BusinessObject[]>(
    initialBusinessObjects,
  );
  const [referenceCreateOpen, setReferenceCreateOpen] = useState(false);
  const [referenceForm, setReferenceForm] = useState<Record<string, string>>(
    {},
  );
  const [referenceFormError, setReferenceFormError] = useState('');

  const generatedCode = useMemo(() => {
    const nextSequence =
      serviceRecords.filter(
        (service) => service.category === catalogForm.category,
      ).length + 1;
    return `SC-${categoryCodes[catalogForm.category]}-${String(nextSequence).padStart(3, '0')}`;
  }, [catalogForm.category, serviceRecords]);

  function openCreation() {
    setCatalogForm(emptyCatalogForm);
    setFormError('');
    setCreateOpen(true);
  }

  function selectView(view: ViewKey) {
    setActiveView(view);
    setDetailServiceId(null);
    setQuery('');
  }

  function openReferenceCreation() {
    setReferenceForm({
      product: 'SMTX OS',
      status: '启用',
      assetName: '远程人天',
    });
    setReferenceFormError('');
    setReferenceCreateOpen(true);
  }

  function saveReferenceRecord() {
    const customerId = referenceForm.customerId ?? '';
    const nextNumber = (count: number) => String(count + 1).padStart(3, '0');

    if (referenceTab === 'customers') {
      if (!referenceForm.name?.trim() || !referenceForm.team?.trim())
        return setReferenceFormError('请填写客户名和负责团队。');
      setCustomers((records) => [
        ...records,
        {
          id: `CUS-${nextNumber(records.length)}`,
          name: referenceForm.name.trim(),
          team: referenceForm.team.trim(),
        },
      ]);
    }
    if (referenceTab === 'contacts') {
      if (
        !referenceForm.name?.trim() ||
        !customerId ||
        !/^1\d{10}$/.test((referenceForm.phone ?? '').replaceAll(' ', ''))
      )
        return setReferenceFormError(
          '请填写姓名、所属客户和有效的 11 位手机号。',
        );
      setContacts((records) => [
        ...records,
        {
          id: `CON-${nextNumber(records.length)}`,
          name: referenceForm.name.trim(),
          customerId,
          phone: referenceForm.phone.trim(),
        },
      ]);
    }
    if (referenceTab === 'assets') {
      if (!customerId) return setReferenceFormError('请选择所属客户。');
      setAssets((records) => [
        ...records,
        {
          id: `AST-${nextNumber(records.length)}`,
          customerId,
          name: (referenceForm.assetName ?? '远程人天') as Asset['name'],
          status: (referenceForm.status ?? '启用') as AssetStatus,
        },
      ]);
    }
    if (referenceTab === 'business-objects') {
      const nodeCount = Number(referenceForm.nodeCount);
      const upgradeEntitlement = Number(referenceForm.upgradeEntitlement);
      const inspectionEntitlement = Number(referenceForm.inspectionEntitlement);
      if (
        !customerId ||
        !referenceForm.name?.trim() ||
        !Number.isInteger(nodeCount) ||
        nodeCount <= 0 ||
        referenceForm.upgradeEntitlement === undefined ||
        referenceForm.upgradeEntitlement === '' ||
        !Number.isInteger(upgradeEntitlement) ||
        upgradeEntitlement < 0 ||
        upgradeEntitlement > nodeCount ||
        referenceForm.inspectionEntitlement === undefined ||
        referenceForm.inspectionEntitlement === '' ||
        !Number.isInteger(inspectionEntitlement) ||
        inspectionEntitlement < 0 ||
        inspectionEntitlement > nodeCount
      )
        return setReferenceFormError(
          '请选择客户并填写对象名称；两类权益须为非负整数，且均不能超过节点数。',
        );
      setBusinessObjects((records) => [
        ...records,
        {
          id: `OBJ-${nextNumber(records.length)}`,
          customerId,
          name: referenceForm.name.trim(),
          product: 'SMTX OS',
          nodeCount,
          upgradeEntitlement,
          inspectionEntitlement,
        },
      ]);
    }

    setReferenceCreateOpen(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2600);
  }

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext })
      .modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    const register = (tool: Parameters<WebMcpContext['registerTool']>[0]) => {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => undefined);
    };

    register({
      name: 'filter_service_catalog',
      title: '筛选服务目录',
      description: '切换到服务目录并按关键词与启用状态筛选可见服务。',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          status: {
            type: 'string',
            enum: ['全部状态', '草稿', '已启用', '已停用'],
          },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) {
        const value = (input ?? {}) as { query?: unknown; status?: unknown };
        if (value.query !== undefined && typeof value.query !== 'string')
          throw new Error('query 必须是字符串');
        if (
          value.status !== undefined &&
          (typeof value.status !== 'string' ||
            !['全部状态', '草稿', '已启用', '已停用'].includes(value.status))
        )
          throw new Error('status 不受支持');
        const nextQuery = typeof value.query === 'string' ? value.query : '';
        const nextStatus = (value.status ?? '全部状态') as
          | '全部状态'
          | ServiceStatus;
        setDetailServiceId(null);
        setQuery(nextQuery);
        setStatusFilter(nextStatus);
        const normalized = nextQuery.trim().toLowerCase();
        const matchedCount = services.filter(
          (service) =>
            (!normalized ||
              `${service.name} ${service.id} ${service.category}`
                .toLowerCase()
                .includes(normalized)) &&
            (nextStatus === '全部状态' || service.status === nextStatus),
        ).length;
        return {
          view: 'catalog',
          query: nextQuery,
          status: nextStatus,
          matchedCount,
        };
      },
    });

    register({
      name: 'start_service_creation',
      title: '开始新建服务目录',
      description: '打开新建服务目录表单，不会在确认保存前创建记录。',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        setCatalogForm(emptyCatalogForm);
        setFormError('');
        setCreateOpen(true);
        return { started: true, view: 'catalog', dialog: 'create-service' };
      },
    });

    return () => lifecycle.abort();
  }, []);

  const filteredServices = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return serviceRecords
      .filter((service) => {
        const matchesQuery =
          !normalized ||
          service.name.toLowerCase().includes(normalized) ||
          service.id.toLowerCase().includes(normalized) ||
          service.category.toLowerCase().includes(normalized);
        const matchesStatus =
          statusFilter === '全部状态' || service.status === statusFilter;
        return matchesQuery && matchesStatus;
      })
      .sort((a, b) => {
        const comparison = a.name.localeCompare(b.name, 'zh-CN');
        return sortDirection === 'asc' ? comparison : -comparison;
      });
  }, [query, serviceRecords, sortDirection, statusFilter]);

  const detailService =
    serviceRecords.find((service) => service.id === detailServiceId) ?? null;
  function saveDraft() {
    const decimalPattern = /^\d{1,3}(\.\d{1,2})?$/;
    const allFieldsComplete =
      catalogForm.name.trim() &&
      catalogForm.description.trim() &&
      catalogForm.internalNote.trim() &&
      catalogForm.deliveryMethods.length &&
      catalogForm.certifications.length &&
      catalogForm.providers.length;
    const validNumbers =
      decimalPattern.test(catalogForm.priceCoefficient) &&
      decimalPattern.test(catalogForm.defaultQuantity) &&
      Number(catalogForm.priceCoefficient) > 0 &&
      Number(catalogForm.defaultQuantity) > 0;
    if (!allFieldsComplete || !validNumbers) {
      setFormError(
        '请填写全部字段；计价系数和默认计价数量须为大于 0、最多两位小数的数字。',
      );
      return;
    }
    const now = new Date();
    const createdService: Service = {
      id: generatedCode,
      name: catalogForm.name.trim(),
      category: catalogForm.category,
      deliveryMethods: catalogForm.deliveryMethods,
      priceUnit: catalogForm.priceUnit,
      priceCoefficient: Number(catalogForm.priceCoefficient),
      defaultQuantity: Number(catalogForm.defaultQuantity),
      certifications: catalogForm.certifications,
      providers: catalogForm.providers,
      internalNote: catalogForm.internalNote.trim(),
      status: '草稿',
      updatedAt: now
        .toLocaleString('zh-CN', { hour12: false })
        .replaceAll('/', '-'),
      owner: currentRole,
      description: catalogForm.description.trim(),
    };
    setServiceRecords((records) => [...records, createdService]);
    setCreateOpen(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2600);
  }

  return (
    <div className="app-shell">
      <SideNavigation activeView={activeView} onSelect={selectView} />

      {mobileNavOpen ? (
        <div className="mobile-nav-layer">
          <button
            className="mobile-nav-backdrop"
            type="button"
            aria-label="关闭导航"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="mobile-nav-panel">
            <Button
              variant="ghost"
              size="icon"
              aria-label="关闭导航"
              className="mobile-nav-close"
              onClick={() => setMobileNavOpen(false)}
            >
              <X />
            </Button>
            <SideNavigation
              activeView={activeView}
              onSelect={selectView}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="app-main">
        <Header
          currentRole={currentRole}
          onRoleChange={setCurrentRole}
          onOpenMenu={() => setMobileNavOpen(true)}
        />
        <main className="content-area">
          <section className="page-header">
            <div>
              <h1>{activeView === 'catalog' ? '服务目录' : '引用数据'}</h1>
              {activeView === 'reference-data' ? (
                <p>维护 Demo 流程中引用的客户、联系人、资产与业务对象。</p>
              ) : null}
            </div>
            {activeView === 'catalog' ? (
              <div className="page-header-actions">
                <search className="search-field">
                  <Search aria-hidden="true" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索服务名称、服务编码或分类"
                    aria-label="搜索服务目录"
                  />
                  {query ? (
                    <button
                      type="button"
                      aria-label="清除搜索"
                      onClick={() => setQuery('')}
                    >
                      <X aria-hidden="true" />
                    </button>
                  ) : null}
                </search>
                <Button
                  className="ct-button ct-button--primary"
                  onClick={openCreation}
                >
                  <Plus data-icon="inline-start" />
                  新建服务目录
                </Button>
              </div>
            ) : null}
          </section>

          {activeView === 'catalog' ? (
            <CatalogView
              services={filteredServices}
              detailService={detailService}
              onView={setDetailServiceId}
              onBack={() => setDetailServiceId(null)}
              sortDirection={sortDirection}
              setSortDirection={setSortDirection}
              resetFilters={() => {
                setQuery('');
                setStatusFilter('全部状态');
              }}
            />
          ) : (
            <ReferenceDataView
              activeTab={referenceTab}
              onTabChange={setReferenceTab}
              customers={customers}
              contacts={contacts}
              assets={assets}
              businessObjects={businessObjects}
              onCreate={openReferenceCreation}
              onDeleteCustomer={(id) =>
                setCustomers((records) =>
                  records.filter((record) => record.id !== id),
                )
              }
              onDeleteContact={(id) =>
                setContacts((records) =>
                  records.filter((record) => record.id !== id),
                )
              }
              onDeleteAsset={(id) =>
                setAssets((records) =>
                  records.filter((record) => record.id !== id),
                )
              }
              onDeleteBusinessObject={(id) =>
                setBusinessObjects((records) =>
                  records.filter((record) => record.id !== id),
                )
              }
            />
          )}
        </main>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="create-dialog">
          <DialogHeader>
            <DialogTitle>新建服务目录</DialogTitle>
            <DialogDescription>
              填写服务目录全部字段，创建后将以草稿状态进入列表。
            </DialogDescription>
          </DialogHeader>
          <div className="dialog-form catalog-form">
            <section className="form-section">
              <h3>基本信息</h3>
              <div className="dialog-grid">
                <label htmlFor="service-category">
                  <span>
                    服务类别 <em>*</em>
                  </span>
                  <select
                    id="service-category"
                    value={catalogForm.category}
                    onChange={(event) =>
                      setCatalogForm((form) => ({
                        ...form,
                        category: event.target.value as ServiceCategory,
                      }))
                    }
                  >
                    {serviceCategories.map((category) => (
                      <option key={category}>{category}</option>
                    ))}
                  </select>
                </label>
                <label htmlFor="service-code">
                  <span>服务编码</span>
                  <Input
                    id="service-code"
                    value={generatedCode}
                    readOnly
                    aria-readonly="true"
                  />
                </label>
              </div>
              <label htmlFor="service-name">
                <span>
                  服务名称 <em>*</em>
                </span>
                <Input
                  id="service-name"
                  value={catalogForm.name}
                  onChange={(event) =>
                    setCatalogForm((form) => ({
                      ...form,
                      name: event.target.value,
                    }))
                  }
                  maxLength={80}
                  placeholder="例如：数据库迁移实施服务"
                />
              </label>
              <label htmlFor="service-description">
                <span>
                  服务说明 <em>*</em>
                </span>
                <textarea
                  id="service-description"
                  value={catalogForm.description}
                  onChange={(event) =>
                    setCatalogForm((form) => ({
                      ...form,
                      description: event.target.value,
                    }))
                  }
                  maxLength={255}
                  placeholder="说明服务范围、交付边界与成功标准"
                  rows={3}
                />
              </label>
            </section>
            <section className="form-section">
              <h3>计价规则</h3>
              <div className="dialog-grid dialog-grid--three">
                <label htmlFor="service-unit">
                  <span>
                    计价单位 <em>*</em>
                  </span>
                  <select
                    id="service-unit"
                    value={catalogForm.priceUnit}
                    onChange={(event) =>
                      setCatalogForm((form) => ({
                        ...form,
                        priceUnit: event.target
                          .value as CatalogForm['priceUnit'],
                      }))
                    }
                  >
                    <option>人天</option>
                    <option>权益</option>
                  </select>
                </label>
                <label htmlFor="price-coefficient">
                  <span>
                    计价系数 <em>*</em>
                  </span>
                  <Input
                    id="price-coefficient"
                    inputMode="decimal"
                    value={catalogForm.priceCoefficient}
                    onChange={(event) =>
                      setCatalogForm((form) => ({
                        ...form,
                        priceCoefficient: event.target.value,
                      }))
                    }
                    placeholder="例如：1.25"
                  />
                </label>
                <label htmlFor="default-quantity">
                  <span>
                    默认计价数量 <em>*</em>
                  </span>
                  <Input
                    id="default-quantity"
                    inputMode="decimal"
                    value={catalogForm.defaultQuantity}
                    onChange={(event) =>
                      setCatalogForm((form) => ({
                        ...form,
                        defaultQuantity: event.target.value,
                      }))
                    }
                    placeholder="例如：5.00"
                  />
                </label>
              </div>
            </section>
            <section className="form-section">
              <h3>交付约束</h3>
              <MultiChoiceField
                label="支持服务方式"
                options={['远程', '现场']}
                values={catalogForm.deliveryMethods}
                onChange={(deliveryMethods) =>
                  setCatalogForm((form) => ({ ...form, deliveryMethods }))
                }
              />
              <MultiChoiceField
                label="认证要求"
                options={['SMTX OS 认证', 'CloudTower 认证', '无认证要求']}
                values={catalogForm.certifications}
                onChange={(certifications) =>
                  setCatalogForm((form) => ({ ...form, certifications }))
                }
              />
              <MultiChoiceField
                label="支持服务方"
                options={['原厂', '代理商', '服务商']}
                values={catalogForm.providers}
                onChange={(providers) =>
                  setCatalogForm((form) => ({ ...form, providers }))
                }
              />
            </section>
            <section className="form-section">
              <h3>内部信息</h3>
              <label htmlFor="internal-note">
                <span>
                  内部备注 <em>*</em>
                </span>
                <textarea
                  id="internal-note"
                  value={catalogForm.internalNote}
                  onChange={(event) =>
                    setCatalogForm((form) => ({
                      ...form,
                      internalNote: event.target.value,
                    }))
                  }
                  maxLength={255}
                  placeholder="填写适用范围、特殊核算规则或内部注意事项"
                  rows={2}
                />
              </label>
            </section>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="dialog-notice">
              服务编码按类别自动生成，创建后状态为草稿。
            </div>
          </div>
          <DialogFooter className="dialog-footer">
            <DialogClose
              render={
                <Button
                  variant="outline"
                  className="ct-button ct-button--ordinary"
                />
              }
            >
              取消
            </DialogClose>
            <Button
              className="ct-button ct-button--primary"
              onClick={saveDraft}
            >
              创建服务目录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReferenceCreateDialog
        open={referenceCreateOpen}
        onOpenChange={setReferenceCreateOpen}
        activeTab={referenceTab}
        customers={customers}
        form={referenceForm}
        setForm={setReferenceForm}
        error={referenceFormError}
        onSave={saveReferenceRecord}
      />

      {saved ? (
        <output className="toast-message">
          <span>
            <Check aria-hidden="true" />
          </span>
          <span className="toast-copy">
            <strong>记录已保存</strong>
            <small>新记录已加入当前列表。</small>
          </span>
        </output>
      ) : null}
    </div>
  );
}

type CatalogViewProps = {
  services: Service[];
  detailService: Service | null;
  onView: (id: string) => void;
  onBack: () => void;
  sortDirection: SortDirection;
  setSortDirection: (value: SortDirection) => void;
  resetFilters: () => void;
};

function CatalogView(props: CatalogViewProps) {
  if (props.detailService)
    return (
      <CatalogDetail service={props.detailService} onBack={props.onBack} />
    );

  return (
    <div className="catalog-view">
      <section className="table-panel" aria-label="服务目录列表">
        {props.services.length ? (
          <div className="table-scroll">
            <table className="service-table">
              <thead>
                <tr>
                  <th
                    aria-sort={
                      props.sortDirection === 'asc' ? 'ascending' : 'descending'
                    }
                  >
                    <button
                      type="button"
                      className="sort-button"
                      onClick={() =>
                        props.setSortDirection(
                          props.sortDirection === 'asc' ? 'desc' : 'asc',
                        )
                      }
                    >
                      服务名称{' '}
                      <span aria-hidden="true">
                        {props.sortDirection === 'asc' ? '↑' : '↓'}
                      </span>
                    </button>
                  </th>
                  <th>服务类别</th>
                  <th>计价系数</th>
                  <th>服务方式</th>
                  <th>支持服务方</th>
                  <th>状态</th>
                  <th>最近更新</th>
                  <th className="actions-column">操作</th>
                </tr>
              </thead>
              <tbody>
                {props.services.map((service) => (
                  <tr key={service.id}>
                    <td>
                      <div className="service-identity">
                        <button
                          type="button"
                          onClick={() => props.onView(service.id)}
                          aria-label={`查看服务 ${service.name}`}
                        >
                          {service.name}
                        </button>
                        <code>{service.id}</code>
                      </div>
                    </td>
                    <td>{service.category}</td>
                    <td>
                      <strong className="price-coefficient">
                        {service.priceCoefficient.toFixed(2)}
                      </strong>
                      <small className="cell-note">
                        {' '}
                        / {service.priceUnit}
                      </small>
                    </td>
                    <td>{service.deliveryMethods.join(' / ')}</td>
                    <td>{service.providers.join('、')}</td>
                    <td>
                      <StatusCapsule status={service.status} />
                    </td>
                    {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- this cell is read-only metadata and contains no control */}
                    <td>
                      <div className="updated-cell">
                        <span>{service.updatedAt.split(' ')[0]}</span>
                        <small>{service.owner}</small>
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          onClick={() => props.onView(service.id)}
                          aria-label={`查看 ${service.name}`}
                        >
                          查看
                        </button>
                        <button
                          type="button"
                          aria-label={`更多 ${service.name} 操作`}
                        >
                          <MoreHorizontal />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyResult reset={props.resetFilters} />
        )}
      </section>
    </div>
  );
}

function CatalogDetail({
  service,
  onBack,
}: {
  service: Service;
  onBack: () => void;
}) {
  return (
    <article className="catalog-detail" aria-label={`${service.name}详情`}>
      <header className="detail-heading">
        <div>
          <button type="button" className="detail-back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            返回服务目录
          </button>
          <div className="detail-title-row">
            <h2>{service.name}</h2>
            <StatusCapsule status={service.status} />
          </div>
          <p>
            {service.id} · {service.category}
          </p>
        </div>
        <div className="detail-actions">
          <Button variant="outline" className="ct-button ct-button--ordinary">
            编辑
          </Button>
          <Button className="ct-button ct-button--primary">
            {service.status === '已启用' ? '停用' : '启用'}
          </Button>
        </div>
      </header>

      <div className="detail-grid">
        <section className="detail-card detail-card--wide">
          <h3>基本信息</h3>
          <dl>
            <div>
              <dt>服务编码</dt>
              <dd>{service.id}</dd>
            </div>
            <div>
              <dt>服务类别</dt>
              <dd>{service.category}</dd>
            </div>
            <div className="detail-span">
              <dt>服务说明</dt>
              <dd>{service.description}</dd>
            </div>
            <div className="detail-span">
              <dt>内部备注</dt>
              <dd>{service.internalNote}</dd>
            </div>
          </dl>
        </section>
        <section className="detail-card">
          <h3>计价规则</h3>
          <dl>
            <div>
              <dt>计价单位</dt>
              <dd>{service.priceUnit}</dd>
            </div>
            <div>
              <dt>计价系数</dt>
              <dd>{service.priceCoefficient.toFixed(2)}</dd>
            </div>
            <div>
              <dt>默认计价数量</dt>
              <dd>{service.defaultQuantity.toFixed(2)}</dd>
            </div>
            <div>
              <dt>默认核算结果</dt>
              <dd>
                {(service.priceCoefficient * service.defaultQuantity).toFixed(
                  2,
                )}{' '}
                {service.priceUnit}
              </dd>
            </div>
          </dl>
        </section>
        <section className="detail-card">
          <h3>交付约束</h3>
          <dl>
            <div className="detail-span">
              <dt>支持服务方式</dt>
              <dd>{service.deliveryMethods.join('、')}</dd>
            </div>
            <div className="detail-span">
              <dt>认证要求</dt>
              <dd>{service.certifications.join('、')}</dd>
            </div>
            <div className="detail-span">
              <dt>支持服务方</dt>
              <dd>{service.providers.join('、')}</dd>
            </div>
          </dl>
        </section>
        <section className="detail-card detail-card--wide">
          <h3>记录信息</h3>
          <dl>
            <div>
              <dt>创建人</dt>
              <dd>{service.owner}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{service.updatedAt}</dd>
            </div>
            <div>
              <dt>上次修改人</dt>
              <dd>{service.owner}</dd>
            </div>
            <div>
              <dt>上次修改时间</dt>
              <dd>{service.updatedAt}</dd>
            </div>
          </dl>
        </section>
      </div>
    </article>
  );
}

type ReferenceDataViewProps = {
  activeTab: ReferenceTab;
  onTabChange: (tab: ReferenceTab) => void;
  customers: Customer[];
  contacts: Contact[];
  assets: Asset[];
  businessObjects: BusinessObject[];
  onCreate: () => void;
  onDeleteCustomer: (id: string) => void;
  onDeleteContact: (id: string) => void;
  onDeleteAsset: (id: string) => void;
  onDeleteBusinessObject: (id: string) => void;
};

function ReferenceDataView(props: ReferenceDataViewProps) {
  const customerNames = new Map(
    props.customers.map((customer) => [customer.id, customer.name]),
  );
  const activeLabel =
    referenceTabs.find((tab) => tab.value === props.activeTab)?.label ?? '记录';
  const counts: Record<ReferenceTab, number> = {
    customers: props.customers.length,
    contacts: props.contacts.length,
    assets: props.assets.length,
    'business-objects': props.businessObjects.length,
  };

  return (
    <section className="reference-panel" aria-label="引用数据维护">
      <div className="reference-toolbar">
        <Tabs
          value={props.activeTab}
          onValueChange={(value) => props.onTabChange(value as ReferenceTab)}
        >
          <TabsList
            variant="line"
            className="reference-tabs"
            aria-label="引用数据分类"
          >
            {referenceTabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="reference-tab"
              >
                <tab.icon aria-hidden="true" />
                {tab.label}
                <span>{counts[tab.value]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button
          className="ct-button ct-button--primary"
          onClick={props.onCreate}
        >
          <Plus data-icon="inline-start" />
          新建{activeLabel}
        </Button>
      </div>

      <div className="reference-context">
        <div>
          <Database aria-hidden="true" />
          <span>
            <strong>{activeLabel}</strong>
            <small>Demo 引用主数据</small>
          </span>
        </div>
        <p>这些记录只用于演示业务流程中的选择与关联。</p>
      </div>

      <div className="table-scroll">
        {props.activeTab === 'customers' ? (
          <table className="reference-table">
            <thead>
              <tr>
                <th>客户名</th>
                <th>负责团队</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.customers.map((record) => {
                const referenced =
                  props.contacts.some(
                    (item) => item.customerId === record.id,
                  ) ||
                  props.assets.some((item) => item.customerId === record.id) ||
                  props.businessObjects.some(
                    (item) => item.customerId === record.id,
                  );
                return (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.name}</strong>
                    </td>
                    <td>{record.team}</td>
                    <td>
                      <code>{record.id}</code>
                    </td>
                    <td>
                      <button
                        className="delete-record"
                        type="button"
                        disabled={referenced}
                        title={
                          referenced ? '该客户已被其他记录引用' : '删除客户'
                        }
                        aria-label={`删除客户 ${record.name}`}
                        onClick={() => props.onDeleteCustomer(record.id)}
                      >
                        <Trash2 />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        {props.activeTab === 'contacts' ? (
          <table className="reference-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>所属客户</th>
                <th>手机号</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.contacts.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.name}</strong>
                  </td>
                  <td>{customerNames.get(record.customerId)}</td>
                  <td className="numeric-cell">{record.phone}</td>
                  <td>
                    <code>{record.id}</code>
                  </td>
                  <td>
                    <button
                      className="delete-record"
                      type="button"
                      aria-label={`删除联系人 ${record.name}`}
                      onClick={() => props.onDeleteContact(record.id)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {props.activeTab === 'assets' ? (
          <table className="reference-table">
            <thead>
              <tr>
                <th>所属客户</th>
                <th>资产名称</th>
                <th>状态</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.assets.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{customerNames.get(record.customerId)}</strong>
                  </td>
                  <td>{record.name}</td>
                  <td>
                    <span
                      className="reference-status"
                      data-status={record.status}
                    >
                      {record.status}
                    </span>
                  </td>
                  <td>
                    <code>{record.id}</code>
                  </td>
                  <td>
                    <button
                      className="delete-record"
                      type="button"
                      aria-label={`删除资产 ${record.id}`}
                      onClick={() => props.onDeleteAsset(record.id)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {props.activeTab === 'business-objects' ? (
          <table className="reference-table">
            <thead>
              <tr>
                <th>对象名称</th>
                <th>所属客户</th>
                <th>产品</th>
                <th>节点数</th>
                <th>升级权益</th>
                <th>巡检权益</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.businessObjects.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.name}</strong>
                  </td>
                  <td>{customerNames.get(record.customerId)}</td>
                  <td>
                    <span className="product-tag">{record.product}</span>
                  </td>
                  <td className="numeric-cell">{record.nodeCount}</td>
                  <td className="numeric-cell">{record.upgradeEntitlement}</td>
                  <td className="numeric-cell">
                    {record.inspectionEntitlement}
                  </td>
                  <td>
                    <code>{record.id}</code>
                  </td>
                  <td>
                    <button
                      className="delete-record"
                      type="button"
                      aria-label={`删除业务对象 ${record.name}`}
                      onClick={() => props.onDeleteBusinessObject(record.id)}
                    >
                      <Trash2 />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

type ReferenceCreateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeTab: ReferenceTab;
  customers: Customer[];
  form: Record<string, string>;
  setForm: Dispatch<SetStateAction<Record<string, string>>>;
  error: string;
  onSave: () => void;
};

function ReferenceCreateDialog(props: ReferenceCreateDialogProps) {
  const activeLabel =
    referenceTabs.find((tab) => tab.value === props.activeTab)?.label ?? '记录';
  const update = (key: string, value: string) =>
    props.setForm((form) => ({ ...form, [key]: value }));
  const customerSelect = (
    <label htmlFor="reference-customer">
      <span>
        所属客户 <em>*</em>
      </span>
      <select
        id="reference-customer"
        value={props.form.customerId ?? ''}
        onChange={(event) => update('customerId', event.target.value)}
      >
        <option value="">请选择客户</option>
        {props.customers.map((customer) => (
          <option key={customer.id} value={customer.id}>
            {customer.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="create-dialog reference-create-dialog">
        <DialogHeader>
          <DialogTitle>新建{activeLabel}</DialogTitle>
          <DialogDescription>
            添加一条可供 Demo 业务流程选择和引用的主数据。
          </DialogDescription>
        </DialogHeader>
        <div className="dialog-form">
          {props.activeTab === 'customers' ? (
            <>
              <label htmlFor="customer-name">
                <span>
                  客户名 <em>*</em>
                </span>
                <Input
                  id="customer-name"
                  value={props.form.name ?? ''}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="例如：北京星海科技有限公司"
                />
              </label>
              <label htmlFor="customer-team">
                <span>
                  负责团队 <em>*</em>
                </span>
                <Input
                  id="customer-team"
                  value={props.form.team ?? ''}
                  onChange={(event) => update('team', event.target.value)}
                  placeholder="例如：华北大客户团队"
                />
              </label>
            </>
          ) : null}
          {props.activeTab === 'contacts' ? (
            <>
              {customerSelect}
              <label htmlFor="contact-name">
                <span>
                  姓名 <em>*</em>
                </span>
                <Input
                  id="contact-name"
                  value={props.form.name ?? ''}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="请输入联系人姓名"
                />
              </label>
              <label htmlFor="contact-phone">
                <span>
                  手机号 <em>*</em>
                </span>
                <Input
                  id="contact-phone"
                  inputMode="tel"
                  value={props.form.phone ?? ''}
                  onChange={(event) => update('phone', event.target.value)}
                  placeholder="请输入 11 位手机号"
                />
              </label>
            </>
          ) : null}
          {props.activeTab === 'assets' ? (
            <>
              {customerSelect}
              <label htmlFor="asset-name">
                <span>
                  资产名称 <em>*</em>
                </span>
                <select
                  id="asset-name"
                  value={props.form.assetName ?? '远程人天'}
                  onChange={(event) => update('assetName', event.target.value)}
                >
                  <option>远程人天</option>
                  <option>现场人天</option>
                </select>
              </label>
              <label htmlFor="asset-status">
                <span>
                  状态 <em>*</em>
                </span>
                <select
                  id="asset-status"
                  value={props.form.status ?? '启用'}
                  onChange={(event) => update('status', event.target.value)}
                >
                  {['启用', '停用', '使用中', '已使用'].map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          {props.activeTab === 'business-objects' ? (
            <>
              {customerSelect}
              <label htmlFor="object-name">
                <span>
                  对象名称 <em>*</em>
                </span>
                <Input
                  id="object-name"
                  value={props.form.name ?? ''}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="例如：生产超融合集群"
                />
              </label>
              <label htmlFor="object-product">
                <span>产品</span>
                <Input
                  id="object-product"
                  value="SMTX OS"
                  readOnly
                  aria-readonly="true"
                />
              </label>
              <div className="dialog-grid dialog-grid--three">
                <label htmlFor="node-count">
                  <span>
                    节点数 <em>*</em>
                  </span>
                  <Input
                    id="node-count"
                    type="number"
                    min="1"
                    step="1"
                    value={props.form.nodeCount ?? ''}
                    onChange={(event) =>
                      update('nodeCount', event.target.value)
                    }
                    placeholder="例如：8"
                  />
                </label>
                <label htmlFor="upgrade-entitlement">
                  <span>
                    升级权益 <em>*</em>
                  </span>
                  <Input
                    id="upgrade-entitlement"
                    type="number"
                    min="0"
                    max={props.form.nodeCount || undefined}
                    step="1"
                    value={props.form.upgradeEntitlement ?? ''}
                    onChange={(event) =>
                      update('upgradeEntitlement', event.target.value)
                    }
                    placeholder="不超过节点数"
                  />
                </label>
                <label htmlFor="inspection-entitlement">
                  <span>
                    巡检权益 <em>*</em>
                  </span>
                  <Input
                    id="inspection-entitlement"
                    type="number"
                    min="0"
                    max={props.form.nodeCount || undefined}
                    step="1"
                    value={props.form.inspectionEntitlement ?? ''}
                    onChange={(event) =>
                      update('inspectionEntitlement', event.target.value)
                    }
                    placeholder="不超过节点数"
                  />
                </label>
              </div>
              <p className="field-hint">
                升级权益和巡检权益均须小于或等于节点数。
              </p>
            </>
          ) : null}
          {props.error ? (
            <p className="form-error" role="alert">
              {props.error}
            </p>
          ) : null}
        </div>
        <DialogFooter className="dialog-footer">
          <DialogClose
            render={
              <Button
                variant="outline"
                className="ct-button ct-button--ordinary"
              />
            }
          >
            取消
          </DialogClose>
          <Button
            className="ct-button ct-button--primary"
            onClick={props.onSave}
          >
            创建{activeLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
