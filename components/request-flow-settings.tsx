'use client';
import { useI18n } from '@/lib/i18n/context';


import { useEffect, useRef, useState } from 'react';
import { HardwareAssessmentTriggerSettings } from '@/components/hardware-assessment-trigger-settings';
import {
  hardwareItems,
  matchesHardwareTrigger,
  parseHardwareAssessmentTrigger,
} from '@/lib/hardware-assessment-trigger';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RuleDisableDialog } from '@/components/rule-disable-dialog';
import { DisabledRuleVersions } from '@/components/disabled-rule-versions';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { UserSearchSelect } from '@/components/user-search-select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  emptyRoutingConfig,
  routingUsers,
  parseRoutePredicate,
  describeRoute,
  matchesRoute,
  routesOverlap,
  type RoutingRole,
  type RoutingRule,
  type RoutingPolicy,
} from '@/lib/assessment-routing-schema';
import {
  canManageRouting,
  readRoutingData,
  saveRoutingPolicy,
  routingTestKey,
  type TestedRouting,
} from '@/lib/assessment-routing-store';
import { resolveAssessmentRoute } from '@/lib/assessment-routing';
import type { OperationActor } from '@/lib/request-operations';

type Data = Awaited<ReturnType<typeof readRoutingData>>;
export function RequestFlowSettings({
  role,
  actor,
}: {
  role: RoutingRole;
  actor: OperationActor;
}) {
  const { localize, localizeMessage } = useI18n();
  const [data, setData] = useState<Data>({
    config: emptyRoutingConfig(),
    workspace: { users: [], customers: [], services: [] },
    requests: [],
  });
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [disableTarget, setDisableTarget] = useState<{ rule: RoutingRule; revision: number }>();
  const [defaultUserId, setDefaultUserId] = useState('');
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState<RoutingRule>();
  const [requirement, setRequirement] = useState(''),
    [priority, setPriority] = useState('10'),
    [userId, setUserId] = useState('');
  const [tested, setTested] = useState<TestedRouting>(),
    [formError, setFormError] = useState('');
  const [sampleId, setSampleId] = useState('');
  const editorRevision = useRef(0);
  const dialogActive = useRef(false);
  const lock = useRef(false),
    policy = data.config[role],
    eligible = routingUsers(data.workspace.users, role),
    canManage = canManageRouting(actor);
  const activeRules = policy.rules.filter(rule => rule.enabled);
  const disabledVersions = policy.rules.flatMap(rule => [
    ...(!rule.enabled ? [{ ...rule, archivedAt: rule.updatedAt, archivedBy: rule.updatedBy }] : []),
    ...(rule.history ?? []),
  ]).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  const definition = { requirement, priority: Number(priority), userId },
    testCurrent = tested?.key === routingTestKey(definition);
  const hardwareTrigger = parseHardwareAssessmentTrigger(
    data.config.hardware.trigger,
  );
  const samples = data.requests.filter(
    (request) =>
      request.status !== '草稿' &&
      (role === 'manager' ||
        hardwareItems(request).length > 0 ||
        matchesHardwareTrigger(request, hardwareTrigger)),
  );
  const sample = samples.find((r) => r.id === sampleId);
  const preview = sample
    ? resolveAssessmentRoute(
        sample,
        role,
        data.config,
        data.workspace.users,
        undefined,
        data.workspace.customers,
      )
    : undefined;
  const current = sample?.operations?.assessment?.routing?.[role];
  const overlaps =
    tested && testCurrent
      ? policy.rules.filter(
          (r) =>
            r.enabled &&
            r.id !== target?.id &&
            routesOverlap(
              r.compiled,
              tested.compiled,
              role,
              role === 'hardware' ? hardwareTrigger : undefined,
            ),
        )
      : [];
  const duplicate = policy.rules.some(
    (r) => r.enabled && r.id !== target?.id && r.priority === Number(priority),
  );
  const contradiction =
    tested &&
    testCurrent &&
    !routesOverlap(tested.compiled, tested.compiled, role);
  const sampleMatches =
    tested && testCurrent
      ? samples.filter(
          (r) =>
            (role !== 'hardware' ||
              matchesHardwareTrigger(r, hardwareTrigger)) &&
            matchesRoute(r, tested.compiled, data.workspace.customers),
        )
      : [];
  const personName = (id: string) =>
    data.workspace.users.find((u) => u.id === id)?.name ?? id;
  useEffect(() => {
    let active = true;
    const load = () => {
      if (lock.current || dialogActive.current) return;
      void readRoutingData()
        .then((latest) => {
          if (active) {
            setData(latest);
            setDefaultUserId(latest.config[role].defaultUserId);
            setReady(true);
            setError('');
          }
        })
        .catch(() => {
          if (active) {
            setReady(false);
            setError('分配配置读取失败，请刷新重试。');
          }
        });
    };
    load();
    window.addEventListener('focus', load);
    window.addEventListener('assessment-routing-saved', load);
    return () => {
      active = false;
      window.removeEventListener('focus', load);
      window.removeEventListener('assessment-routing-saved', load);
    };
  }, [role]);
  async function run(action: () => Promise<void>, inForm = false) {
    if (lock.current || !ready || !canManage) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setFormError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      (inForm ? setFormError : setError)(
        e instanceof Error ? e.message : '操作失败，请重试。',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function persistPolicy(next: RoutingPolicy, receipt?: TestedRouting, expectedRevision = data.config.revision) {
    const config = await saveRoutingPolicy(
      actor,
      role,
      next,
      receipt ? editorRevision.current : expectedRevision,
      receipt,
    );
    setData((previous) => ({ ...previous, config }));
    setDefaultUserId(config[role].defaultUserId);
    window.dispatchEvent(new Event('assessment-routing-saved'));
    setNotice(
      '配置已保存。新提交时采用当前触发条件；已有请求保留本轮条件和负责人。',
    );
  }
  function edit(rule?: RoutingRule) {
    editorRevision.current = data.config.revision;
    dialogActive.current = true;
    setTarget(rule);
    setRequirement(rule?.requirement ?? '');
    setPriority(
      String(
        rule?.priority ??
          Math.min(
            9999,
            Math.max(0, ...policy.rules.map((r) => r.priority)) + 10,
          ),
      ),
    );
    setUserId(rule?.userId ?? policy.defaultUserId);
    setTested(undefined);
    setFormError('');
    setOpen(true);
  }
  function invalidate() {
    setTested(undefined);
    setFormError('');
  }
  async function translate() {
    await run(async () => {
      if (
        !requirement.trim() ||
        !userId ||
        !Number.isInteger(Number(priority)) ||
        Number(priority) < 1 ||
        Number(priority) > 9999
      )
        throw new Error('请填写匹配条件、负责人和有效优先级（1–9999）。');
      if (duplicate) throw new Error('启用规则的优先级不能重复。');
      setTested(undefined);
      const latest = await readRoutingData();
      if (latest.config.revision !== editorRevision.current)
        throw new Error('分配配置已变化，请关闭弹窗并刷新后重新编辑。');
      setData(latest);
      const response = await fetch('/api/assessment-routing/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({
          requirement,
          dictionary: {
            customers: latest.workspace.customers.map(({ id, name, team }) => ({
              id,
              name,
              team,
            })),
            services: latest.workspace.services.map(({ id, name }) => ({
              id,
              name,
            })),
          },
        }),
      });
      const result = (await response.json()) as {
        compiled?: unknown;
        error?: string;
      };
      if (!response.ok || result.error)
        throw new Error(result.error || '转译失败，请重试。');
      setTested({
        key: routingTestKey(definition),
        compiled: parseRoutePredicate(result.compiled, latest.workspace),
      });
    }, true);
  }
  const selector = (
    value: string,
    onChange: (id: string) => void,
    label: string,
    optional: boolean,
  ) => (
    <UserSearchSelect
      id={`${role}-${optional ? 'default' : 'assignee'}`}
      label={localize(label)}
      required={!optional}
      users={data.workspace.users}
      eligibleIds={eligible.map(user => user.id)}
      value={value}
      onChange={onChange}
      disabled={!canManage || busy || !ready}
      emptyHint={optional ? '未设置时，无法匹配的请求将待分配。' : undefined}
    />
  );
  return (
    <div className="request-flow-settings">
      {localize(error && (
        <p className="sr-error" role="alert">
          {localize(error)}
        </p>
      ))}
      {localize(notice && <output className="submission-rule-notice">{localize(notice)}</output>)}
      {localize(role === 'hardware' && (
        <HardwareAssessmentTriggerSettings
          actor={actor}
          config={data.config}
          services={data.workspace.services}
          ready={ready && !busy}
          onSaved={(config) => {
            setData((previous) => ({ ...previous, config }));
            setNotice(
              '硬件评估触发条件已保存。新提交申请生效，已有请求保持本轮流程。',
            );
          }}
        />
      ))}
      <section className="routing-default" aria-label={localize("默认负责人")}>
        <div>
          <strong>{localize("默认负责人")}</strong>
        </div>
        <div className="routing-inline routing-default-controls">
          {localize(selector(defaultUserId, setDefaultUserId, '默认负责人', true))}
          {localize(canManage && (
            <Button
              variant="outline"
              disabled={
                !ready || busy || defaultUserId === policy.defaultUserId
              }
              onClick={() =>
                void run(() => persistPolicy({ ...policy, defaultUserId }))
              }
            >
              {localize("保存")}</Button>
          ))}
        </div>
      </section>
      <section className="routing-rules" aria-label={localize("条件分配规则")}>
        <div className="submission-rules-toolbar">
          <div>
            <strong>{localize("条件分配规则")}</strong>
          </div>
          {localize(canManage && (
            <Button disabled={!ready || busy} onClick={() => edit()}>
              <Plus size={16} />
              {localize("新建规则")}</Button>
          ))}
        </div>
        <div className="table-scroll">
          <table className="reference-table app-list-table routing-table">
            <thead>
              <tr>
                <th>{localize("优先级")}</th>
                <th>{localize("自然语言描述")}</th>
                <th>{localize("分配给")}</th>
                <th>{localize("版本 / 状态")}</th>
                <th>{localize("修改时间")}</th>
                <th>{localize("修改人")}</th>
                <th data-list-actions>{localize("操作")}</th>
              </tr>
            </thead>
            <tbody>
              {localize(activeRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{localize(rule.priority)}</td>
                  <td>
                    <div className="submission-rule-requirement">
                      {localize(rule.requirement)}

                      <details>
                        <summary>{localize("查看执行条件")}</summary>
                        <p>{localize(describeRoute(rule.compiled, data.workspace))}</p>
                      </details>

                    </div>
                  </td>
                  <td>
                    {localize(personName(rule.userId))}
                    {localize(!eligible.some((u) => u.id === rule.userId) && (
                      <small className="sr-error">{localize("（不可用）")}</small>
                    ))}
                  </td>
                  <td><span className="rule-version-status" data-enabled={rule.enabled}>v{localize(rule.revision ?? 1)} · {localize(rule.enabled ? '已启用' : '已停用')}</span></td>
                  <td>{localize(rule.updatedAt ? new Date(rule.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—')}</td>
                  <td>{localize(rule.updatedBy ?? '—')}</td>
                  <td>
                    {localize(canManage ? (
                      <div className="rule-table-actions">
                        {localize(rule.enabled && <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => edit(rule)}
                        >
                          {localize("编辑")}</Button>)}
                        {localize(rule.enabled && <Button variant="ghost" disabled={busy} onClick={() => {
                          setFormError('');
                          setDisableTarget({ rule, revision: data.config.revision });
                          dialogActive.current = true;
                        }}>{localize("停用")}</Button>)}
                      </div>
                    ) : (
                      '—'
                    ))}
                  </td>
                </tr>
              )))}
              {localize(!activeRules.length && (
                <tr>
                  <td colSpan={7} className="routing-empty">
                    {localize(ready
                      ? '暂无启用的条件规则，将使用默认负责人。'
                      : '正在读取配置…')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DisabledRuleVersions targetLabel="分配给" ready={ready} versions={disabledVersions.map((version, index) => ({
        key: `${version.id}-${version.revision ?? 1}-${index}`,
        priority: version.priority,
        requirement: version.requirement,
        condition: describeRoute(version.compiled, data.workspace),
        target: personName(version.userId),
        version: version.revision ?? 1,
        disabledAt: version.archivedAt,
        disabledBy: version.archivedBy,
      }))} />
      <section className="routing-preview" aria-label={localize("分配预览")}>
        <strong>{localize("分配预览")}</strong>
        <NativeSelect
          aria-label={localize("预览服务请求")}
          value={sampleId}
          onChange={(e) => setSampleId(e.target.value)}
          disabled={!ready || busy}
        >
          <option value="">
            {localize(samples.length ? '选择服务请求' : '暂无可预览的请求')}
          </option>
          {localize(samples.map((r) => (
            <option key={r.id} value={r.id}>
              {localize(r.id)} ·{localize(' ')}
              {localize(data.workspace.customers.find((c) => c.id === r.customerId)
                ?.name ?? r.customerId)}{localize(' ')}
              · {localize(r.status)}
            </option>
          )))}
        </NativeSelect>
        {localize(sample && (preview || role === 'hardware') && (
          <div className="routing-preview-result">
            {localize(preview?.matchedBy === 'default' ? <>
              <p>{localize("未命中分配规则。")}{localize(preview.userId ? <>{localize("默认负责人：")}<strong>{localize(preview.userName)}</strong></> : !policy.defaultUserId && '未设置默认负责人，待分配。')}</p>
              {localize(!preview.userId && policy.defaultUserId && <p className="sr-error">{localize("默认负责人不存在、已停用或角色不符，待分配。")}</p>)}
            </> : <p>
              {localize("按当前规则：")}<strong>
                {localize(preview
                  ? preview.userName || '待分配'
                  : '无需硬件产品经理评估')}
              </strong>{localize(' ')}
              · {localize(preview?.reason ?? '未命中当前硬件评估触发条件。')}
            </p>)}
            <p className="sr-help">
              {localize("当前负责人：")}{localize(current
                ? current.userName || '待分配'
                : role === 'manager'
                  ? sample.operations?.assessment?.manager || '未记录分配'
                  : sample.operations?.assessment?.hardware?.reviewer ||
                    '未记录分配')}
              {localize(current &&
                localizeMessage(" · 分配于 {0}", [String(localize(new Date(current.at).toLocaleString('zh-CN', { hour12: false })))]))}
            </p>
            {localize(!!sample.operations?.assessment?.routing?.history?.filter(
              (h) => h.role === role,
            ).length && (
              <details>
                <summary>{localize("查看分配历史")}</summary>
                {localize(sample.operations.assessment.routing.history
                  .filter((h) => h.role === role)
                  .map((h) => (
                    <p key={h.allocation.id} className="sr-help">
                      {localize(h.allocation.userName || '待分配')} · {localize(h.by)}{localize("于")}{localize(new Date(h.replacedAt).toLocaleString('zh-CN', {
                        hour12: false,
                      }))}
                      {localize("调整 ·")}{localize(h.reason)}
                    </p>
                  )))}
              </details>
            ))}
          </div>
        ))}
      </section>
      <RuleDisableDialog
        open={!!disableTarget}
        requirement={disableTarget ? `v${disableTarget.rule.revision ?? 1} · ${disableTarget.rule.requirement}` : ''}
        description={localize("停用后，新请求将不再匹配此规则，已有请求的负责人保持不变。")}
        busy={busy}
        error={formError}
        onCancel={() => { setDisableTarget(undefined); setFormError(''); dialogActive.current = false; }}
        onConfirm={() => { if (disableTarget) void run(async () => {
          await persistPolicy({ ...policy, rules: policy.rules.map(item => item.id === disableTarget.rule.id ? { ...item, enabled: false } : item) }, undefined, disableTarget.revision);
          setDisableTarget(undefined);
          dialogActive.current = false;
          setNotice('分配规则已停用，已有请求的负责人保持不变。');
        }, true); }}
      />
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) {
            setOpen(value);
            dialogActive.current = value;
          }
        }}
      >
        <DialogContent className="submission-rule-dialog">
          <DialogHeader>
            <DialogTitle>
              {localize(target ? '编辑分配规则' : '新建分配规则')}
            </DialogTitle>
          </DialogHeader>
          <form
            className="submission-rule-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (!tested || !testCurrent || duplicate || contradiction)
                  throw new Error(
                    '请先转译并测试，处理无效条件及优先级重复后再保存。',
                  );
                const rule: RoutingRule = {
                  ...definition,
                  id: target?.id ?? crypto.randomUUID(),
                  compiled: tested.compiled,
                  enabled: true,
                };
                await persistPolicy(
                  {
                    ...policy,
                    rules: target
                      ? policy.rules.map((r) => (r.id === target.id ? rule : r))
                      : [...policy.rules, rule],
                  },
                  tested,
                );
                setOpen(false);
                dialogActive.current = false;
              }, true);
            }}
          >
            <div className="submission-rule-form-body">
              <label
                htmlFor={`${role}-condition`}
                className="submission-rule-field"
              >
                <span className="routing-field-heading">
                  <span>{localize("自然语言描述")}</span>
                  <em aria-hidden="true">*</em>
                </span>
                <Textarea
                  id={`${role}-condition`}
                  aria-required="true"
                  disabled={busy}
                  value={requirement}
                  maxLength={4000}
                  onChange={(e) => {
                    setRequirement(e.target.value);
                    invalidate();
                  }}
                  placeholder={localize("例如：客户所属团队为金融，且包含硬件兼容性测试")}
                />
                <small className="sr-help">
                  {localize("支持客户、客户负责团队（金融 / 商业 / 港澳 / 其他）、申请来源、服务项、服务方式，以及“且 / 或 / 不包含”。客户和服务项请使用完整名称。")}</small>
              </label>
              <div className="routing-form-row">
                <label
                  htmlFor={`${role}-priority`}
                  className="submission-rule-field"
                >
                  <span className="routing-field-heading">
                    <span>{localize("优先级")}</span>
                    <em aria-hidden="true">*</em>
                  </span>
                  <Input
                    id={`${role}-priority`}
                    aria-label={localize("优先级")}
                    aria-required="true"
                    type="number"
                    min={1}
                    max={9999}
                    step={1}
                    disabled={busy}
                    value={priority}
                    onChange={(e) => {
                      setPriority(e.target.value);
                      invalidate();
                    }}
                  />
                </label>
                <label
                  htmlFor={`${role}-assignee`}
                  className="submission-rule-field"
                >
                  <span className="routing-field-heading">
                    <span>{localize("分配给")}</span>
                    <em aria-hidden="true">*</em>
                  </span>
                  {localize(selector(
                    userId,
                    (id) => {
                      setUserId(id);
                      invalidate();
                    },
                    '规则负责人',
                    false,
                  ))}
                </label>
              </div>
              <div className="submission-rule-test-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !requirement.trim() || !userId}
                  onClick={() => void translate()}
                >
                  {localize(busy ? '处理中…' : 'AI 转译并测试')}
                </Button>
              </div>
              {localize(formError && (
                <p className="sr-error" role="alert">
                  {localize(formError)}
                </p>
              ))}
              {localize(tested && testCurrent && (
                <div className="submission-rule-test-result">
                  <strong>{localize("实际执行条件")}</strong>
                  <p>{localize(describeRoute(tested.compiled, data.workspace))}</p>
                  {localize(contradiction ? (
                    <p className="sr-error">{localize("匹配条件互相矛盾，请修改后重试。")}</p>
                  ) : (
                    <p>
                      {localize("条件检查通过。当前")}{localize(samples.length)} {localize(" 个请求样本中有")}{localize(' ')}
                      {localize(sampleMatches.length)} {localize(" 个符合条件。")}{localize(!samples.length &&
                        '尚无实际请求样本，保存前请核对上述条件。')}
                    </p>
                  ))}
                  {localize(duplicate && (
                    <p className="sr-error">{localize("优先级重复，请修改。")}</p>
                  ))}
                  {localize(overlaps.map((r) => (
                    <p key={r.id}>
                      {localize("可能与优先级")}{localize(r.priority)} {localize(" 的规则同时命中，将先执行优先级")}{localize(' ')}
                      {localize(Math.min(r.priority, Number(priority)))}。
                      {localize(JSON.stringify(r.compiled) ===
                      JSON.stringify(tested.compiled)
                        ? '两条规则条件相同，后执行的规则不会获得分配。'
                        : '')}
                    </p>
                  )))}
                  {localize(!!sampleMatches.length && (
                    <details>
                      <summary>{localize("查看命中样本与分配结果")}</summary>
                      {localize(sampleMatches.slice(0, 10).map((sample) => {
                        const rule = {
                          ...definition,
                          id: target?.id ?? '__preview__',
                          compiled: tested.compiled,
                          enabled: true,
                        };
                        const config = {
                          ...data.config,
                          [role]: {
                            ...policy,
                            rules: [
                              ...policy.rules.filter(
                                (r) => r.id !== target?.id,
                              ),
                              rule,
                            ],
                          },
                        };
                        const result = resolveAssessmentRoute(
                          sample,
                          role,
                          config,
                          data.workspace.users,
                          undefined,
                          data.workspace.customers,
                        );
                        return (
                          <p key={sample.id}>
                            {localize(sample.id)} → {localize(result?.userName || '待分配')} ·{localize(' ')}
                            {localize(result?.reason)}
                          </p>
                        );
                      }))}
                      {localize(sampleMatches.length > 10 && <p>{localize("仅展示前 10 个样本。")}</p>)}
                    </details>
                  ))}
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  dialogActive.current = false;
                }}
              >
                {localize("取消")}</Button>
              <Button
                type="submit"
                disabled={busy || !testCurrent || duplicate || !!contradiction}
              >
                {localize("保存规则")}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
