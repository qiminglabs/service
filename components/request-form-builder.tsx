'use client';
import { useRef, useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  fieldTypes,
  RequestFieldControl,
  type RequestField,
} from '@/components/request-field-settings';
import {
  isEntitlementService,
  requestFieldIsRequired,
  checkFile,
  fileAccept,
  storedFile,
  downloadFile,
  type MaterialRequirement,
  type CatalogService,
  type RequestConfig,
} from '@/lib/service-requests';
import { requestFormOrder, requestFieldPlacements, setRequestFieldPlacement } from '@/lib/request-form-layout';
import { RequestFormLayout } from '@/components/request-form-layout';
import { editionFieldRequirement, fieldRequirementLabels, isEditionRequirement, withEditionFieldDependency, type FieldRequirement } from '@/lib/request-field-requirements';

function templateFileName(url: string) {
  const name = url.split(/[?#]/)[0].split('/').pop() || '模板文件';
  try { return decodeURIComponent(name); } catch { return name; }
}

export function RequestFormBuilder({
  service,
  config,
  fields,
  products,
  busy,
  update,
}: {
  service: CatalogService;
  config: RequestConfig;
  fields: RequestField[];
  products: string[];
  busy: boolean;
  update: (config: RequestConfig) => void;
}) {
  const [selected, select] = useState('method');
  const templateInput = useRef<HTMLInputElement>(null);
  const [query, search] = useState('');
  const [hover, setHover] = useState<string | null>(null);
  const [materialError, setMaterialError] = useState('');
  const material = config.materials.find(
    (m) => `material:${m.id}` === selected,
  );
  const patchMaterial = (patch: Partial<MaterialRequirement>) => {
    if (!material || busy) return;
    update({
      ...config,
      materials: config.materials.map((m) =>
        m.id === material.id ? { ...m, ...patch } : m,
      ),
    });
  };
  const all: RequestField[] = [
    {
      id: 'method',
      name: fields.find(field => field.id === 'method')?.name ?? '服务方式',
      type: 'single',
      options: service.deliveryMethods.map((value) => ({
        value,
        enabled: true,
      })),
    },
    { id: 'description', name: fields.find(field => field.id === 'description')?.name ?? '需求说明', type: 'textarea', options: [] },
    { id: 'businessObjects', name: fields.find(field => field.id === 'businessObjects')?.name ?? '业务对象', type: 'lookup', options: [] },
    ...fields.filter(
      (f) => !['method', 'description', 'businessObjects'].includes(f.id),
    ),
    ...config.fields
      .filter(
        (id) =>
          !fields.some((f) => f.id === id) &&
          !['method', 'description', 'businessObjects'].includes(id),
      )
      .map((id) => ({
        id,
        name: config.fieldNames[id] ?? id,
        type: 'text' as const,
        options: [],
      })),
  ];
  const order = requestFormOrder(config);
  const placements = requestFieldPlacements(config);
  const field = all.find((f) => f.id === selected);
  const specialRequirement = field?.type === 'address' ? 'onsite' : editionFieldRequirement(selected);
  const updateWithDependencies = (next: RequestConfig) => update(withEditionFieldDependency(next,
    fields.find(f => f.id === 'edition')?.options.filter(option => option.enabled).map(option => option.value) ?? [],
  ));
  const fixed =
    selected === 'method' ||
    (selected === 'edition' && config.fields.some(id => isEditionRequirement(config.fieldRequiredWhen?.[id]))) ||
    (selected === 'businessObjects' && isEntitlementService(service));
  const required = (id: string) =>
    id === 'method' ||
    (id === 'description'
      ? config.basicFields?.description?.required !== false
      : id === 'businessObjects'
        ? !!config.basicFields?.businessObjects?.required
        : requestFieldIsRequired(config, id, ''));
  const add = (id: string, before?: string, column?: 'left' | 'right') => {
    if (busy || !all.some((f) => f.id === id)) return;
    let next = { ...config, fieldColumns: { ...config.fieldColumns } };
    for (const [key, position] of Object.entries(placements))
      if (position !== 'full') next.fieldColumns[key] = position;
    if (id === 'description' || id === 'businessObjects')
      next.basicFields = {
        ...config.basicFields,
        [id]: {
          ...config.basicFields?.[id],
          enabled: true,
          required:
            id === 'description'
              ? config.basicFields?.description?.required !== false
              : (config.basicFields?.businessObjects?.required ?? false),
        },
      };
    else if (id !== 'method') {
      next.fields = [...new Set([...config.fields, id])];
      const f = all.find((f) => f.id === id)!;
      if (['single', 'multiple'].includes(f.type) && !config.fieldOptions[id])
        next.fieldOptions = {
          ...config.fieldOptions,
          [id]: f.options.filter((o) => o.enabled).map((o) => o.value),
        };
    }
    const arranged = order.filter((key) => key !== id);
    const targetBefore = before === id ? order[order.indexOf(id) + 1] : before;
    const index = targetBefore ? arranged.indexOf(targetBefore) : -1;
    arranged.splice(index < 0 ? arranged.length : index, 0, id);
    next.fieldOrder = arranged;
    next.fields = arranged.filter((key) => next.fields.includes(key));
    const requirement = editionFieldRequirement(id);
    if (requirement && !config.fields.includes(id))
      next.fieldRequiredWhen = { ...config.fieldRequiredWhen, [id]: requirement };
    if (column) next = { ...setRequestFieldPlacement(next, id, column), fieldColumns: { ...next.fieldColumns, [id]: column } };
    updateWithDependencies(next);
    select(id);
  };
  const remove = () => {
    if (fixed || busy) return;
    const next = {
      ...config,
      fields: config.fields.filter((id) => id !== selected),
      fieldOrder: order.filter((id) => id !== selected),
    };
    if (selected === 'description' || selected === 'businessObjects')
      next.basicFields = {
        ...config.basicFields,
        [selected]: {
          ...config.basicFields?.[selected],
          enabled: false,
          required: false,
        },
      };
    update(next);
    select('method');
  };
  return (
    <div className="rf-builder">
      <aside className="rf-library">
        <h3>可用字段</h3>
        <p className="sr-help">拖入表单，或点击添加</p>
        <Input
          aria-label="搜索可用字段"
          placeholder="搜索字段"
          value={query}
          onChange={(e) => search(e.target.value)}
        />
        <div className="rf-library-list">
          {all
            .filter((f) => f.name.includes(query))
            .map((f) => (
              <button
                type="button"
                key={f.id}
                disabled={busy}
                draggable={!busy}
                onDragStart={(e) =>
                  e.dataTransfer.setData('application/x-request-field', f.id)
                }
                onClick={() =>
                  order.includes(f.id) ? select(f.id) : add(f.id)
                }
                className="rf-library-field"
                data-selected={selected === f.id}
                data-added={order.includes(f.id)}
              >
                <GripVertical size={16} />
                <span>
                  {f.name}
                  <small>{fieldTypes[f.type]}</small>
                </span>
                {order.includes(f.id) ? (
                  <small>已添加</small>
                ) : (
                  <Plus size={16} />
                )}
              </button>
            ))}
        </div>
      </aside>
      <main className="rf-center">
        <div className="rf-preview-heading">
          <strong>申请表单预览</strong>
          <span>左右列独立排列 · 可拖入指定列或在属性中调整</span>
        </div>
        <div className="rf-paper">
          <h3>{service.name}</h3>
          <h3 className="rf-service-section-title">服务需求</h3>
          <div
            className="rf-canvas"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              add(e.dataTransfer.getData('application/x-request-field'));
              setHover(null);
            }}
          >
            <RequestFormLayout config={config} onPlaceField={busy ? undefined : (id, column, before) => add(id, before, column)} renderField={(id) => {
              const f = all.find((f) => f.id === id);
              if (!f) return null;
              return (
                <div
                  key={id}
                  className="rf-preview-field"
                  data-selected={selected === id}
                  data-over={hover === id}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setHover(id);
                  }}
                  onDragLeave={() => setHover(null)}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const dragged = e.dataTransfer.getData(
                      'application/x-request-field',
                    );
                    if (dragged !== id) add(dragged, id, placements[id] === 'full' ? undefined : placements[id] as 'left' | 'right');
                    setHover(null);
                  }}
                >
                  <button
                    type="button"
                    className="rf-select-field"
                    draggable={!busy}
                    disabled={busy}
                    onDragStart={(e) =>
                      e.dataTransfer.setData('application/x-request-field', id)
                    }
                    onClick={() => select(id)}
                    aria-label={`配置${f.name}`}
                  >
                    <span>
                      {f.name} {config.fieldRequiredWhen?.[id] ? <small>{fieldRequirementLabels[config.fieldRequiredWhen[id]]}</small> : required(id) && <em>*</em>}
                    </span>
                    <GripVertical size={15} />
                  </button>
                  <div
                    className="rf-control-preview"
                    onPointerDown={() => select(id)}
                  >
                    <fieldset disabled aria-hidden="true">
                      {id === 'businessObjects' ? (
                        <div className="rf-object-placeholder">
                          选择{f.name} · 可多选
                          <br />
                          <small>
                            {isEntitlementService(service)
                              ? 'SMTX OS 系统'
                              : (
                                  config.basicFields?.businessObjects
                                    ?.products ?? products
                                ).join('、')}
                          </small>
                        </div>
                      ) : (
                        <RequestFieldControl
                          field={f}
                          value=""
                          disabled
                          availableOptions={
                            id === 'method'
                              ? service.deliveryMethods
                              : config.fieldOptions[id]
                          }
                          onChange={() => {}}
                        />
                      )}
                    </fieldset>
                  </div>
                </div>
              );
            }} />
            <div className="rf-drop-hint">拖动字段到此处添加</div>
          </div>
          <section className="rf-materials">
            <div className="sr-panel-heading">
              <h3>材料要求（{config.materials.length}）</h3>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const id = crypto.randomUUID();
                  update({
                    ...config,
                    materials: [
                      ...config.materials,
                      { id, name: '', instructions: '', required: false },
                    ],
                  });
                  select(`material:${id}`);
                  setMaterialError('');
                }}
              >
                <Plus size={14} />
                添加材料要求
              </Button>
            </div>
            {config.materials.map((m) => (
              <button
                type="button"
                key={m.id}
                className="rf-material-preview"
                data-selected={selected === `material:${m.id}`}
                disabled={busy}
                onClick={() => {
                  select(`material:${m.id}`);
                  setMaterialError('');
                }}
                aria-label={`配置材料${m.name || '未命名材料'}`}
              >
                <span className="rf-material-title">
                  {m.name || '未命名材料'}
                  <small>{m.required ? '必须上传' : '选填'}</small>
                </span>
                <span className="rf-material-instructions">
                  {m.instructions || '暂无填写说明'}
                </span>
                <span className="rf-material-placeholder">上传材料</span>
                <small>
                  {m.template?.name ??
                    (m.templateUrl ? '已配置文件模板' : '未配置文件模板')}
                  {m.onlineTemplateUrl ? ' · 已配置在线文档模板' : ''}
                </small>
              </button>
            ))}
            {!config.materials.length && (
              <p className="sr-help">暂无材料要求，点击上方按钮添加。</p>
            )}
          </section>
        </div>
      </main>
      <aside className="rf-properties">
        <h3>{material ? '材料属性' : '字段属性'}</h3>
        {material ? (
          <>
            <label className="rf-property-input" htmlFor={`material-name-${material.id}`}>
              <span className="rf-property-label">材料名称 <em>*</em></span>
              <Input
                id={`material-name-${material.id}`}
                disabled={busy}
                value={material.name}
                onChange={(e) => patchMaterial({ name: e.target.value })}
              />
            </label>
            <label className="rf-property-input">
              填写说明
              <textarea
                rows={5}
                disabled={busy}
                value={material.instructions}
                placeholder="填写此材料的要求与说明"
                onChange={(e) =>
                  patchMaterial({ instructions: e.target.value })
                }
              />
            </label>
            <label className="sr-check-line">
              <input
                type="checkbox"
                disabled={busy}
                checked={material.required}
                onChange={(e) => patchMaterial({ required: e.target.checked })}
              />
              必须上传
            </label>
            <label className="sr-check-line">
              <input type="checkbox" disabled={busy} checked={material.deduplicate ?? false} onChange={event => patchMaterial({ deduplicate: event.target.checked })} />
              去重
            </label>
            <p className="sr-help">多个服务项使用相同文件模板或在线文档链接时，在申请材料中合并展示。</p>
            <label className="rf-property-input" htmlFor={`material-url-${material.id}`}>
              在线文档模板链接
              <Input
                id={`material-url-${material.id}`}
                type="url"
                disabled={busy}
                value={material.onlineTemplateUrl ?? ''}
                placeholder="https://…"
                onChange={(e) =>
                  patchMaterial({ onlineTemplateUrl: e.target.value })
                }
              />
            </label>
            <section className="rf-template-section" aria-label="文件模板">
              <div className="rf-template-heading"><span>文件模板</span>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => templateInput.current?.click()}>
                  {material.template || material.templateUrl ? '替换模板' : '上传模板'}
                </Button>
              </div>
              <input
                ref={templateInput}
                hidden
                aria-label="上传文件模板"
                type="file"
                disabled={busy}
                accept={fileAccept}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (!file) return;
                  const issue = checkFile(file);
                  setMaterialError(issue ?? '');
                  if (issue) return;
                  patchMaterial({
                    template: storedFile(file),
                    templateUrl: undefined,
                  });
                }}
              />
            {material.template ? (
              <Button
                variant="link"
                className="rf-template-download"
                onClick={() => downloadFile(material.template!)}
              >
                {material.template.name}
              </Button>
            ) : material.templateUrl ? (
              <a className="rf-template-download" href={material.templateUrl} download>
                {templateFileName(material.templateUrl)}
              </a>
            ) : (
              <p className="rf-template-empty">尚未上传模板</p>
            )}
            </section>
            {/^https?:\/\//i.test(material.onlineTemplateUrl?.trim() ?? '') && (
              <a
                href={material.onlineTemplateUrl!.trim()}
                target="_blank"
                rel="noopener noreferrer"
              >
                打开在线文档模板
              </a>
            )}
            {materialError && (
              <p className="sr-error" role="alert">
                {materialError}
              </p>
            )}
            <Button
              variant="outline"
              className="rf-material-remove"
              disabled={busy}
              onClick={() => {
                update({
                  ...config,
                  materials: config.materials.filter(
                    (m) => m.id !== material.id,
                  ),
                });
                select('method');
                setMaterialError('');
              }}
            >
              <Trash2 size={14} />
              移除此材料要求
            </Button>
          </>
        ) : field && order.includes(selected) ? (
          <>
            <div className="rf-property-title">
              <strong>{field.name}</strong>
              <small>{fieldTypes[field.type]}</small>
            </div>
            <fieldset disabled={busy}>
              <legend>布局位置</legend>
              <div className="rf-width-options">
                {(['left', 'right', 'full'] as const).map((position) => (
                  <label key={position}>
                    <input
                      type="radio"
                      name="field-position"
                      checked={placements[selected] === position}
                      onChange={() => update(setRequestFieldPlacement(config, selected, position))}
                    />
                    {position === 'full' ? '整行' : position === 'left' ? '左列' : '右列'}
                  </label>
                ))}
              </div>
              <p className="sr-help">左右列各自向下排列，整行字段排在两列之后。</p>
            </fieldset>
            {specialRequirement ? <fieldset className="rf-address-required" disabled={busy}>
              <legend>特殊填写要求</legend>
              {([['required', '必填'], ['optional', '选填'], [specialRequirement, fieldRequirementLabels[specialRequirement]]] as const).map(([rule, label]) => <label className="sr-check-line" key={rule}>
                <input type="radio" name={`field-required-${selected}`} value={rule} checked={(config.fieldRequiredWhen?.[selected] ?? (required(selected) ? 'required' : 'optional')) === rule} onChange={() => {
                  const conditions = { ...config.fieldRequiredWhen };
                  if (rule === 'required' || rule === 'optional') delete conditions[selected]; else conditions[selected] = rule as FieldRequirement;
                  updateWithDependencies({ ...config, fieldRequired: { ...config.fieldRequired, [selected]: rule === 'required' }, fieldRequiredWhen: conditions });
                }} />{label}
              </label>)}
            </fieldset> : <label className="sr-check-line">
              <input
                type="checkbox"
                disabled={busy || fixed}
                checked={required(selected)}
                onChange={(e) => {
                  if (
                    selected === 'description' ||
                    selected === 'businessObjects'
                  )
                    update({
                      ...config,
                      basicFields: {
                        ...config.basicFields,
                        [selected]: {
                          ...config.basicFields?.[selected],
                          enabled: true,
                          required: e.target.checked,
                        },
                      },
                    });
                  else
                    update({
                      ...config,
                      fieldRequired: {
                        ...config.fieldRequired,
                        [selected]: e.target.checked,
                      },
                    });
                }}
              />
              必填
            </label>}
            {selected === 'edition' && fixed && <p className="sr-help">其他字段的显示条件依赖授权版本，因此该字段必须保留并填写。</p>}
            {selected === 'method' ? (
              <p className="sr-help">
                引用服务目录：{service.deliveryMethods.join('、')}
                。必填与可选项不可编辑。
              </p>
            ) : selected === 'businessObjects' ? (
              <fieldset disabled={busy || fixed}>
                <legend>可搜索产品</legend>
                {(fixed ? ['SMTX OS 系统'] : products).map((product) => (
                  <label className="sr-check-line" key={product}>
                    <input
                      type="checkbox"
                      checked={(
                        config.basicFields?.businessObjects?.products ??
                        products
                      ).includes(product)}
                      onChange={(e) => {
                        const values =
                          config.basicFields?.businessObjects?.products ??
                          products;
                        update({
                          ...config,
                          basicFields: {
                            ...config.basicFields,
                            businessObjects: {
                              enabled: true,
                              required: required(selected),
                              products: e.target.checked
                                ? [...values, product]
                                : values.filter((v) => v !== product),
                            },
                          },
                        });
                      }}
                    />
                    {product}
                  </label>
                ))}
                {fixed && (
                  <p className="sr-help">
                    权益类服务固定必填，仅可关联 SMTX OS 系统。
                  </p>
                )}
              </fieldset>
            ) : (
              ['single', 'multiple'].includes(field.type) && (
                <fieldset disabled={busy}>
                  <legend>可用选项</legend>
                  {field.options
                    .filter((o) => o.enabled)
                    .map((option) => (
                      <label className="sr-check-line" key={option.value}>
                        <input
                          type="checkbox"
                          checked={(
                            config.fieldOptions[selected] ?? []
                          ).includes(option.value)}
                          onChange={(e) => {
                            const values = config.fieldOptions[selected] ?? [];
                            update({
                              ...config,
                              fieldOptions: {
                                ...config.fieldOptions,
                                [selected]: e.target.checked
                                  ? [...values, option.value]
                                  : values.filter((v) => v !== option.value),
                              },
                            });
                          }}
                        />
                        {option.value}
                      </label>
                    ))}
                  {!field.options.some((o) => o.enabled) && (
                    <p className="sr-help">后台暂无启用选项</p>
                  )}
                </fieldset>
              )
            )}
            <Button variant="outline" disabled={busy || fixed} onClick={remove}>
              <Trash2 size={14} />
              移除字段
            </Button>
          </>
        ) : (
          <p className="sr-help">选择中间的字段以配置属性</p>
        )}
      </aside>
    </div>
  );
}
