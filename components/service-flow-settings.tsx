'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import {
  stepDocuments,
  stepFiles,
  stepDeliverySummary,
} from '@/lib/service-step-deliverables';
import { disabledServiceFlowRecords } from '@/lib/service-flow-history';
import { ServiceFlowScopeSelect } from '@/components/service-flow-scope-select';
import { ServiceFlowDesigner } from '@/components/service-flow-designer';
import { newServiceFlowStep, serviceStepTypes } from '@/lib/service-flow-steps';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  parseServiceFlowPredicate,
  serviceFlowConditionGroups,
  validateServiceFlowLanguage,
} from '@/lib/service-flow-conditions';
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
  flowConditionLabel,
  resolveServiceFlow,
  sortedFlowRules,
  validateServiceFlowScope,
  serviceFlowScopeLabel,
  type ServiceFlow,
  type ServiceFlowConfig,
  type ServiceFlowHistory,
  type ServiceFlowRule,
} from '@/lib/service-flows';

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
  allowNew = false,
}: {
  config: ServiceFlowConfig;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  allowNew?: boolean;
}) {
  return (
    <NativeSelect
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">请选择服务流程</option>
      {allowNew && <option value="__new__">新建并配置服务流程</option>}
      {config.flows.map((flow) => (
        <option key={flow.id} value={flow.id} disabled={!flow.enabled}>
          {flow.name}
          {!flow.enabled && '（已停用）'}
        </option>
      ))}
    </NativeSelect>
  );
}
export function ServiceFlowSettings({ actor }: { actor: OperationActor }) {
  const [data, setData] =
    useState<Awaited<ReturnType<typeof readServiceFlowData>>>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [flowDraft, setFlowDraft] = useState<ServiceFlow>(),
    [ruleDraft, setRuleDraft] = useState<ServiceFlowRule>();
  const [formError, setFormError] = useState('');
  const [historyTarget, setHistoryTarget] = useState<ServiceFlowHistory>();
  const [pendingRule, setPendingRule] = useState<ServiceFlowRule>();
  const [testResult, setTestResult] = useState<{
    key: string;
    summary: string;
    matched: number;
    selected: number;
    total: number;
  }>();
  const [editingDefault, setEditingDefault] = useState(false);
  const [sampleId, setSampleId] = useState('');
  const lock = useRef(false);
  const config = data?.config ?? emptyServiceFlowConfig();
  const activeRules = config.assignment.rules.filter((rule) => rule.enabled);
  const archivedRecords = disabledServiceFlowRecords(config);
  const dictionary = data?.dictionary ?? { customers: [], services: [] };
  const allowed = canManageRouting(actor),
    disabled = busy || !data || !allowed;
  useEffect(() => {
    let active = true;
    void readServiceFlowData()
      .then((next) => {
        if (active) {
          setData(next);
        }
      })
      .catch((issue) => {
        if (active) setError(message(issue));
      });
    return () => {
      active = false;
    };
  }, []);
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

      setFlowDraft(undefined);
      setRuleDraft(undefined);
      setNotice(success);
      return saved;
    } catch (issue) {
      (dialog ? setFormError : setError)(message(issue));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function editFlow(flow?: ServiceFlow, asDefault = false) {
    setEditingDefault(asDefault);
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
    setTestResult(undefined);
    setRuleDraft(
      rule
        ? {
            ...structuredClone(rule),
            naturalLanguage: {
              requirement:
                rule.naturalLanguage?.requirement ?? describeRule(rule),
            },
          }
        : {
            id: crypto.randomUUID(),
            name: '',
            priority: Math.min(
              9999,
              Math.max(0, ...activeRules.map((row) => row.priority)) + 10,
            ),
            enabled: true,
            match: 'all',
            conditions: [],
            naturalLanguage: { requirement: '' },
            flowId: '__new__',
            serviceScope: { mode: 'all', serviceIds: [] },
          },
    );
  }
  function describeRule(rule: ServiceFlowRule) {
    return (
      serviceFlowConditionGroups(rule)
        .map(
          (group) =>
            `（${group.map((condition) => flowConditionLabel(condition, dictionary)).join('，且')}）`,
        )
        .join('，或') || '尚未生成有效执行条件'
    );
  }
  function testKey(rule: ServiceFlowRule) {
    return JSON.stringify([
      rule.naturalLanguage?.requirement.trim(),
      rule.priority,
      rule.enabled,
      rule.flowId,
      rule.serviceScope ?? { mode: 'all', serviceIds: [] },
    ]);
  }
  function ruleIssue(rule: ServiceFlowRule) {
    try {
      validateServiceFlowScope(rule, dictionary);
    } catch (issue) {
      return message(issue);
    }
    if (!rule.name.trim()) return '请填写规则名称。';
    if (
      !Number.isInteger(rule.priority) ||
      rule.priority < 1 ||
      rule.priority > 9999
    )
      return '优先级须为 1–9999 的整数。';
    if (
      config.assignment.rules.some(
        (row) =>
          row.enabled &&
          rule.enabled &&
          row.id !== rule.id &&
          row.priority === rule.priority,
      )
    )
      return '优先级重复，请使用其他数字。';
    if (!rule.flowId) return '请选择或新建服务流程。';
    return '';
  }
  async function translate() {
    if (!ruleDraft || disabled || lock.current) return;
    const issue = ruleIssue(ruleDraft);
    if (issue) {
      setFormError(issue);
      return;
    }
    lock.current = true;
    setBusy(true);
    setFormError('');
    setTestResult(undefined);
    const candidate = {
      ...ruleDraft,
      naturalLanguage: {
        requirement: ruleDraft.naturalLanguage?.requirement ?? '',
      },
    };
    setRuleDraft(candidate);
    try {
      const latest = await readServiceFlowData();
      if (latest.config.revision !== config.revision)
        throw new Error('配置已更新，请关闭编辑窗口并重新加载后再测试。');
      const response = await fetch('/api/assessment-routing/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({
          requirement: candidate.naturalLanguage.requirement,
          dictionary: latest.dictionary,
          purpose: 'service-flow',
        }),
      });
      const result = (await response.json()) as {
        compiled?: unknown;
        error?: string;
      };
      if (!response.ok || result.error)
        throw new Error(result.error || '转译失败，请重试。');
      const compiled = parseServiceFlowPredicate(
        result.compiled,
        latest.dictionary,
      );
      const tested: ServiceFlowRule = {
        ...candidate,
        conditions: [],
        naturalLanguage: {
          ...candidate.naturalLanguage,
          compiled,
          testedRequirement: candidate.naturalLanguage.requirement.trim(),
        },
      };
      const sampleContexts = latest.projects.flatMap((project) =>
        (project.items ?? []).map((item) => ({
          customerId: project.customerId,
          customerTeam:
            latest.dictionary.customers.find(
              (customer) => customer.id === project.customerId,
            )?.team ?? '',
          serviceId: item.serviceId,
          method: item.method,
        })),
      );
      const previewFlow: ServiceFlow = {
        id: '__new__',
        name: '新服务流程',
        description: '',
        enabled: true,
        steps: [newServiceFlowStep(1)],
      };
      const trial = {
        ...latest.config,
        flows: [...latest.config.flows, previewFlow],
        assignment: {
          ...latest.config.assignment,
          rules: [
            ...latest.config.assignment.rules.filter(
              (row) => row.id !== tested.id,
            ),
            tested,
          ],
        },
      };
      const matches = sampleContexts.filter(
        (context) =>
          resolveServiceFlow(trial, context).trace.find(
            (row) => row.rule.id === tested.id,
          )?.matched,
      );
      setRuleDraft(tested);
      setTestResult({
        key: testKey(tested),
        summary: `适用服务目录：${serviceFlowScopeLabel(tested, latest.dictionary)}；${describeRule(tested)}`,
        total: sampleContexts.length,
        matched: matches.length,
        selected: matches.filter(
          (context) =>
            resolveServiceFlow(trial, context).rule?.id === tested.id,
        ).length,
      });
    } catch (issue) {
      setFormError(message(issue));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveRule(configure: boolean) {
    if (!ruleDraft || disabled || lock.current) return;
    const issue = ruleIssue(ruleDraft);
    if (issue) {
      setFormError(issue);
      return;
    }
    if (!testResult || testResult.key !== testKey(ruleDraft)) {
      setFormError('请先转译并测试当前条件，再保存规则。');
      return;
    }
    try {
      validateServiceFlowLanguage(ruleDraft, dictionary);
    } catch (issue) {
      setFormError(message(issue));
      return;
    }
    if (ruleDraft.flowId === '__new__') {
      const flow: ServiceFlow = {
        id: crypto.randomUUID(),
        name: ruleDraft.name.trim(),
        description: '',
        enabled: true,
        steps: [newServiceFlowStep(1)],
      };
      if (config.flows.some((row) => row.name === flow.name))
        flow.name += '（新流程）';
      setPendingRule({ ...ruleDraft, flowId: flow.id });
      setFlowDraft(flow);
      return;
    }
    const saved = await save(
      {
        ...config,
        assignment: {
          ...config.assignment,
          rules: [
            ...config.assignment.rules.filter((row) => row.id !== ruleDraft.id),
            ruleDraft,
          ],
        },
      },
      '条件分配规则已保存。',
      true,
    );
    if (saved && configure)
      setFlowDraft(
        structuredClone(
          saved.flows.find((flow) => flow.id === ruleDraft.flowId)!,
        ),
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
  const sample = samples.find((row) => row.id === sampleId);
  const result = sample
    ? resolveServiceFlow(config, sample.context)
    : undefined;

  if (historyTarget)
    return (
      <ServiceFlowDesigner
        key={historyTarget.id}
        initialFlow={historyTarget.flow}
        config={config}
        actor={actor}
        readonly
        onBack={() => setHistoryTarget(undefined)}
        onSaved={() => {}}
      />
    );

  if (flowDraft)
    return (
      <ServiceFlowDesigner
        key={flowDraft.id}
        initialFlow={flowDraft}
        config={
          pendingRule
            ? {
                ...config,
                assignment: {
                  ...config.assignment,
                  rules: [
                    ...config.assignment.rules.filter(
                      (rule) => rule.id !== pendingRule.id,
                    ),
                    pendingRule,
                  ],
                },
              }
            : editingDefault
              ? {
                  ...config,
                  assignment: {
                    ...config.assignment,
                    defaultFlowId: flowDraft.id,
                  },
                }
              : config
        }
        actor={actor}
        onBack={() => {
          setFlowDraft(undefined);
          setPendingRule(undefined);
          setEditingDefault(false);
        }}
        onSaved={(saved) => {
          setData((current) => current && { ...current, config: saved });

          if (pendingRule) {
            setRuleDraft(undefined);
            setPendingRule(undefined);
          }
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
      <section className="routing-default">
        <div>
          <strong>默认服务流程</strong>
        </div>
        <div className="routing-inline service-flow-default">
          <span className="sr-help">
            {config.flows.find(
              (flow) => flow.id === config.assignment.defaultFlowId,
            )?.name || '尚未配置'}
          </span>
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() =>
              editFlow(
                config.flows.find(
                  (flow) => flow.id === config.assignment.defaultFlowId,
                ),
                true,
              )
            }
          >
            配置流程
          </Button>
        </div>
      </section>
      <section className="routing-rules" aria-label="条件分配规则">
        <div className="submission-rules-toolbar">
          <div>
            <strong>条件分配规则</strong>
          </div>
          <div className="routing-inline">
            <Button disabled={disabled} onClick={() => editRule()}>
              <Plus size={16} />
              新增规则
            </Button>
          </div>
        </div>
        <div className="table-scroll">
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>优先级</th>
                <th>规则名称</th>
                <th>适用服务目录</th>
                <th>自然语言描述</th>
                <th>分配流程</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {sortedFlowRules(activeRules).map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.priority}</td>
                  <td>{rule.name}</td>
                  <td>{serviceFlowScopeLabel(rule, dictionary)}</td>
                  <td>
                    <p>
                      {rule.naturalLanguage?.requirement ?? describeRule(rule)}
                    </p>
                    <details>
                      <summary>查看执行条件</summary>
                      <p>{describeRule(rule)}</p>
                    </details>
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
                        编辑条件
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={disabled}
                        onClick={() =>
                          editFlow(
                            config.flows.find(
                              (flow) => flow.id === rule.flowId,
                            ),
                          )
                        }
                      >
                        配置服务流程
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
                                    ? { ...row, enabled: false }
                                    : row,
                                ),
                              },
                            },
                            '规则已停用。',
                          )
                        }
                      >
                        停用
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {!activeRules.length && (
                <tr>
                  <td colSpan={7} className="routing-empty">
                    暂无条件分配规则，将使用已保存的默认服务流程。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <details
        className="routing-rules disabled-rule-versions"
        aria-label="条件分配规则（已停用）"
      >
        <summary className="submission-rules-toolbar">
          <strong>条件分配规则（已停用）</strong>
        </summary>
        <div className="table-scroll">
          <table className="reference-table app-list-table">
            <thead>
              <tr>
                <th>类型 / 规则名称</th>
                <th>适用服务目录</th>
                <th>分配条件</th>
                <th>历史服务流程</th>
                <th>停用原因</th>
                <th>停用时间 / 操作人</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {archivedRecords.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <span className="rule-version-status">
                      {entry.kind === 'default' ? '历史默认规则' : '条件规则'}
                    </span>
                    {entry.rule && (
                      <p>
                        {entry.name} · 优先级 {entry.rule.priority}
                      </p>
                    )}
                  </td>
                  <td>
                    {entry.rule
                      ? serviceFlowScopeLabel(entry.rule, dictionary)
                      : '全部服务目录'}
                  </td>
                  <td>
                    {entry.rule ? (
                      <>
                        <p>
                          {entry.rule.naturalLanguage?.requirement ??
                            describeRule(entry.rule)}
                        </p>
                        <details>
                          <summary>查看执行条件</summary>
                          <p>{describeRule(entry.rule)}</p>
                        </details>
                      </>
                    ) : (
                      '未命中任何启用的条件规则时使用'
                    )}
                  </td>
                  <td>
                    <strong>{entry.flow.name}</strong>
                    <p className="sr-help">
                      {entry.flow.steps.length} 个步骤 · 历史快照
                    </p>
                  </td>
                  <td>{entry.reason}</td>
                  <td>
                    {entry.disabledAt
                      ? new Date(entry.disabledAt).toLocaleString('zh-CN', {
                          hour12: false,
                        })
                      : '时间未记录'}
                    <p className="sr-help">
                      {entry.disabledBy ?? '操作人未记录'}
                    </p>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => setHistoryTarget(entry)}
                    >
                      查看流程
                    </Button>
                  </td>
                </tr>
              ))}
              {!archivedRecords.length && (
                <tr>
                  <td colSpan={7} className="routing-empty">
                    {data
                      ? '暂无已停用规则。更换默认流程后，原默认规则也会保留在这里。'
                      : '正在读取配置…'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </details>

      <section className="routing-preview" aria-label="分配预览">
        <strong>分配预览</strong>
        <NativeSelect
          aria-label="预览项目服务项"
          value={sampleId}
          onChange={(event) => setSampleId(event.target.value)}
          disabled={!data || busy}
        >
          <option value="">
            {samples.length ? '选择项目服务项' : '暂无可预览的项目服务项'}
          </option>
          {samples.map((sample) => (
            <option key={sample.id} value={sample.id}>
              {sample.label}
            </option>
          ))}
        </NativeSelect>
        {sample && result && (
          <div className="routing-preview-result">
            <p className="sr-help">
              根据已保存的配置预览，不修改项目、工单或执行记录。
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
                      {` · ${serviceStepTypes[step.type]} · ${step.required ? '必须完成' : '可选完成'}${stepDeliverySummary(step) ? ` · ${stepDeliverySummary(step)}` : ''}`}
                      {(step.type === 'document' || step.type === 'upload') && (
                        <ul>
                          {(step.type === 'document'
                            ? stepDocuments(step)
                            : stepFiles(step)
                          ).map((item) => (
                            <li key={item.id}>
                              {item.name} · {item.required ? '必填' : '选填'} ·{' '}
                              {item.deliverToCustomer ? '交付客户' : '内部使用'}
                            </li>
                          ))}
                        </ul>
                      )}
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
                          : !row.scopeMatched
                            ? '不适用该服务目录'
                            : row.rule.id === result.rule?.id
                              ? '已选中'
                              : row.matched
                                ? '命中，优先级较低'
                                : '未命中'}
                    </span>
                  </summary>
                  <p className="sr-help">
                    适用服务目录：
                    {serviceFlowScopeLabel(row.rule, dictionary)} ·{' '}
                    {row.scopeMatched ? '目录范围符合' : '目录范围不符合'}
                  </p>
                  <p className="sr-help">
                    满足任一条件组；组内需满足全部条件。
                  </p>
                  {row.groups.map((group, groupIndex) => (
                    <div key={groupIndex}>
                      <strong>条件组 {groupIndex + 1}</strong>
                      {group.map((condition, index) => (
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
                    </div>
                  ))}
                </details>
              ))}
            </section>
          </div>
        )}
      </section>

      <Dialog
        open={!!ruleDraft}
        onOpenChange={(open) => {
          if (!open && !busy) setRuleDraft(undefined);
        }}
      >
        <DialogContent
          className="submission-rule-dialog service-flow-dialog service-flow-rule-dialog"
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
                void saveRule(false);
              }}
            >
              <div className="submission-rule-form-body">
                <fieldset
                  disabled={disabled}
                  className="service-flow-rule-fields"
                >
                  <div className="routing-form-row">
                    <Field label="规则名称 *">
                      <Input
                        required
                        maxLength={120}
                        value={ruleDraft.name}
                        onChange={(event) =>
                          setRuleDraft({
                            ...ruleDraft,
                            name: event.target.value,
                          })
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
                  <Field label="分配服务流程 *">
                    <FlowSelect
                      allowNew
                      config={config}
                      value={ruleDraft.flowId}
                      onChange={(flowId) => {
                        setRuleDraft({ ...ruleDraft, flowId });
                        setTestResult(undefined);
                      }}
                    />
                  </Field>
                  <ServiceFlowScopeSelect
                    value={ruleDraft.serviceScope}
                    dictionary={dictionary}
                    onChange={(serviceScope) => {
                      setRuleDraft({ ...ruleDraft, serviceScope });
                      setTestResult(undefined);
                      setFormError('');
                    }}
                  />
                  <Field label="自然语言描述 *">
                    <Textarea
                      required
                      rows={4}
                      maxLength={4000}
                      value={ruleDraft.naturalLanguage?.requirement ?? ''}
                      onChange={(event) => {
                        setRuleDraft({
                          ...ruleDraft,
                          naturalLanguage: { requirement: event.target.value },
                        });
                        setTestResult(undefined);
                        setFormError('');
                      }}
                      placeholder="例如：客户负责团队为金融，且服务方式为现场"
                    />
                  </Field>
                  <p className="sr-help">
                    支持客户、客户负责团队、服务项、服务方式，以及“且 / 或 /
                    不等于”。每次只匹配当前服务项；客户和服务请填写完整名称。
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={
                      busy || !ruleDraft.naturalLanguage?.requirement.trim()
                    }
                    onClick={() => void translate()}
                  >
                    {busy ? '正在转译并测试…' : 'AI 转译并测试'}
                  </Button>
                  {testResult && testResult.key === testKey(ruleDraft) && (
                    <div className="submission-rule-test-result">
                      <strong>实际执行条件</strong>
                      <p>{testResult.summary}</p>
                      <p>
                        当前 {testResult.total} 个项目服务项样本中，
                        {testResult.matched} 个符合条件；按优先级实际选中{' '}
                        {testResult.selected} 个。
                      </p>
                      {!testResult.total && (
                        <p>暂无项目服务项样本，请核对执行条件后保存。</p>
                      )}
                      <p>
                        多条规则命中时，采用数字最小的优先级；未命中使用默认服务流程。
                      </p>
                    </div>
                  )}
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
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setRuleDraft(undefined)}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={
                    disabled ||
                    ruleDraft.flowId === '__new__' ||
                    !testResult ||
                    testResult.key !== testKey(ruleDraft)
                  }
                >
                  保存规则
                </Button>
                <Button
                  type="button"
                  disabled={
                    disabled ||
                    !testResult ||
                    testResult.key !== testKey(ruleDraft)
                  }
                  onClick={(event) => {
                    if (event.currentTarget.form?.reportValidity())
                      void saveRule(true);
                  }}
                >
                  保存并配置服务流程
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
