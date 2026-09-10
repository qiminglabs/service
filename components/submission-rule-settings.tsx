'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { builtinSubmissionRules } from '@/lib/submission-validation';
import { ruleScopes, ruleEvents } from '@/lib/submission-rule-schema';
import type { RuleEvent, RuleScope, SubmissionRule } from '@/lib/submission-rule-schema';
import { canManageSubmissionRules, readSubmissionRules, saveRuleDraft, finishRuleCompilation, toggleSubmissionRule } from '@/lib/submission-rule-store';
import type { OperationActor } from '@/lib/request-operations';

export function SubmissionRuleSettings({ actor }: { actor: OperationActor }) {
  const [rules, setRules] = useState<SubmissionRule[]>([]);
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [formError, setFormError] = useState(''), [notice, setNotice] = useState('');
  const [open, setOpen] = useState(false), [target, setTarget] = useState<SubmissionRule>();
  const [scope, setScope] = useState<RuleScope>('all');
  const [events, setEvents] = useState<RuleEvent[]>(['submit', 'resubmit']);
  const [requirement, setRequirement] = useState('');
  const [promptText, setPromptText] = useState('');
  const lock = useRef(false);
  const canManage = canManageSubmissionRules(actor);
  useEffect(() => {
    let active = true;
    const load = () => readSubmissionRules().then(value => { if (active) { setRules(value); setReady(true); setError(''); } }).catch(() => { if (active) { setReady(false); setError('无法读取校验规则，请刷新后重试。'); } });
    void load(); window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, []);
  function edit(rule?: SubmissionRule) {
    setTarget(rule); setScope(rule?.scope ?? 'all'); setEvents(rule?.events ?? ['submit', 'resubmit']);
    setPromptText(rule?.promptText ?? '');
    setRequirement(rule?.requirement ?? ''); setFormError(''); setOpen(true);
  }
  async function save() {
    if (lock.current || !canManage || !ready) return;
    if (!events.length) { setFormError('请至少选择一个检查时机。'); return; }
    if (!requirement.trim()) { setFormError('请输入检验要求。'); return; }
    if (!promptText.trim()) { setFormError('请输入提示文本。'); return; }
    lock.current = true; setBusy(true); setFormError(''); setNotice('');
    let saved: SubmissionRule | undefined;
    try {
      saved = await saveRuleDraft(actor, { scope, events, requirement, promptText }, target);
      setTarget(saved); setRules(await readSubmissionRules());
      let result: { compiled?: unknown; summary?: string; error?: string };
      try {
        const response = await fetch('/api/submission-rules/compile', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope, events, requirement, promptText }), signal: AbortSignal.timeout(100_000),
        });
        result = await response.json();
        if (!response.ok && !result.error) result = { error: 'AI 转译失败，请稍后重试。' };
        if (!result.error && !result.compiled) result = { error: '没有获得可执行规则，请改写后重试。' };
      } catch { result = { error: '无法连接 AI 服务，文字要求已保存，请稍后重试转译。' }; }
      const updated = await finishRuleCompilation(actor, saved, result);
      setRules(updated); setTarget(updated.find(r => r.id === saved!.id));
      if (result.error) { setFormError(result.error); return; }
      setOpen(false); setNotice('规则已保存并加入校验队列，下次命中检查时机时生效。');
    } catch (issue) { setFormError(issue instanceof Error ? issue.message : '规则保存失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function toggle(rule: SubmissionRule) {
    if (lock.current || !canManage) return;
    lock.current = true; setBusy(true); setError('');
    try { setRules(await toggleSubmissionRule(actor, rule)); setNotice(rule.active?.enabled ? '规则已停用。' : '规则已启用。'); }
    catch (issue) { setError(issue instanceof Error ? issue.message : '修改失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <>
    <div className="submission-rules-toolbar">
      <p>到达检查时机后，按适用申请逐条校验；全部通过后继续操作。</p>
      {canManage && <Button disabled={!ready || busy} onClick={() => edit()}><Plus size={16} />新建规则</Button>}
    </div>
    {error && <p className="sr-error" role="alert">{error}</p>}
    {notice && <p className="submission-rule-notice" role="status">{notice}</p>}
    <div className="table-scroll"><table className="reference-table app-list-table submission-rules-table">
      <thead><tr><th>适用申请</th><th>检查时机</th><th>检验要求</th><th>提示文本</th><th>状态</th><th>修改时间</th><th>修改人</th><th>操作</th></tr></thead>
      <tbody>
        {builtinSubmissionRules.map(rule => <tr key={rule.id}>
          <td>{ruleScopes[rule.scope]}</td><td><div className="submission-rule-events">{rule.events.map(event => <span key={event}>{ruleEvents[event]}</span>)}</div></td>
          <td>{rule.requirement}</td><td>{rule.promptText}</td><td><span className="submission-rule-state">生效中</span></td><td>—</td><td>系统预置</td><td><span className="sr-help">系统预置</span></td>
        </tr>)}
        {rules.map(rule => <tr key={rule.id}>
          <td>{ruleScopes[rule.scope]}</td><td><div className="submission-rule-events">{rule.events.map(event => <span key={event}>{ruleEvents[event]}</span>)}</div></td>
          <td><div className="submission-rule-requirement">{rule.requirement}
            {rule.active && <details><summary>查看当前执行条件</summary><p>{rule.active.summary}</p>{rule.status !== 'ready' && <p>适用申请：{ruleScopes[rule.active.scope]}；检查时机：{rule.active.events.map(event => ruleEvents[event]).join('、')}；提示文本：{rule.active.promptText}</p>}</details>}
            {rule.error && <p className="submission-rule-problem">{rule.error}</p>}
          </div></td>
          <td className="submission-rule-prompt">{rule.promptText}</td>
          <td><span className="submission-rule-state" data-status={rule.status === 'ready' ? rule.active?.enabled ? 'active' : 'disabled' : 'pending'}>{rule.status === 'pending' ? '待转译' : rule.status === 'error' ? '转译未通过' : rule.active?.enabled ? '生效中' : '已停用'}</span>
            {rule.status !== 'ready' && <small className="submission-rule-status-note">{rule.active?.enabled ? '原规则继续生效' : '尚未加入队列'}</small>}</td>
          <td>{new Date(rule.updatedAt).toLocaleString('zh-CN', { hour12: false })}</td><td>{rule.updatedBy}</td>
          <td>{canManage && <><Button variant="ghost" disabled={busy} onClick={() => edit(rule)}>{rule.status === 'ready' ? '编辑' : '修改 / 重试'}</Button>{rule.active && <Button variant="ghost" disabled={busy} onClick={() => void toggle(rule)}>{rule.active.enabled ? '停用' : '启用'}</Button>}</>}</td>
        </tr>)}
      </tbody>
    </table></div>
    {!ready && !error && <p className="submission-rule-notice">正在读取规则…</p>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}>
      <DialogContent className="submission-rule-dialog" aria-describedby={undefined}>
        <DialogHeader><DialogTitle>{target ? '编辑提交校验规则' : '新建提交校验规则'}</DialogTitle></DialogHeader>
        <form className="submission-rule-form" onSubmit={event => { event.preventDefault(); void save(); }}>
          <div className="submission-rule-form-body">
          <div className="submission-rule-field">
            <label htmlFor="rule-scope">适用申请</label>
            <NativeSelect id="rule-scope" value={scope} disabled={busy} onChange={event => setScope(event.target.value as RuleScope)}>{Object.entries(ruleScopes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect>
          </div>
          <fieldset className="submission-rule-event-picker" disabled={busy}><legend>检查时机 <span>可多选</span></legend>
            {Object.entries(ruleEvents).map(([value, label]) => <label key={value}><Checkbox disabled={busy} checked={events.includes(value as RuleEvent)} onCheckedChange={checked => setEvents(previous => checked ? [...previous, value as RuleEvent] : previous.filter(event => event !== value))} />{label}</label>)}
          </fieldset>
          <div className="submission-rule-field">
            <label htmlFor="rule-requirement">自然语言描述检验要求 <em aria-hidden="true">*</em></label>
            <p id="rule-requirement-help" className="submission-rule-field-help">保存后将 AI 转译，支持字段必填、人数和数量比较、协作人角色、必填材料齐套等检查。</p>
            <Textarea id="rule-requirement" aria-describedby="rule-requirement-help" rows={3} maxLength={2000} required disabled={busy} value={requirement} onChange={event => setRequirement(event.target.value)} placeholder="例如：必须填写申请说明；期望服务日期至少提前 3 天；内部协作人至少包含一位服务工程师。" />
          </div>
          <div className="submission-rule-field">
            <label htmlFor="rule-prompt">提示文本 <em aria-hidden="true">*</em></label>
            <p id="rule-prompt-help" className="submission-rule-field-help">校验未通过时，向申请人显示此提示文本。</p>
            <Textarea id="rule-prompt" aria-describedby="rule-prompt-help" rows={2} maxLength={4000} required disabled={busy} value={promptText} onChange={event => setPromptText(event.target.value)} placeholder="例如：请填写申请说明后再提交。" />
          </div>
          {formError && <p className="sr-error" role="alert">{formError}{target?.active?.enabled && ' 原规则仍然生效。'}</p>}
          {busy && <p className="sr-help" role="status">文字要求保存后正在转译，请稍候…</p>}
          </div>
          <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy || !canManage}>{busy ? '正在保存并转译…' : '保存并转译'}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  </>;
}
