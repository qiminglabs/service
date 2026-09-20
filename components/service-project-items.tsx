'use client';
import { useContext, useRef, useState } from 'react';
import { CircleAlert, FileText, Plus, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CustomerVisibleBadge } from '@/components/customer-visible-badge';
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
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  RequestFieldsContext,
  RequestFieldControl,
} from '@/components/request-field-settings';
import { RequestFormLayout } from '@/components/request-form-layout';
import { requestFormOrder } from '@/lib/request-form-layout';
import {
  readProjectItemContext,
  newProjectServiceItem,
} from '@/lib/service-project-store';
import { projectItemReadonlyTargets } from '@/lib/service-project-readonly';
import type { MappingTarget } from '@/lib/request-project-mapping';
import type { ServiceProjectRecord } from '@/lib/service-projects';
import { projectItemAudience } from '@/lib/service-projects';
import type { OperationActor } from '@/lib/request-operations';
import type {
  ProjectItemChange,
  ProjectItemContext,
} from '@/lib/service-project-items';
import {
  fieldLabels,
  itemBasicIssues,
  itemSummaryFields,
  serviceAvailableForRequest,
  requestFieldIsRequired,
  requestFieldIsVisible,
  matchesObjectProduct,
  objectEntitlementAvailability,
  savedItemBusinessObjects,
  type CatalogService,
  type ObjectRef,
  type RequestItem,
  type ServiceRequest,
} from '@/lib/service-requests';

function ProjectItemsPanel({
  record,
  objects,
  busy,
  readonly,
  showCompleteness,
  showCustomerVisibility = false,
  canAdd = true,
  canRemove,
  onAdd,
  onEdit,
  onRemove,
  onCopy,
}: {
  record: { id: string; items: RequestItem[] };
  objects: ObjectRef[];
  busy: boolean;
  readonly: boolean;
  showCompleteness: boolean;
  showCustomerVisibility?: boolean;
  canAdd?: boolean;
  canRemove: (item: RequestItem) => boolean;
  onAdd: () => void;
  onEdit: (item: RequestItem) => void;
  onRemove: (id: string) => void;
  onCopy: (id: string) => void;
}) {
  const fieldNames = Object.fromEntries(
    useContext(RequestFieldsContext).map((field) => [field.id, field.name]),
  );

  return (
    <section className={`sr-panel${showCustomerVisibility ? ' sr-customer-visible-panel' : ''}`}>
      <div className="sr-panel-heading">
        <div>
          <div className="sr-panel-title-with-visibility">
            <h3>服务项</h3>
            {showCustomerVisibility && <CustomerVisibleBadge />}
          </div>
        </div>
        {!readonly && (
          <Button variant="outline" disabled={busy || !canAdd} onClick={onAdd}>
            <Plus size={15} />
            添加服务项
          </Button>
        )}
      </div>
      {!record.items.length ? (
        <div className="sr-empty">
          <FileText size={30} />
          <h3>还没有服务项</h3>
        </div>
      ) : (
        <div className="sr-item-list">
          {record.items.map((item, index) => {
            const basicMissing = showCompleteness ? itemBasicIssues(item) : [];
            const summary = itemSummaryFields(item, fieldNames, objects);
            const inlineFields = summary.filter((field) => !field.address);
            const addressFields = summary.filter((field) => field.address);
            return (
              <article
                key={item.id}
                id={`sr-service-${record.id}-${item.id}`}
                className="sr-item-entry"
              >
                <div className="sr-item-row">
                  <span className="sr-item-number">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <div className="sr-item-copy">
                    <h4>
                      {item.serviceName}
                      {basicMissing.length > 0 && (
                        <span className="sr-badge" data-tone="amber">
                          待完善
                        </span>
                      )}
                    </h4>
                    {(summary.length > 0 || item.description.trim()) && (
                      <div className="sr-item-summary">
                        <div className="sr-item-summary-fields">
                          {inlineFields.map((field) => (
                            <span className="sr-summary-field" key={field.key}>
                              <span className="sr-summary-label">
                                {field.label}
                              </span>
                              <span className="sr-summary-value">
                                {field.value}
                              </span>
                            </span>
                          ))}
                          {item.description.trim() && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger
                                  render={
                                    <button
                                      type="button"
                                      className="sr-description-hint"
                                      aria-label={`查看${fieldNames.description ?? '需求说明'}`}
                                    >
                                      <CircleAlert size={16} />
                                    </button>
                                  }
                                />
                                <TooltipContent
                                  className="sr-description-tooltip"
                                  side="top"
                                >
                                  <div>
                                    <strong className="sr-tooltip-heading">
                                      {fieldNames.description ?? '需求说明'}
                                    </strong>
                                    <div>{item.description}</div>
                                  </div>
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                        {addressFields.map((field) => (
                          <div className="sr-summary-address" key={field.key}>
                            <span className="sr-summary-label">
                              {field.label}
                            </span>
                            <span className="sr-summary-value">
                              {field.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {basicMissing.length > 0 && (
                      <p className="sr-missing">
                        待补充：{basicMissing.join('、')}
                      </p>
                    )}
                  </div>
                  <div className="sr-item-actions">
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => onEdit(item)}
                    >
                      {readonly ? '查看详细信息' : '编辑详细信息'}
                    </Button>
                    {!readonly && (
                      <div className="sr-item-secondary-actions">
                        <button
                          type="button"
                          className="sr-copy-item"
                          disabled={busy || !canAdd}
                          onClick={() => onCopy(item.id)}
                        >
                          复制
                        </button>
                        <button
                          type="button"
                          className="sr-muted-button"
                          disabled={busy || !canRemove(item)}
                          onClick={() => onRemove(item.id)}
                        >
                          移除
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ProjectItemBasicFields({
  reservationRecords,
  requestId,
  priceUnit,
  value,
  objects,
  customerId,
  readonly,
  lockedFields,
  busy,
  update,
  descriptionPlaceholder = "说明本项服务的目标、范围和期望结果，环境细节可在材料中补充。",
}: {
  reservationRecords: ServiceRequest[];
  requestId?: string;
  descriptionPlaceholder?: string;
  priceUnit?: string;
  value: RequestItem;
  objects: ObjectRef[];
  customerId: string;
  readonly: boolean;
  lockedFields: MappingTarget[];
  busy: boolean;
  update: (patch: Partial<RequestItem>) => void;
}) {
  const fieldReadonly = (target: MappingTarget) => readonly || lockedFields.includes(target);
  const fields = useContext(RequestFieldsContext);
  const methodField = fields.find((field) => field.id === 'method');
  const formOrder = requestFormOrder(value.config);
  const methodOptions =
    methodField?.options
      .filter(
        (option) => option.enabled && value.methods.includes(option.value),
      )
      .map((option) => option.value) ?? value.methods;
  return (
    <div className="sr-basic-fields">
      <section className="sr-sheet-section">
        <h3>服务需求</h3>
        <fieldset
          disabled={readonly || busy}
          className="sr-form-grid sr-live-fields"
        >
          <RequestFormLayout
            config={value.config}
            visibleIds={formOrder.filter(
              (id) =>
                ['method', 'description', 'businessObjects'].includes(id) ||
                requestFieldIsVisible(
                  value.config,
                  id,
                  value.method,
                  value.values,
                ),
            )}
            renderField={(key) => {
              if (key === 'method')
                return (
                  <label>
                    {methodField?.name ?? '服务方式'} <em>*</em>
                    {methodField && methodField.type !== 'single' ? (
                      <RequestFieldControl
                        disabled={fieldReadonly('method') || busy}
                        field={methodField}
                        availableOptions={value.methods}
                        value={value.method}
                        onChange={(method) =>
                          update({
                            method,
                            methodFieldType:
                              methodField.type === 'lookup' ||
                              methodField.type === 'address'
                                ? 'single'
                                : methodField.type,
                          })
                        }
                      />
                    ) : (
                      <select
                        disabled={fieldReadonly('method') || busy}
                        value={value.method}
                        onChange={(e) =>
                          update({
                            method: e.target.value,
                            methodFieldType: 'single',
                          })
                        }
                      >
                        <option value="">请选择</option>
                        {value.method &&
                          !methodOptions.includes(value.method) && (
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
                );
              if (key === 'description')
                return (
                  <label>
                    {fields.find((field) => field.id === 'description')?.name ??
                      '需求说明'}{' '}
                    {value.config.basicFields?.description?.required !==
                    false ? (
                      <em>*</em>
                    ) : (
                      <small>选填</small>
                    )}
                    <textarea
                      rows={4}
                      readOnly={fieldReadonly('description')}
                      value={value.description}
                      onChange={(e) => update({ description: e.target.value })}
                      placeholder={descriptionPlaceholder}
                    />
                  </label>
                );
              if (key === 'businessObjects')
                return (
                  <section className="sr-sheet-section">
                    <h3>
                      {fields.find((field) => field.id === 'businessObjects')
                        ?.name ?? '业务对象'}{' '}
                      <span>
                        {value.config.basicFields?.businessObjects?.required
                          ? '必填'
                          : '选填'}{' '}
                        · 可多选
                      </span>
                    </h3>
                    {value.config.basicFields?.businessObjects?.required && (
                      <p className="sr-help">
                        请至少关联一个当前客户的业务对象。
                      </p>
                    )}
                    <fieldset
                      disabled={fieldReadonly('businessObjectIds') || busy}
                      className="sr-object-options"
                    >
                      <ul aria-label="可关联的业务对象">
                        {(fieldReadonly('businessObjectIds')
                          ? savedItemBusinessObjects(value)
                          : objects
                              .filter(
                                (o) =>
                                  (o.status === '启用' &&
                                    matchesObjectProduct(o, value.config)) ||
                                  value.businessObjectIds.includes(o.id),
                              )
                              .map((object) => ({
                                object,
                                entitlement: objectEntitlementAvailability(
                                  object,
                                  priceUnit,
                                  reservationRecords,
                                  requestId,
                                ),
                                recorded: true,
                              }))
                        ).map(({ object: o, entitlement, recorded }) => {
                          return (
                            <li key={o.id}>
                              <label>
                                <input
                                  type="checkbox"
                                  disabled={
                                    fieldReadonly('businessObjectIds') ||
                                    busy ||
                                    ((o.status !== '启用' ||
                                      !matchesObjectProduct(o, value.config)) &&
                                      !value.businessObjectIds.includes(o.id))
                                  }
                                  checked={value.businessObjectIds.includes(
                                    o.id,
                                  )}
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
                                    <small>
                                      （
                                      {recorded
                                        ? `${o.nodeCount} 节点`
                                        : '保存时数量未记录'}
                                      ）
                                    </small>
                                  </span>
                                  {entitlement && (
                                    <span
                                      className="sr-object-entitlement"
                                      data-insufficient={
                                        entitlement.insufficient || undefined
                                      }
                                    >
                                      <span title="可用权益 / 集群节点数">
                                        {entitlement.name}（
                                        {entitlement.available ?? '未维护'}/
                                        {entitlement.required}）
                                      </span>
                                      {entitlement.insufficient && (
                                        <span className="sr-object-entitlement-warning">
                                          权益不足，可继续申请
                                        </span>
                                      )}
                                      {entitlement.available === undefined && (
                                        <span className="sr-help">
                                          权益数量未维护，可继续申请
                                        </span>
                                      )}
                                    </span>
                                  )}
                                  <span className="sr-object-sn">
                                    序列号：{o.sn?.trim() || '未填写'}
                                  </span>
                                  {!fieldReadonly('businessObjectIds') && o.status !== '启用' && (
                                    <span className="sr-missing">
                                      已停用，请取消关联
                                    </span>
                                  )}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                      {!objects.length && (
                        <p className="sr-help">
                          {customerId
                            ? '该客户暂时没有可关联的业务对象。'
                            : '请先在项目中选择客户。'}
                        </p>
                      )}
                    </fieldset>
                  </section>
                );

              if (key === 'businessObjects') return null;
              const visible = requestFieldIsVisible(
                value.config,
                key,
                value.method,
                value.values,
              );
              if (!visible) return null;
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
                    {!requestFieldIsRequired(
                      value.config,
                      key,
                      value.method,
                      value.values,
                    ) ? (
                      <small>选填</small>
                    ) : (
                      <em>*</em>
                    )}
                  </span>
                  {key !== 'nodes' && field ? (
                    <RequestFieldControl
                      disabled={fieldReadonly('values') || busy}
                      field={field}
                      value={value.values[key] ?? ''}
                      availableOptions={value.config.fieldOptions?.[key]}
                      onChange={(next) =>
                        update({ values: { ...value.values, [key]: next } })
                      }
                    />
                  ) : (
                    <Input
                      readOnly={fieldReadonly('values')}
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
                        key === 'nodes'
                          ? '填写本项涉及的节点数'
                          : `填写${label}`
                      }
                    />
                  )}
                </div>
              );
            }}
          />
        </fieldset>
      </section>
    </div>
  );
}

export function ServiceProjectItems({
  project,
  actor,
  id,
  customerId,
  items,
  services,
  objects,
  readonly: requestedReadonly,
  busy,
  save,
}: {
  project?: ServiceProjectRecord;
  actor: OperationActor;
  id: string;
  customerId: string;
  items: RequestItem[];
  services: CatalogService[];
  objects: ObjectRef[];
  readonly: boolean;
  busy: boolean;
  save: (change: ProjectItemChange) => Promise<string | null>;
}) {
  const readonly = requestedReadonly || actor.role === '客户';
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<RequestItem | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [context, setContext] = useState<ProjectItemContext>({
    services,
    businessObjects: objects,
    requests: [],
  });
  const lock = useRef(false);
  const disabled = busy || working;
  const audience = projectItemAudience(actor);
  const available = context.services.filter((service) =>
    serviceAvailableForRequest(service, audience),
  );
  const matches = available.filter((service) =>
    `${service.id} ${service.name}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const selectedService = context.services.find(
    (service) => service.id === pending?.serviceId,
  );

  async function begin(item: RequestItem | null) {
    if (disabled || lock.current) return;
    setPending(item ? structuredClone(item) : null);
    setError('');
    setQuery('');
    setOpen(true);
    // Customer details use only the authorized project projection and its snapshots.
    if (audience === 'customer') {
      setContext({ services, businessObjects: objects, requests: [] });
      return;
    }
    setWorking(true);
    lock.current = true;
    try {
      setContext(await readProjectItemContext());
    } catch {
      setError('无法读取服务目录和业务对象，请关闭后重试。');
    } finally {
      setWorking(false);
      lock.current = false;
    }
  }
  async function select(service: CatalogService) {
    if (disabled || readonly || lock.current) return;
    setWorking(true);
    lock.current = true;
    setError('');
    try {
      setPending(await newProjectServiceItem(service, actor));
    } catch {
      setError('无法读取服务项配置，请重试。');
    } finally {
      setWorking(false);
      lock.current = false;
    }
  }
  async function persist(change: ProjectItemChange) {
    if (disabled || readonly || lock.current) return;
    setWorking(true);
    lock.current = true;
    setError('');
    try {
      const issue = await save(change);
      if (issue) {
        setError(issue);
        return;
      }
      setOpen(false);
      setPending(null);
      setRemoveId(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : '服务项保存失败，请重试。',
      );
    } finally {
      setWorking(false);
      lock.current = false;
    }
  }

  return (
    <>
      <ProjectItemsPanel
        showCustomerVisibility={audience === 'internal'}
        record={{ id, items }}
        objects={objects}
        busy={disabled}
        readonly={readonly}
        showCompleteness
        canAdd={!!customerId}
        canRemove={item => !projectItemReadonlyTargets(project, item.id).length}
        onAdd={() => void begin(null)}
        onEdit={(item) => void begin(item)}
        onCopy={(id) => void persist({ type: 'copy', id })}
        onRemove={(id) => {
          setError('');
          setRemoveId(id);
        }}
      />
      {!customerId && !readonly && (
        <p className="sr-help">请先选择客户，再添加服务项。</p>
      )}
      {error && !open && !removeId && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!disabled) {
            setOpen(next);
            if (!next) {
              setPending(null);
              setError('');
            }
          }
        }}
      >
        <DialogContent
          className="sr-dialog sr-catalog-dialog sr-item-basics-dialog"
          {...(readonly ? { 'aria-describedby': undefined } : {})}
          showCloseButton={!disabled}
        >
          <DialogHeader>
            <DialogTitle>
              {readonly
                ? '服务项详细信息'
                : pending && items.some((item) => item.id === pending.id)
                  ? '编辑服务项'
                  : '添加服务项'}
            </DialogTitle>
            {!readonly && <DialogDescription>
              {pending ? '填写并保存服务项信息。' : '选择本项目的服务目录。'}
            </DialogDescription>}
          </DialogHeader>
          <div className="sr-item-dialog-body">
            {pending ? (
              <>
                <div className="sr-selected-service">
                  <div>
                    <div className="sr-selected-service-heading">
                      <strong>{pending.serviceName}</strong>
                      <p>
                        {pending.serviceId} · 版本{' '}
                        {selectedService
                          ? `v${selectedService.version ?? 1}`
                          : '—'}
                      </p>
                    </div>
                    {selectedService?.description?.trim() && (
                      <p className="sr-selected-service-content">
                        服务内容：{selectedService.description}
                      </p>
                    )}
                  </div>
                  {!readonly &&
                    !items.some((item) => item.id === pending.id) && (
                      <Button
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => {
                          setPending(null);
                          setError('');
                        }}
                      >
                        重新选择目录
                      </Button>
                    )}
                </div>
                <ProjectItemBasicFields
                  lockedFields={projectItemReadonlyTargets(project, pending.id)}
                  value={pending}
                  reservationRecords={context.requests}
                  priceUnit={selectedService?.priceUnit}
                  objects={context.businessObjects.filter(
                    (object) => object.customerId === customerId,
                  )}
                  customerId={customerId}
                  readonly={readonly}
                  busy={disabled}
                  update={(patch) =>
                    setPending((current) =>
                      current ? { ...current, ...patch } : current,
                    )
                  }
                />
              </>
            ) : (
              <>
                <Input
                  aria-label="搜索可添加服务"
                  value={query}
                  disabled={disabled}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索服务名称或编码"
                />
                <div className="sr-catalog-options">
                  {matches.map((service) => (
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
                        disabled={disabled}
                        onClick={() => void select(service)}
                      >
                        选择
                      </Button>
                    </div>
                  ))}
                  {!matches.length && (
                    <p className="sr-empty">没有匹配的已启用服务。</p>
                  )}
                </div>
              </>
            )}
            {error && (
              <p className="sr-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                setPending(null);
                setError('');
              }}
            >
              {readonly ? '关闭' : '取消'}
            </Button>
            {pending && !readonly && (
              <Button
                disabled={disabled}
                onClick={() => void persist({ type: 'save', item: pending })}
              >
                <Save size={15} />
                {disabled ? '正在保存…' : '保存服务项'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!removeId}
        onOpenChange={(next) => {
          if (!next && !disabled) {
            setRemoveId(null);
            setError('');
          }
        }}
      >
        <DialogContent className="sr-dialog">
          <DialogHeader>
            <DialogTitle>移除此服务项？</DialogTitle>
            <DialogDescription>
              该服务项将从项目中移除，其他服务项将保留。
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="sr-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                setRemoveId(null);
                setError('');
              }}
            >
              保留服务项
            </Button>
            <Button
              variant="destructive"
              disabled={disabled || readonly}
              onClick={() =>
                removeId && void persist({ type: 'remove', id: removeId })
              }
            >
              确认移除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
