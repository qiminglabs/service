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
  ClipboardList,
  ContactRound,
  Database,
  Menu,
  MoreHorizontal,
  Network,
  Plus,
  Search,
  Server,
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
import { readLocal, saveLocal } from '@/lib/service-requests';
import { businessObjectProducts } from '@/lib/product-dictionary';
import {
  RequestWorkspace,
  RequestCatalogSettings,
  BusinessObjectProductsContext,
} from '@/components/service-requests';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  RequestFieldSettings,
  RequestFieldsContext,
  normalizeRequestFields,
  initialRequestFields,
  type RequestField,
} from '@/components/request-field-settings';
import { importedServiceCatalogSeeds } from './service-catalog-import';

type ServiceStatus = '草稿' | '已启用' | '已停用';
type SortDirection = 'asc' | 'desc';
type ViewKey = 'requests' | 'catalog' | 'reference-data' | 'field-settings';
type ReferenceTab = 'customers' | 'contacts' | 'assets' | 'business-objects';
type AssetStatus = '启用' | '停用' | '使用中' | '已使用';
type MasterDataStatus = '启用' | '停用';
type ResponsibleTeam = (typeof responsibleTeams)[number];
type BusinessObjectProduct = (typeof businessObjectProducts)[number];
type RoleName = (typeof roles)[number];
type ServiceCategory = (typeof serviceCategories)[number];
type CatalogForm = {
  category: ServiceCategory;
  name: string;
  description: string;
  priceUnit: '服务人天' | '巡检权益' | '升级权益';
  priceCoefficient: string;
  defaultQuantity: string;
  deliveryMethods: string[];
  certifications: string[];
  providers: string[];
  allowedInitiatorSites: string[];
  internalNote: string;
};

const roles = ['系统管理员', '销售', '项目经理', '服务工程师', '客户'] as const;
const responsibleTeams = ['金融', '商业', '港澳', '其他'] as const;
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
  priceUnit: '服务人天',
  priceCoefficient: '',
  defaultQuantity: '',
  deliveryMethods: [],
  certifications: [],
  providers: [],
  allowedInitiatorSites: [],
  internalNote: '',
};

type Service = {
  id: string;
  name: string;
  category: ServiceCategory;
  deliveryMethods: string[];
  priceUnit: '服务人天' | '巡检权益' | '升级权益';
  priceCoefficient: number;
  defaultQuantity: number;
  certifications: string[];
  providers: string[];
  allowedInitiatorSites: string[];
  internalNote: string;
  status: ServiceStatus;
  updatedAt: string;
  owner: string;
  description: string;
};

const services: Service[] = (() => {
  const sequences: Record<ServiceCategory, number> = {
    产品实施交付: 0,
    产品增值服务: 0,
    运维支持或培训: 0,
    技术保障或支持: 0,
  };

  return importedServiceCatalogSeeds.map((seed) => {
    const sequence = ++sequences[seed.serviceCategory];
    return {
      id: `SC-${categoryCodes[seed.serviceCategory]}-${String(sequence).padStart(3, '0')}`,
      name: seed.serviceName,
      category: seed.serviceCategory,
      deliveryMethods: ['远程', '现场'],
      priceUnit: seed.pricingUnit ?? '服务人天',
      priceCoefficient: 1,
      defaultQuantity: 1,
      certifications: ['无认证要求'],
      providers: [...seed.supportedProviders],
      allowedInitiatorSites: ['内部系统', '客户中心', '合作伙伴中心'],
      internalNote: '由 Google 表格“服务目录设计”的“服务目录”页导入。',
      status: '已启用',
      updatedAt: '2026-09-07 00:00',
      owner: '系统导入',
      description: seed.serviceDescription,
    };
  });
})();

const importedServiceIds = new Set(services.map((service) => service.id));

function mergeImportedServices(storedServices: Service[]): Service[] {
  return [
    ...services,
    ...storedServices.filter((service) => !importedServiceIds.has(service.id)),
  ];
}

type Customer = {
  id: string;
  name: string;
  team: ResponsibleTeam;
  status: MasterDataStatus;
};
type Contact = {
  id: string;
  name: string;
  customerId: string;
  phone: string;
  email: string;
  status: MasterDataStatus;
};
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
  sn: string;
  product: BusinessObjectProduct;
  nodeCount: number;
  upgradeEntitlement: number;
  inspectionEntitlement: number;
  status: MasterDataStatus;
};
type StoredBusinessObject = Omit<BusinessObject, 'product'> & {
  product: string;
};

const initialCustomers: Customer[] = [
  { id: 'CUS-001', name: '北京星海科技有限公司', team: '金融', status: '启用' },
  { id: 'CUS-002', name: '上海远帆数据有限公司', team: '商业', status: '启用' },
  {
    id: 'CUS-003',
    name: '深圳云岭信息技术有限公司',
    team: '其他',
    status: '启用',
  },
];

const initialContacts: Contact[] = [
  {
    id: 'CON-001',
    name: '周宁',
    customerId: 'CUS-001',
    phone: '138 0013 8000',
    email: 'zhou.ning@example.com',
    status: '启用',
  },
  {
    id: 'CON-002',
    name: '沈奕',
    customerId: 'CUS-002',
    phone: '139 0013 9000',
    email: 'shen.yi@example.com',
    status: '启用',
  },
  {
    id: 'CON-003',
    name: '梁雯',
    customerId: 'CUS-003',
    phone: '136 0013 6000',
    email: 'liang.wen@example.com',
    status: '启用',
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
    sn: 'c280dee4-df3a-4a44-b198-ea7fa4c9178b',
    product: 'SMTX OS 系统',
    nodeCount: 8,
    upgradeEntitlement: 8,
    inspectionEntitlement: 8,
    status: '启用',
  },
  {
    id: 'OBJ-002',
    customerId: 'CUS-002',
    name: '核心数据库集群',
    sn: '72b83074-fc26-47f1-867a-63a5f6ffca02',
    product: 'SMTX OS 系统',
    nodeCount: 6,
    upgradeEntitlement: 6,
    inspectionEntitlement: 4,
    status: '启用',
  },
  {
    id: 'OBJ-003',
    customerId: 'CUS-003',
    name: '研发测试集群',
    sn: 'a4ca429a-a01b-4d03-a99f-b9b315f0fc7c',
    product: 'SMTX OS 系统',
    nodeCount: 4,
    upgradeEntitlement: 4,
    inspectionEntitlement: 0,
    status: '启用',
  },
  {
    id: 'OBJ-004',
    customerId: 'CUS-001',
    name: '灾备超融合集群',
    sn: 'c62e097c-210b-4b80-b303-04ef745d310d',
    product: 'SMTX OS 系统',
    nodeCount: 6,
    upgradeEntitlement: 6,
    inspectionEntitlement: 6,
    status: '启用',
  },
];

function normalizeBusinessObjects(
  records: StoredBusinessObject[],
): BusinessObject[] {
  return records.map((record) => {
    const product =
      record.product === 'SMTX OS' ? 'SMTX OS 系统' : record.product;
    return {
      ...record,
      product: businessObjectProducts.includes(product as BusinessObjectProduct)
        ? (product as BusinessObjectProduct)
        : 'SMTX OS 系统',
    };
  });
}

const referenceTabs: Array<{
  value: ReferenceTab;
  label: string;
  icon: LucideIcon;
}> = [
  { value: 'customers', label: '客户', icon: Building2 },
  { value: 'contacts', label: '联系人', icon: ContactRound },
  { value: 'assets', label: '服务资产', icon: Server },
  { value: 'business-objects', label: '业务对象', icon: Network },
];

const COPY = {
  appName: '服务管理中心',
  workspace: '北京志凌海纳',
  catalogTitle: '服务目录',
  catalogDescription: '统一维护可交付服务的范围、计价规则与服务约束。',
};

const navigation: Array<{
  key: ViewKey;
  label: string;
  icon: LucideIcon;
}> = [
  {
    key: 'requests',
    label: '服务请求',
    icon: ClipboardList,
  },
  {
    key: 'catalog',
    label: '服务目录',
    icon: Boxes,
  },
  {
    key: 'field-settings',
    label: '后台字段配置',
    icon: Database,
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
  const [activeView, setActiveView] = useState<ViewKey>('requests');
  const [requestCreateToken, setRequestCreateToken] = useState(0);
  const [serviceRecords, setServiceRecords] = useState<Service[]>(services);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部状态' | ServiceStatus>(
    '已启用',
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
  const [requestFields, setRequestFields] =
    useState<RequestField[]>(initialRequestFields);
  const [referencesReady, setReferencesReady] = useState(false);
  const [referenceStorageError, setReferenceStorageError] = useState('');

  useEffect(() => {
    let active = true;
    readLocal<{
      id: string;
      payload: {
        requestFields?: RequestField[];
        services: Service[];
        customers: Customer[];
        contacts: Contact[];
        assets: Asset[];
        businessObjects: StoredBusinessObject[];
      };
    }>('references')
      .then((records) => {
        if (!active) return;
        const snapshot = records.find(
          (record) => record.id === 'workspace',
        )?.payload;
        if (snapshot) {
          const storedRequestFields = normalizeRequestFields(
            snapshot.requestFields ?? initialRequestFields,
          );
          setRequestFields([
            ...storedRequestFields,
            ...initialRequestFields.filter(
              (defaultField) =>
                !storedRequestFields.some(
                  (storedField) => storedField.id === defaultField.id,
                ),
            ),
          ]);
          setServiceRecords(
            mergeImportedServices(
              Array.isArray(snapshot.services) ? snapshot.services : [],
            ),
          );
          setCustomers(snapshot.customers);
          setContacts(snapshot.contacts);
          setAssets(snapshot.assets);
          setBusinessObjects(
            normalizeBusinessObjects(snapshot.businessObjects),
          );
        }
        setReferencesReady(true);
      })
      .catch(() => {
        if (active)
          setReferenceStorageError(
            '无法读取本地引用数据。请检查浏览器存储设置后刷新，本次不会覆盖原有资料。',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!referencesReady) return;
    // Debounce edits and cancel obsolete scheduled snapshots before opening a transaction.
    const timer = window.setTimeout(() => {
      void saveLocal('references', {
        id: 'workspace',
        payload: {
          requestFields,
          services: serviceRecords,
          customers,
          contacts,
          assets,
          businessObjects,
        },
      })
        .then(() => setReferenceStorageError(''))
        .catch(() =>
          setReferenceStorageError(
            '引用数据未能保存到本机，请保留页面并检查浏览器存储空间。',
          ),
        );
    }, 150);
    return () => window.clearTimeout(timer);
  }, [
    referencesReady,
    requestFields,
    serviceRecords,
    customers,
    contacts,
    assets,
    businessObjects,
  ]);

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
      product: 'SMTX OS 系统',
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
      if (
        !referenceForm.name?.trim() ||
        !responsibleTeams.includes(referenceForm.team as ResponsibleTeam)
      )
        return setReferenceFormError('请填写客户名并选择负责团队。');
      setCustomers((records) => [
        ...records,
        {
          id: `CUS-${nextNumber(records.length)}`,
          name: referenceForm.name.trim(),
          team: referenceForm.team as ResponsibleTeam,
          status: '启用',
        },
      ]);
    }
    if (referenceTab === 'contacts') {
      const normalizedEmail = (referenceForm.email ?? '').trim().toLowerCase();
      if (
        !referenceForm.name?.trim() ||
        !customerId ||
        !/^1\d{10}$/.test((referenceForm.phone ?? '').replaceAll(' ', '')) ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
      )
        return setReferenceFormError(
          '请填写姓名、所属客户、有效的 11 位手机号和邮箱。',
        );
      setContacts((records) => [
        ...records,
        {
          id: `CON-${nextNumber(records.length)}`,
          name: referenceForm.name.trim(),
          customerId,
          phone: referenceForm.phone.trim(),
          email: normalizedEmail,
          status: '启用',
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
      const normalizedSn = (referenceForm.sn ?? '').trim().toLowerCase();
      const product = referenceForm.product as BusinessObjectProduct;
      const nodeCount = Number(referenceForm.nodeCount);
      const upgradeEntitlement = Number(referenceForm.upgradeEntitlement);
      const inspectionEntitlement = Number(referenceForm.inspectionEntitlement);
      if (
        !customerId ||
        !referenceForm.name?.trim() ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          normalizedSn,
        ) ||
        businessObjects.some((record) => record.sn === normalizedSn) ||
        !businessObjectProducts.includes(product) ||
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
          '请选择客户和产品，并填写对象名称和唯一的 UUID v4 格式 SN；两类权益须为非负整数，且均不能超过节点数。',
        );
      setBusinessObjects((records) => [
        ...records,
        {
          id: `OBJ-${nextNumber(records.length)}`,
          customerId,
          name: referenceForm.name.trim(),
          sn: normalizedSn,
          product,
          nodeCount,
          upgradeEntitlement,
          inspectionEntitlement,
          status: '启用',
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
      name: 'start_service_request_creation',
      title: '开始新建服务请求',
      description: '切换到服务请求并打开申请表单，不会在确认提交前创建记录。',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute() {
        setActiveView('requests');
        setRequestCreateToken((value) => value + 1);
        return { started: true, view: 'requests', dialog: 'create-request' };
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
      catalogForm.providers.length &&
      catalogForm.allowedInitiatorSites.length;
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
      allowedInitiatorSites: catalogForm.allowedInitiatorSites,
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
          {referenceStorageError && (
            <p role="alert" className="sr-error">
              {referenceStorageError}
            </p>
          )}
          <section className="page-header">
            <div>
              <h1>
                {activeView === 'requests'
                  ? '服务请求'
                  : activeView === 'catalog'
                    ? '服务目录'
                    : activeView === 'field-settings'
                      ? '后台字段配置'
                      : '引用数据'}
              </h1>
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

          {activeView === 'requests' ? (
            referencesReady ? (
              <RequestFieldsContext.Provider value={requestFields}>
                <RequestWorkspace
                  services={serviceRecords}
                  customers={customers}
                  contacts={contacts}
                  businessObjects={businessObjects}
                  currentRole={currentRole}
                  createToken={requestCreateToken}
                />
              </RequestFieldsContext.Provider>
            ) : (
              <p className="sr-workspace">
                {referenceStorageError
                  ? '本地数据读取失败，请检查后刷新。'
                  : '正在读取本地资料…'}
              </p>
            )
          ) : activeView === 'catalog' ? (
            <BusinessObjectProductsContext.Provider
              value={[...businessObjectProducts]}
            >
              <RequestFieldsContext.Provider value={requestFields}>
                <CatalogView
                  services={filteredServices}
                  counts={{
                    enabled: serviceRecords.filter(
                      (service) => service.status === '已启用',
                    ).length,
                    disabled: serviceRecords.filter(
                      (service) => service.status === '已停用',
                    ).length,
                    all: serviceRecords.length,
                  }}
                  statusFilter={statusFilter}
                  setStatusFilter={setStatusFilter}
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
              </RequestFieldsContext.Provider>
            </BusinessObjectProductsContext.Provider>
          ) : activeView === 'field-settings' ? (
            <RequestFieldSettings
              fields={requestFields}
              onChange={setRequestFields}
              ready={referencesReady}
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
              onDisableCustomer={(id) =>
                setCustomers((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
                )
              }
              onDisableContact={(id) =>
                setContacts((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
                )
              }
              onDisableAsset={(id) =>
                setAssets((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
                )
              }
              onDisableBusinessObject={(id) =>
                setBusinessObjects((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
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
                    <option>服务人天</option>
                    <option>巡检权益</option>
                    <option>升级权益</option>
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
              <h3>服务约束</h3>
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
              <MultiChoiceField
                label="可发起站点"
                options={['内部系统', '客户中心', '合作伙伴中心']}
                values={catalogForm.allowedInitiatorSites}
                onChange={(allowedInitiatorSites) =>
                  setCatalogForm((form) => ({ ...form, allowedInitiatorSites }))
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
  counts: { enabled: number; disabled: number; all: number };
  statusFilter: '全部状态' | ServiceStatus;
  setStatusFilter: (value: '全部状态' | ServiceStatus) => void;
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
    <div className="catalog-view catalog-reference-panel">
      <div className="reference-toolbar">
        <Tabs
          value={
            props.statusFilter === '草稿' ? '全部状态' : props.statusFilter
          }
          onValueChange={(value) =>
            props.setStatusFilter(value as '全部状态' | ServiceStatus)
          }
        >
          <TabsList
            variant="line"
            className="reference-tabs"
            aria-label="服务目录状态"
          >
            <TabsTrigger value="已启用" className="reference-tab">
              启用<span>{props.counts.enabled}</span>
            </TabsTrigger>
            <TabsTrigger value="已停用" className="reference-tab">
              停用<span>{props.counts.disabled}</span>
            </TabsTrigger>
            <TabsTrigger value="全部状态" className="reference-tab">
              全部<span>{props.counts.all}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
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
                  <th>可发起站点</th>
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
                    <td>{service.allowedInitiatorSites.join('、')}</td>
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
        <RequestCatalogSettings key={service.id} service={service} />
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
          <h3>服务约束</h3>
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
            <div className="detail-span">
              <dt>可发起站点</dt>
              <dd>{service.allowedInitiatorSites.join('、')}</dd>
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
  onDisableCustomer: (id: string) => void;
  onDisableContact: (id: string) => void;
  onDisableAsset: (id: string) => void;
  onDisableBusinessObject: (id: string) => void;
};

function DisableRecordAction({
  isDisabled,
  label,
  onDisable,
}: {
  isDisabled: boolean;
  label: string;
  onDisable: () => void;
}) {
  return isDisabled ? (
    <span className="disabled-record-label">已停用</span>
  ) : (
    <button
      className="disable-record"
      type="button"
      aria-label={`停用${label}`}
      onClick={onDisable}
    >
      停用
    </button>
  );
}

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
                <th>状态</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.customers.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.name}</strong>
                  </td>
                  <td>{record.team}</td>
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
                    <DisableRecordAction
                      isDisabled={record.status === '停用'}
                      label={`客户 ${record.name}`}
                      onDisable={() => props.onDisableCustomer(record.id)}
                    />
                  </td>
                </tr>
              ))}
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
                <th>邮箱</th>
                <th>状态</th>
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
                  <td>{record.email}</td>
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
                    <DisableRecordAction
                      isDisabled={record.status === '停用'}
                      label={`联系人 ${record.name}`}
                      onDisable={() => props.onDisableContact(record.id)}
                    />
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
                    <DisableRecordAction
                      isDisabled={record.status === '停用'}
                      label={`服务资产 ${record.id}`}
                      onDisable={() => props.onDisableAsset(record.id)}
                    />
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
                <th>SN</th>
                <th>产品</th>
                <th>节点数</th>
                <th>升级权益</th>
                <th>巡检权益</th>
                <th>状态</th>
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
                    <code>{record.sn}</code>
                  </td>
                  <td>
                    <span className="product-tag">{record.product}</span>
                  </td>
                  <td className="numeric-cell">{record.nodeCount}</td>
                  <td className="numeric-cell">{record.upgradeEntitlement}</td>
                  <td className="numeric-cell">
                    {record.inspectionEntitlement}
                  </td>
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
                    <DisableRecordAction
                      isDisabled={record.status === '停用'}
                      label={`业务对象 ${record.name}`}
                      onDisable={() => props.onDisableBusinessObject(record.id)}
                    />
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
        {props.customers
          .filter((customer) => customer.status === '启用')
          .map((customer) => (
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
                <select
                  id="customer-team"
                  value={props.form.team ?? ''}
                  onChange={(event) => update('team', event.target.value)}
                >
                  <option value="">请选择负责团队</option>
                  {responsibleTeams.map((team) => (
                    <option key={team} value={team}>
                      {team}
                    </option>
                  ))}
                </select>
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
              <label htmlFor="contact-email">
                <span>
                  邮箱 <em>*</em>
                </span>
                <Input
                  id="contact-email"
                  type="email"
                  value={props.form.email ?? ''}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="例如：name@example.com"
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
              <label htmlFor="object-sn">
                <span>
                  SN <em>*</em>
                </span>
                <Input
                  id="object-sn"
                  value={props.form.sn ?? ''}
                  onChange={(event) => update('sn', event.target.value)}
                  placeholder="例如：c280dee4-df3a-4a44-b198-ea7fa4c9178b"
                  autoComplete="off"
                />
              </label>
              <label htmlFor="object-product">
                <span>
                  产品 <em>*</em>
                </span>
                <select
                  id="object-product"
                  value={props.form.product ?? ''}
                  onChange={(event) => update('product', event.target.value)}
                >
                  {businessObjectProducts.map((productOption) => (
                    <option key={productOption} value={productOption}>
                      {productOption}
                    </option>
                  ))}
                </select>
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
