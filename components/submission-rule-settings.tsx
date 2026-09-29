'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RuleDisableDialog } from '@/components/rule-disable-dialog';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { builtinSubmissionRules } from '@/lib/submission-validation';
import { ruleScopes, submissionCheckEvents } from '@/lib/submission-rule-schema';
import type { RuleScope, SubmissionRule } from '@/lib/submission-rule-schema';
import { canManageSubmissionRules, readSubmissionRules, saveTestedSubmissionRule, disableSubmissionRule } from '@/lib/submission-rule-store';
import { ruleCompilationKey, RuleConflictError, testSubmissionRule } from '@/lib/submission-rule-conflicts';
import type { RuleTestResult } from '@/lib/submission-rule-conflicts';
import type { OperationActor } from '@/lib/request-operations';

export function SubmissionRuleSettings({ actor }: { actor: OperationActor }) {
  const [rules, setRules] = useState<SubmissionRule[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [formError, setFormError] = useState(''), [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false), [target, setTarget] = useState<SubmissionRule>();
  const [disableTarget, setDisableTarget] = useState<SubmissionRule>();
  const [disableError, setDisableError] = useState('');
  const [scope, setScope] = useState<RuleScope>('all');
  const [requirement, setRequirement] = useState('');
  const [promptText, setPromptText] = useState('');
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<RuleTestResult>();
  const [testError, setTestError] = useState('');
  const definition = { scope, events: [...submissionCheckEvents], requirement, promptText };
  const testCurrent = tested?.key === ruleCompilationKey(definition);
  const canSave = testCurrent && tested && !tested.conflicts.length && !!promptText.trim();
  const lock = useRef(false);
  const canManage = canManageSubmissionRules(actor);
  const activeRules = rules.filter(rule => rule.enabled !== false);
  const disabledVersions = rules.flatMap(rule => [
    ...(rule.enabled === false ? [{ ...rule, archivedAt: rule.disabledAt ?? rule.updatedAt, archivedBy: rule.disabledBy ?? rule.updatedBy }] : []),
    ...(rule.history ?? []),
  ]).sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  useEffect(() => {
    let active = true;
    const load = () => readSubmissionRules().then(value => { if (active) { setRules(value); setReady(true); setError(''); } }).catch(() => { if (active) { setReady(false); setError('无法读取校验规则，请刷新后重试。'); } });
    void load(); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);
  function edit(rule?: SubmissionRule) {
    setTested(undefined); setTestError('');
    setTarget(rule); setScope(rule?.scope ?? 'all');
    setPromptText(rule?.promptText ?? '');
    setRequirement(rule?.requirement ?? ''); setFormError(''); setOpen(true);
  }
  function invalidateTest() { setTested(undefined); setTestError(''); setFormError(''); }
  async function translateAndTest() {
    if (lock.current || !canManage || !ready) return;
    if (!requirement.trim()) { setTestError('请输入自然语言描述。'); return; }
    lock.current = true; setBusy(true); setTesting(true); setTested(undefined); setTestError(''); setFormError('');
    try {
      const response = await fetch('/api/submission-rules/compile', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(definition), signal: AbortSignal.timeout(100_000),
      });
      const result: { compiled?: unknown; summary?: string; error?: string } = await response.json();
      if (!response.ok || result.error) throw new Error(result.error || 'AI 转译失败，请稍后重试。');
      if (!result.compiled || !result.summary) throw new Error('没有获得完整的可执行规则，请改写后重试。');
      const latest = await readSubmissionRules();
      setRules(latest);
      setTested(testSubmissionRule(definition, result.compiled, result.summary, latest, target?.id));
    } catch (issue) {
      setTestError(issue instanceof Error ? issue.message : '转译或测试失败，请重试。');
    } finally { lock.current = false; setBusy(false); setTesting(false); }
  }
  async function save() {
    if (lock.current || !canManage || !ready) return;
    if (!tested || !testCurrent || tested.conflicts.length) { setFormError('请先转译并测试，处理所有冲突后再保存。'); return; }
    if (!promptText.trim()) { setFormError('请输入提示文本。'); return; }
    lock.current = true; setBusy(true); setFormError(''); setNotice('');
    try {
      setRules(await saveTestedSubmissionRule(actor, definition, tested, target));
      setOpen(false); setNotice('规则已保存，将在提交申请或退回后重新提交时校验。');
    } catch (issue) {
      if (issue instanceof RuleConflictError) setTested({ ...tested, conflicts: issue.conflicts });
      setFormError(issue instanceof Error ? issue.message : '规则保存失败，请重试。');
    } finally { lock.current = false; setBusy(false); }
  }
  async function disable() {
    if (!disableTarget || lock.current || !canManage || !ready) return;
    lock.current = true; setBusy(true); setDisableError('');
    try {
      setRules(await disableSubmissionRule(actor, disableTarget));
      setDisableTarget(undefined); setNotice('规则已停用，不再参与后续提交校验。');
    } catch (issue) { setDisableError(issue instanceof Error ? issue.message : '停用失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  function renderRule(rule: SubmissionRule, disabled = false, key = rule.id) {
    return <tr key={key}>
      <td>{ruleScopes[rule.scope]}</td>
      <td><div className="submission-rule-requirement">{rule.requirement}
        {rule.active && <details><summary>查看执行条件</summary><p>（{rule.active.summary}）</p>{rule.status !== 'ready' && <p>适用申请：{ruleScopes[rule.active.scope]}；提示文本：{rule.active.promptText}</p>}</details>}
        {rule.error && <p className="submission-rule-problem">{rule.error}</p>}
      </div></td>
      <td className="submission-rule-prompt">{rule.promptText}</td>
      <td><span className="rule-version-status" data-enabled={!disabled && !!rule.active?.enabled}>v{rule.version ?? Math.max(1, rule.revision)} · {disabled ? '已停用' : rule.active?.enabled ? '已启用' : '未生效'}</span></td>
      <td>{new Date(disabled ? rule.disabledAt ?? rule.updatedAt : rule.updatedAt).toLocaleString('zh-CN', { hour12: false })}</td>
      <td>{disabled ? rule.disabledBy ?? rule.updatedBy : rule.updatedBy}</td>
      <td>{!disabled && canManage && <div className="rule-table-actions">
        <Button variant="ghost" disabled={busy} onClick={() => edit(rule)}>{rule.status === 'ready' ? '编辑' : '修改 / 重试'}</Button>
        <Button variant="ghost" disabled={busy} onClick={() => { setDisableTarget(rule); setDisableError(''); }}>停用</Button>
      </div>}</td>
    </tr>;
  }
  return <>
    <div className="request-flow-settings">
    {error && <p className="sr-error" role="alert">{error}</p>}
    {notice && <p className="submission-rule-notice" role="status">{notice}</p>}
    <section className="routing-rules" aria-label="提交校验规则">
    <div className="submission-rules-toolbar">
      <div><strong>提交校验规则</strong></div>
      {canManage && <Button disabled={!ready || busy} onClick={() => edit()}><Plus size={16} />新建规则</Button>}
    </div>
    <div className="table-scroll"><table className="reference-table app-list-table submission-rules-table">
      <thead><tr><th>适用申请</th><th>自然语言描述</th><th>提示文本</th><th>版本 / 状态</th><th>修改时间</th><th>修改人</th><th data-list-actions>操作</th></tr></thead>
      <tbody>
        {builtinSubmissionRules.map(rule => <tr key={rule.id}>
          <td>{ruleScopes[rule.scope]}</td>
          <td>{rule.requirement}</td><td>{rule.promptText}</td><td>—</td><td>—</td><td>系统预置</td><td><span className="sr-help">系统预置</span></td>
        </tr>)}
        {activeRules.map(rule => renderRule(rule))}
      </tbody>
    </table></div>
    {!ready && !error && <p className="submission-rule-notice">正在读取规则…</p>}
    </section>
    <details className="routing-rules disabled-rule-versions" aria-label="提交校验规则（已停用）">
      <summary className="submission-rules-toolbar"><strong>提交校验规则（已停用）</strong></summary>
      <div className="table-scroll"><table className="reference-table app-list-table submission-rules-table">
        <thead><tr><th>适用申请</th><th>自然语言描述</th><th>提示文本</th><th>版本 / 状态</th><th>停用时间</th><th>停用人</th><th data-list-actions>操作</th></tr></thead>
        <tbody>{disabledVersions.map((rule, index) => renderRule(rule, true, `${rule.id}-${rule.version ?? rule.revision}-${index}`))}
          {!disabledVersions.length && <tr><td colSpan={7} className="routing-empty">{ready ? '暂无已停用版本。' : '正在读取规则…'}</td></tr>}
        </tbody>
      </table></div>
    </details>
    </div>
    <RuleDisableDialog open={!!disableTarget} requirement={disableTarget ? `v${disableTarget.version ?? Math.max(1, disableTarget.revision)} · ${disableTarget.requirement}` : ''} description="停用后，该规则不再参与后续提交校验。" busy={busy} error={disableError} onCancel={() => setDisableTarget(undefined)} onConfirm={() => void disable()} />
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="submission-rule-dialog" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{target ? '编辑提交校验规则' : '新建提交校验规则'}</DialogTitle></DialogHeader>
        <form className="submission-rule-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="submission-rule-form-body">
          <div className="submission-rule-field">
            <label htmlFor="rule-scope">适用申请</label>
            <NativeSelect id="rule-scope" value={scope} disabled={busy} onChange={event => { setScope(event.target.value as RuleScope); invalidateTest(); }}>{Object.entries(ruleScopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>
          </div>
          <div className="submission-rule-field">
            <label htmlFor="rule-requirement">自然语言描述 <em aria-hidden="true">*</em></label>
            <Textarea id="rule-requirement" aria-describedby="rule-requirement-help" rows={3} maxLength={2000} required disabled={busy} value={requirement} onChange={event => { setRequirement(event.target.value); invalidateTest(); }} placeholder="例如：必须填写申请说明；期望服务日期至少提前 3 天；内部协作人至少包含一位服务工程师。" />
            <p id="rule-requirement-help" className="submission-rule-field-help">支持字段必填、人数和数量比较、协作人角色、必填材料齐套等检查。请先转译并测试，通过后保存。</p>

          </div>
          <div className="submission-rule-field">
            <label htmlFor="rule-prompt">提示文本 <em aria-hidden="true">*</em></label>
            <p id="rule-prompt-help" className="submission-rule-field-help">校验未通过时，向申请人显示此提示文本。</p>
            <Textarea id="rule-prompt" aria-describedby="rule-prompt-help" rows={2} maxLength={4000} required disabled={busy} value={promptText} onChange={event => setPromptText(event.target.value)} placeholder="例如：请填写申请说明后再提交。" />
          </div>
            <div className="submission-rule-test-actions"><Button type="button" variant="outline" disabled={busy || !canManage || !ready} onClick={() => void translateAndTest()}>{testing ? '正在转译并测试…' : 'AI 转译并测试'}</Button></div>
            {(testing || testError || (testCurrent && tested)) && <div aria-live="polite" aria-atomic="true">
              {testing && <p className="submission-rule-field-help" role="status">正在转译，并检查与当前生效规则的冲突…</p>}
              {testError && <p className="sr-error" role="alert">{testError}</p>}
              {testCurrent && tested && <div className="submission-rule-test-result" data-conflicts={!!tested.conflicts.length}>
                <strong>实际执行条件</strong>
                <p>{tested.summary}</p>
                {tested.conflicts.length ? <><p>发现冲突或检查未完成，暂不能保存。</p><b>可能的冲突项</b><ul>{tested.conflicts.map((conflict, index) => <li key={index}>
                  <b>{conflict.context}</b><p>{conflict.message}</p>
                  {conflict.requirements.map((text, i) => <p key={i}>{text}</p>)}
                </li>)}</ul></> : <p>条件检查通过。在当前支持的条件范围内，未发现规则冲突。</p>}
              </div>}
            </div>}
          {formError && <p className="sr-error" role="alert">{formError}{target?.active?.enabled && ' 原规则仍然生效。'}</p>}
          {busy && !testing && <p className="sr-help" role="status">正在保存…</p>}
          </div>
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || !canManage || !ready || !canSave}>{busy && !testing ? '正在保存…' : '保存规则'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
