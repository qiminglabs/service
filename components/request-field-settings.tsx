'use client';

import { createContext, useState } from 'react';
import { Plus } from 'lucide-react';
import { EntitlementConversions } from '@/components/entitlement-conversions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export const fieldTypes = {
  single: '单选',
  multiple: '多选',
  text: '文本',
  textarea: '多行文本',
  integer: '整数',
  decimal: '小数',
  date: '日期',
} as const;
export type RequestFieldType = keyof typeof fieldTypes;
export type FieldOption = { value: string; enabled: boolean };
export type RequestField = {
  id: string;
  name: string;
  type: RequestFieldType;
  options: FieldOption[];
};
const systemFields: Record<string, { name: string; type: RequestFieldType }> = {
  edition: { name: '产品版本', type: 'single' },
  version: { name: '产品版本号', type: 'single' },
  nodes: { name: '节点数', type: 'integer' },
  description: { name: '需求说明', type: 'textarea' },
  businessObjects: { name: '业务对象', type: 'multiple' },
  method: { name: '服务方式', type: 'single' },
};
export function isSystemField(id: string) {
  return Object.hasOwn(systemFields, id);
}
export function sortRequestFields(fields: RequestField[]): RequestField[] {
  const systemOrder = Object.keys(systemFields);
  const rank = (id: string) =>
    isSystemField(id) ? systemOrder.indexOf(id) : systemOrder.length;
  return [...fields].sort((left, right) => rank(left.id) - rank(right.id));
}
export function normalizeRequestFields(
  fields: Array<
    Omit<RequestField, 'type' | 'options'> & {
      type?: RequestFieldType;
      options: Array<string | FieldOption>;
    }
  >,
): RequestField[] {
  return sortRequestFields(
    fields.map((field) => ({
      ...field,
      type: systemFields[field.id]?.type ?? field.type ?? 'single',
      name: systemFields[field.id]?.name ?? field.name,
      options: field.options.map((option) =>
        typeof option === 'string' ? { value: option, enabled: true } : option,
      ),
    })),
  );
}
export const initialRequestFields = normalizeRequestFields([
  {
    id: 'edition',
    name: '产品版本',
    options: ['基础版', '敏捷版', '标准版', '企业版'],
  },
  { id: 'version', name: '产品版本号', options: ['5.0.1', '5.0.2', '5.0.3'] },
  { id: 'nodes', name: '节点数', type: 'integer', options: [] },
  { id: 'description', name: '需求说明', type: 'textarea', options: [] },
  { id: 'businessObjects', name: '业务对象', type: 'multiple', options: [] },
  { id: 'method', name: '服务方式', type: 'single', options: ['远程', '现场'] },
]);
export const RequestFieldsContext = createContext(initialRequestFields);

export function RequestFieldSettings({
  fields,
  onChange,
  ready,
  actor,
}: {
  actor: string;
  fields: RequestField[];
  onChange: (fields: RequestField[]) => void;
  ready: boolean;
}) {
  const [activeTab, setActiveTab] = useState('request-items');
  const [target, setTarget] = useState<string | null>(null);
  const [deletedField, setDeletedField] = useState<RequestField | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<RequestFieldType>('single');
  const [options, setOptions] = useState<FieldOption[]>([]);
  const [newOption, setNewOption] = useState('');
  const [error, setError] = useState('');
  const locked = target !== null && isSystemField(target);
  const isChoice =
    (type === 'single' || type === 'multiple') && target !== 'businessObjects';
  function open(id: string) {
    const field = fields.find((field) => field.id === id);
    setTarget(id);
    setName(field?.name ?? '');
    setType(field?.type ?? 'single');
    setOptions(field?.options.map((option) => ({ ...option })) ?? []);
    setNewOption('');
    setError('');
  }
  function addedOptions() {
    const values = newOption
      .split(/[\n,，]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (
      new Set(values).size !== values.length ||
      values.some((value) => options.some((option) => option.value === value))
    ) {
      setError('选项已存在（包含已停用选项），请修改或启用原选项。');
      return null;
    }
    return [...options, ...values.map((value) => ({ value, enabled: true }))];
  }
  function add() {
    if (!newOption.trim()) {
      setError('请输入选项名称。');
      return;
    }
    const next = addedOptions();
    if (!next) return;
    setOptions(next);
    setNewOption('');
    setError('');
  }
  function save() {
    if (!name.trim()) {
      setError('请输入字段名称。');
      return;
    }
    if (
      fields.some((field) => field.id !== target && field.name === name.trim())
    ) {
      setError('字段名称已存在。');
      return;
    }
    const next = isChoice ? addedOptions() : options;
    if (!next) return;
    if (isChoice && !next.length) {
      setError('请至少新建一个选项。');
      return;
    }
    const field = {
      id: target === 'new' ? crypto.randomUUID() : target!,
      name: locked ? systemFields[target!].name : name.trim(),
      type: locked ? systemFields[target!].type : type,
      options: next,
    };
    onChange(
      target === 'new'
        ? [...fields, field]
        : fields.map((item) => (item.id === target ? field : item)),
    );
    setTarget(null);
  }
  return (
    <section className="reference-panel backend-settings-panel" aria-label="后台配置">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="reference-toolbar request-field-toolbar">
          <TabsList
            variant="line"
            className="reference-tabs"
            aria-label="字段分类"
          >
            <TabsTrigger value="request-items" className="reference-tab">
              申请项字段<span>{fields.length}</span>
            </TabsTrigger>
            <TabsTrigger
              value="entitlement-conversions"
              className="reference-tab"
            >
              权益换算
            </TabsTrigger>
          </TabsList>
          {activeTab === 'request-items' && (
            <Button
              className="ct-button ct-button--primary"
              disabled={!ready}
              onClick={() => open('new')}
            >
              <Plus />
              新建字段
            </Button>
          )}
        </div>
        <TabsContent value="request-items">
          <div className="table-scroll">
            <table className="reference-table app-list-table">
              <thead>
                <tr>
                  <th>字段名称</th>
                  <th>字段类型</th>
                  <th>选项</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {normalizeRequestFields(fields).map((field) => (
                  <tr key={field.id}>
                    <td>
                      <strong>{field.name}</strong>
                      {isSystemField(field.id) && (
                        <span className="request-system-field">系统字段</span>
                      )}
                    </td>
                    <td>{fieldTypes[field.type]}</td>
                    <td>
                      {field.id === 'businessObjects' ? (
                        '关联业务对象，可多选'
                      ) : field.type === 'single' ||
                        field.type === 'multiple' ? (
                        <div className="request-field-options">
                          {field.options.map((option) => (
                            <span
                              key={option.value}
                              data-disabled={!option.enabled || undefined}
                            >
                              {option.value}
                              {!option.enabled && ' · 已停用'}
                            </span>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {isSystemField(field.id) &&
                      !['edition', 'version'].includes(field.id) ? (
                        <span className="sr-help">系统预置</span>
                      ) : (
                        <Button
                          variant="ghost"
                          disabled={!ready}
                          onClick={() => open(field.id)}
                        >
                          编辑
                        </Button>
                      )}
                      {!initialRequestFields.some(
                        (item) => item.id === field.id,
                      ) && (
                        <Button
                          variant="ghost"
                          disabled={!ready}
                          onClick={() => {
                            setDeletedField(field);
                            onChange(
                              fields.filter((item) => item.id !== field.id),
                            );
                          }}
                        >
                          删除
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
        <TabsContent value="entitlement-conversions">
          <EntitlementConversions actor={actor} />
        </TabsContent>
      </Tabs>
      {activeTab === 'request-items' && deletedField && (
        <output className="sr-help">
          已删除「{deletedField.name}」
          <Button
            variant="ghost"
            disabled={!ready}
            onClick={() => {
              onChange([...fields, deletedField]);
              setDeletedField(null);
            }}
          >
            撤销
          </Button>
        </output>
      )}
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent className="request-field-dialog">
          <DialogHeader>
            <DialogTitle>
              {target === 'new' ? '新建申请项字段' : '编辑申请项字段'}
            </DialogTitle>
            <DialogDescription>
              {locked
                ? '系统字段名称和类型不可修改，仅支持管理选项。保存后生效。'
                : '配置字段名称和类型；单选、多选字段可维护选项及启用状态。保存后生效。'}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save();
            }}
            className="sr-form-grid"
          >
            <label htmlFor="request-field-name">
              字段名称
              <Input
                id="request-field-name"
                disabled={locked}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入字段名称"
              />
            </label>
            <label>
              字段类型
              <select
                disabled={locked}
                value={type}
                onChange={(event) => {
                  setType(event.target.value as RequestFieldType);
                  setError('');
                }}
              >
                {Object.entries(fieldTypes).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {isChoice && (
              <section
                className="sr-span request-field-editor"
                aria-label="选项管理"
              >
                <h3>
                  选项管理{' '}
                  <small>
                    共 {options.length} 项，已启用{' '}
                    {options.filter((option) => option.enabled).length} 项
                  </small>
                </h3>
                <p className="sr-help">
                  停用后不可新增选择，已填写的历史值会保留。
                </p>
                <div className="request-field-option-list">
                  <table className="reference-table">
                    <thead>
                      <tr>
                        <th>选项名称</th>
                        <th>状态</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.map((option, index) => (
                        <tr key={option.value}>
                          <td>{option.value}</td>
                          <td>
                            <span
                              className="request-field-option-status"
                              data-enabled={option.enabled}
                            >
                              {option.enabled ? '已启用' : '已停用'}
                            </span>
                          </td>
                          <td>
                            <Button
                              type="button"
                              variant="ghost"
                              className="request-field-option-action"
                              data-action={
                                option.enabled ? 'disable' : 'enable'
                              }
                              aria-label={`${option.enabled ? '停用' : '启用'}${option.value}`}
                              onClick={() =>
                                setOptions((items) =>
                                  items.map((item, i) =>
                                    i === index
                                      ? { ...item, enabled: !item.enabled }
                                      : item,
                                  ),
                                )
                              }
                            >
                              {option.enabled ? '停用' : '启用'}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!options.length && (
                    <p className="sr-help">暂无选项，请新建。</p>
                  )}
                </div>
                <label htmlFor="request-field-option">新选项</label>
                <div className="request-field-option-add">
                  <Input
                    id="request-field-option"
                    value={newOption}
                    onChange={(event) => setNewOption(event.target.value)}
                    placeholder="输入选项，多个选项用逗号分隔"
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        add();
                      }
                    }}
                  />
                  <Button type="button" variant="outline" onClick={add}>
                    <Plus />
                    新建
                  </Button>
                </div>
              </section>
            )}
            {error && (
              <p role="alert" className="sr-error sr-span">
                {error}
              </p>
            )}
            <DialogFooter className="sr-span">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTarget(null)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!ready}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function RequestFieldControl({
  field,
  value,
  availableOptions,
  onChange,
}: {
  field: RequestField;
  value: string;
  availableOptions?: string[];
  onChange: (value: string) => void;
}) {
  const optionIsAvailable = (option: FieldOption) =>
    option.enabled &&
    (availableOptions === undefined || availableOptions.includes(option.value));
  if (field.type === 'single')
    return (
      <select
        aria-label={field.name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">请选择</option>
        {value &&
          !field.options.some(
            (option) => option.value === value && optionIsAvailable(option),
          ) && (
            <option value={value} disabled>
              {value}（当前不可用）
            </option>
          )}
        {field.options.filter(optionIsAvailable).map((option) => (
          <option key={option.value}>{option.value}</option>
        ))}
      </select>
    );
  if (field.type === 'multiple') {
    let selected: string[];
    try {
      const parsed: unknown = JSON.parse(value);
      selected =
        Array.isArray(parsed) &&
        parsed.every((item) => typeof item === 'string')
          ? parsed
          : value
            ? [value]
            : [];
    } catch {
      selected = value ? [value] : [];
    }
    const choices = [
      ...field.options,
      ...selected
        .filter(
          (item) => !field.options.some((option) => option.value === item),
        )
        .map((item) => ({ value: item, enabled: false })),
    ];
    return (
      <fieldset className="request-field-checkboxes" aria-label={field.name}>
        {choices
          .filter(
            (option) =>
              optionIsAvailable(option) || selected.includes(option.value),
          )
          .map((option) => (
            <label key={option.value}>
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((item) => item !== option.value);
                  onChange(next.length ? JSON.stringify(next) : '');
                }}
                disabled={
                  !optionIsAvailable(option) && !selected.includes(option.value)
                }
              />
              {option.value}
              {!optionIsAvailable(option) && '（当前不可用）'}
            </label>
          ))}
        {!choices.some(
          (option) =>
            optionIsAvailable(option) || selected.includes(option.value),
        ) && <span>暂无可用选项</span>}
      </fieldset>
    );
  }
  if (field.type === 'textarea')
    return (
      <textarea
        aria-label={field.name}
        rows={3}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  return (
    <Input
      aria-label={field.name}
      type={
        field.type === 'integer' || field.type === 'decimal'
          ? 'number'
          : field.type === 'date'
            ? 'date'
            : 'text'
      }
      step={
        field.type === 'integer'
          ? 1
          : field.type === 'decimal'
            ? 'any'
            : undefined
      }
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
