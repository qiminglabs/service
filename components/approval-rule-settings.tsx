'use client';

import { RequiredMark } from '@/components/required-mark';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { ApprovalAllocationPreview } from '@/components/approval-allocation-preview';
import { Button } from '@/components/ui/button';
import { UserSearchSelect } from '@/components/user-search-select';
import type { InternalUser } from '@/lib/service-requests';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { RuleDisableDialog } from '@/components/rule-disable-dialog';
import { DisabledRuleVersions } from '@/components/disabled-rule-versions';
import { ApprovalFlowSettings } from '@/components/approval-flow-settings';
import { canManageRouting } from '@/lib/assessment-routing-store';
import type { ApprovalScope } from '@/lib/approval-scope';
import { readApprovalPreviewData, readApprovalRules, saveApprovalRule, disableApprovalRule, saveDefaultApprovalUser } from '@/lib/approval-flow-store';
import { approvalRuleIssue, approvalRuleConditionLabel, newApprovalRule, sortApprovalRules, resolveApprovalRule, type ApprovalRule } from '@/lib/approval-rules';
import { describeRoute, matchesRoute, parseRoutePredicate, routesOverlap, type RoutingDictionary } from '@/lib/assessment-routing-schema';
import { readRoutingData } from '@/lib/assessment-routing-store';
import type { OperationActor } from '@/lib/request-operations';

export function ApprovalRuleSettings({ actor, scope = 'request' }: { actor: OperationActor; scope?: ApprovalScope }) {
  const [users, setUsers] = useState<InternalUser[]>([]);
  const [routingDictionary, setRoutingDictionary] = useState<RoutingDictionary>({ customers: [], services: [] });
  const [defaultUserId, setDefaultUserId] = useState(''), [savedDefaultUserId, setSavedDefaultUserId] = useState(''), [defaultRevision, setDefaultRevision] = useState(0);
  const [rules, setRules] = useState<ApprovalRule[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [formError, setFormError] = useState('');
  const [draft, setDraft] = useState<ApprovalRule>();
  const [disableTarget, setDisableTarget] = useState<ApprovalRule>();
  const [disableError, setDisableError] = useState('');
  const [flowRuleId, setFlowRuleId] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ summary: string; matches: number; samples: number; priority: number; selected: number; overlaps: ApprovalRule[] }>();
  const [revision, setRevision] = useState<number | null>(null);
  const lock = useRef(false);
  const allowed = canManageRouting(actor);
  const activeRules = sortApprovalRules(rules.filter(rule => rule.enabled !== false));
  const disabledVersions = rules.flatMap(rule => [
    ...(rule.enabled === false ? [{ ...rule, archivedAt: rule.updatedAt, archivedBy: rule.updatedBy }] : []),
    ...(rule.history ?? []),
  ]).sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''));
  const duplicate = !!draft && rules.some(rule => rule.enabled !== false && rule.id !== draft.id && rule.priority === draft.priority);
  function applyData(data: Awaited<ReturnType<typeof readApprovalRules>>) {
    setRoutingDictionary(data.dictionary);
    setRules(data.collection.rules); setUsers(data.users); setDefaultUserId(data.collection.defaultUserId ?? ''); setSavedDefaultUserId(data.collection.defaultUserId ?? ''); setDefaultRevision(data.collection.defaultRevision ?? 0); setReady(true);
  }
  async function saveDefault() {
    if (!allowed || !ready || lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveDefaultApprovalUser(actor, defaultUserId, defaultRevision, scope);
      setRules(saved.rules); setSavedDefaultUserId(saved.defaultUserId ?? ''); setDefaultRevision(saved.defaultRevision ?? 0); setNotice('默认审批人已保存。');
    } catch (issue) { setError(issue instanceof Error ? issue.message : '默认审批人保存失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function reload() {
    try { applyData(await readApprovalRules(scope)); setError(''); }
    catch (issue) { setError(issue instanceof Error ? issue.message : '规则读取失败，请重试。'); }
  }
  useEffect(() => {
    let active = true;
    void readApprovalRules(scope).then(data => { if (active) { applyData(data); } }).catch(issue => { if (active) setError(issue instanceof Error ? issue.message : '规则读取失败，请重试。'); });
    return () => { active = false; };
  }, [scope]);
  function edit(rule?: ApprovalRule) {
    setRevision(rule?.revision ?? null);
    setDraft(rule ? { ...structuredClone(rule), conditions: { requirement: rule.conditions.requirement } } : newApprovalRule(rules)); setFormError(''); setTestResult(undefined);
  }
  async function translate() {
    if (!draft || lock.current || !allowed || !ready) return;
    const issue = approvalRuleIssue(draft); if (issue) { setFormError(issue); return; }
    if (duplicate) { setFormError('优先级重复，请选择其他数字。'); return; }
    lock.current = true; setBusy(true); setTesting(true); setFormError(''); setTestResult(undefined);
    setDraft({ ...draft, conditions: { requirement: draft.conditions.requirement } });
    try {
      const [latest, latestRules] = await Promise.all([readRoutingData(), readApprovalRules(scope)]);
      setRules(latestRules.collection.rules);
      setRoutingDictionary(latestRules.dictionary);
      if (latestRules.collection.rules.some(rule => rule.enabled !== false && rule.id !== draft.id && rule.priority === draft.priority)) throw new Error('优先级重复，请选择其他数字。');
      const dictionary = {
        customers: latest.workspace.customers.map(({ id, name, team }) => ({ id, name, team })),
        services: latest.workspace.services.map(({ id, name }) => ({ id, name })),
      };
      const response = await fetch('/api/assessment-routing/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(100_000),
        body: JSON.stringify({ requirement: draft.conditions.requirement, dictionary, purpose: 'approval' }),
      });
      const result = await response.json() as { compiled?: unknown; error?: string };
      if (!response.ok || result.error) throw new Error(result.error || '转译失败，请重试。');
      const compiled = parseRoutePredicate(result.compiled, dictionary);
      if (!routesOverlap(compiled, compiled, 'manager')) throw new Error('匹配条件互相矛盾，请修改后重新测试。');
      const samples = scope === 'project' ? (await readApprovalPreviewData(scope)).requests : latest.requests.filter(request => request.status !== '草稿');
      const candidate = { ...draft, conditions: { requirement: draft.conditions.requirement, compiled, testedRequirement: draft.conditions.requirement.trim() } };
      const others = latestRules.collection.rules.filter(rule => rule.enabled !== false && rule.id !== draft.id);
      const matches = samples.filter(request => matchesRoute(request, compiled, dictionary.customers));
      setDraft(candidate);
      setTestResult({ summary: describeRoute(compiled, dictionary), matches: matches.length, samples: samples.length, priority: draft.priority,
        selected: matches.filter(request => resolveApprovalRule([...others, candidate], request, dictionary.customers)?.id === draft.id).length,
        overlaps: sortApprovalRules(others.filter(rule => rule.conditions.compiled && rule.conditions.testedRequirement === rule.conditions.requirement.trim() && routesOverlap(rule.conditions.compiled, compiled, 'manager'))),
      });
    } catch (issue) { setFormError(issue instanceof Error ? issue.message : '转译或测试失败，请重试。'); }
    finally { lock.current = false; setBusy(false); setTesting(false); }
  }
  async function save(configure = false) {
    if (!draft || lock.current || !allowed || !ready) return;
    const issue = approvalRuleIssue(draft); if (issue) { setFormError(issue); return; }
    if (duplicate) { setFormError('优先级重复，请选择其他数字。'); return; }
    if (!testResult || testResult.priority !== draft.priority || draft.conditions.testedRequirement !== draft.conditions.requirement.trim()) { setFormError('请先转译并测试当前匹配条件，再保存规则。'); return; }
    lock.current = true; setBusy(true); setFormError('');
    try {
      const result = await saveApprovalRule(actor, draft, revision, scope);
      setRules(result.rules); setDraft(undefined); setError(''); setNotice('审批规则已保存。');
      if (configure) setFlowRuleId(draft.id);
    } catch (issue) { setFormError(issue instanceof Error ? issue.message : '保存失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function disable(rule: ApprovalRule) {
    if (lock.current || !allowed) return;
    lock.current = true; setBusy(true); setDisableError('');
    try { setRules((await disableApprovalRule(actor, rule, scope)).rules); setDisableTarget(undefined); setError(''); setNotice('审批规则已停用，已发起的审批继续按原流程处理。'); }
    catch (issue) { setDisableError(issue instanceof Error ? issue.message : '停用失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  if (flowRuleId) return <ApprovalFlowSettings scope={scope} key={`${scope}:${flowRuleId}`} actor={actor} ruleId={flowRuleId} onBack={() => { setFlowRuleId(''); setNotice(''); void reload(); }} />;
  return <div className="request-flow-settings">
    {error && <p className="sr-error" role="alert">{error}</p>}{notice && <output className="submission-rule-notice block">{notice}</output>}
    {!allowed && <p className="sr-help">仅系统管理员可维护特殊审批规则。</p>}
    <section className="routing-default" aria-label="默认审批人">
      <div><strong>默认审批人</strong></div>
      <div className="routing-inline routing-default-controls">
        <UserSearchSelect label="默认审批人" users={users} value={defaultUserId} onChange={setDefaultUserId}
          disabled={!allowed || busy || !ready} emptyHint={scope === 'project' ? '未设置时，无法匹配的项目将待分配。' : '未设置时，无法匹配的请求将待分配。'} />
        {allowed && <Button variant="outline" disabled={!ready || busy || defaultUserId === savedDefaultUserId} onClick={() => void saveDefault()}>保存</Button>}
      </div>
    </section>
    <section className="routing-rules" aria-label="条件审批规则">
    <div className="submission-rules-toolbar"><div><strong>条件审批规则</strong></div>{allowed && <Button disabled={!ready || busy} onClick={() => edit()}><Plus size={16} />新建规则</Button>}</div>
    <div className="table-scroll"><table className="reference-table app-list-table approval-rules-table">
      <thead><tr><th>优先级</th><th>规则名称</th><th>自然语言描述</th><th>审批节点数量</th><th>版本 / 状态</th><th>修改时间</th><th>修改人</th><th data-list-actions>操作</th></tr></thead>
      <tbody>{activeRules.map(rule => <tr key={rule.id}>
        <td>{rule.priority}</td><td><strong>{rule.name}</strong></td><td>
          <div className="submission-rule-requirement">
            {approvalRuleConditionLabel(rule.conditions)}
            <details>
              <summary>查看执行条件</summary>
              <p>{rule.conditions.compiled && rule.conditions.testedRequirement === rule.conditions.requirement.trim()
                ? describeRoute(rule.conditions.compiled, routingDictionary)
                : '尚未生成有效执行条件，请编辑条件并转译测试。'}</p>
            </details>

          </div>
        </td>
        <td>{rule.flow.nodes.length}</td>
        <td><span className="rule-version-status" data-enabled={rule.enabled !== false}>v{rule.version ?? Math.max(1, rule.revision)} · {rule.enabled !== false ? '已启用' : '已停用'}</span></td>
        <td>{rule.updatedAt ? new Date(rule.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</td><td>{rule.updatedBy ?? '—'}</td>
        <td><div className="rule-table-actions">{allowed && rule.enabled !== false && <Button variant="ghost" disabled={busy} onClick={() => edit(rule)}>编辑条件</Button>}<Button variant="ghost" disabled={busy} onClick={() => setFlowRuleId(rule.id)}>{allowed && rule.enabled !== false ? '配置审批流程' : '查看审批流程'}</Button>{allowed && rule.enabled !== false && <Button variant="ghost" disabled={busy} onClick={() => { setDisableTarget(rule); setDisableError(''); }}>停用</Button>}</div></td>
      </tr>)}{!activeRules.length && <tr><td colSpan={8} className="approval-empty">{ready ? '暂无启用的特殊审批规则，请新建规则并配置审批流程。' : error ? '规则加载失败，请刷新页面重试。' : '正在读取审批规则…'}</td></tr>}</tbody>
    </table></div>
    </section>
    <DisabledRuleVersions showName targetLabel="审批节点数量" ready={ready} versions={disabledVersions.map((version, index) => ({
      key: `${version.id}-${version.version ?? version.revision}-${index}`,
      name: version.name,
      priority: version.priority,
      requirement: approvalRuleConditionLabel(version.conditions),
      condition: version.conditions.compiled && version.conditions.testedRequirement === version.conditions.requirement.trim()
        ? describeRoute(version.conditions.compiled, routingDictionary) : '尚未生成有效执行条件。',
      target: <>{version.flow.nodes.length}<details className="disabled-rule-flow">
        <summary>查看审批流程</summary>
        <ol>{version.flow.nodes.map(node => <li key={node.id}>
          {node.name} · {node.source === 'people' ? node.userIds.map(id => users.find(user => user.id === id)?.name ?? id).join('、')
            : node.source === 'manager' ? '直属主管' : `逐级主管（${node.stopUserIds.length ? '截止人：' + node.stopUserIds.map(id => users.find(user => user.id === id)?.name ?? id).join('、') : node.depth + ' 级'}）`}
          <span> · 驳回退回申请人</span>
        </li>)}</ol>
        {!version.flow.nodes.length && <p>尚未配置审批节点</p>}
      </details></>,
      version: version.version ?? Math.max(1, version.revision),
      disabledAt: version.archivedAt,
      disabledBy: version.archivedBy,
    }))} />
    <ApprovalAllocationPreview scope={scope} refreshKey={JSON.stringify([defaultRevision, rules.map(rule => [rule.id, rule.revision])])} dirty={defaultUserId !== savedDefaultUserId} />
    <RuleDisableDialog
      open={!!disableTarget}
      requirement={disableTarget ? `${disableTarget.name} · v${disableTarget.version ?? Math.max(1, disableTarget.revision)}` : ''}
      description={scope === 'project' ? '停用后，新项目审批将不再匹配此规则，已发起的审批继续按原流程处理。' : '停用后，新请求将不再匹配此规则，已发起的审批继续按原流程处理。'}
      busy={busy}
      error={disableError}
      onCancel={() => { setDisableTarget(undefined); setDisableError(''); }}
      onConfirm={() => { if (disableTarget) void disable(disableTarget); }}
    />
    <Dialog open={!!draft} onOpenChange={open => { if (!open && !busy) setDraft(undefined); }}>
      <DialogContent className="submission-rule-dialog" aria-describedby={undefined}><DialogHeader><DialogTitle>{revision === null ? '新建特殊审批规则' : '编辑特殊审批条件'}</DialogTitle></DialogHeader>
        {draft && <form className="submission-rule-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <fieldset className="submission-rule-form-body approval-rule-fields" disabled={busy}>
            <label htmlFor="approval-rule-name" className="submission-rule-field"><span>规则名称 <RequiredMark /></span><Input id="approval-rule-name" required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：金融客户现场服务审批" /></label>
            <label htmlFor="approval-rule-priority" className="submission-rule-field"><span className="routing-field-heading"><span>优先级</span><em aria-hidden="true">*</em></span><Input id="approval-rule-priority" required type="number" min={1} max={9999} step={1} value={Number.isFinite(draft.priority) ? draft.priority : ''} onChange={event => { setDraft({ ...draft, priority: event.target.value === '' ? NaN : Number(event.target.value) }); setTestResult(undefined); setFormError(''); }} /><small className="sr-help">填写 1–9999 的整数，数字越小越优先，不能与其他启用规则重复。</small>{duplicate && <p className="sr-error" role="alert">优先级重复，请选择其他数字。</p>}</label>
            <label htmlFor="approval-rule-requirement" className="submission-rule-field">
              <span className="routing-field-heading"><span>自然语言描述</span><em aria-hidden="true">*</em></span>
              <Textarea id="approval-rule-requirement" required aria-required="true" rows={4} maxLength={4000} value={draft.conditions.requirement} onChange={event => { setDraft({ ...draft, conditions: { requirement: event.target.value } }); setTestResult(undefined); setFormError(''); }} placeholder="例如：客户负责团队为金融，且包含现场服务" />
              <small className="sr-help">支持客户、客户负责团队（金融 / 商业 / 港澳 / 其他）、申请来源、服务项、服务方式，以及“且 / 或 / 不包含”。客户和服务项请使用完整名称。</small>
            </label>
            <div className="submission-rule-test-actions"><Button type="button" variant="outline" disabled={busy || duplicate || !draft.conditions.requirement.trim()} onClick={() => void translate()}>{testing ? '正在转译并测试…' : 'AI 转译并测试'}</Button></div>
            {testResult && <div className="submission-rule-test-result"><strong>实际执行条件</strong><p>{testResult.summary}</p><p>条件检查通过。当前 {testResult.samples} 个请求样本中有 {testResult.matches} 个符合条件。{!testResult.samples && '尚无实际请求样本，保存前请核对上述条件。'}</p><p>按优先级预览，其中 {testResult.selected} 个样本将选中本规则。</p>{testResult.overlaps.map(rule => <p key={rule.id}>可能与「{rule.name}」（优先级 {rule.priority}）同时命中，将优先选取优先级 {Math.min(rule.priority, draft.priority)} 的规则。</p>)}</div>}
            {formError && <p className="sr-error" role="alert">{formError}</p>}
          </fieldset>
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setDraft(undefined)}>取消</Button><Button type="submit" variant="outline" disabled={busy || !allowed || duplicate || !testResult}>保存规则</Button><Button type="button" disabled={busy || !allowed || duplicate || !testResult} onClick={event => { if (event.currentTarget.form?.reportValidity()) void save(true); }}>保存并配置审批流程</Button></DialogFooter>
        </form>}
      </DialogContent>
    </Dialog>
  </div>;
}
