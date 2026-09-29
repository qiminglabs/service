'use client';

import { ServiceExecutionFormSettings } from '@/components/service-execution-form-settings';
import { ServiceProviderSettings } from '@/components/service-provider-settings';

import type { OperationActor } from '@/lib/request-operations';
import { createContext, useId, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  readAddress,
  writeAddress,
  skipAddressChoice,
} from '@/lib/request-address';
import {
  provinceNames,
  provinceCities,
  allCityNames,
} from '@/lib/china-province-city';
import { EntitlementConversions } from '@/components/entitlement-conversions';
import { RequestFlowDiagram } from '@/components/request-flow-diagram';
import { RequestProjectMappingSettings } from '@/components/request-project-mapping-settings';
import { ProjectCollaboratorAssignmentSettings } from '@/components/project-collaborator-assignment-settings';
import { ServiceFlowSettings } from '@/components/service-flow-settings';
import { ExecutionFlowDiagram } from '@/components/execution-flow-diagram';
import { RequestFlowSettings } from '@/components/request-flow-settings';
import { ApprovalRuleSettings } from '@/components/approval-rule-settings';
import { RequestRuleSettings } from '@/components/request-rule-settings';
import { backendSettingsSections, type BackendSettingsSection, type RequestFlowTab } from '@/lib/backend-settings';
import { initialApplicationFields, isSystemApplicationField, normalizeApplicationFields } from '@/lib/request-application-fields';
import { initialProjectFields, isSystemProjectField, normalizeProjectFields, projectFieldRules } from '@/lib/service-project-fields';
import { editionFeatureFields, editionFieldRequirement, fieldRequirementLabels, fieldOptionsIssue } from '@/lib/request-field-requirements';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateField } from '@/components/date-field';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '@/components/ui/combobox';
import { ServiceMailTemplateSettings } from '@/components/service-mail-template-settings';
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
  lookup: '查找字段',
  address: '地址',
} as const;
export type RequestFieldType = keyof typeof fieldTypes;
export type FieldOption = { value: string; enabled: boolean };
export type RequestField = {
  id: string;
  name: string;
  type: RequestFieldType;
  options: FieldOption[];
  referenceTarget?: 'partners' | 'businessObjects' | 'customers' | 'users';
  updatedAt?: string;
  updatedBy?: string;
};
const systemFields: Record<
  string,
  {
    name: string;
    type: RequestFieldType;
    referenceTarget?: 'partners' | 'businessObjects';
  }
> = {
  edition: { name: '授权版本', type: 'single' },
  version: { name: '版本号', type: 'single' },
  ...Object.fromEntries(editionFeatureFields.map(field => [field.id, { name: field.name, type: 'single' as const }])),
  nodes: { name: '节点数', type: 'integer' },
  installObservability: { name: '是否安装可观测性', type: 'single' },
  description: { name: '需求说明', type: 'textarea' },
  businessObjects: {
    name: '业务对象',
    type: 'lookup',
    referenceTarget: 'businessObjects',
  },
  method: { name: '服务方式', type: 'single' },
  productForm: { name: '产品形态', type: 'single' },
  address: { name: '地址', type: 'address' },
  tibCount: { name: 'TiB 数', type: 'integer' },
  instanceCount: { name: '实例数', type: 'integer' },
  clusterCount: { name: '集群数', type: 'integer' },
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
      name: (field.name?.trim() || systemFields[field.id]?.name || field.name),
      referenceTarget:
        systemFields[field.id]?.referenceTarget ?? field.referenceTarget,
      options: field.options.map((option) =>
        typeof option === 'string' ? { value: option, enabled: true } : option,
      ),
    })),
  );
}
export const initialRequestFields = normalizeRequestFields([
  ...editionFeatureFields.map(field => ({ id: field.id, name: field.name, type: 'single' as const, options: ['是', '否'] })),
  {
    id: 'edition',
    name: '授权版本',
    options: ['基础版', '敏捷版', '标准版', '企业版'],
  },
  { id: 'version', name: '版本号', options: ['5.0.1', '5.0.2', '5.0.3'] },
  { id: 'nodes', name: '节点数', type: 'integer', options: [] },
  { id: 'installObservability', name: '是否安装可观测性', type: 'single', options: ['是', '否'] },
  { id: 'description', name: '需求说明', type: 'textarea', options: [] },
  {
    id: 'businessObjects',
    name: '业务对象',
    type: 'lookup',
    referenceTarget: 'businessObjects',
    options: [],
  },
  { id: 'method', name: '服务方式', type: 'single', options: ['远程', '现场'] },
  {
    id: 'productForm',
    name: '产品形态',
    type: 'single',
    options: ['纯软件', '一体机'],
  },
  { id: 'address', name: '地址', type: 'address', options: [] },
  { id: 'tibCount', name: 'TiB 数', type: 'integer', options: [] },
  { id: 'instanceCount', name: '实例数', type: 'integer', options: [] },
  { id: 'clusterCount', name: '集群数', type: 'integer', options: [] },
]);
export const RequestFieldsContext = createContext(initialRequestFields);
export const ApplicationFieldsContext = createContext(initialApplicationFields);

export function RequestFieldSettings({
  fields: serviceFields,
  onChange: onServiceFieldsChange,
  applicationFields,
  onApplicationFieldsChange,
  projectFields = initialProjectFields,
  onProjectFieldsChange,
  ready,
  actor,
  actorIdentity,
  section = 'forms',
}: {
  section?: BackendSettingsSection;
  actor: string;
  actorIdentity: OperationActor;
  fields: RequestField[];
  onChange: (fields: RequestField[]) => void;
  applicationFields: RequestField[];
  onApplicationFieldsChange: (fields: RequestField[]) => void;
  projectFields?: RequestField[];
  onProjectFieldsChange?: (fields: RequestField[]) => void;
  ready: boolean;
}) {
  const currentSection = backendSettingsSections.find(item => item.key === section)!;
  const [activeTab, setActiveTab] = useState<string>(currentSection.tabs[0]?.key ?? '');
  const settingsTabsId = useId();
  const tabId = (key: string) => `${settingsTabsId}-settings-tab-${key}`;
  function selectFlowTab(key: RequestFlowTab) {
    setActiveTab(key);
  }
  const applicationTab = activeTab === 'application-fields';
  const projectTab = section === 'project-forms';
  const visibleProjectFields = normalizeProjectFields(projectFields).filter(field =>
    !['id', 'status', 'createdBy', 'createdAt'].includes(field.id),
  );
  const fields = projectTab ? projectFields : applicationTab ? applicationFields : serviceFields;
  const onChange = projectTab ? onProjectFieldsChange! : applicationTab ? onApplicationFieldsChange : onServiceFieldsChange;
  const systemField = projectTab ? isSystemProjectField : applicationTab ? isSystemApplicationField : isSystemField;
  const [target, setTarget] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<RequestFieldType>('single');
  const [options, setOptions] = useState<FieldOption[]>([]);
  const [newOption, setNewOption] = useState('');
  const [error, setError] = useState('');
  const creating = target === 'new';
  const locked = target !== null && systemField(target);
  const fixedTypeOptions = (applicationTab && target === 'requestType') || (projectTab && target === 'status');
  const isChoice =
    (type === 'single' || type === 'multiple') && target !== 'businessObjects';
  function open(id: string) {
    if (!ready) return;
    const field = fields.find((field) => field.id === id);
    if (id !== 'new' && !field) return;
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
    const next = [...options.map(option => ({ ...option, value: option.value.trim() })), ...values.map((value) => ({ value, enabled: true }))];
    const issue = fieldOptionsIssue(next);
    if (issue) { setError(issue); return null; }
    return next;
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
    if (!ready || !target) return;
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
    const current = fields.find((field) => field.id === target);
    if (!creating && !current) return;
    const next = isChoice ? addedOptions() : current?.options ?? [];
    if (!next) return;
    if (!locked && isChoice && !next.length) {
      setError('请至少新建一个选项。');
      return;
    }
    const changed = creating || (current && (
      current.name !== name.trim() ||
      current.options.length !== next.length ||
      current.options.some((option, index) =>
        option.value !== next[index]?.value || option.enabled !== next[index]?.enabled,
      )
    ));
    if (changed) {
      const updatedAt = new Date().toISOString();
      const field: RequestField = {
        ...(current ?? { id: `field-${crypto.randomUUID()}`, type }),
        name: name.trim(),
        options: next,
        updatedAt,
        updatedBy: actor || '未选择用户',
      };
      onChange(creating ? [...fields, field] : fields.map(item => item.id === target ? field : item));
    }
    setTarget(null);
  }
  return (
    <section
      className="reference-panel backend-settings-panel"
      aria-label={currentSection.label}
    >
      {section === 'execution-flow' && <ExecutionFlowDiagram activeTab={activeTab} tabId={tabId} onTabSelect={setActiveTab} />}
      {section === 'request-flow' && <RequestFlowDiagram activeTab={activeTab} tabId={tabId} onTabSelect={selectFlowTab} />}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="reference-toolbar request-field-toolbar">
          <TabsList
            variant="line"
            className="reference-tabs"
            aria-label={currentSection.label}
          >
            {currentSection.tabs.map(tab => <TabsTrigger key={tab.key} id={tabId(tab.key)} value={tab.key} className="reference-tab">
              {tab.label}{tab.key === 'request-items' && <span>{serviceFields.length}</span>}{tab.key === 'application-fields' && <span>{applicationFields.length}</span>}{tab.key === 'project-fields' && <span>{visibleProjectFields.length}</span>}
            </TabsTrigger>)}
          </TabsList>
          {(section === 'forms' || projectTab) && <Button disabled={!ready} onClick={() => open('new')}><Plus size={16} />创建字段</Button>}
        </div>
        {(section === 'forms' || projectTab) && <TabsContent value={activeTab}>
          <div className="table-scroll">
            <table className="reference-table app-list-table">
              <thead>
                <tr>
                  <th>字段名称</th>
                  <th>字段类型</th>
                  <th>选项</th>
                  {projectTab && <th>填写规则</th>}
                  <th>修改时间</th>
                  <th>修改人</th>
                  <th data-list-actions>操作</th>
                </tr>
              </thead>
              <tbody>
                {(projectTab ? visibleProjectFields : applicationTab ? normalizeApplicationFields(fields) : normalizeRequestFields(fields)).map((field) => (
                  <tr key={field.id}>
                    <td>
                      <strong>{field.name}</strong>
                      {systemField(field.id) && <span className="request-system-field">系统预置</span>}
                    </td>
                    <td>{projectTab && field.id === 'createdAt' ? '日期时间' : fieldTypes[field.type]}</td>
                    <td>
                      {projectTab && field.id === 'serviceProviderId' ? '合作伙伴创建时固定为所属企业，内部创建时可选择服务方' : field.referenceTarget === 'users' ? '关联内部用户，自动记录' : field.referenceTarget === 'customers' ? (
                        '关联客户对象，单选'
                      ) : field.id === 'businessObjects' ? (
                        '关联业务对象，可多选'
                      ) : field.referenceTarget === 'partners' ? (
                        '关联合作伙伴对象，单选'
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
                    {projectTab && <td>{projectFieldRules[field.id] ?? '选填'}</td>}
                    <td>
                      {field.updatedAt
                        ? new Date(field.updatedAt).toLocaleString('zh-CN', { hour12: false })
                        : '—'}
                    </td>
                    <td>{field.updatedBy ?? '—'}</td>
                    <td>
                        <Button
                          variant="ghost"
                          disabled={!ready}
                          onClick={() => open(field.id)}
                        >
                          编辑
                        </Button>

                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>}
        {section === 'request-flow' && <>
          <TabsContent value="assessment-manager"><RequestFlowSettings role="manager" actor={actorIdentity} /></TabsContent>
          <TabsContent value="assessment-hardware"><RequestFlowSettings role="hardware" actor={actorIdentity} /></TabsContent>
          <TabsContent value="approval-designer"><ApprovalRuleSettings actor={actorIdentity} /></TabsContent>
          <TabsContent value="collaborators"><RequestRuleSettings tab="collaborators" actor={actorIdentity} /></TabsContent>
          <TabsContent value="submission"><RequestRuleSettings tab="submission" actor={actorIdentity} /></TabsContent>
        </>}
        {section === 'execution-flow' && <TabsContent value="service-mail-templates">{activeTab === 'service-mail-templates' && <ServiceMailTemplateSettings actor={actorIdentity} />}</TabsContent>}
        {section === 'execution-flow' && <TabsContent value="service-flows"><ServiceFlowSettings actor={actorIdentity} /></TabsContent>}
        {section === 'execution-flow' && <TabsContent value="project-approval-designer"><ApprovalRuleSettings actor={actorIdentity} scope="project" /></TabsContent>}
        {section === 'execution-flow' && <TabsContent value="service-providers">{activeTab === 'service-providers' && <ServiceProviderSettings actor={actorIdentity} />}</TabsContent>}
        {section === 'execution-flow' && <TabsContent value="project-collaborators"><ProjectCollaboratorAssignmentSettings /></TabsContent>}
        {section === 'execution-flow' && <TabsContent value="request-project-mapping"><RequestProjectMappingSettings actor={actorIdentity} applicationFields={applicationFields} projectFields={projectFields} /></TabsContent>}
        {section === 'execution-flow' && <TabsContent value="execution-form-library"><ServiceExecutionFormSettings actor={actorIdentity} /></TabsContent>}
        {section === 'pricing' && <TabsContent value="entitlement-conversions">
          <EntitlementConversions actor={actor} />
        </TabsContent>}
      </Tabs>
      <Dialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
      >
        <DialogContent className="request-field-dialog">
          <DialogHeader>
            <DialogTitle>
              {creating ? '创建字段' : '编辑字段'}
            </DialogTitle>
            <DialogDescription>
              {projectTab && locked ? '可修改字段名称；字段类型、填写规则、项目状态选项及系统自动记录规则固定。' : fixedTypeOptions ? '申请类型应用于所有服务申请，选项固定为技术评估和服务交付；可修改字段名称。' : locked
                ? '系统预置字段可修改名称；选项列表支持编辑选项值、新增及启停选项。'
                : creating
                  ? projectTab ? '创建后可在服务项目中填写，并配置请求转项目映射。' : applicationTab ? '创建后保存在服务申请字段库中。' : '创建后可在服务目录的申请表单中添加使用。'
                  : '可修改名称和选项。'}
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
              字段名称（标签）
              <Input
                id="request-field-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="请输入字段名称"
              />
            </label>
            <label>
              字段类型
              <select
                disabled={!creating}
                value={type}
                onChange={(event) => {
                  setType(event.target.value as RequestFieldType);
                  setError('');
                }}
              >
                {Object.entries(fieldTypes)
                  .filter(([key]) => key !== 'lookup' || type === 'lookup')
                  .map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            {target && editionFieldRequirement(target) && (
              <div className="sr-span">
                <strong>特殊填写要求</strong>
                <p className="sr-help">{fieldRequirementLabels[editionFieldRequirement(target)!]}。添加到服务表单时默认启用，可在字段属性中调整。</p>
              </div>
            )}
            {projectTab && target && <p className="sr-help sr-span">{projectFieldRules[target]}</p>}
            {fixedTypeOptions && <div className="sr-span"><strong>{projectTab ? '项目状态' : '可选类型'}</strong><div className="request-field-options">{options.map(option => <span key={option.value}>{option.value}</span>)}</div></div>}
            {isChoice && !fixedTypeOptions && (
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
                  修改或停用选项后，已填写的历史值会保留；服务表单的可用选项需同步检查。
                </p>
                <div className="request-field-option-list">
                  <table className="reference-table">
                    <thead>
                      <tr>
                        <th>选项名称</th>
                        <th>状态</th>
                        <th data-list-actions>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {options.map((option, index) => (
                        <tr key={index}>
                          <td><Input aria-label={`选项 ${index + 1} 名称`} value={option.value} onChange={(event) => {
                            setOptions(items => items.map((item, i) => i === index ? { ...item, value: event.target.value } : item));
                            setError('');
                          }} /></td>
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
  disabled = false,
}: {
  field: RequestField;
  value: string;
  availableOptions?: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const addressDetailId = useId();
  if (field.type === 'address') {
    const address = readAddress(value);
    const cities = provinceCities[address.province] ?? allCityNames;
    return (
      <fieldset
        className="request-address"
        disabled={disabled}
        aria-label={field.name}
      >
        {(['province', 'city'] as const).map((key) => {
          const label = key === 'province' ? '省' : '市';
          const items = [
            ...(key === 'province' ? provinceNames : cities),
            skipAddressChoice,
          ];
          return (
            <div key={key} className="request-address-choice">
              <span>{label}</span>
              <Combobox
                items={items}
                value={address[key] || null}
                disabled={disabled}
                onValueChange={(next) => {
                  const selected = next ?? '';
                  onChange(
                    writeAddress(
                      key === 'province'
                        ? { ...address, province: selected, city: '' }
                        : { ...address, city: selected },
                    ),
                  );
                }}
              >
                <ComboboxInput
                  aria-label={`${field.name}·${label}`}
                  placeholder={`请选择或搜索${label}`}
                  disabled={disabled}
                />
                <ComboboxContent>
                  <ComboboxEmpty>未找到匹配的{label}</ComboboxEmpty>
                  <ComboboxList>
                    {(item: string) => (
                      <ComboboxItem key={item} value={item}>
                        {item}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
            </div>
          );
        })}
        <label className="request-address-detail" htmlFor={addressDetailId}>
          详细地址
          <Input
            id={addressDetailId}
            aria-label={`${field.name}·详细地址`}
            value={address.detail}
            onChange={(event) =>
              onChange(writeAddress({ ...address, detail: event.target.value }))
            }
            placeholder="街道、门牌号等"
          />
        </label>
      </fieldset>
    );
  }
  if (field.referenceTarget === 'partners') {
    const partners = field.options.map((option) => option.value);
    return (
      <Combobox
        items={partners}
        value={value || null}
        onValueChange={(next) => onChange(next ?? '')}
        disabled={disabled}
      >
        <ComboboxInput
          aria-label={field.name}
          placeholder="搜索并选择合作伙伴"
          showClear
          disabled={disabled}
        />
        <ComboboxContent>
          <ComboboxEmpty>未找到匹配的合作伙伴</ComboboxEmpty>
          <ComboboxList>
            {(partner: string) => (
              <ComboboxItem key={partner} value={partner}>
                {partner}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    );
  }
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
  if (field.type === 'date')
    return <DateField label={field.name} hideLabel value={value} onChange={onChange} disabled={disabled} />;
  return (
    <Input
      aria-label={field.name}
      type={
        field.type === 'integer' || field.type === 'decimal'
          ? 'number'
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
