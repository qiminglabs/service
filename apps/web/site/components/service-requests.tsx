'use client';
import { commitCatalogVersion } from '@/lib/catalog-versions';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Plus,
  Save,
  Search,
  Settings2,
  Upload,
} from 'lucide-react';
import {
  fieldTypes,
  RequestFieldControl,
  RequestFieldsContext,
} from '@/components/request-field-settings';
import type { RequestField } from '@/components/request-field-settings';
import { RequestMaterialDialog } from '@/components/request-material-dialog';
import { RequestContactField } from '@/components/request-contact-field';
import { RequestStatusProgress } from '@/components/request-status-progress';
import { DateField } from '@/components/date-field';
import { RequestOperationsTabs } from '@/components/request-operations';
import { appendActivity, isInternal, migrateRoleLabel } from '@/lib/request-operations';
import type { OperationActor, RequestAsset } from '@/lib/request-operations';
import {
  RequestExternalCollaborators,
  RequestInternalInfo,
} from '@/components/request-internal-info';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  canAccessRequest,
  canCreateRequest,
  requestCreationAccessIssue,
  checkFile,
  requestCreationIssue,
  requestStatuses,
  requestStatusTone,
  RequestIdentityError,
  businessObjectsEnabled,
  matchesObjectProduct,
  defaultConfig,
  downloadFile,
  fieldLabels,
  fileAccept,
  itemIssues,
  materialFiles,
  itemSummary,
  itemBasicIssues,
  newItem,
  newRequest,
  normalizeRequestConfig,
  readLocal,
  requestIssues,
  saveLocal,
  storedFile,
} from '@/lib/service-requests';
import type {
  CatalogService,
  ContactRef,
  CustomerRef,
  InternalUser,
  ItemMaterial,
  ObjectRef,
  RequestConfig,
  RequestItem,
  ServiceRequest,
} from '@/lib/service-requests';

export const BusinessObjectProductsContext = createContext<string[]>([]);
type Props = {
  services: CatalogService[];
  customers: CustomerRef[];
  contacts: ContactRef[];
  businessObjects: ObjectRef[];
  users: InternalUser[];
  assets: RequestAsset[];
  currentRole: string;
  currentActor: OperationActor;
  identityDirectory: { id: string; name: string }[];
  currentCustomerId?: string;
  partnerCollaborators: { id: string; name: string; phone: string; email: string; status: string }[];
  createToken: number;
};
const dateLabel = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { hour12: false });
const localError =
  '本地保存未完成。请检查浏览器存储空间或隐私设置后重试，当前填写内容仍保留在页面中。';

const isChoiceField = (field: RequestField) =>
  field.type === 'single' || field.type === 'multiple';

function configForEditing(
  config: RequestConfig,
  requestFields: RequestField[],
): RequestConfig {
  const normalized = normalizeRequestConfig(config);
  const fieldOptions = { ...normalized.fieldOptions };
  for (const field of requestFields) {
    if (!normalized.fields.includes(field.id) || !isChoiceField(field))
      continue;
    const enabledOptions = field.options
      .filter((option) => option.enabled)
      .map((option) => option.value);
    fieldOptions[field.id] =
      normalized.fieldOptions[field.id]?.filter((option) =>
        enabledOptions.includes(option),
      ) ?? enabledOptions;
  }
  return {
    ...normalized,
    fieldNames: {
      ...normalized.fieldNames,
      ...Object.fromEntries(
        requestFields.map((field) => [field.id, field.name]),
      ),
    },
    fieldOptions,
  };
}

export function RequestWorkspace(props: Props) {
  const access = { actor: props.currentActor, directory: props.identityDirectory, customerId: props.currentCustomerId };
  const customerPortal = props.currentActor.role === '客户';
  const canCreate = canCreateRequest(access);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [configs, setConfigs] = useState<RequestConfig[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('全部状态');
  const [draft, setDraft] = useState<ServiceRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState('');
  const [selectedCustomer, setCreateCustomer] = useState('');
  const createCustomer = customerPortal ? (props.currentCustomerId ?? '') : selectedCustomer;
  const [createContact, setCreateContact] = useState('');
  const createContacts = props.contacts.filter(
    (contact) =>
      contact.customerId === createCustomer && contact.status === '启用',
  );
  const [addOpen, setAddOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [pendingItem, setPendingItem] = useState<RequestItem | null>(null);
  const pendingServiceContent = props.services
    .find((service) => service.id === pendingItem?.serviceId)
    ?.description?.trim();
  const [itemError, setItemError] = useState('');
  const [materialTarget, setMaterialTarget] = useState<{
    itemId: string;
    requirementId: string;
  } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const handledToken = useRef(0);
  const saveLock = useRef(false);

  function load() {
    return Promise.all([
      readLocal<ServiceRequest>('requests'),
      readLocal<RequestConfig>('configs'),
    ])
      .then(([records, settings]) => {
        const visible = records.filter((record) => canAccessRequest(record, access));
        setRequests(visible.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
        setDraft((current) => current && !visible.some((record) => record.id === current.id) ? null : current);
        setConfigs(settings.map(normalizeRequestConfig));
        setReady(true);
        setError('');
      })
      .catch(() => {
        setError('无法读取本地资料。请允许此站点使用浏览器存储后重试。');
      });
  }
  useEffect(() => {
    let active = true;
    const refresh = () => { if (active) void load(); };
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, []);
  useEffect(() => {
    if (canCreate && props.createToken > handledToken.current) {
      handledToken.current = props.createToken;
      setCreateTitle('');
      setCreateCustomer('');
      setCreateContact(customerPortal ? props.currentActor.id : '');
      setCreateOpen(true);
    }
  }, [props.createToken]);

  async function persist(record: ServiceRequest, message = '草稿已保存到本机') {
    if (saveLock.current) return false;
    saveLock.current = true;
    setBusy(true);
    setError('');
    const next = { ...record, updatedAt: new Date().toISOString() };
    try {
      await saveLocal('requests', next, access);
      setRequests((old) => [next, ...old.filter((r) => r.id !== next.id)].filter((record) => canAccessRequest(record, access)));
      setDraft(canAccessRequest(next, access) ? next : null);
      setNotice(message);
      return true;
    } catch (error) {
      setError(
        error instanceof RequestIdentityError ? error.message : localError,
      );
      return false;
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }
  async function createDraft() {
    if (!ready || busy || !canCreate) return;
    const record = newRequest(
      createTitle,
      createCustomer,
      props.currentActor.name || props.currentRole,
      createContact,
      props.currentActor.id,
    );
    const issue = requestCreationAccessIssue(record, access) ?? requestCreationIssue(record, props);
    if (issue) {
      setError(issue);
      return;
    }
    if (await persist(record, '草稿已创建，可以逐项完善申请内容')) {
      setCreateOpen(false);
      setMaterialTarget(null);
      setShowIssues(false);
    }
  }
  function selectItemService(service: CatalogService) {
    setItemError('');
    setPendingItem(
      newItem(
        service,
        configs.find((c) => c.serviceId === service.id) ??
          defaultConfig(service),
      ),
    );
  }
  async function savePendingItem() {
    if (!draft || !pendingItem || draft.status !== '草稿') return;
    const missing = itemBasicIssues(pendingItem);
    if (missing.length) {
      setItemError(`请补充：${missing.join('、')}`);
      return;
    }
    if (
      !props.services.some(
        (s) => s.id === pendingItem.serviceId && s.status === '已启用',
      )
    ) {
      setItemError('该服务目录已停用或不存在，请重新选择。');
      return;
    }
    if (
      businessObjectsEnabled(pendingItem.config) &&
      pendingItem.businessObjectIds.some(
        (id) =>
          !props.businessObjects.some(
            (o) =>
              o.id === id &&
              o.customerId === draft.customerId &&
              matchesObjectProduct(o, pendingItem.config) &&
              o.status === '启用',
          ),
      )
    ) {
      setItemError(
        '请取消关联已停用、不属于当前客户或不符合可搜索产品的业务对象。',
      );
      return;
    }
    const exists = draft.items.some((i) => i.id === pendingItem.id);
    if (
      await persist(
        {
          ...draft,
          items: exists
            ? draft.items.map((i) =>
                i.id === pendingItem.id ? pendingItem : i,
              )
            : [...draft.items, pendingItem],
        },
        '申请项基础信息已保存，可在该申请项中补充材料',
      )
    ) {
      setAddOpen(false);
      setMaterialTarget(null);
      setPendingItem(null);
      setItemError('');
    }
  }
  async function saveItemMaterials(id: string, materials: ItemMaterial[]) {
    if (!draft || draft.status !== '草稿') return false;
    const ok = await persist(
      {
        ...draft,
        items: draft.items.map((existing) =>
          existing.id === id ? { ...existing, materials } : existing,
        ),
      },
      '申请项材料已保存到本机',
    );
    return ok;
  }
  const readonly = draft?.status !== '草稿';
  const issues = draft ? requestIssues(draft, props) : [];
  const materialItem = draft?.items.find(
    (item) => item.id === materialTarget?.itemId,
  );
  const materialRequirement = materialItem?.config.materials.find(
    (m) => m.id === materialTarget?.requirementId,
  );
  const completeCount =
    draft?.items.filter((item) => !itemIssues(item).length).length ?? 0;
  const filtered = requests.filter((record) => {
    if (!canAccessRequest(record, access)) return false;
    const customer =
      props.customers.find((c) => c.id === record.customerId)?.name ?? '';
    return (
      (status === '全部状态' || record.status === status) &&
      `${record.id} ${record.title} ${customer}`
        .toLowerCase()
        .includes(query.toLowerCase().trim())
    );
  });
  function updateDraft(
    patch: Partial<
      Pick<
        ServiceRequest,
        | 'title'
        | 'contactId'
        | 'description'
        | 'expectedServiceDate'
        | 'externalCollaborators'
        | 'internalParticipants'
      >
    >,
  ) {
    setDraft((record) => (record ? { ...record, ...patch } : record));
    setNotice('有未保存的修改');
  }

  function updateCollaborators(patch: Partial<Pick<ServiceRequest, 'externalCollaborators' | 'internalParticipants'>>) {
    if (!draft || busy || !isInternal(props.currentRole)) return;
    if (!props.currentActor.id) { setError('请先在右上角选择一个启用的内部用户。'); return; }
    if (!readonly) { updateDraft(patch); return; }
    const external = 'externalCollaborators' in patch;
    const before = external ? (draft.externalCollaborators ?? []).map(p => p.name) : (draft.internalParticipants ?? []).map(p => p.name);
    const after = external ? (patch.externalCollaborators ?? []).map(p => p.name) : (patch.internalParticipants ?? []).map(p => p.name);
    const detail = `变更前：${before.join('、') || '无'}；变更后：${after.join('、') || '无'}`;
    void persist(appendActivity({ ...draft, ...patch }, props.currentActor, '协作', external ? '更新外部协作人' : '更新内部协作人', detail), '协作人已保存');
  }

  const feedback = (
    <>
      {error && (
        <div className="sr-error" role="alert">
          {error}
          {!ready && (
            <Button variant="outline" onClick={() => void load()}>
              重试读取
            </Button>
          )}
        </div>
      )}
      {notice && <output className="sr-notice">{notice}</output>}
    </>
  );

  return (
    <div
      className={
        draft
          ? 'sr-workspace sr-workspace--detail catalog-detail'
          : 'sr-workspace'
      }
    >
      {!draft ? (
        <>
          {feedback}
          <div className="sr-toolbar">
            <div className="sr-filter-group">
              <div className="sr-search">
                <Search size={16} />
                <Input
                  aria-label="搜索服务请求"
                  placeholder="搜索申请主题、编号或客户"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <select
                aria-label="筛选请求状态"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option>全部状态</option>
                {requestStatuses.map((state) => (
                  <option key={state}>{state}</option>
                ))}
              </select>
            </div>
            {canCreate && <Button
              disabled={!ready || busy}
              onClick={() => {
                setCreateTitle('');
                setCreateCustomer('');
                setCreateContact(customerPortal ? props.currentActor.id : '');
                setCreateOpen(true);
              }}
            >
              <Plus size={16} />
              新建服务请求
            </Button>}
          </div>
          <section className="sr-panel">
            <div className="sr-table-scroll">
              <table className="sr-table app-list-table">
                <thead>
                  <tr>
                    <th>申请主题 / 编号</th>
                    <th>客户</th>
                    <th>申请项</th>
                    <th>期望服务日期</th>
                    <th>状态</th>
                    <th>最近更新</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <button
                          className="sr-title-link app-list-link"
                          onClick={() => {
                            setDraft(structuredClone(record));
                            setMaterialTarget(null);
                            setShowIssues(false);
                            setNotice('');
                          }}
                        >
                          {record.title}
                        </button>
                        <small>{record.id}</small>
                      </td>
                      <td>
                        {props.customers.find((c) => c.id === record.customerId)
                          ?.name ?? '待选择'}
                      </td>
                      <td>{record.items.length} 项</td>
                      <td>{record.expectedServiceDate || '—'}</td>
                      <td>
                        <span
                          className="sr-badge"
                          data-tone={requestStatusTone(record.status)}
                        >
                          {record.status}
                        </span>
                      </td>
                      <td>
                        {dateLabel(record.updatedAt)}
                        <small>{migrateRoleLabel(record.owner)}</small>
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          className="app-list-link"
                          onClick={() => {
                            setDraft(structuredClone(record));
                            setMaterialTarget(null);
                            setShowIssues(false);
                            setNotice('');
                          }}
                        >
                          查看
                          <ChevronRight size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!filtered.length && (
              <div className="sr-empty">
                <FileText size={32} />
                <h3>
                  {!ready
                    ? '正在读取本地资料…'
                    : query || status !== '全部状态'
                      ? '没有匹配的请求'
                      : '从一份服务请求开始'}
                </h3>
                <p>先保存申请草稿，再添加服务和准备各项材料。</p>
              </div>
            )}
          </section>
        </>
      ) : (
        <>
          <header className="detail-heading">
            <div>
              <button
                type="button"
                className="detail-back"
                disabled={busy}
                onClick={async () => {
                  if (readonly || (await persist(draft))) {
                    setDraft(null);
                    setNotice('');
                  }
                }}
              >
                <ArrowLeft aria-hidden="true" />
                返回服务请求
              </button>
              <div className="detail-title-row">
                <h2>{draft.title || '未命名服务请求'}</h2>
                <span
                  className="sr-badge"
                  data-tone={requestStatusTone(draft.status)}
                >
                  {draft.status}
                </span>
              </div>
              <p>
                {draft.id} ·{' '}
                {props.customers.find(
                  (customer) => customer.id === draft.customerId,
                )?.name ?? '未关联客户'}
                {' · '}
                {completeCount} / {draft.items.length} 项完整
              </p>
            </div>
            <div className="detail-actions">
              {!readonly && (
                <>
                  <Button
                    variant="outline"
                    className="ct-button ct-button--ordinary"
                    disabled={busy}
                    onClick={() => {
                      void persist(draft);
                    }}
                  >
                    <Save size={15} />
                    保存草稿
                  </Button>
                  <Button
                    className="ct-button ct-button--primary"
                    disabled={busy}
                    onClick={() => {
                      setShowIssues(true);
                      if (!issues.length) setSubmitOpen(true);
                    }}
                  >
                    提交申请
                  </Button>
                </>
              )}
            </div>
          </header>
          <RequestStatusProgress status={draft.status} />
          {feedback}
          {showIssues && !readonly && issues.length > 0 && (
            <section className="sr-error" role="alert">
              <strong>尚未提交，请补充以下内容</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={`${index}-${issue}`}>{issue}</li>
                ))}
              </ul>
              <p>
                基础字段请点击“编辑基础信息”；材料请点击对应申请项的“补充材料”。
              </p>
            </section>
          )}
              <RequestOperationsTabs key={draft.id} record={draft} users={props.users} assets={props.assets} actor={props.currentActor} busy={busy} save={persist} sidebar={
            <aside className="sr-collaboration-column" aria-label="协作人">
              <RequestExternalCollaborators
                contacts={[...props.contacts.filter(
                  (contact) => contact.customerId === draft.customerId && contact.status === '启用',
                ), ...props.partnerCollaborators.map((person) => ({ ...person, customerId: draft.customerId }))]}
                value={draft.externalCollaborators ?? []}
                readonly={!isInternal(props.currentRole)}
                busy={busy}
                onChange={(externalCollaborators) =>
                  updateCollaborators({ externalCollaborators })
                }
              />
              {isInternal(props.currentRole) && <RequestInternalInfo
                users={props.users}
                value={draft.internalParticipants ?? []}
                readonly={false}
                busy={busy}
                onChange={(internalParticipants) =>
                  updateCollaborators({ internalParticipants })
                }
              />}
            </aside>
              }>
              <section className="sr-panel">
                <div className="sr-panel-heading">
                  <h3>基本信息</h3>
                </div>
                <fieldset disabled={readonly || busy} className="sr-form-grid">
                  <label htmlFor="sr-title">
                    申请主题 <em>*</em>
                    <Input
                      id="sr-title"
                      value={draft.title}
                      onChange={(e) => updateDraft({ title: e.target.value })}
                      placeholder="例如：生产环境新装与巡检"
                    />
                  </label>
                  <label htmlFor="sr-customer-readonly">
                    客户
                    <Input
                      id="sr-customer-readonly"
                      readOnly
                      value={
                        props.customers.find((c) => c.id === draft.customerId)
                          ?.name ??
                        (draft.customerId || '历史草稿未选择客户')
                      }
                    />
                    <small>
                      {draft.customerId
                        ? '创建后不可修改客户。'
                        : '此历史草稿未关联客户，请重新创建请求。'}
                    </small>
                  </label>
                  <RequestContactField
                    id="sr-request-contact"
                    contacts={props.contacts.filter(
                      (c) =>
                        c.customerId === draft.customerId &&
                        (c.status === '启用' || c.id === draft.contactId),
                    )}
                    value={draft.contactId}
                    onChange={(contactId) => updateDraft({ contactId })}
                    disabled={busy || !draft.customerId}
                    readonly={readonly}
                  />
                  <DateField
                    id="sr-expected-service-date"
                    label="期望服务日期"
                    value={draft.expectedServiceDate ?? ''}
                    readonly={readonly}
                    disabled={busy}
                    onChange={(expectedServiceDate) =>
                      updateDraft({ expectedServiceDate })
                    }
                  />
                  <label className="sr-span">
                    申请背景 <em>*</em>
                    <textarea
                      value={draft.description}
                      onChange={(e) =>
                        updateDraft({ description: e.target.value })
                      }
                      placeholder="说明本次整体目标、业务背景和期望时间。各服务的具体范围请在申请项中填写。"
                      rows={3}
                    />
                  </label>
                </fieldset>
              </section>
              <section className="sr-panel">
                <div className="sr-panel-heading">
                  <div>
                    <h3>
                      申请项 <span>{draft.items.length}</span>
                    </h3>
                    <p>{readonly ? '申请内容已锁定，可查看基础信息和已提交材料。' : '点击申请项中的材料入口，在弹窗中填写或上传。'}</p>
                  </div>
                  {!readonly && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setCatalogQuery('');
                        setPendingItem(null);
                        setItemError('');
                        setAddOpen(true);
                      }}
                    >
                      <Plus size={15} />
                      添加申请项
                    </Button>
                  )}
                </div>
                {!draft.items.length ? (
                  <div className="sr-empty">
                    <FileText size={30} />
                    <h3>还没有申请项</h3>
                    <p>从服务目录添加所需服务。同一种服务可以分项申请。</p>
                  </div>
                ) : (
                  <div className="sr-item-list">
                    {draft.items.map((item, index) => {
                      const missing = itemIssues(item);
                      const summary = itemSummary(item);
                      return (
                        <article key={item.id} className="sr-item-entry">
                          <div className="sr-item-row">
                            <span className="sr-item-number">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="sr-item-copy">
                              <h4>
                                {item.serviceName}
                                <span
                                  className="sr-badge"
                                  data-tone={missing.length ? 'amber' : 'green'}
                                >
                                  {missing.length ? '待完善' : '已完整'}
                                </span>
                              </h4>
                              {summary && <p>{summary}</p>}
                              {itemBasicIssues(item).length > 0 && (
                                <p className="sr-missing">
                                  待补充：{itemBasicIssues(item).join('、')}
                                </p>
                              )}
                              {item.config.materials.map((requirement) => {
                                const material = item.materials.find(
                                  (m) => m.requirementId === requirement.id,
                                );
                                const complete =
                                  materialFiles(material).length > 0;
                                return (
                                  <div
                                    key={requirement.id}
                                    className="sr-material-entry"
                                  >
                                    <span
                                      className={
                                        complete
                                          ? 'sr-complete'
                                          : requirement.required
                                            ? 'sr-missing'
                                            : 'sr-help'
                                      }
                                    >
                                      {complete
                                        ? '已完成：'
                                        : requirement.required
                                          ? '待补充：上传'
                                          : '选填：'}
                                      {requirement.name}
                                    </span>
                                    <button
                                      className="sr-material-link"
                                      disabled={busy}
                                      onClick={() =>
                                        setMaterialTarget({
                                          itemId: item.id,
                                          requirementId: requirement.id,
                                        })
                                      }
                                      aria-label={
                                        requirement.name +
                                        (readonly || complete
                                          ? '，查看材料'
                                          : '，补充材料')
                                      }
                                    >
                                      {readonly || complete
                                        ? '查看材料'
                                        : '补充材料'}
                                      <ChevronRight size={13} />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="sr-item-actions">
                              <Button
                                variant="outline"
                                disabled={busy}
                                onClick={() => {
                                  setPendingItem(structuredClone(item));
                                  setItemError('');
                                  setAddOpen(true);
                                }}
                              >
                                {readonly ? '查看基础信息' : '编辑基础信息'}
                              </Button>

                              {!readonly && (
                                <button
                                  className="sr-muted-button"
                                  disabled={busy}
                                  onClick={() => setRemoveId(item.id)}
                                >
                                  移除
                                </button>
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
              <section className="sr-panel" aria-labelledby="sr-system-heading">
                <div className="sr-panel-heading">
                  <h3 id="sr-system-heading">系统信息</h3>
                </div>
                <dl className="sr-system-info">
                  <div>
                    <dt>创建时间</dt>
                    <dd>{dateLabel(draft.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>更新时间</dt>
                    <dd>{dateLabel(draft.updatedAt)}</dd>
                  </div>
                  <div>
                    <dt>提交时间</dt>
                    <dd>
                      {draft.submittedAt
                        ? dateLabel(draft.submittedAt)
                        : '未提交'}
                    </dd>
                  </div>
                  <div>
                    <dt>创建人</dt>
                    <dd>{migrateRoleLabel(draft.createdBy ?? draft.owner ?? '—')}</dd>
                  </div>
                </dl>
              </section>
              </RequestOperationsTabs>
        </>
      )}

      {materialItem && materialRequirement && (
        <RequestMaterialDialog
          key={materialItem.id + ':' + materialRequirement.id}
          item={materialItem}
          requirement={materialRequirement}
          readonly={readonly}
          busy={busy}
          error={error}
          onClose={() => setMaterialTarget(null)}
          onSave={(material) =>
            saveItemMaterials(materialItem.id, [
              ...materialItem.materials.filter(
                (m) => m.requirementId !== material.requirementId,
              ),
              material,
            ])
          }
        />
      )}
      <Dialog
        open={canCreate && createOpen}
        onOpenChange={(open) => {
          if (!busy) setCreateOpen(open);
        }}
      >
        <DialogContent className="sr-dialog">
          <DialogHeader>
            <DialogTitle>新建服务请求</DialogTitle>
          </DialogHeader>
          <div className="sr-form-stack">
            <label htmlFor="sr-create-title">
              申请主题 <em>*</em>
              <Input
                id="sr-create-title"
                required
                disabled={busy}
                value={createTitle}
                onChange={(e) => {
                  setCreateTitle(e.target.value);
                  setError('');
                }}
                placeholder="填写本次申请主题"
              />
            </label>
            {!customerPortal && <label>
              客户 <em>*</em>
              <select
                required
                disabled={busy}
                value={createCustomer}
                aria-describedby="sr-create-customer-hint"
                onChange={(e) => {
                  setCreateCustomer(e.target.value);
                  setCreateContact('');
                  setError('');
                }}
              >
                <option value="">请选择客户</option>
                {props.customers
                  .filter((c) => c.status === '启用')
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
              <span
                id="sr-create-customer-hint"
                className="sr-help block font-normal"
              >
                创建后不可修改客户
              </span>
            </label>}
            <RequestContactField
              id="sr-create-contact"
              contacts={createContacts}
              value={createContact}
              disabled={busy || !createCustomer || createContacts.length === 0}
              onChange={(contactId) => {
                setCreateContact(contactId);
                setError('');
              }}
              placeholder={
                !createCustomer
                  ? '请先选择客户'
                  : createContacts.length === 0
                    ? '该客户暂无可用联系人'
                    : '请选择联系人'
              }
              hint={
                createCustomer && createContacts.length === 0
                  ? '请先在客户资料中维护已启用的联系人。'
                  : undefined
              }
            />
          </div>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setCreateOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={!ready || busy || !canCreate}
              onClick={() => void createDraft()}
            >
              {busy ? '正在保存…' : '创建草稿'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!busy) {
            setAddOpen(open);
            if (!open) {
              setPendingItem(null);
              setItemError('');
            }
          }
        }}
      >
        <DialogContent className="sr-dialog sr-catalog-dialog sr-item-basics-dialog">
          <DialogHeader>
            <DialogTitle>
              {readonly && pendingItem
                ? '申请项基础信息'
                : pendingItem &&
                    draft?.items.some((i) => i.id === pendingItem.id)
                  ? '编辑申请项'
                  : '添加申请项'}
            </DialogTitle>
            <DialogDescription>
              先填写基础信息并保存，材料在申请详情页中补充。
            </DialogDescription>
          </DialogHeader>
          <div className="sr-item-dialog-body">
            {pendingItem ? (
              <>
                <div className="sr-selected-service">
                  <div>
                    <strong>{pendingItem.serviceName}</strong>
                    <p>{pendingItem.serviceId}</p>
                    {pendingServiceContent && (
                      <p className="sr-selected-service-content">
                        服务内容：{pendingServiceContent}
                      </p>
                    )}
                  </div>
                  {!draft?.items.some((i) => i.id === pendingItem.id) && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setPendingItem(null);
                        setItemError('');
                      }}
                    >
                      重新选择目录
                    </Button>
                  )}
                </div>
                <ItemBasicFields
                  value={pendingItem}
                  objects={props.businessObjects.filter(
                    (o) => o.customerId === draft?.customerId,
                  )}
                  customerId={draft?.customerId ?? ''}
                  readonly={readonly}
                  busy={busy}
                  update={(patch) =>
                    setPendingItem((item) =>
                      item ? { ...item, ...patch } : item,
                    )
                  }
                />
              </>
            ) : (
              <>
                <Input
                  aria-label="搜索可申请服务"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="搜索服务名称或编码"
                />
                <div className="sr-catalog-options">
                  {props.services
                    .filter(
                      (s) =>
                        s.status === '已启用' &&
                        (s.id + ' ' + s.name)
                          .toLowerCase()
                          .includes(catalogQuery.toLowerCase()),
                    )
                    .map((service) => (
                      <div key={service.id}>
                        <FileText size={20} />
                        <div>
                          <strong>{service.name}</strong>
                          <p>
                            {service.id} · {service.category}
                          </p>
                          {service.description?.trim() && (
                            <p className="sr-catalog-service-description">
                              {service.description}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="outline"
                          disabled={busy}
                          onClick={() => selectItemService(service)}
                        >
                          选择
                        </Button>
                      </div>
                    ))}
                  {!props.services.some(
                    (s) =>
                      s.status === '已启用' &&
                      (s.id + ' ' + s.name)
                        .toLowerCase()
                        .includes(catalogQuery.toLowerCase()),
                  ) && <p className="sr-empty">没有匹配的已启用服务。</p>}
                </div>
              </>
            )}
            {(itemError || error) && (
              <p className="sr-error" role="alert">
                {itemError || error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setAddOpen(false);
                setPendingItem(null);
                setItemError('');
              }}
            >
              {readonly ? '关闭' : '取消'}
            </Button>
            {pendingItem && !readonly && (
              <Button disabled={busy} onClick={() => void savePendingItem()}>
                <Save size={15} />
                {busy ? '正在保存…' : '保存申请项'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!removeId}
        onOpenChange={(open) => {
          if (!open && !busy) setRemoveId(null);
        }}
      >
        <DialogContent className="sr-dialog">
          <DialogHeader>
            <DialogTitle>移除此申请项？</DialogTitle>
            <DialogDescription>
              该项的填写内容和已保存附件将一并从草稿中移除，其他申请项不受影响。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="sr-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setRemoveId(null)}
            >
              保留申请项
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (
                  draft &&
                  (await persist(
                    {
                      ...draft,
                      items: draft.items.filter((i) => i.id !== removeId),
                    },
                    '申请项已移除',
                  ))
                )
                  setRemoveId(null);
              }}
            >
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={submitOpen}
        onOpenChange={(open) => {
          if (!busy) setSubmitOpen(open);
        }}
      >
        <DialogContent className="sr-dialog">
          <DialogHeader>
            <DialogTitle>确认提交服务请求</DialogTitle>
            <DialogDescription>
              共 {draft?.items.length}{' '}
              个申请项。提交后进入“待评估”，本版申请内容将锁定，由 SmartX 员工
              核查材料、服务范围和依据。这不是客户对计费的确认。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="sr-error">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setSubmitOpen(false)}
            >
              继续检查
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                if (!draft) return;
                if (issues.length) {
                  setSubmitOpen(false);
                  setShowIssues(true);
                  return;
                }
                if (
                  await persist(
                    appendActivity({
                      ...draft,
                      status: '待评估',
                      submittedAt: new Date().toISOString(),
                    }, props.currentActor, '提交', '提交服务请求', '请求进入待评估，基本信息和申请项已锁定'),
                    '已提交，等待 SmartX 员工评估',
                  )
                ) {
                  setSubmitOpen(false);
                  setShowIssues(false);
                }
              }}
            >
              确认提交
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemBasicFields({
  value,
  objects,
  customerId,
  readonly,
  busy,
  update,
}: {
  value: RequestItem;
  objects: ObjectRef[];
  customerId: string;
  readonly: boolean;
  busy: boolean;
  update: (patch: Partial<RequestItem>) => void;
}) {
  const fields = useContext(RequestFieldsContext);
  const methodField = fields.find((field) => field.id === 'method');
  const methodOptions =
    methodField?.options
      .filter(
        (option) => option.enabled && value.methods.includes(option.value),
      )
      .map((option) => option.value) ?? value.methods;
  return (
    <div className="sr-basic-fields">
      {' '}
      <section className="sr-sheet-section">
        <h3>服务需求</h3>
        <fieldset disabled={readonly || busy} className="sr-form-grid">
          <label>
            {methodField?.name ?? '服务方式'} <em>*</em>
            {methodField && methodField.type !== 'single' ? (
              <RequestFieldControl
                field={methodField}
                availableOptions={value.methods}
                value={value.method}
                onChange={(method) =>
                  update({ method, methodFieldType: methodField.type })
                }
              />
            ) : (
              <select
                value={value.method}
                onChange={(e) =>
                  update({ method: e.target.value, methodFieldType: 'single' })
                }
              >
                <option value="">请选择</option>
                {value.method && !methodOptions.includes(value.method) && (
                  <option disabled value={value.method}>
                    {value.method}（已停用）
                  </option>
                )}
                {methodOptions.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            )}
          </label>
          {value.config.basicFields?.description?.enabled !== false && (
            <label className="sr-span">
              需求说明{' '}
              {value.config.basicFields?.description?.required !== false ? (
                <em>*</em>
              ) : (
                <small>选填</small>
              )}
              <textarea
                rows={4}
                value={value.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="说明本项服务的目标、范围和期望结果，环境细节可在材料中补充。"
              />
            </label>
          )}
          {value.config.fields.map((key) => {
            if (key === 'businessObjects') return null;
            const field = fields.find((item) => item.id === key);
            const label =
              field?.name ??
              value.config.fieldNames?.[key] ??
              fieldLabels[key] ??
              key;
            return (
              <div className="request-field-input" key={key}>
                <span>
                  {label}{' '}
                  {value.config.fieldRequired?.[key] === false ? (
                    <small>选填</small>
                  ) : (
                    <em>*</em>
                  )}
                </span>
                {key !== 'nodes' && field ? (
                  <RequestFieldControl
                    field={field}
                    value={value.values[key] ?? ''}
                    availableOptions={value.config.fieldOptions?.[key]}
                    onChange={(next) =>
                      update({ values: { ...value.values, [key]: next } })
                    }
                  />
                ) : (
                  <Input
                    type={key === 'nodes' ? 'number' : 'text'}
                    min={key === 'nodes' ? 1 : undefined}
                    step={key === 'nodes' ? 1 : undefined}
                    value={value.values[key] ?? ''}
                    onChange={(e) =>
                      update({
                        values: { ...value.values, [key]: e.target.value },
                      })
                    }
                    aria-label={label}
                    placeholder={
                      key === 'nodes' ? '填写本项涉及的节点数' : `填写${label}`
                    }
                  />
                )}
              </div>
            );
          })}
        </fieldset>
      </section>
      {businessObjectsEnabled(value.config) && (
        <section className="sr-sheet-section">
          <h3>
            业务对象{' '}
            <span>
              {value.config.basicFields?.businessObjects?.required
                ? '必填'
                : '选填'}{' '}
              · 可多选
            </span>
          </h3>
          {value.config.basicFields?.businessObjects?.required && (
            <p className="sr-help">请至少关联一个当前客户的业务对象。</p>
          )}
          <fieldset disabled={readonly || busy} className="sr-object-options">
            <ul aria-label="可关联的业务对象">
              {objects
                .filter(
                  (o) =>
                    (o.status === '启用' &&
                      matchesObjectProduct(o, value.config)) ||
                    value.businessObjectIds.includes(o.id),
                )
                .map((o) => (
                  <li key={o.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={
                          readonly ||
                          busy ||
                          ((o.status !== '启用' ||
                            !matchesObjectProduct(o, value.config)) &&
                            !value.businessObjectIds.includes(o.id))
                        }
                        checked={value.businessObjectIds.includes(o.id)}
                        onChange={(e) =>
                          update({
                            businessObjectIds: e.target.checked
                              ? [...value.businessObjectIds, o.id]
                              : value.businessObjectIds.filter(
                                  (id) => id !== o.id,
                                ),
                          })
                        }
                      />
                      <span className="sr-object-copy">
                        <span className="sr-object-name">
                          {o.name}
                          <small>（{o.nodeCount} 节点）</small>
                        </span>
                        <span className="sr-object-sn">
                          序列号：{o.sn?.trim() || '未填写'}
                        </span>
                        {o.status !== '启用' && (
                          <span className="sr-missing">已停用，请取消关联</span>
                        )}
                      </span>
                    </label>
                  </li>
                ))}
            </ul>
            {!objects.length && (
              <p className="sr-help">
                {customerId
                  ? '该客户暂时没有可关联的业务对象。'
                  : '请先在申请单中选择客户。'}
              </p>
            )}
          </fieldset>
        </section>
      )}
    </div>
  );
}

export function RequestCatalogSettings({
  service,
  audience = 'internal',
}: {
  service: CatalogService;
  audience?: 'internal' | 'customer';
}) {
  const configLabel = audience === 'internal' ? '内部申请' : '客户中心申请';
  const customerConfigId = `customer-request-config:${service.id}`;
  const requestFields = useContext(RequestFieldsContext);
  const products = useContext(BusinessObjectProductsContext);
  const [config, setConfig] = useState<RequestConfig>(() =>
    defaultConfig(service),
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(config);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    (audience === 'internal'
      ? readLocal<RequestConfig>('configs')
      : readLocal<{ id: string; payload: RequestConfig }>('references').then(
          (records) =>
            records
              .filter((record) => record.id === customerConfigId)
              .map((record) => record.payload),
        )
    )
      .then((records) => {
        if (active) {
          setConfig(
            normalizeRequestConfig(
              records.find((c) => c.serviceId === service.id) ??
                defaultConfig(service),
            ),
          );
          setReady(true);
        }
      })
      .catch(() => {
        if (active) setError('无法读取本地申请配置，请重新进入此目录后重试。');
      });
    return () => {
      active = false;
    };
  }, [service, audience, customerConfigId]);
  return (
    <section className="detail-card detail-card--wide sr-config-card">
      <div className="sr-panel-heading">
        <div>
          <h3>{configLabel}配置</h3>
          <p>配置申请项所需参数与文档，不改变服务计价字段。</p>
        </div>
        <Button
          variant="outline"
          disabled={!ready}
          onClick={() => {
            setEditing(configForEditing(config, requestFields));
            setSaved(false);
            setOpen(true);
          }}
        >
          <Settings2 size={15} />
          配置{configLabel}
        </Button>
      </div>
      <p>
        申请项字段：
        {config.fields
          .map(
            (fieldId) =>
              requestFields.find((field) => field.id === fieldId)?.name ??
              fieldLabels[fieldId] ??
              fieldId,
          )
          .join('、') || '无额外必填参数'}
      </p>
      <p>
        材料：
        {config.materials
          .map((m) => `${m.name}（${m.required ? '必填' : '选填'}）`)
          .join('、') || '无'}
      </p>
      {saved && <output className="sr-complete">申请配置已保存到本机</output>}
      {error && (
        <p role="alert" className="sr-error">
          {error}
        </p>
      )}
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <SheetContent className="sr-item-sheet">
          <SheetHeader>
            <SheetTitle>配置{configLabel}</SheetTitle>
            <SheetDescription>
              {service.name} · 保存后用于新添加的申请项；不影响已创建项目。
            </SheetDescription>
          </SheetHeader>
          <div className="sr-sheet-body">
            <section className="sr-sheet-section">
              <h3>申请项字段</h3>
              <p className="sr-help">
                字段来自后台字段配置。勾选后用于当前服务目录；单选和多选字段可进一步限制本目录可用的选项。
              </p>
              <div className="sr-config-field-list">
                <article className="sr-config-field">
                  <strong>服务方式</strong>
                  <p>{service.deliveryMethods.join('、')}</p>
                  <p className="sr-help">引用服务目录 · 不可在此编辑</p>
                </article>
                {(['description', 'businessObjects'] as const).map((key) => {
                  const label = key === 'description' ? '需求说明' : '业务对象';
                  const setting = editing.basicFields?.[key] ?? {
                    enabled:
                      key === 'businessObjects'
                        ? businessObjectsEnabled(editing)
                        : true,
                    required: key === 'description',
                  };
                  return (
                    <article
                      className="sr-config-field"
                      data-selected={setting.enabled || undefined}
                      key={key}
                    >
                      <label
                        className="sr-config-field-main"
                        aria-label={`使用申请项字段${label}`}
                      >
                        <input
                          type="checkbox"
                          disabled={busy}
                          checked={setting.enabled}
                          onChange={(event) =>
                            setEditing({
                              ...editing,
                              basicFields: {
                                ...editing.basicFields,
                                [key]: {
                                  ...setting,
                                  enabled: event.target.checked,
                                },
                              },
                            })
                          }
                        />
                        <span>
                          <strong>{label}</strong>
                          <small>
                            {key === 'businessObjects'
                              ? '查找字段'
                              : '多行文本'}
                          </small>
                        </span>
                      </label>
                      {setting.enabled && (
                        <label className="sr-check-line">
                          <input
                            type="checkbox"
                            disabled={busy}
                            checked={setting.required}
                            aria-label={`${label}是否必填`}
                            onChange={(event) =>
                              setEditing({
                                ...editing,
                                basicFields: {
                                  ...editing.basicFields,
                                  [key]: {
                                    ...setting,
                                    required: event.target.checked,
                                  },
                                },
                              })
                            }
                          />
                          必填
                        </label>
                      )}
                      {key === 'businessObjects' && setting.enabled && (
                        <fieldset className="sr-config-option-set">
                          <legend>可搜索产品</legend>
                          {products.map((product) => {
                            const setting = editing.basicFields
                              ?.businessObjects ?? {
                              enabled: true,
                              required: false,
                            };
                            const selectedProducts =
                              setting.products ?? products;
                            return (
                              <label key={product}>
                                <input
                                  type="checkbox"
                                  disabled={busy}
                                  checked={selectedProducts.includes(product)}
                                  onChange={(event) =>
                                    setEditing({
                                      ...editing,
                                      basicFields: {
                                        ...editing.basicFields,
                                        businessObjects: {
                                          ...setting,
                                          products: event.target.checked
                                            ? [...selectedProducts, product]
                                            : selectedProducts.filter(
                                                (value) => value !== product,
                                              ),
                                        },
                                      },
                                    })
                                  }
                                />
                                {product}
                              </label>
                            );
                          })}
                          {!products.length && (
                            <p>暂无产品，请先维护业务对象的产品字段。</p>
                          )}
                        </fieldset>
                      )}
                    </article>
                  );
                })}
                {requestFields
                  .filter(
                    (field) =>
                      !['description', 'businessObjects', 'method'].includes(
                        field.id,
                      ),
                  )
                  .map((field) => {
                    const selected = editing.fields.includes(field.id);
                    const enabledOptions = field.options.filter(
                      (option) => option.enabled,
                    );
                    const selectedOptions =
                      editing.fieldOptions[field.id] ??
                      enabledOptions.map((option) => option.value);
                    return (
                      <article
                        className="sr-config-field"
                        data-selected={selected || undefined}
                        key={field.id}
                      >
                        <label
                          className="sr-config-field-main"
                          aria-label={`使用申请项字段${field.name}`}
                        >
                          <input
                            disabled={busy}
                            type="checkbox"
                            checked={selected}
                            onChange={(event) => {
                              const fieldOptions = {
                                ...editing.fieldOptions,
                              };
                              if (event.target.checked && isChoiceField(field))
                                fieldOptions[field.id] = enabledOptions.map(
                                  (option) => option.value,
                                );
                              if (!event.target.checked)
                                delete fieldOptions[field.id];
                              setEditing({
                                ...editing,
                                fields: event.target.checked
                                  ? [...editing.fields, field.id]
                                  : editing.fields.filter(
                                      (fieldId) => fieldId !== field.id,
                                    ),
                                fieldOptions,
                              });
                            }}
                          />
                          <span>
                            <strong>{field.name}</strong>
                            <small>{fieldTypes[field.type]}</small>
                          </span>
                        </label>
                        {selected && (
                          <label className="sr-check-line">
                            <input
                              type="checkbox"
                              aria-label={`${field.name}是否必填`}
                              disabled={busy}
                              checked={
                                editing.fieldRequired?.[field.id] !== false
                              }
                              onChange={(event) =>
                                setEditing({
                                  ...editing,
                                  fieldRequired: {
                                    ...editing.fieldRequired,
                                    [field.id]: event.target.checked,
                                  },
                                })
                              }
                            />
                            必填
                          </label>
                        )}
                        {selected && isChoiceField(field) && (
                          <fieldset className="sr-config-option-set">
                            <legend>当前目录可用选项</legend>
                            {enabledOptions.map((option) => (
                              <label key={option.value}>
                                <input
                                  type="checkbox"
                                  disabled={busy}
                                  checked={selectedOptions.includes(
                                    option.value,
                                  )}
                                  onChange={(event) =>
                                    setEditing({
                                      ...editing,
                                      fieldOptions: {
                                        ...editing.fieldOptions,
                                        [field.id]: event.target.checked
                                          ? [...selectedOptions, option.value]
                                          : selectedOptions.filter(
                                              (value) => value !== option.value,
                                            ),
                                      },
                                    })
                                  }
                                />
                                {option.value}
                              </label>
                            ))}
                            {!enabledOptions.length && (
                              <span className="sr-help">
                                后台暂未启用可用选项
                              </span>
                            )}
                          </fieldset>
                        )}
                      </article>
                    );
                  })}
                {!requestFields.length && (
                  <p className="sr-help">
                    后台尚未配置申请项字段，请先前往后台字段配置。
                  </p>
                )}
              </div>
            </section>
            <section className="sr-sheet-section">
              <div className="sr-panel-heading">
                <h3>材料要求</h3>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    setEditing({
                      ...editing,
                      materials: [
                        ...editing.materials,
                        {
                          id: crypto.randomUUID(),
                          name: '',
                          required: false,
                          instructions: '',
                        },
                      ],
                    })
                  }
                >
                  <Plus size={14} />
                  添加材料要求
                </Button>
              </div>
              {editing.materials.map((material) => (
                <article
                  className="sr-material-card sr-form-stack"
                  key={material.id}
                >
                  <label htmlFor={`sr-material-name-${material.id}`}>
                    材料名称 <em>*</em>
                    <Input
                      id={`sr-material-name-${material.id}`}
                      disabled={busy}
                      value={material.name}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          materials: editing.materials.map((m) =>
                            m.id === material.id
                              ? { ...m, name: e.target.value }
                              : m,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    填写说明
                    <textarea
                      disabled={busy}
                      rows={3}
                      value={material.instructions}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          materials: editing.materials.map((m) =>
                            m.id === material.id
                              ? { ...m, instructions: e.target.value }
                              : m,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="sr-check-line">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={material.required}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          materials: editing.materials.map((m) =>
                            m.id === material.id
                              ? { ...m, required: e.target.checked }
                              : m,
                          ),
                        })
                      }
                    />
                    提交前必须上传并确认完成
                  </label>
                  <div className="sr-material-actions">
                    <label className="sr-upload">
                      <Upload size={14} />
                      上传 / 替换模板
                      <input
                        aria-label={`上传${material.name || '新材料'}模板`}
                        disabled={busy}
                        type="file"
                        accept={fileAccept}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (!file) return;
                          const problem = checkFile(file);
                          setError(problem ?? '');
                          if (problem) return;
                          setEditing({
                            ...editing,
                            materials: editing.materials.map((m) =>
                              m.id === material.id
                                ? {
                                    ...m,
                                    template: storedFile(file),
                                    templateUrl: undefined,
                                  }
                                : m,
                            ),
                          });
                        }}
                      />
                    </label>
                    {material.template ? (
                      <button
                        className="sr-download"
                        onClick={() => downloadFile(material.template!)}
                      >
                        {material.template.name}
                      </button>
                    ) : material.templateUrl ? (
                      <a
                        className="sr-download"
                        href={material.templateUrl}
                        download
                      >
                        查看当前模板
                      </a>
                    ) : (
                      <span className="sr-help">未配置固定模板</span>
                    )}
                  </div>
                  <label htmlFor={`online-template-${material.id}`}>
                    在线文档模板链接
                    <Input
                      id={`online-template-${material.id}`}
                      type="url"
                      disabled={busy}
                      value={material.onlineTemplateUrl ?? ''}
                      placeholder="https://…"
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          materials: editing.materials.map((item) =>
                            item.id === material.id
                              ? {
                                  ...item,
                                  onlineTemplateUrl: event.target.value,
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  {/^https?:\/\//i.test(
                    material.onlineTemplateUrl?.trim() ?? '',
                  ) && (
                    <a
                      className="sr-download"
                      href={material.onlineTemplateUrl!.trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开在线文档模板
                    </a>
                  )}
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      setEditing({
                        ...editing,
                        materials: editing.materials.filter(
                          (m) => m.id !== material.id,
                        ),
                      })
                    }
                  >
                    移除此材料要求
                  </Button>
                </article>
              ))}
            </section>
            {error && (
              <p className="sr-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <SheetFooter className="sr-sheet-footer">
            <span>模板文件仅保存在本机</span>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              取消
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                const choiceWithoutOptions = requestFields.find(
                  (field) =>
                    editing.fields.includes(field.id) &&
                    isChoiceField(field) &&
                    !(editing.fieldOptions[field.id]?.length ?? 0),
                );
                if (choiceWithoutOptions) {
                  setError(
                    `请为“${choiceWithoutOptions.name}”至少选择一个当前目录可用选项。`,
                  );
                  return;
                }
                if (editing.materials.some((m) => !m.name.trim())) {
                  setError('请填写每份材料的名称。');
                  return;
                }
                if (
                  editing.materials.some((material) => {
                    const value = material.onlineTemplateUrl?.trim();
                    if (!value) return false;
                    try {
                      const url = new URL(value);
                      return !['http:', 'https:'].includes(url.protocol);
                    } catch {
                      return true;
                    }
                  })
                ) {
                  setError('在线文档模板链接须为有效的 http 或 https 地址。');
                  return;
                }
                setBusy(true);
                setError('');
                const selectedChoiceIds = new Set(
                  requestFields
                    .filter(
                      (field) =>
                        editing.fields.includes(field.id) &&
                        isChoiceField(field),
                    )
                    .map((field) => field.id),
                );
                const next = {
                  ...editing,
                  basicFields: {
                    ...editing.basicFields,
                    businessObjects: {
                      enabled: businessObjectsEnabled(editing),
                      required:
                        editing.basicFields?.businessObjects?.required ?? false,
                      products: [
                        ...(editing.basicFields?.businessObjects?.products ??
                          products),
                      ],
                    },
                  },
                  revision: config.revision + 1,
                  fieldNames: Object.fromEntries(
                    editing.fields.map((fieldId) => [
                      fieldId,
                      requestFields.find((field) => field.id === fieldId)
                        ?.name ??
                        editing.fieldNames[fieldId] ??
                        fieldLabels[fieldId] ??
                        fieldId,
                    ]),
                  ),
                  fieldOptions: Object.fromEntries(
                    Object.entries(editing.fieldOptions).filter(([fieldId]) =>
                      selectedChoiceIds.has(fieldId),
                    ),
                  ),
                };
                try {
                  const savedConfig = await commitCatalogVersion(service.id, {
                    config: next,
                    audience,
                    reason: `修改${configLabel}配置`,
                  });
                  setConfig(savedConfig ?? next);
                  setSaved(true);
                  setOpen(false);
                } catch {
                  setError(localError);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? '正在保存…' : '保存配置'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </section>
  );
}
