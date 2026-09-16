'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ServiceFlowDesigner } from '@/components/service-flow-designer';
import { newServiceFlowStep, serviceStepTypes } from '@/lib/service-flow-steps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import type { OperationActor } from '@/lib/request-operations';
import {
  readServiceFlowData,
  saveServiceFlowConfig,
} from '@/lib/service-flow-store';
import {
  emptyServiceFlowConfig,
  flowConditionFields,
  flowConditionLabel,
  resolveServiceFlow,
  sortedFlowRules,
  type FlowConditionField,
  type FlowContext,
  type FlowDictionary,
  type ServiceFlow,
  type ServiceFlowConfig,
  type ServiceFlowRule,
} from '@/lib/service-flows';

const emptyContext = (): FlowContext => ({
  serviceId: '',
  method: '',
  customerId: '',
  customerTeam: '',
});
const message = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请重试。';
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="submission-rule-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function FlowSelect({
  config,
  value,
  onChange,
  disabled,
  label = '选择服务流程',
}: {
  config: ServiceFlowConfig;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">请选择服务流程</option>
      {config.flows.map((flow) => (
        <option key={flow.id} value={flow.id} disabled={!flow.enabled}>
          {flow.name}
          {!flow.enabled && '（已停用）'}
        </option>
      ))}
    </NativeSelect>
  );
}
function conditionOptions(
  field: FlowConditionField,
  dictionary: FlowDictionary,
) {
  if (field === 'serviceId') return dictionary.services;
  if (field === 'customerId') return dictionary.customers;
  return (
    field === 'method' ? ['现场', '远程'] : ['金融', '商业', '港澳', '其他']
  ).map((value) => ({ id: value, name: value }));
}

export function ServiceFlowSettings({
  actor,
  mode,
}: {
  actor: OperationActor;
  mode: 'flows' | 'assignment';
}) {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof readServiceFlowData>>>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [flowDraft, setFlowDraft] = useState<ServiceFlow>(),
    [ruleDraft, setRuleDraft] = useState<ServiceFlowRule>();
  const [formError, setFormError] = useState(''),
    [deleteTarget, setDeleteTarget] = useState<{
      kind: 'flow' | 'rule';
      id: string;
      name: string;
    }>();
  const [defaultId, setDefaultId] = useState('');
  const [preview, setPreview] = useState(false),
    [context, setContext] = useState<FlowContext>(emptyContext),
    [sampleId, setSampleId] = useState('');
  const lock = useRef(false);
  const config = data?.config ?? emptyServiceFlowConfig();
  const dictionary = data?.dictionary ?? { customers: [], services: [] };
  const allowed = canManageRouting(actor),
    disabled = busy || !data || !allowed;
  useEffect(() => {
    let active = true;
    void readServiceFlowData()
      .then((next) => {
        if (active) {
          setData(next);
          setDefaultId(next.config.assignment.defaultFlowId);
        }
      })
      .catch((issue) => {
        if (active) setError(message(issue));
      });
    return () => {
      active = false;
    };
  }, []);
  async function reload() {
    if (lock.current) return;
    setError('');
    setNotice('');
    try {
      const next = await readServiceFlowData();
      setData(next);
      setDefaultId(next.config.assignment.defaultFlowId);
    } catch (issue) {
      setError(message(issue));
    }
  }
  async function save(
    next: ServiceFlowConfig,
    success: string,
    dialog = false,
  ) {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setFormError('');
    setError('');
    setNotice('');
    try {
      const saved = await saveServiceFlowConfig(next, actor);
      setData((current) => current && { ...current, config: saved });
      setDefaultId(saved.assignment.defaultFlowId);
      setFlowDraft(undefined);
      setRuleDraft(undefined);
      setDeleteTarget(undefined);
      setNotice(success);
    } catch (issue) {
      (dialog ? setFormError : setError)(message(issue));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function editFlow(flow?: ServiceFlow) {
    setFormError('');
    setFlowDraft(
      flow
        ? structuredClone(flow)
        : {
            id: crypto.randomUUID(),
            name: '',
            description: '',
            enabled: true,
            steps: [newServiceFlowStep(1)],
          },
    );
  }
  function editRule(rule?: ServiceFlowRule) {
    setFormError('');
    setRuleDraft(
      rule
        ? structuredClone(rule)
        : {
            id: crypto.randomUUID(),
            name: '',
            priority: Math.min(
              9999,
              Math.max(
                0,
                ...config.assignment.rules.map((row) => row.priority),
              ) + 10,
            ),
            enabled: true,
            match: 'all',
            conditions: [{ field: 'serviceId', operator: 'eq', value: '' }],
            flowId: '',
          },
    );
  }
  const samples = (data?.projects ?? []).flatMap((project) =>
    (project.items ?? []).map((item) => ({
      id: JSON.stringify([project.id, item.id]),
      label: `${project.name} · ${item.serviceName} · ${item.method || '方式未填写'}（${item.id}）`,
      context: {
        customerId: project.customerId,
        customerTeam:
          dictionary.customers.find(
            (customer) => customer.id === project.customerId,
          )?.team ?? '',
        serviceId: item.serviceId,
        method: item.method,
      },
    })),
  );
  const result = resolveServiceFlow(config, context);
  const flowOptionsAvailable = config.flows.some((flow) => flow.enabled);
  if (flowDraft)
    return (
      <ServiceFlowDesigner
        key={flowDraft.id}
        initialFlow={flowDraft}
        config={config}
        actor={actor}
        onBack={() => setFlowDraft(undefined)}
        onSaved={(saved) => {
          setData((current) => current && { ...current, config: saved });
          setDefaultId(saved.assignment.defaultFlowId);
        }}
      />
    );
  return (
    <div className="request-flow-settings service-flow-settings">
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="sr-success" role="status">
          {notice}
        </p>
      )}
      {!data && !error && <p role="status">正在加载服务流程…</p>}
      {mode === 'flows' ? (
        <section className="routing-rules" aria-label="服务流程">
          <div className="submission-rules-toolbar">
            <div>
              <strong>服务流程</strong>
            </div>
            <div className="routing-inline">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void reload()}
              >
                重新加载
              </Button>
              <Button disabled={disabled} onClick={() => editFlow()}>
                <Plus size={16} />
                新建服务流程
              </Button>
            </div>
          </div>
          <div className="table-scroll">
            <table className="reference-table app-list-table">
              <thead>
                <tr>
                  <th>流程名称</th>
                  <th>服务步骤</th>
                  <th>状态</th>
                  <th>分配引用</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {config.flows.map((flow) => (
                  <tr key={flow.id}>
                    <td>
                      <strong>{flow.name}</strong>
                      {flow.description && (
                        <p className="sr-help">{flow.description}</p>
                      )}
                    </td>
                    <td>
                      <details>
                        <summary>{flow.steps.length} 个步骤</summary>
                        <ol className="service-flow-step-summary">
                          {flow.steps.map((step) => (
                            <li key={step.id}>
                              {step.phase && `${step.phase} / `}
                              {step.name}
                            </li>
                          ))}
                        </ol>
                      </details>
                    </td>
                    <td>{flow.enabled ? '启用' : '停用'}</td>
                    <td>
                      {[
                        config.assignment.defaultFlowId === flow.id
                          ? '默认流程'
                          : '',
                        ...config.assignment.rules
                          .filter((rule) => rule.flowId === flow.id)
                          .map((rule) => rule.name),
                      ]
                        .filter(Boolean)
                        .join('、') || '未分配'}
                    </td>
                    <td>
                      <div className="rule-table-actions">
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => editFlow(flow)}
                        >
                          配置步骤
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={disabled}
                          onClick={() => {
                            setFormError('');
                            setDeleteTarget({
                              kind: 'flow',
                              id: flow.id,
                              name: flow.name,
                            });
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!config.flows.length && (
                  <tr>
                    <td colSpan={5} className="routing-empty">
                      尚未配置服务流程。新建流程后，添加步骤并设置分配规则。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <>
          <section className="routing-default">
            <div>
              <strong>默认服务流程</strong>
            </div>
            <div className="routing-inline service-flow-default">
              <FlowSelect
                config={config}
                value={defaultId}
                onChange={setDefaultId}
                disabled={disabled}
                label="默认服务流程"
              />
              <Button
                disabled={
                  disabled || defaultId === config.assignment.defaultFlowId
                }
                onClick={() =>
                  void save(
                    {
                      ...config,
                      assignment: {
                        ...config.assignment,
                        defaultFlowId: defaultId,
                      },
                    },
                    '默认服务流程已保存。',
                  )
                }
              >
                保存
              </Button>
            </div>
          </section>
          <section className="routing-rules" aria-label="条件分配规则">
            <div className="submission-rules-toolbar">
              <div>
                <strong>条件分配规则</strong>
              </div>
              <div className="routing-inline">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void reload()}
                >
                  重新加载
                </Button>
                <Button
                  variant="outline"
                  disabled={!data || busy}
                  onClick={() => setPreview(true)}
                >
                  分配预览
                </Button>
                <Button
                  disabled={disabled || !flowOptionsAvailable}
                  onClick={() => editRule()}
                >
                  <Plus size={16} />
                  新增规则
                </Button>
              </div>
            </div>
            {!flowOptionsAvailable && (
              <p className="service-flow-hint sr-help">
                请先在“服务流程”中创建并启用至少一个流程。
              </p>
            )}
            <div className="table-scroll">
              <table className="reference-table app-list-table">
                <thead>
                  <tr>
                    <th>优先级</th>
                    <th>规则名称</th>
                    <th>匹配条件</th>
                    <th>分配流程</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFlowRules(config.assignment.rules).map((rule) => (
                    <tr key={rule.id}>
                      <td>{rule.priority}</td>
                      <td>{rule.name}</td>
                      <td>
                        <span className="sr-help">
                          {rule.match === 'all'
                            ? '满足全部条件'
                            : '满足任一条件'}
                        </span>
                        {rule.conditions.map((condition, index) => (
                          <p key={index}>
                            {flowConditionLabel(condition, dictionary)}
                          </p>
                        ))}
                      </td>
                      <td>
                        {config.flows.find((flow) => flow.id === rule.flowId)
                          ?.name ?? '流程不存在'}
                      </td>
                      <td>{rule.enabled ? '启用' : '停用'}</td>
                      <td>
                        <div className="rule-table-actions">
                          <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => editRule(rule)}
                          >
                            编辑
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() =>
                              void save(
                                {
                                  ...config,
                                  assignment: {
                                    ...config.assignment,
                                    rules: config.assignment.rules.map((row) =>
                                      row.id === rule.id
                                        ? { ...row, enabled: !row.enabled }
                                        : row,
                                    ),
                                  },
                                },
                                `规则已${rule.enabled ? '停用' : '启用'}。`,
                              )
                            }
                          >
                            {rule.enabled ? '停用' : '启用'}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={disabled}
                            onClick={() => {
                              setFormError('');
                              setDeleteTarget({
                                kind: 'rule',
                                id: rule.id,
                                name: rule.name,
                              });
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {!config.assignment.rules.length && (
                    <tr>
                      <td colSpan={6} className="routing-empty">
                        暂无条件分配规则，将使用已保存的默认服务流程。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <Dialog
        open={!!ruleDraft}
        onOpenChange={(open) => {
          if (!open && !busy) setRuleDraft(undefined);
        }}
      >
        <DialogContent
          className="submission-rule-dialog service-flow-dialog"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>
              {config.assignment.rules.some((rule) => rule.id === ruleDraft?.id)
                ? '编辑条件分配规则'
                : '新增条件分配规则'}
            </DialogTitle>
            <DialogDescription>
              每次针对一个服务项匹配条件，分配一个服务流程。
            </DialogDescription>
          </DialogHeader>
          {ruleDraft && (
            <form
              className="submission-rule-form"
              onSubmit={(event) => {
                event.preventDefault();
                void save(
                  {
                    ...config,
                    assignment: {
                      ...config.assignment,
                      rules: [
                        ...config.assignment.rules.filter(
                          (rule) => rule.id !== ruleDraft.id,
                        ),
                        ruleDraft,
                      ],
                    },
                  },
                  '条件分配规则已保存。',
                  true,
                );
              }}
            >
              <fieldset
                disabled={disabled}
                className="submission-rule-form-body"
              >
                <div className="routing-form-row">
                  <Field label="规则名称 *">
                    <Input
                      required
                      maxLength={120}
                      value={ruleDraft.name}
                      onChange={(event) =>
                        setRuleDraft({ ...ruleDraft, name: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="优先级 *">
                    <Input
                      required
                      type="number"
                      min={1}
                      max={9999}
                      step={1}
                      value={
                        Number.isFinite(ruleDraft.priority)
                          ? ruleDraft.priority
                          : ''
                      }
                      onChange={(event) =>
                        setRuleDraft({
                          ...ruleDraft,
                          priority:
                            event.target.value === ''
                              ? NaN
                              : Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <div className="routing-form-row">
                  <Field label="分配服务流程 *">
                    <FlowSelect
                      config={config}
                      value={ruleDraft.flowId}
                      onChange={(flowId) =>
                        setRuleDraft({ ...ruleDraft, flowId })
                      }
                    />
                  </Field>
                  <Field label="条件关系">
                    <NativeSelect
                      value={ruleDraft.match}
                      onChange={(event) =>
                        setRuleDraft({
                          ...ruleDraft,
                          match: event.target.value as 'all' | 'any',
                        })
                      }
                    >
                      <option value="all">满足全部条件（且）</option>
                      <option value="any">满足任一条件（或）</option>
                    </NativeSelect>
                  </Field>
                </div>
                <div className="service-flow-conditions">
                  {ruleDraft.conditions.map((condition, index) => (
                    <div className="service-flow-condition" key={index}>
                      <NativeSelect
                        aria-label={`条件 ${index + 1} 字段`}
                        value={condition.field}
                        onChange={(event) =>
                          setRuleDraft({
                            ...ruleDraft,
                            conditions: ruleDraft.conditions.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    field: event.target
                                      .value as FlowConditionField,
                                    value: '',
                                  }
                                : row,
                            ),
                          })
                        }
                      >
                        {Object.entries(flowConditionFields).map(
                          ([key, label]) => (
                            <option key={key} value={key}>
                              {label}
                            </option>
                          ),
                        )}
                      </NativeSelect>
                      <NativeSelect
                        aria-label={`条件 ${index + 1} 比较方式`}
                        value={condition.operator}
                        onChange={(event) =>
                          setRuleDraft({
                            ...ruleDraft,
                            conditions: ruleDraft.conditions.map((row, i) =>
                              i === index
                                ? {
                                    ...row,
                                    operator: event.target.value as 'eq' | 'ne',
                                  }
                                : row,
                            ),
                          })
                        }
                      >
                        <option value="eq">等于</option>
                        <option value="ne">不等于</option>
                      </NativeSelect>
                      <NativeSelect
                        required
                        aria-label={`条件 ${index + 1} 值`}
                        value={condition.value}
                        onChange={(event) =>
                          setRuleDraft({
                            ...ruleDraft,
                            conditions: ruleDraft.conditions.map((row, i) =>
                              i === index
                                ? { ...row, value: event.target.value }
                                : row,
                            ),
                          })
                        }
                      >
                        <option value="">请选择</option>
                        {conditionOptions(condition.field, dictionary).map(
                          (option) => (
                            <option key={option.id} value={option.id}>
                              {option.name}
                            </option>
                          ),
                        )}
                      </NativeSelect>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`删除条件 ${index + 1}`}
                        disabled={ruleDraft.conditions.length === 1}
                        onClick={() =>
                          setRuleDraft({
                            ...ruleDraft,
                            conditions: ruleDraft.conditions.filter(
                              (_, i) => i !== index,
                            ),
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={ruleDraft.conditions.length >= 20}
                    onClick={() =>
                      setRuleDraft({
                        ...ruleDraft,
                        conditions: [
                          ...ruleDraft.conditions,
                          { field: 'method', operator: 'eq', value: '' },
                        ],
                      })
                    }
                  >
                    <Plus size={16} />
                    添加条件
                  </Button>
                </div>
                <label className="service-flow-checkbox">
                  <input
                    type="checkbox"
                    checked={ruleDraft.enabled}
                    onChange={(event) =>
                      setRuleDraft({
                        ...ruleDraft,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  启用规则
                </label>
                {formError && (
                  <p className="sr-error" role="alert">
                    {formError}
                  </p>
                )}
              </fieldset>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRuleDraft(undefined)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={disabled}>
                  {busy ? '正在保存…' : '保存规则'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(undefined);
        }}
      >
        <DialogContent className="submission-rule-dialog">
          <DialogHeader>
            <DialogTitle>
              删除{deleteTarget?.kind === 'flow' ? '服务流程' : '分配规则'}
            </DialogTitle>
            <DialogDescription>
              确认删除「{deleteTarget?.name}
              」？被默认分配或条件规则引用的流程不可删除。
            </DialogDescription>
          </DialogHeader>
          <div className="submission-rule-form">
            <div className="submission-rule-form-body">
              {formError && (
                <p className="sr-error" role="alert">
                  {formError}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setDeleteTarget(undefined)}
              >
                取消
              </Button>
              <Button
                variant="destructive"
                disabled={disabled}
                onClick={() => {
                  if (deleteTarget)
                    void save(
                      deleteTarget.kind === 'flow'
                        ? {
                            ...config,
                            flows: config.flows.filter(
                              (flow) => flow.id !== deleteTarget.id,
                            ),
                          }
                        : {
                            ...config,
                            assignment: {
                              ...config.assignment,
                              rules: config.assignment.rules.filter(
                                (rule) => rule.id !== deleteTarget.id,
                              ),
                            },
                          },
                      '已删除。',
                      true,
                    );
                }}
              >
                确认删除
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={preview} onOpenChange={setPreview}>
        <DialogContent className="submission-rule-dialog service-flow-dialog">
          <DialogHeader>
            <DialogTitle>服务流程分配预览</DialogTitle>
            <DialogDescription>
              根据已保存的配置模拟分配，不修改项目、工单或执行记录。
            </DialogDescription>
          </DialogHeader>
          <div className="submission-rule-form">
            <div className="submission-rule-form-body">
              <Field label="选择项目服务项">
                <NativeSelect
                  value={sampleId}
                  onChange={(event) => {
                    setSampleId(event.target.value);
                    setContext(
                      samples.find((row) => row.id === event.target.value)
                        ?.context ?? emptyContext(),
                    );
                  }}
                >
                  <option value="">手动填写预览条件</option>
                  {samples.map((sample) => (
                    <option key={sample.id} value={sample.id}>
                      {sample.label}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <div className="routing-form-row">
                {(Object.keys(flowConditionFields) as FlowConditionField[]).map(
                  (field) => (
                    <Field key={field} label={flowConditionFields[field]}>
                      <NativeSelect
                        value={context[field]}
                        onChange={(event) => {
                          const value = event.target.value;
                          setSampleId('');
                          setContext({
                            ...context,
                            [field]: value,
                            ...(field === 'customerId'
                              ? {
                                  customerTeam:
                                    dictionary.customers.find(
                                      (customer) => customer.id === value,
                                    )?.team ?? '',
                                }
                              : {}),
                          });
                        }}
                      >
                        <option value="">未填写</option>
                        {context[field] &&
                          !conditionOptions(field, dictionary).some(
                            (option) => option.id === context[field],
                          ) && (
                            <option value={context[field]}>
                              {context[field]}（历史值）
                            </option>
                          )}
                        {conditionOptions(field, dictionary).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  ),
                )}
              </div>
              <p className="sr-help">
                未填写的字段不命中相关条件，包括“不等于”条件。
              </p>
              <section className="service-flow-result" aria-live="polite">
                <strong>
                  {result.flow
                    ? `分配流程：${result.flow.name}`
                    : '未分配服务流程'}
                </strong>
                <p>
                  {result.rule
                    ? `命中规则「${result.rule.name}」，优先级 ${result.rule.priority}。`
                    : result.flow
                      ? '未命中启用的条件规则，使用默认服务流程。'
                      : '未命中启用的条件规则，且尚未设置默认服务流程。'}
                </p>
                {result.flow && (
                  <ol className="service-flow-step-summary">
                    {result.steps.map((step) => (
                      <li key={step.id}>
                        <strong>{step.name}</strong>
                        {` · ${serviceStepTypes[step.type]} · ${step.required ? '必须完成' : '可选完成'} · ${step.deliverToCustomer ? '交付客户' : '内部使用'}`}
                        {step.subtitle && <p>{step.subtitle}</p>}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section>
                <strong>规则匹配明细</strong>
                {!result.trace.length && (
                  <p className="sr-help">暂无条件规则。</p>
                )}
                {result.trace.map((row) => (
                  <details className="service-flow-trace" key={row.rule.id}>
                    <summary>
                      {row.rule.priority} · {row.rule.name}
                      <span>
                        {!row.rule.enabled
                          ? '已停用'
                          : !row.available
                            ? '流程不可用'
                            : row.rule.id === result.rule?.id
                              ? '已选中'
                              : row.matched
                                ? '命中，优先级较低'
                                : '未命中'}
                      </span>
                    </summary>
                    <p className="sr-help">
                      {row.rule.match === 'all'
                        ? '满足全部条件'
                        : '满足任一条件'}
                    </p>
                    {row.conditions.map((condition, index) => (
                      <p key={index}>
                        {condition.matched ? '✓' : '—'}{' '}
                        {flowConditionLabel(condition, dictionary)} ·{' '}
                        {condition.actual
                          ? condition.matched
                            ? '符合'
                            : '不符合'
                          : '未填写'}
                      </p>
                    ))}
                  </details>
                ))}
              </section>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(false)}>
                关闭预览
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
