'use client';
import { useI18n } from '@/lib/i18n/context';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { startRequestFieldDrag } from '@/lib/request-field-drag';
import { requestTypes } from '@/lib/request-types';
import { materialRequiredFor, materialRequiredTypes, materialRequirementLabel } from '@/lib/material-requirements';
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
import { requestFormOrder, requestFieldWidth, moveRequestFormField } from '@/lib/request-form-layout';
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
  busy: saving,
  readonly = false,
  update,
}: {
  service: CatalogService;
  config: RequestConfig;
  fields: RequestField[];
  products: string[];
  busy: boolean;
  readonly?: boolean;
  update: (config: RequestConfig) => void;
}) {
  const { localize } = useI18n();
  const busy = saving || readonly;
  const [selected, select] = useState('method');
  const templateInput = useRef<HTMLInputElement>(null);
  const [query, search] = useState('');
  const builder = useRef<HTMLDivElement>(null);
  const cancelDrag = useRef<(() => void) | null>(null);
  const suppressDragClick = useRef(false);
  useEffect(() => () => cancelDrag.current?.(), []);
  useEffect(() => { if (busy) cancelDrag.current?.(); }, [busy]);
  function beginDrag(event: PointerEvent<HTMLButtonElement>, id: string) {
    if (busy || event.button !== 0 || !event.isPrimary || !builder.current) return;
    cancelDrag.current?.();
    suppressDragClick.current = false;
    cancelDrag.current = startRequestFieldDrag({
      source: event.currentTarget, root: builder.current, id, order,
      pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
      onDrag: () => { suppressDragClick.current = true; },
      onEnd: () => { setTimeout(() => { suppressDragClick.current = false; }, 0); },
      onDrop: add,
    });
  }
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
  const add = (id: string, before?: string) => {
    if (busy || !all.some((f) => f.id === id)) return;
    const next: RequestConfig = { ...config, fieldColumns: undefined };
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
    const arranged = moveRequestFormField(order, id, before);
    next.fieldOrder = arranged;
    next.fields = arranged.filter((key) => next.fields.includes(key));
    const requirement = editionFieldRequirement(id);
    if (requirement && !config.fields.includes(id))
      next.fieldRequiredWhen = { ...config.fieldRequiredWhen, [id]: requirement };
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
    <div className="rf-builder" ref={builder}
      onDragStart={(event) => event.preventDefault()}
      onClickCapture={(event) => {
        if (suppressDragClick.current && event.detail !== 0) {
          suppressDragClick.current = false;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <aside className="rf-library">
        <h3>{localize("可用字段")}</h3>
        {localize(!readonly && <p className="sr-help">{localize("拖入表单，或点击添加")}</p>)}
        <Input
          aria-label={localize("搜索可用字段")}
          placeholder={localize("搜索字段")}
          value={query}
          onChange={(e) => search(e.target.value)}
        />
        <div className="rf-library-list">
          {localize(all
            .filter((f) => f.name.includes(query))
            .map((f) => (
              <button
                type="button"
                key={f.id}
                disabled={saving || (readonly && !order.includes(f.id))}
                onPointerDown={(event) => beginDrag(event, f.id)}
                onClick={() =>
                  order.includes(f.id) ? select(f.id) : add(f.id)
                }
                className="rf-library-field"
                data-selected={selected === f.id}
                data-added={order.includes(f.id)}
              >
                <GripVertical size={16} />
                <span>
                  {localize(f.name)}
                  <small>{localize(fieldTypes[f.type])}</small>
                </span>
                {localize(order.includes(f.id) ? (
                  <small>{localize("已添加")}</small>
                ) : (
                  <Plus size={16} />
                ))}
              </button>
            )))}
        </div>
      </aside>
      <main className="rf-center">
        <div className="rf-preview-heading">
          <strong>{localize("申请表单预览")}</strong>
          {localize(!readonly && <span>{localize("按字段顺序自动排列 · 拖动可调整先后顺序")}</span>)}
        </div>
        <div className="rf-paper">
          <h3>{localize(service.name)}</h3>
          <h3 className="rf-service-section-title">{localize("服务需求")}</h3>
          <div className="rf-canvas">
            <RequestFormLayout config={config} renderField={(id) => {
              const f = all.find((f) => f.id === id);
              if (!f) return null;
              return (
                <div
                  key={id}
                  className="rf-preview-field"
                  data-selected={selected === id}
                  data-field-id={id}
                >
                  <button
                    type="button"
                    className="rf-select-field"
                    disabled={saving}
                    onPointerDown={(event) => beginDrag(event, id)}
                    onClick={() => select(id)}
                    aria-label={localize(`${readonly ? '查看' : '配置'}${f.name}`)}
                  >
                    <span>
                      {localize(f.name)} {localize(config.fieldRequiredWhen?.[id] ? <small>{localize(fieldRequirementLabels[config.fieldRequiredWhen[id]])}</small> : required(id) && <em>*</em>)}
                    </span>
                    <GripVertical size={15} />
                  </button>
                  <div
                    className="rf-control-preview"
                    onPointerDown={() => select(id)}
                  >
                    <fieldset disabled aria-hidden="true">
                      {localize(id === 'businessObjects' ? (
                        <div className="rf-object-placeholder">
                          {localize("选择")}{localize(f.name)} {localize(" · 可多选")}<br />
                          <small>
                            {localize(isEntitlementService(service)
                              ? 'SMTX OS 系统'
                              : (
                                  config.basicFields?.businessObjects
                                    ?.products ?? products
                                ).join('、'))}
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
                      ))}
                    </fieldset>
                  </div>
                </div>
              );
            }} />
            {localize(!readonly && <div className="rf-drop-hint">{localize("拖动字段到此处添加")}</div>)}
          </div>
          <section className="rf-materials">
            <div className="sr-panel-heading">
              <h3>{localize("材料要求（")}{localize(config.materials.length)}）</h3>
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
                {localize("添加材料要求")}</Button>
            </div>
            {localize(config.materials.map((m) => (
              <button
                type="button"
                key={m.id}
                className="rf-material-preview"
                data-selected={selected === `material:${m.id}`}
                disabled={saving}
                onClick={() => {
                  select(`material:${m.id}`);
                  setMaterialError('');
                }}
                aria-label={localize(`${readonly ? '查看' : '配置'}材料${m.name || '未命名材料'}`)}
              >
                <span className="rf-material-title">
                  {localize(m.name || '未命名材料')}
                  <small>{localize(materialRequirementLabel(m))}</small>
                </span>
                <span className="rf-material-instructions">
                  {localize(m.instructions || '暂无填写说明')}
                </span>
                <span className="rf-material-placeholder">{localize("上传材料")}</span>
                <small>
                  {localize(m.template?.name ??
                    (m.templateUrl ? '已配置文件模板' : '未配置文件模板'))}
                  {localize(m.onlineTemplateUrl ? ' · 已配置在线文档模板' : '')}
                </small>
              </button>
            )))}
            {localize(!config.materials.length && (
              <p className="sr-help">{localize("暂无材料要求，点击上方按钮添加。")}</p>
            ))}
          </section>
        </div>
      </main>
      <aside className="rf-properties">
        <h3>{localize(material ? '材料属性' : '字段属性')}</h3>
        {localize(material ? (
          <>
            <label className="rf-property-input" htmlFor={`material-name-${material.id}`}>
              <span className="rf-property-label">{localize("材料名称")}<em>*</em></span>
              <Input
                id={`material-name-${material.id}`}
                disabled={busy}
                value={material.name}
                onChange={(e) => patchMaterial({ name: e.target.value })}
              />
            </label>
            <label className="rf-property-input">
              {localize("填写说明")}<textarea
                rows={5}
                disabled={busy}
                value={material.instructions}
                placeholder={localize("填写此材料的要求与说明")}
                onChange={(e) =>
                  patchMaterial({ instructions: e.target.value })
                }
              />
            </label>
            {localize(requestTypes.map(type => <label className="sr-check-line" key={type}>
              <input
                type="checkbox"
                disabled={busy}
                checked={materialRequiredFor(material, type)}
                onChange={(e) => patchMaterial({ requiredByType: { ...materialRequiredTypes(material), [type]: e.target.checked } })}
              />
              {localize(type)}{localize("类型必须上传")}</label>))}
            <label className="sr-check-line">
              <input type="checkbox" disabled={busy} checked={material.deduplicate ?? false} onChange={event => patchMaterial({ deduplicate: event.target.checked })} />
              {localize("去重")}</label>
            <p className="sr-help">{localize("多个服务项使用相同文件模板或在线文档链接时，在申请材料中合并展示。")}</p>
            <label className="rf-property-input" htmlFor={`material-url-${material.id}`}>
              {localize("在线文档模板链接")}<Input
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
            <section className="rf-template-section" aria-label={localize("文件模板")}>
              <div className="rf-template-heading"><span>{localize("文件模板")}</span>
                <Button variant="outline" size="sm" disabled={busy} onClick={() => templateInput.current?.click()}>
                  {localize(material.template || material.templateUrl ? '替换模板' : '上传模板')}
                </Button>
              </div>
              <input
                ref={templateInput}
                hidden
                aria-label={localize("上传文件模板")}
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
            {localize(material.template ? (
              <Button
                variant="link"
                className="rf-template-download"
                onClick={() => downloadFile(material.template!)}
              >
                {localize(material.template.name)}
              </Button>
            ) : material.templateUrl ? (
              <a className="rf-template-download" href={material.templateUrl} download>
                {localize(templateFileName(material.templateUrl))}
              </a>
            ) : (
              <p className="rf-template-empty">{localize("尚未上传模板")}</p>
            ))}
            </section>
            {localize(/^https?:\/\//i.test(material.onlineTemplateUrl?.trim() ?? '') && (
              <a
                href={material.onlineTemplateUrl!.trim()}
                target="_blank"
                rel="noopener noreferrer"
              >
                {localize("打开在线文档模板")}</a>
            ))}
            {localize(materialError && (
              <p className="sr-error" role="alert">
                {localize(materialError)}
              </p>
            ))}
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
              {localize("移除此材料要求")}</Button>
          </>
        ) : field && order.includes(selected) ? (
          <>
            <div className="rf-property-title">
              <strong>{localize(field.name)}</strong>
              <small>{localize(fieldTypes[field.type])}</small>
            </div>
            <fieldset disabled={busy}>
              <legend>{localize("字段宽度")}</legend>
              <div className="rf-width-options">
                {localize((['half', 'full'] as const).map((position) => (
                  <label key={position}>
                    <input
                      type="radio"
                      name="field-width"
                      checked={requestFieldWidth(config, selected) === position}
                      onChange={() => update({ ...config, fieldColumns: undefined, fieldWidths: { ...config.fieldWidths, [selected]: position } })}
                    />
                    {localize(position === 'full' ? '整行' : '半行')}
                  </label>
                )))}
              </div>
              <p className="sr-help">{localize("半行字段按顺序从左到右排列，整行字段独占一行。")}</p>
            </fieldset>
            {localize(specialRequirement ? <fieldset className="rf-address-required" disabled={busy}>
              <legend>{localize("特殊填写要求")}</legend>
              {localize(([['required', '必填'], ['optional', '选填'], [specialRequirement, fieldRequirementLabels[specialRequirement]]] as const).map(([rule, label]) => <label className="sr-check-line" key={rule}>
                <input type="radio" name={`field-required-${selected}`} value={rule} checked={(config.fieldRequiredWhen?.[selected] ?? (required(selected) ? 'required' : 'optional')) === rule} onChange={() => {
                  const conditions = { ...config.fieldRequiredWhen };
                  if (rule === 'required' || rule === 'optional') delete conditions[selected]; else conditions[selected] = rule as FieldRequirement;
                  updateWithDependencies({ ...config, fieldRequired: { ...config.fieldRequired, [selected]: rule === 'required' }, fieldRequiredWhen: conditions });
                }} />{localize(label)}
              </label>))}
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
              {localize("必填")}</label>)}
            {localize(selected === 'edition' && fixed && <p className="sr-help">{localize("其他字段的显示条件依赖授权版本，因此该字段必须保留并填写。")}</p>)}
            {localize(selected === 'method' ? (
              <p className="sr-help">
                {localize("引用服务目录：")}{localize(service.deliveryMethods.join('、'))}
              </p>
            ) : selected === 'businessObjects' ? (
              <fieldset disabled={busy || fixed}>
                <legend>{localize("可搜索产品")}</legend>
                {localize((fixed ? ['SMTX OS 系统'] : products).map((product) => (
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
                    {localize(product)}
                  </label>
                )))}
                {localize(fixed && (
                  <p className="sr-help">
                    {localize("权益类服务固定必填，仅可关联 SMTX OS 系统。")}</p>
                ))}
              </fieldset>
            ) : (
              ['single', 'multiple'].includes(field.type) && (
                <fieldset disabled={busy}>
                  <legend>{localize("可用选项")}</legend>
                  {localize(field.options
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
                        {localize(option.value)}
                      </label>
                    )))}
                  {localize(!field.options.some((o) => o.enabled) && (
                    <p className="sr-help">{localize("后台暂无启用选项")}</p>
                  ))}
                </fieldset>
              )
            ))}
            <Button variant="outline" disabled={busy || fixed} onClick={remove}>
              <Trash2 size={14} />
              {localize("移除字段")}</Button>
          </>
        ) : (
          <p className="sr-help">{localize("选择中间的字段以配置属性")}</p>
        ))}
      </aside>
    </div>
  );
}
