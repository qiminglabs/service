'use client';
import { commitCatalogVersion } from '@/lib/catalog-versions';
import { parseDayQuantity, formatDays } from '@/lib/day-quantity';
import { calculateBillableDays } from '@/lib/request-pricing';
import { isEntitlementService } from '@/lib/service-requests';
import { CatalogHistory } from '@/components/catalog-history';
import { InitializeDataButton } from '@/components/initialize-data-button';
import { initializeCustomerOwners, resetLocalDemoData } from '@/lib/initialize-demo-data';
import {
  resolveOperationActor,
  operationIdentities,
  ensureLocalInternalUsers,
  fixedIdentityRoles,
} from '@/lib/internal-users';
import {
  resolvePortalContext,
  portalSwitchIdentities,
  type PortalContext,
} from '@/lib/portal-context';
import type { OperationActor } from '@/lib/request-operations';
import {
  ensurePartnerSamples,
  normalizePartnerName,
  samplePartners,
  samplePartnerUsers,
  type Partner,
  type PartnerUser,
} from '@/lib/partner-directory';
import { migrateRoleLabel } from '@/lib/request-operations';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowLeft,
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
  Users,
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
import { DateField } from '@/components/date-field';
import {
  readLocal,
  saveLocal,
  type InternalUser,
} from '@/lib/service-requests';
import { businessObjectProducts } from '@/lib/product-dictionary';
import { withDefaultAssetBalances, parseEntitlementQuantity, type EntitlementField } from '@/lib/reference-balances';
import {
  serviceCertificationOptions,
  catalogCertificationOptions,
  certificationUsers,
  createServiceCertification,
  ensureCertificationSamples,
  type ServiceCertification,
} from '@/lib/service-certifications';
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
type ReferenceTab =
  | 'customers'
  | 'contacts'
  | 'assets'
  | 'business-objects'
  | 'users'
  | 'partners'
  | 'partner-users'
  | 'service-certifications';
type AssetStatus = '启用' | '停用' | '使用中' | '已使用';
type MasterDataStatus = '启用' | '停用';
type ResponsibleTeam = (typeof responsibleTeams)[number];
type BusinessObjectProduct = (typeof businessObjectProducts)[number];
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
  version?: number;
  id: string;
  name: string;
  category: ServiceCategory;
  deliveryMethods: string[];
  priceUnit: '服务人天' | '巡检权益' | '升级权益';
  priceCoefficient?: number;
  defaultQuantity?: number;
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
      priceCoefficient: seed.pricingUnit && isEntitlementService({ priceUnit: seed.pricingUnit }) ? undefined : 1,
      defaultQuantity: seed.pricingUnit && isEntitlementService({ priceUnit: seed.pricingUnit }) ? undefined : 1,
      certifications: ['无认证要求'],
      providers: [...seed.supportedProviders],
      allowedInitiatorSites: ['内部系统', '客户中心'],
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
    ...services.map(
      (service) =>
        storedServices.find((stored) => stored.id === service.id) ?? service,
    ),
    ...storedServices.filter((service) => !importedServiceIds.has(service.id)),
  ].map((service) => ({
    ...service,
    priceCoefficient: isEntitlementService(service) ? undefined : service.priceCoefficient,
    defaultQuantity: isEntitlementService(service) ? undefined : service.defaultQuantity,
    allowedInitiatorSites: service.allowedInitiatorSites.filter(
      (site) => site !== '合作伙伴中心',
    ),
  }));
}

type Customer = {
  ownerUserId?: string;
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
  balanceDays?: number;
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
type User = Omit<InternalUser, 'status'> & {
  status: MasterDataStatus;
};
type StoredBusinessObject = Omit<BusinessObject, 'product'> & {
  product: string;
};

const initialCustomers: Customer[] = [
  { id: 'CUS-001', name: '北京星海科技有限公司', team: '金融', status: '启用', ownerUserId: 'USR-001' },
  { id: 'CUS-002', name: '上海远帆数据有限公司', team: '商业', status: '启用', ownerUserId: 'USR-001' },
  {
    id: 'CUS-003',
    name: '深圳云岭信息技术有限公司',
    ownerUserId: 'USR-001',
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

const initialAssets: Asset[] = withDefaultAssetBalances<Asset>([
  { id: 'AST-001', customerId: 'CUS-001', name: '远程人天', status: '使用中' },
  { id: 'AST-002', customerId: 'CUS-001', name: '现场人天', status: '启用' },
  { id: 'AST-003', customerId: 'CUS-002', name: '远程人天', status: '已使用' },
]);

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

const initialUsers: User[] = ensureLocalInternalUsers([
  {
    id: 'USR-001',
    name: '王琪',
    email: 'wang.qi@example.com',
    department: '销售部',
    status: '启用',
  },
  {
    id: 'USR-002',
    name: '陈屿',
    email: 'chen.yu@example.com',
    department: '售前团队',
    status: '启用',
  },
  {
    id: 'USR-003',
    name: '赵言',
    email: 'zhao.yan@example.com',
    department: '项目管理部',
    status: '启用',
  },
  {
    id: 'USR-004',
    name: '林澈',
    email: 'lin.che@example.com',
    department: '技术服务部',
    status: '启用',
  },
  {
    id: 'USR-005',
    name: '周遥',
    email: 'zhou.yao@example.com',
    department: '客户成功部',
    status: '启用',
  },
]);

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
  { value: 'users', label: '内部用户', icon: Users },
  { value: 'partners', label: '合作伙伴', icon: Building2 },
  { value: 'partner-users', label: '合作伙伴用户', icon: ContactRound },
  { value: 'service-certifications', label: '服务认证', icon: ClipboardList },
];

const COPY = {
  appName: '服务管理中心',
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
    key: 'reference-data',
    label: '引用数据',
    icon: Database,
  },
  {
    key: 'field-settings',
    label: '后台配置',
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
  portal,
  activeView,
  onSelect,
  onNavigate,
}: {
  portal: PortalContext;
  activeView: ViewKey;
  onSelect: (view: ViewKey) => void;
  onNavigate?: () => void;
}) {
  return (
    <aside className="app-sidebar" aria-label="主导航">
      <div className="workspace-switcher">
        <strong
          title={portal.organizationName.replace(/（模拟）|\(模拟\)/g, '')}
        >
          {portal.organizationName.replace(/（模拟）|\(模拟\)/g, '')}
        </strong>
      </div>

      <nav className="sidebar-groups">
        {navigation
          .filter((item) => portal.views.includes(item.key))
          .map((item) => (
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
  portal,
  identitySources,
  currentActor,
  identities,
  onUserChange,
  onOpenMenu,
  onInitialize,
  initializationDisabled,
}: {
  portal: PortalContext;
  identitySources: Parameters<typeof resolvePortalContext>[1];
  currentActor: OperationActor;
  identities: OperationActor[];
  onUserChange: (id: string) => void;
  onOpenMenu: () => void;
  onInitialize: () => Promise<void>;
  initializationDisabled: boolean;
}) {
  return (
    <header className="topbar">
      <div className="topbar-brand" aria-label={`SmartX ${portal.title}`}>
        {/* oxlint-disable-next-line next/no-img-element -- using the exact SmartX CDN wordmark from the reference console */}
        <img
          src="https://cdn.smartx.com/partner-connect/navigation/smartx-badge-on-light-horizontal.svg"
          alt="SmartX"
        />
        <span className="topbar-brand-divider" aria-hidden="true" />
        <strong>{portal.title}</strong>
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
        <InitializeDataButton disabled={initializationDisabled} onInitialize={onInitialize} />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                className="role-switcher"
                type="button"
                aria-label={`当前用户：${currentActor.name || '未选择'}，切换身份`}
              />
            }
          >
            <span
              title={
                currentActor.name
                  ? `${currentActor.name} · ${currentActor.role}`
                  : '请选择用户'
              }
            >
              {currentActor.name
                ? currentActor.name === currentActor.role
                  ? currentActor.name
                  : `${currentActor.name} · ${currentActor.role}`
                : '请选择用户'}
            </span>
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="role-menu-content"
            align="end"
            sideOffset={6}
          >
            <DropdownMenuRadioGroup
              value={currentActor.id}
              onValueChange={onUserChange}
            >
              <DropdownMenuLabel>切换身份</DropdownMenuLabel>
              {portalSwitchIdentities(
                identities,
                currentActor.id,
                identitySources,
              ).map((identity) => (
                <DropdownMenuRadioItem
                  className="role-menu-item"
                  key={identity.id}
                  value={identity.id}
                >
                  {`${identity.name} · ${resolvePortalContext(identity, identitySources).organizationName.replace(/（模拟）|\(模拟\)/g, '')} · ${identity.role}`}
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
  exclusiveOption,
}: {
  label: string;
  options: string[];
  values: string[];
  onChange: (values: string[]) => void;
  exclusiveOption?: string;
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
                    ? option === exclusiveOption
                      ? [option]
                      : [
                          ...values.filter(
                            (value) => value !== exclusiveOption,
                          ),
                          option,
                        ]
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
  const [generation, setGeneration] = useState(0);
  return <Workspace key={generation} onInitialized={() => setGeneration(value => value + 1)} />;
}

function Workspace({ onInitialized }: { onInitialized: () => void }) {
  const resetting = useRef(false);
  const [selectedView, setActiveView] = useState<ViewKey>('requests');
  const [requestCreateToken, setRequestCreateToken] = useState(0);
  const [serviceRecords, setServiceRecords] = useState<Service[]>(services);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'全部状态' | ServiceStatus>(
    '已启用',
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  useEffect(() => {
    const reload = () => {
      void readLocal<{ id: string; payload: { services: Service[] } }>(
        'references',
      ).then((records) => {
        const workspace = records.find((record) => record.id === 'workspace');
        if (workspace) setServiceRecords(workspace.payload.services);
      });
    };
    window.addEventListener('catalog-version-saved', reload);
    return () => window.removeEventListener('catalog-version-saved', reload);
  }, []);
  const [saved, setSaved] = useState(false);
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
  const [users, setUsers] = useState<User[]>(initialUsers);
  const [partners, setPartners] = useState<Partner[]>(samplePartners);
  const [partnerUsers, setPartnerUsers] =
    useState<PartnerUser[]>(samplePartnerUsers);
  const [serviceCertifications, setServiceCertifications] = useState<
    ServiceCertification[]
  >(() =>
    ensureCertificationSamples(
      [],
      initialUsers,
      samplePartnerUsers,
      samplePartners,
    ),
  );
  const [currentUserId, setCurrentUserId] = useState('');
  const identitySources = { contacts, customers, partnerUsers, partners };
  const identities = operationIdentities(users, identitySources);
  const currentActor = resolveOperationActor(
    users,
    currentUserId,
    identitySources,
  );
  const currentRole = currentActor.role;
  const portal = resolvePortalContext(currentActor, identitySources);
  const activeView = portal.views.includes(selectedView)
    ? selectedView
    : (portal.views[0] ?? 'requests');
  const [referenceCreateOpen, setReferenceCreateOpen] = useState(false);
  const [referenceForm, setReferenceForm] = useState<Record<string, string>>(
    {},
  );
  const [referenceFormError, setReferenceFormError] = useState('');
  const [requestFields, setRequestFields] =
    useState<RequestField[]>(initialRequestFields);
  const resolvedRequestFields = useMemo(() => requestFields.map(field => field.referenceTarget === 'partners'
    ? { ...field, options: partners.map(partner => ({ value: partner.name, enabled: true })) }
    : field), [requestFields, partners]);
  const [referencesReady, setReferencesReady] = useState(false);
  const [referenceStorageError, setReferenceStorageError] = useState('');

  useEffect(() => {
    let active = true;
    readLocal<{
      id: string;
      payload: {
        customerOwnersInitialized?: boolean;
        requestFields?: RequestField[];
        services: Service[];
        customers: Customer[];
        contacts: Contact[];
        assets: Asset[];
        businessObjects: StoredBusinessObject[];
        users?: User[];
        partners?: Partner[];
        partnerUsers?: PartnerUser[];
        serviceCertifications?: ServiceCertification[];
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
          setContacts(snapshot.contacts);
          setAssets(withDefaultAssetBalances(Array.isArray(snapshot.assets) ? snapshot.assets : initialAssets));
          const partnerDirectory = ensurePartnerSamples(
            Array.isArray(snapshot.partners) ? snapshot.partners : [],
            Array.isArray(snapshot.partnerUsers) ? snapshot.partnerUsers : [],
          );
          setPartners(partnerDirectory.partners);
          setPartnerUsers(partnerDirectory.partnerUsers);
          setBusinessObjects(
            normalizeBusinessObjects(snapshot.businessObjects),
          );
          const restoredUsers = ensureLocalInternalUsers(
            Array.isArray(snapshot.users) ? snapshot.users : initialUsers,
          );
          setUsers(restoredUsers);
          setCustomers(snapshot.customerOwnersInitialized ? snapshot.customers : initializeCustomerOwners(snapshot.customers, restoredUsers));
          setServiceCertifications(
            ensureCertificationSamples(
              Array.isArray(snapshot.serviceCertifications)
                ? snapshot.serviceCertifications
                : [],
              restoredUsers,
              partnerDirectory.partnerUsers,
              partnerDirectory.partners,
            ),
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
      if (resetting.current) return;
      void saveLocal('references', {
        id: 'workspace',
        payload: {
          customerOwnersInitialized: true,
          requestFields,
          services: serviceRecords,
          customers,
          contacts,
          assets,
          businessObjects,
          users,
          partners,
          partnerUsers,
          serviceCertifications,
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
    users,
    partners,
    partnerUsers,
    serviceCertifications,
  ]);

  async function initializeAllData() {
    if (resetting.current || !referencesReady) return;
    resetting.current = true;
    try {
      await resetLocalDemoData({
        requestFields: initialRequestFields,
        services,
        customers: initialCustomers,
        contacts: initialContacts,
        assets: initialAssets,
        businessObjects: initialBusinessObjects,
        users: initialUsers,
        partners: samplePartners,
        partnerUsers: samplePartnerUsers,
        serviceCertifications: ensureCertificationSamples([], initialUsers, samplePartnerUsers, samplePartners),
      });
      // Remount all editors so stale forms and filters cannot overwrite restored data.
      onInitialized();
    } catch (error) {
      resetting.current = false;
      throw error;
    }
  }

  const generatedCode = useMemo(() => {
    const nextSequence =
      serviceRecords.filter(
        (service) => service.category === catalogForm.category,
      ).length + 1;
    return `SC-${categoryCodes[catalogForm.category]}-${String(nextSequence).padStart(3, '0')}`;
  }, [catalogForm.category, serviceRecords]);

  function openCreation() {
    setEditingService(null);
    setCatalogForm(emptyCatalogForm);
    setFormError('');
    setCreateOpen(true);
  }

  function switchIdentity(id: string) {
    if (!identities.some((identity) => identity.id === id)) return;
    setCurrentUserId(id);
    setActiveView('requests');
    setDetailServiceId(null);
    setCreateOpen(false);
    setReferenceCreateOpen(false);
    setMobileNavOpen(false);
    setQuery('');
    setRequestCreateToken(0);
  }

  function selectView(view: ViewKey) {
    if (!portal.views.includes(view)) return;
    setActiveView(view);
    setDetailServiceId(null);
    setQuery('');
  }

  function openReferenceCreation() {
    setReferenceForm({
      product: 'SMTX OS 系统',
      status: '启用',
      assetName: '远程人天',
      balanceDays: '5',
    });
    setReferenceFormError('');
    setReferenceCreateOpen(true);
  }

  function saveReferenceRecord() {
    const customerId = referenceForm.customerId ?? '';
    const nextNumber = (count: number) => String(count + 1).padStart(3, '0');
    if (referenceTab === 'service-certifications') {
      try {
        const record = createServiceCertification(
          referenceForm,
          serviceCertifications,
          users,
          partnerUsers,
          partners,
        );
        setServiceCertifications((records) => [...records, record]);
      } catch (error) {
        return setReferenceFormError(
          error instanceof Error
            ? error.message
            : '服务认证创建失败，请检查填写内容。',
        );
      }
    }

    if (referenceTab === 'customers') {
      if (
        !referenceForm.name?.trim() ||
        !responsibleTeams.includes(referenceForm.team as ResponsibleTeam)
      )
        return setReferenceFormError('请填写客户名并选择负责团队。');
      if (referenceForm.ownerUserId && !users.some(user => user.id === referenceForm.ownerUserId && user.status === '启用'))
        return setReferenceFormError('请选择启用的内部用户作为客户所有人。');
      setCustomers((records) => [
        ...records,
        {
          id: `CUS-${nextNumber(records.length)}`,
          name: referenceForm.name.trim(),
          team: referenceForm.team as ResponsibleTeam,
          ownerUserId: referenceForm.ownerUserId || undefined,
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
      const balanceDays = parseDayQuantity(referenceForm.balanceDays ?? '');
      if (balanceDays === null) return setReferenceFormError('余额人天须为非负数，最多一位小数。');
      setAssets((records) => [
        ...records,
        {
          id: `AST-${nextNumber(records.length)}`,
          customerId,
          name: (referenceForm.assetName ?? '远程人天') as Asset['name'],
          balanceDays,
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
    if (referenceTab === 'users') {
      const normalizedEmail = (referenceForm.email ?? '').trim().toLowerCase();
      if (
        !referenceForm.name?.trim() ||
        !referenceForm.department?.trim() ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
        users.some((record) => record.email === normalizedEmail)
      )
        return setReferenceFormError('请填写姓名、部门和唯一的有效邮箱。');
      const phone = (referenceForm.phone ?? '').trim();
      if (phone && !/^[+\d][\d\s()-]{5,24}$/.test(phone))
        return setReferenceFormError('请填写有效的电话。');
      setUsers((records) => [
        ...records,
        {
          id: `USR-${nextNumber(records.length)}`,
          name: referenceForm.name.trim(),
          email: normalizedEmail,
          phone,
          department: referenceForm.department.trim(),
          status: '启用',
        },
      ]);
    }

    if (referenceTab === 'partners') {
      const name = normalizePartnerName(referenceForm.name ?? '');
      if (
        !name ||
        name.length > 120 ||
        partners.some((record) => record.name === name)
      )
        return setReferenceFormError('请填写唯一的合作伙伴名称，最多 120 字。');
      setPartners((records) => [
        ...records,
        {
          id: `PAR-${nextNumber(records.length)}`,
          name,
          status: '启用',
        },
      ]);
    }
    if (referenceTab === 'partner-users') {
      const name = (referenceForm.name ?? '').trim();
      const email = (referenceForm.email ?? '').trim().toLowerCase();
      const phone = (referenceForm.phone ?? '').replace(/\s/g, '');
      const partnerId = referenceForm.partnerId ?? '';
      if (
        !partners.some(
          (partner) => partner.id === partnerId && partner.status === '启用',
        )
      )
        return setReferenceFormError(
          '请选择已启用的合作伙伴；如无选项，请先新建合作伙伴。',
        );
      if (
        !name ||
        name.length > 80 ||
        !/^1\d{10}$/.test(phone) ||
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        partnerUsers.some((record) => record.email.toLowerCase() === email)
      )
        return setReferenceFormError(
          '请填写姓名（最多 80 字）、11 位手机号和唯一的有效邮箱。',
        );
      setPartnerUsers((records) => [
        ...records,
        {
          id: `PUS-${nextNumber(records.length)}`,
          name,
          partnerId,
          phone,
          email,
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
    if (!context?.registerTool || currentRole !== 'SmartX 系统管理员') return;

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
  }, [currentRole]);

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
  async function saveDraft() {
    const decimalPattern = /^\d{1,3}(\.\d{1,2})?$/;
    const allFieldsComplete =
      catalogForm.name.trim() &&
      catalogForm.description.trim() &&
      catalogForm.internalNote.trim() &&
      catalogForm.deliveryMethods.length &&
      catalogForm.certifications.length &&
      catalogForm.providers.length &&
      catalogForm.allowedInitiatorSites.length;
    const validNumbers = isEntitlementService(catalogForm) || (
      decimalPattern.test(catalogForm.priceCoefficient) &&
      parseDayQuantity(catalogForm.defaultQuantity) !== null &&
      Number(catalogForm.defaultQuantity) <= 999.9 &&
      Number(catalogForm.priceCoefficient) > 0 &&
      Number(catalogForm.defaultQuantity) > 0);
    if (!allFieldsComplete || !validNumbers) {
      setFormError(
        '请填写全部字段；计价系数须大于 0、最多两位小数；最小人天数量须大于 0、不超过 999.9，最多一位小数。',
      );
      return;
    }
    const now = new Date();
    const createdService: Service = {
      id: editingService?.id ?? generatedCode,
      version: editingService?.version ?? 1,
      name: catalogForm.name.trim(),
      category: catalogForm.category,
      deliveryMethods: catalogForm.deliveryMethods,
      priceUnit: catalogForm.priceUnit,
      priceCoefficient: isEntitlementService(catalogForm) ? undefined : Number(catalogForm.priceCoefficient),
      defaultQuantity: isEntitlementService(catalogForm) ? undefined : Number(catalogForm.defaultQuantity),
      certifications: catalogForm.certifications,
      providers: catalogForm.providers,
      allowedInitiatorSites: catalogForm.allowedInitiatorSites,
      internalNote: catalogForm.internalNote.trim(),
      status: editingService?.status ?? '草稿',
      updatedAt: now
        .toLocaleString('zh-CN', { hour12: false })
        .replaceAll('/', '-'),
      owner: editingService?.owner ?? currentActor.name,
      description: catalogForm.description.trim(),
    };
    try {
      if (editingService)
        await commitCatalogVersion(editingService.id, {
          service: createdService,
          reason: '编辑服务目录',
        });
      else setServiceRecords((records) => [...records, createdService]);
    } catch {
      setFormError('保存失败，请重试。');
      return;
    }
    setCreateOpen(false);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2600);
  }

  return (
    <div className="app-shell">
      <SideNavigation
        portal={portal}
        activeView={activeView}
        onSelect={selectView}
      />

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
              portal={portal}
              activeView={activeView}
              onSelect={selectView}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </div>
        </div>
      ) : null}

      <div className="app-main">
        <Header
          portal={portal}
          identitySources={identitySources}
          currentActor={currentActor}
          identities={referencesReady ? identities : []}
          onUserChange={switchIdentity}
          onOpenMenu={() => setMobileNavOpen(true)}
          onInitialize={initializeAllData}
          initializationDisabled={!referencesReady}
        />
        <main className="content-area" data-assistant-page={activeView} data-assistant-reference-tab={activeView === 'reference-data' ? referenceTab : undefined}>
          {referenceStorageError && (
            <p role="alert" className="sr-error">
              {referenceStorageError}
            </p>
          )}
          {!(activeView === 'catalog' && detailService) && <section className="page-header">
            <div>
              <h1>
                {activeView === 'requests'
                  ? '服务请求'
                  : activeView === 'catalog'
                    ? '服务目录'
                    : activeView === 'field-settings'
                      ? '后台配置'
                      : '引用数据'}
              </h1>
              {activeView === 'reference-data' ? (
                <p>
                  维护 Demo
                  流程中引用的客户、联系人、服务资产、业务对象、内部用户、合作伙伴与合作伙伴用户。
                </p>
              ) : null}
            </div>
          </section>}

          {activeView === 'requests' ? (
            referencesReady && portal.views.includes('requests') ? (
              <RequestFieldsContext.Provider value={resolvedRequestFields}>
                <RequestWorkspace
                  key={`${currentActor.id}:${portal.organizationId}`}
                  services={serviceRecords}
                  customers={customers}
                  contacts={contacts}
                  businessObjects={businessObjects}
                  users={users.filter((user) => user.status === '启用')}
                  assets={assets}
                  currentRole={currentRole}
                  currentActor={currentActor}
                  identityDirectory={[...users, ...contacts, ...partnerUsers]}
                  currentCustomerId={portal.type === 'customer' ? portal.organizationId : undefined}
                  partnerCollaborators={partnerUsers.filter(
                    (person) =>
                      person.status === '启用' &&
                      partners.some(
                        (partner) =>
                          partner.id === person.partnerId &&
                          partner.status === '启用',
                      ),
                  )}
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
              <RequestFieldsContext.Provider value={resolvedRequestFields}>
                <CatalogView
                  toolbarActions={<div className="app-list-actions">
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
              </div>}
                  onEdit={(service) => {
                    setEditingService(service);
                    setCatalogForm({
                      ...service,
                      priceCoefficient: String(service.priceCoefficient ?? ''),
                      defaultQuantity: String(service.defaultQuantity ?? ''),
                    });
                    setFormError('');
                    setCreateOpen(true);
                  }}
                  onToggle={async (service) => {
                    try {
                      await commitCatalogVersion(service.id, {
                        service: {
                          ...service,
                          status:
                            service.status === '已启用' ? '已停用' : '已启用',
                        },
                        reason:
                          service.status === '已启用'
                            ? '停用服务目录'
                            : '启用服务目录',
                      });
                    } catch {
                      setReferenceStorageError('状态保存失败，请重试。');
                    }
                  }}
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
              actor={currentActor.name}
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
              users={users}
              onCreate={openReferenceCreation}
              partners={partners}
              partnerUsers={partnerUsers}
              serviceCertifications={serviceCertifications}
              onDisableCertification={(id) =>
                setServiceCertifications((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
                )
              }
              onDisablePartner={(id) =>
                setPartners((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
                )
              }
              onDisablePartnerUser={(id) =>
                setPartnerUsers((records) =>
                  records.map((record) =>
                    record.id === id ? { ...record, status: '停用' } : record,
                  ),
                )
              }
              onCustomerOwnerChange={(id, ownerUserId) => {
                if (ownerUserId && !users.some(user => user.id === ownerUserId && user.status === '启用')) return;
                setCustomers(records => records.map(record => record.id === id ? { ...record, ownerUserId: ownerUserId || undefined } : record));
              }}
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
              onAssetBalanceChange={(id, days) => setAssets(records => records.map(record => record.id === id ? { ...record, balanceDays: days } : record))}
              onEntitlementChange={(id, field, quantity) => setBusinessObjects((records) => records.map((record) =>
                record.id === id && parseEntitlementQuantity(String(quantity), record.nodeCount) !== null
                  ? { ...record, [field]: quantity } : record,
              ))}
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
              onDisableUser={(id) =>
                setUsers((records) =>
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
            <DialogTitle>
              {editingService ? '编辑服务目录' : '新建服务目录'}
            </DialogTitle>
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
                    disabled={!!editingService}
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
                    value={editingService?.id ?? generatedCode}
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
                {!isEntitlementService(catalogForm) && <><label htmlFor="price-coefficient">
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
                    最小人天数量 <em>*</em>
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
                    placeholder="例如：0.5，最多一位小数"
                  />
                </label>
                </>}
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
                exclusiveOption="无认证要求"
                options={catalogCertificationOptions}
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
                options={['内部系统', '客户中心']}
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
              {editingService ? '保存修改' : '创建服务目录'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReferenceCreateDialog
        open={referenceCreateOpen}
        onOpenChange={setReferenceCreateOpen}
        activeTab={referenceTab}
        customers={customers}
        partners={partners}
        users={users}
        partnerUsers={partnerUsers}
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
  toolbarActions: ReactNode;
  onEdit: (service: Service) => void;
  onToggle: (service: Service) => void;
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
      <CatalogDetail
        service={props.detailService}
        onBack={props.onBack}
        onEdit={props.onEdit}
        onToggle={props.onToggle}
      />
    );

  return (
    <div className="catalog-view catalog-reference-panel">
      <div className="reference-toolbar app-list-toolbar">
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
        {props.toolbarActions}
      </div>
      <section className="table-panel" aria-label="服务目录列表">
        {props.services.length ? (
          <div className="table-scroll">
            <table className="service-table app-list-table">
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
                  <th>版本</th>
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
                          className="app-list-link"
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
                      {!isEntitlementService(service) && <strong className="price-coefficient">
                        {service.priceCoefficient?.toFixed(2) ?? '—'}
                      </strong>}
                      <small className="cell-note">
                        {' '}
                        {!isEntitlementService(service) && '/ '}{service.priceUnit}
                      </small>
                    </td>
                    <td>{service.deliveryMethods.join(' / ')}</td>
                    <td>{service.providers.join('、')}</td>
                    <td>{service.allowedInitiatorSites.join('、')}</td>
                    <td>v{service.version ?? 1}</td>
                    <td>
                      <StatusCapsule status={service.status} />
                    </td>
                    {/* oxlint-disable-next-line jsx-a11y/control-has-associated-label -- this cell is read-only metadata and contains no control */}
                    <td>
                      <div className="updated-cell">
                        <span>{service.updatedAt.split(/[T ]/)[0]}</span>
                        <small>{migrateRoleLabel(service.owner)}</small>
                      </div>
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="app-list-link"
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
  onEdit,
  onToggle,
}: {
  service: Service;
  onBack: () => void;
  onEdit: (service: Service) => void;
  onToggle: (service: Service) => void;
}) {
  return (
    <article className="catalog-detail" aria-label={`${service.name}详情`}>
      <header className="detail-heading">
        <div>
          <button type="button" className="detail-back" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            返回服务目录列表
          </button>
          <div className="detail-title-row">
            <h2>{service.name}</h2>
            <StatusCapsule status={service.status} />
          </div>
          <p>
            {service.id} · {service.category} · v{service.version ?? 1}
          </p>
        </div>
        <div className="detail-actions">
          <CatalogHistory serviceId={service.id} />
          <Button
            variant="outline"
            className="ct-button ct-button--ordinary"
            onClick={() => onEdit(service)}
          >
            编辑
          </Button>
          <Button
            className="ct-button ct-button--primary"
            onClick={() => onToggle(service)}
          >
            {service.status === '已启用' ? '停用' : '启用'}
          </Button>
        </div>
      </header>

      <div className="catalog-detail-columns">
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
              {!isEntitlementService(service) && <><div>
                <dt>计价系数</dt>
                <dd>{service.priceCoefficient?.toFixed(2) ?? '—'}</dd>
              </div>
              <div>
                <dt>最小人天数量</dt>
                <dd>{service.defaultQuantity === undefined ? '—' : formatDays(service.defaultQuantity)} 人天</dd>
              </div>
              <div>
                <dt>最小计价人天</dt>
                <dd>
                  {calculateBillableDays(service.defaultQuantity ?? 0, service.priceCoefficient ?? 0)} 人天
                </dd>
              </div>
              </>}
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
                <dd>{migrateRoleLabel(service.owner)}</dd>
              </div>
              <div>
                <dt>创建时间</dt>
                <dd>{service.updatedAt}</dd>
              </div>
              <div>
                <dt>上次修改人</dt>
                <dd>{migrateRoleLabel(service.owner)}</dd>
              </div>
              <div>
                <dt>上次修改时间</dt>
                <dd>{service.updatedAt}</dd>
              </div>
            </dl>
          </section>
        </div>
        <aside className="catalog-config-column" aria-label="申请配置">
          <RequestCatalogSettings key={service.id} service={service} />
          <RequestCatalogSettings
            key={`${service.id}-customer`}
            service={service}
            audience="customer"
          />
        </aside>
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
  users: User[];
  partners: Partner[];
  partnerUsers: PartnerUser[];
  serviceCertifications: ServiceCertification[];
  onDisableCertification: (id: string) => void;
  onDisablePartner: (id: string) => void;
  onDisablePartnerUser: (id: string) => void;
  onCreate: () => void;
  onCustomerOwnerChange: (id: string, ownerUserId: string) => void;
  onDisableCustomer: (id: string) => void;
  onDisableContact: (id: string) => void;
  onDisableAsset: (id: string) => void;
  onAssetBalanceChange: (id: string, days: number) => void;
  onEntitlementChange: (id: string, field: EntitlementField, quantity: number) => void;
  onDisableBusinessObject: (id: string) => void;
  onDisableUser: (id: string) => void;
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
  const partnerNames = new Map(
    props.partners.map((partner) => [partner.id, partner.name]),
  );
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
    users: props.users.length,
    partners: props.partners.length,
    'partner-users': props.partnerUsers.length,
    'service-certifications': props.serviceCertifications.length,
  };

  return (
    <section className="reference-panel" aria-label="引用数据维护">
      <div className="reference-toolbar app-list-toolbar">
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

      <div className="table-scroll">
        {props.activeTab === 'customers' ? (
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>客户名</th>
                <th>负责团队</th>
                <th>客户所有人</th>
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
                    <select aria-label={`${record.name}的客户所有人`} value={record.ownerUserId ?? ''} onChange={event => props.onCustomerOwnerChange(record.id, event.target.value)}>
                      <option value="">未设置</option>
                      {props.users.filter(user => user.status === '启用' || user.id === record.ownerUserId).map(user => <option key={user.id} value={user.id} disabled={user.status !== '启用'}>{user.name}{user.status !== '启用' ? '（已停用）' : ''}</option>)}
                      {record.ownerUserId && !props.users.some(user => user.id === record.ownerUserId) && <option value={record.ownerUserId} disabled>原用户不可用</option>}
                    </select>
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
          <table className="reference-table app-list-table">
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
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>所属客户</th>
                <th>资产名称</th>
                <th>余额人天（含已锁定）</th>
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
                  <td><Input key={`${record.id}:${record.balanceDays}`} aria-label={`${record.id} 余额人天`} type="number" min="0" step="0.1" placeholder="待维护" defaultValue={record.balanceDays ?? ''} onChange={event => event.target.setCustomValidity('')} onBlur={event => {
                    const value = parseDayQuantity(event.target.value);
                    if (value !== null) props.onAssetBalanceChange(record.id, value);
                    else { event.target.setCustomValidity('余额人天须为非负数，最多一位小数。'); event.target.reportValidity(); event.target.value = record.balanceDays === undefined ? '' : String(record.balanceDays); }
                  }} /></td>
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
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>对象名称</th>
                <th>所属客户</th>
                <th>SN</th>
                <th>产品</th>
                <th>节点数</th>
                <th>升级权益（含已锁定）</th>
                <th>巡检权益（含已锁定）</th>
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
                  {(['upgradeEntitlement', 'inspectionEntitlement'] as const).map((field) => (
                    <td className="numeric-cell" key={field}>
                      <Input
                        key={`${record.id}:${field}:${record[field]}`}
                        aria-label={`${record.id} ${field === 'upgradeEntitlement' ? '升级权益' : '巡检权益'}（含已锁定）`}
                        type="number"
                        min="0"
                        max={record.nodeCount}
                        step="1"
                        defaultValue={record[field]}
                        title={`请输入 0 至 ${record.nodeCount} 的整数，离开输入框后保存`}
                        onBlur={(event) => {
                          const quantity = parseEntitlementQuantity(event.target.value, record.nodeCount);
                          if (quantity !== null) props.onEntitlementChange(record.id, field, quantity);
                          else event.target.value = String(record[field]);
                        }}
                      />
                    </td>
                  ))}
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

        {props.activeTab === 'partners' ? (
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>合作伙伴名称</th>
                <th>状态</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.partners.length === 0 ? (
                <tr>
                  <td colSpan={4}>暂无合作伙伴，点击“新建合作伙伴”添加。</td>
                </tr>
              ) : (
                props.partners.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.name}</strong>
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
                        label={`合作伙伴 ${record.name}`}
                        onDisable={() => props.onDisablePartner(record.id)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}

        {props.activeTab === 'partner-users' ? (
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>所属合作伙伴</th>
                <th>手机号</th>
                <th>邮箱</th>
                <th>状态</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.partnerUsers.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    暂无合作伙伴用户，请先维护合作伙伴，再添加用户。
                  </td>
                </tr>
              ) : (
                props.partnerUsers.map((record) => (
                  <tr key={record.id}>
                    <td>
                      <strong>{record.name}</strong>
                    </td>
                    <td>{partnerNames.get(record.partnerId) ?? '—'}</td>
                    <td>{record.phone}</td>
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
                        label={`合作伙伴用户 ${record.name}`}
                        onDisable={() => props.onDisablePartnerUser(record.id)}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : null}

        {props.activeTab === 'service-certifications' ? (
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>认证内容</th>
                <th>用户类型</th>
                <th>认证用户</th>
                <th>到期日</th>
                <th>状态</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.serviceCertifications.length === 0 ? (
                <tr>
                  <td colSpan={7}>暂无服务认证，点击“新建服务认证”添加。</td>
                </tr>
              ) : (
                props.serviceCertifications.map((record) => {
                  const directory =
                    record.holderType === 'internal'
                      ? props.users
                      : props.partnerUsers;
                  const userName =
                    directory.find((person) => person.id === record.userId)
                      ?.name ?? record.userName;
                  return (
                    <tr key={record.id}>
                      <td>
                        <strong>{record.certification}</strong>
                      </td>
                      <td>
                        {record.holderType === 'internal'
                          ? '内部用户'
                          : '合作伙伴用户'}
                      </td>
                      <td>{userName}</td>
                      <td>{record.expiresOn}</td>
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
                          label={`服务认证 ${userName} ${record.certification}`}
                          onDisable={() =>
                            props.onDisableCertification(record.id)
                          }
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        ) : null}

        {props.activeTab === 'users' ? (
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>姓名</th>
                <th>电话</th>
                <th>邮箱</th>
                <th>部门</th>
                <th>角色</th>
                <th>状态</th>
                <th>记录编号</th>
                <th className="actions-column">操作</th>
              </tr>
            </thead>
            <tbody>
              {props.users.map((record) => (
                <tr key={record.id}>
                  <td>
                    <strong>{record.name}</strong>
                  </td>
                  <td>{record.phone || '—'}</td>
                  <td>{record.email}</td>
                  <td>{record.department}</td>
                  <td>{fixedIdentityRoles[record.id] ?? '—'}</td>
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
                      label={`内部用户 ${record.name}`}
                      onDisable={() => props.onDisableUser(record.id)}
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
  partners: Partner[];
  users: User[];
  partnerUsers: PartnerUser[];
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
              <label htmlFor="customer-owner">
                <span>客户所有人</span>
                <select id="customer-owner" value={props.form.ownerUserId ?? ''} onChange={event => update('ownerUserId', event.target.value)}>
                  <option value="">请选择内部用户</option>
                  {props.users.filter(user => user.status === '启用').map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
                </select>
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
              <label htmlFor="asset-balance"><span>余额人天 <em>*</em></span><Input id="asset-balance" type="number" min="0" step="0.1" value={props.form.balanceDays ?? ''} onChange={event => update('balanceDays', event.target.value)} placeholder="请输入实际余额人天，最多一位小数" /></label>
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
                    升级权益（含已锁定） <em>*</em>
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
                    巡检权益（含已锁定） <em>*</em>
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
          {props.activeTab === 'partners' ? (
            <label htmlFor="partner-name">
              <span>
                合作伙伴名称 <em>*</em>
              </span>
              <Input
                id="partner-name"
                maxLength={120}
                value={props.form.name ?? ''}
                onChange={(event) => update('name', event.target.value)}
                placeholder="请输入合作伙伴名称"
              />
            </label>
          ) : null}
          {props.activeTab === 'partner-users' ? (
            <>
              <label htmlFor="partner-user-name">
                <span>
                  姓名 <em>*</em>
                </span>
                <Input
                  id="partner-user-name"
                  maxLength={80}
                  value={props.form.name ?? ''}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="请输入合作伙伴用户姓名"
                />
              </label>
              <label htmlFor="partner-user-partner">
                <span>
                  所属合作伙伴 <em>*</em>
                </span>
                <select
                  id="partner-user-partner"
                  value={props.form.partnerId ?? ''}
                  onChange={(event) => update('partnerId', event.target.value)}
                >
                  <option value="">请选择合作伙伴</option>
                  {props.partners
                    .filter((partner) => partner.status === '启用')
                    .map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {partner.name}
                      </option>
                    ))}
                </select>
                {!props.partners.some(
                  (partner) => partner.status === '启用',
                ) ? (
                  <span>暂无已启用的合作伙伴，请先在“合作伙伴”中创建。</span>
                ) : null}
              </label>
              <label htmlFor="partner-user-phone">
                <span>
                  手机号 <em>*</em>
                </span>
                <Input
                  id="partner-user-phone"
                  type="tel"
                  value={props.form.phone ?? ''}
                  onChange={(event) => update('phone', event.target.value)}
                  placeholder="请输入 11 位手机号"
                />
              </label>
              <label htmlFor="partner-user-email">
                <span>
                  邮箱 <em>*</em>
                </span>
                <Input
                  id="partner-user-email"
                  type="email"
                  maxLength={254}
                  value={props.form.email ?? ''}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="例如：name@example.com"
                />
              </label>
            </>
          ) : null}
          {props.activeTab === 'users' ? (
            <>
              <label htmlFor="user-name">
                <span>
                  姓名 <em>*</em>
                </span>
                <Input
                  id="user-name"
                  value={props.form.name ?? ''}
                  onChange={(event) => update('name', event.target.value)}
                  placeholder="请输入内部用户姓名"
                />
              </label>
              <label htmlFor="user-phone">
                <span>电话</span>
                <Input id="user-phone" type="tel" value={props.form.phone ?? ''} onChange={(event) => update('phone', event.target.value)} placeholder="请输入联系电话" />
              </label>
              <label htmlFor="user-email">
                <span>
                  邮箱 <em>*</em>
                </span>
                <Input
                  id="user-email"
                  type="email"
                  value={props.form.email ?? ''}
                  onChange={(event) => update('email', event.target.value)}
                  placeholder="例如：name@example.com"
                />
              </label>
              <label htmlFor="user-department">
                <span>
                  部门 <em>*</em>
                </span>
                <Input
                  id="user-department"
                  value={props.form.department ?? ''}
                  onChange={(event) => update('department', event.target.value)}
                  placeholder="例如：技术服务部"
                />
              </label>
            </>
          ) : null}
          {props.activeTab === 'service-certifications' ? (
            <>
              <label htmlFor="certification-content">
                <span>
                  认证内容 <em>*</em>
                </span>
                <select
                  id="certification-content"
                  value={props.form.certification ?? ''}
                  onChange={(event) =>
                    update('certification', event.target.value)
                  }
                >
                  <option value="">请选择认证内容</option>
                  {serviceCertificationOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label htmlFor="certification-holder-type">
                <span>
                  用户类型 <em>*</em>
                </span>
                <select
                  id="certification-holder-type"
                  value={props.form.holderType ?? ''}
                  onChange={(event) =>
                    props.setForm((form) => ({
                      ...form,
                      holderType: event.target.value,
                      userId: '',
                    }))
                  }
                >
                  <option value="">请选择用户类型</option>
                  <option value="internal">内部用户</option>
                  <option value="partner">合作伙伴用户</option>
                </select>
              </label>
              <label htmlFor="certification-user">
                <span>
                  认证用户 <em>*</em>
                </span>
                <select
                  id="certification-user"
                  disabled={!props.form.holderType}
                  value={props.form.userId ?? ''}
                  onChange={(event) => update('userId', event.target.value)}
                >
                  <option value="">请选择已启用用户</option>
                  {certificationUsers(
                    props.form.holderType,
                    props.users,
                    props.partnerUsers,
                    props.partners,
                  ).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} · {person.email}
                    </option>
                  ))}
                </select>
              </label>
              <DateField
                id="certification-expires-on"
                label="到期日"
                required
                value={props.form.expiresOn ?? ''}
                onChange={(date) => update('expiresOn', date)}
              />
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
