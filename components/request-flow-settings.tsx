'use client';

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
      label={label}
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
      {error && (
        <p className="sr-error" role="alert">
          {error}
        </p>
      )}
      {notice && <output className="submission-rule-notice">{notice}</output>}
      {role === 'hardware' && (
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
      )}
      <section className="routing-default" aria-label="默认负责人">
        <div>
          <strong>默认负责人</strong>
        </div>
        <div className="routing-inline routing-default-controls">
          {selector(defaultUserId, setDefaultUserId, '默认负责人', true)}
          {canManage && (
            <Button
              variant="outline"
              disabled={
                !ready || busy || defaultUserId === policy.defaultUserId
              }
              onClick={() =>
                void run(() => persistPolicy({ ...policy, defaultUserId }))
              }
            >
              保存
            </Button>
          )}
        </div>
      </section>
      <section className="routing-rules" aria-label="条件分配规则">
        <div className="submission-rules-toolbar">
          <div>
            <strong>条件分配规则</strong>
          </div>
          {canManage && (
            <Button disabled={!ready || busy} onClick={() => edit()}>
              <Plus size={16} />
              新建规则
            </Button>
          )}
        </div>
        <div className="table-scroll">
          <table className="reference-table app-list-table routing-table">
            <thead>
              <tr>
                <th>优先级</th>
                <th>自然语言描述</th>
                <th>分配给</th>
                <th>版本 / 状态</th>
                <th>修改时间</th>
                <th>修改人</th>
                <th data-list-actions>操作</th>
              </tr>
            </thead>
            <tbody>
              {activeRules.map((rule) => (
                <tr key={rule.id}>
                  <td>{rule.priority}</td>
                  <td>
                    <div className="submission-rule-requirement">
                      {rule.requirement}

                      <details>
                        <summary>查看执行条件</summary>
                        <p>{describeRoute(rule.compiled, data.workspace)}</p>
                      </details>

                    </div>
                  </td>
                  <td>
                    {personName(rule.userId)}
                    {!eligible.some((u) => u.id === rule.userId) && (
                      <small className="sr-error">（不可用）</small>
                    )}
                  </td>
                  <td><span className="rule-version-status" data-enabled={rule.enabled}>v{rule.revision ?? 1} · {rule.enabled ? '已启用' : '已停用'}</span></td>
                  <td>{rule.updatedAt ? new Date(rule.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td>
                  <td>{rule.updatedBy ?? '—'}</td>
                  <td>
                    {canManage ? (
                      <div className="rule-table-actions">
                        {rule.enabled && <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => edit(rule)}
                        >
                          编辑
                        </Button>}
                        {rule.enabled && <Button variant="ghost" disabled={busy} onClick={() => {
                          setFormError('');
                          setDisableTarget({ rule, revision: data.config.revision });
                          dialogActive.current = true;
                        }}>停用</Button>}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
              {!activeRules.length && (
                <tr>
                  <td colSpan={7} className="routing-empty">
                    {ready
                      ? '暂无启用的条件规则，将使用默认负责人。'
                      : '正在读取配置…'}
                  </td>
                </tr>
              )}
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
      <section className="routing-preview" aria-label="分配预览">
        <strong>分配预览</strong>
        <NativeSelect
          aria-label="预览服务请求"
          value={sampleId}
          onChange={(e) => setSampleId(e.target.value)}
          disabled={!ready || busy}
        >
          <option value="">
            {samples.length ? '选择服务请求' : '暂无可预览的请求'}
          </option>
          {samples.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} ·{' '}
              {data.workspace.customers.find((c) => c.id === r.customerId)
                ?.name ?? r.customerId}{' '}
              · {r.status}
            </option>
          ))}
        </NativeSelect>
        {sample && (preview || role === 'hardware') && (
          <div className="routing-preview-result">
            {preview?.matchedBy === 'default' ? <>
              <p>未命中分配规则。{preview.userId ? <>默认负责人：<strong>{preview.userName}</strong></> : !policy.defaultUserId && '未设置默认负责人，待分配。'}</p>
              {!preview.userId && policy.defaultUserId && <p className="sr-error">默认负责人不存在、已停用或角色不符，待分配。</p>}
            </> : <p>
              按当前规则：
              <strong>
                {preview
                  ? preview.userName || '待分配'
                  : '无需硬件产品经理评估'}
              </strong>{' '}
              · {preview?.reason ?? '未命中当前硬件评估触发条件。'}
            </p>}
            <p className="sr-help">
              当前负责人：
              {current
                ? current.userName || '待分配'
                : role === 'manager'
                  ? sample.operations?.assessment?.manager || '未记录分配'
                  : sample.operations?.assessment?.hardware?.reviewer ||
                    '未记录分配'}
              {current &&
                ` · 分配于 ${new Date(current.at).toLocaleString('zh-CN', { hour12: false })}`}
            </p>
            {!!sample.operations?.assessment?.routing?.history?.filter(
              (h) => h.role === role,
            ).length && (
              <details>
                <summary>查看分配历史</summary>
                {sample.operations.assessment.routing.history
                  .filter((h) => h.role === role)
                  .map((h) => (
                    <p key={h.allocation.id} className="sr-help">
                      {h.allocation.userName || '待分配'} · {h.by}于
                      {new Date(h.replacedAt).toLocaleString('zh-CN', {
                        hour12: false,
                      })}
                      调整 · {h.reason}
                    </p>
                  ))}
              </details>
            )}
          </div>
        )}
      </section>
      <RuleDisableDialog
        open={!!disableTarget}
        requirement={disableTarget ? `v${disableTarget.rule.revision ?? 1} · ${disableTarget.rule.requirement}` : ''}
        description="停用后，新请求将不再匹配此规则，已有请求的负责人保持不变。"
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
              {target ? '编辑分配规则' : '新建分配规则'}
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
                  <span>自然语言描述</span>
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
                  placeholder="例如：客户所属团队为金融，且包含硬件兼容性测试"
                />
                <small className="sr-help">
                  支持客户、客户负责团队（金融 / 商业 / 港澳 /
                  其他）、申请来源、服务项、服务方式，以及“且 / 或 /
                  不包含”。客户和服务项请使用完整名称。
                </small>
              </label>
              <div className="routing-form-row">
                <label
                  htmlFor={`${role}-priority`}
                  className="submission-rule-field"
                >
                  <span className="routing-field-heading">
                    <span>优先级</span>
                    <em aria-hidden="true">*</em>
                  </span>
                  <Input
                    id={`${role}-priority`}
                    aria-label="优先级"
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
                    <span>分配给</span>
                    <em aria-hidden="true">*</em>
                  </span>
                  {selector(
                    userId,
                    (id) => {
                      setUserId(id);
                      invalidate();
                    },
                    '规则负责人',
                    false,
                  )}
                </label>
              </div>
              <div className="submission-rule-test-actions">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !requirement.trim() || !userId}
                  onClick={() => void translate()}
                >
                  {busy ? '处理中…' : 'AI 转译并测试'}
                </Button>
              </div>
              {formError && (
                <p className="sr-error" role="alert">
                  {formError}
                </p>
              )}
              {tested && testCurrent && (
                <div className="submission-rule-test-result">
                  <strong>实际执行条件</strong>
                  <p>{describeRoute(tested.compiled, data.workspace)}</p>
                  {contradiction ? (
                    <p className="sr-error">匹配条件互相矛盾，请修改后重试。</p>
                  ) : (
                    <p>
                      条件检查通过。当前 {samples.length} 个请求样本中有{' '}
                      {sampleMatches.length} 个符合条件。
                      {!samples.length &&
                        '尚无实际请求样本，保存前请核对上述条件。'}
                    </p>
                  )}
                  {duplicate && (
                    <p className="sr-error">优先级重复，请修改。</p>
                  )}
                  {overlaps.map((r) => (
                    <p key={r.id}>
                      可能与优先级 {r.priority} 的规则同时命中，将先执行优先级{' '}
                      {Math.min(r.priority, Number(priority))}。
                      {JSON.stringify(r.compiled) ===
                      JSON.stringify(tested.compiled)
                        ? '两条规则条件相同，后执行的规则不会获得分配。'
                        : ''}
                    </p>
                  ))}
                  {!!sampleMatches.length && (
                    <details>
                      <summary>查看命中样本与分配结果</summary>
                      {sampleMatches.slice(0, 10).map((sample) => {
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
                            {sample.id} → {result?.userName || '待分配'} ·{' '}
                            {result?.reason}
                          </p>
                        );
                      })}
                      {sampleMatches.length > 10 && <p>仅展示前 10 个样本。</p>}
                    </details>
                  )}
                </div>
              )}
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
                取消
              </Button>
              <Button
                type="submit"
                disabled={busy || !testCurrent || duplicate || !!contradiction}
              >
                保存规则
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
