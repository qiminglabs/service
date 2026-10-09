'use client';
import { useI18n } from '@/lib/i18n/context';


import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserSearchSelect } from '@/components/user-search-select';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import type { ApprovalScope } from '@/lib/approval-scope';
import { readApprovalData, saveApprovalConfig } from '@/lib/approval-flow-store';
import { approvalConfigIssue, emptyApprovalConfig, newApprovalNode, type ApprovalConfig, type ApprovalNode } from '@/lib/approval-flows';
import type { InternalUser } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

function Field({ label, children }: { label: string; children: ReactNode }) {
  const { localize } = useI18n(); return <label className="approval-field"><span>{localize(label)}</span>{localize(children)}</label>; }

function ApprovalStopUsers({ users, value, disabled, onChange }: { users: InternalUser[]; value: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const { localize } = useI18n();
  const [query, setQuery] = useState('');
  const available = users.filter(user => user.status === '启用' && !value.includes(user.id));
  const selected = value.map(id => users.find(user => user.id === id) ?? { id, name: id, email: '', status: '已不存在' });
  const matches = available.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="approval-field" role="group" aria-label={localize("审批截止人")}>
    <span>{localize("审批截止人")}<small>{localize("（可多选）")}</small></span>
    <Input aria-label={localize("搜索审批截止人")} placeholder={localize("搜索姓名或邮箱")} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
    <div className="approval-stop-users">
      {localize([...selected, ...matches].map(user => <label key={user.id}>
        <input type="checkbox" checked={value.includes(user.id)} disabled={disabled} onChange={event => onChange(event.target.checked ? [...value, user.id] : value.filter(id => id !== user.id))} />
        <span>{localize(user.name)}<small>{localize(user.email)}</small>{localize(user.status !== '启用' && <small>{localize("不可用，请取消选择")}</small>)}</span>
      </label>))}
      {localize(!selected.length && !matches.length && <p className="sr-help">{localize("没有匹配的内部用户")}</p>)}
    </div>
    <small className="sr-help">{localize(value.length ? `已选 ${value.length} 人。沿汇报关系遇到其中任意一人，由其完成最后一级审批。` : '未选择时按指定级数审批；选择后以最先遇到的截止人为终点。')}</small>
  </div>;
}

export function ApprovalFlowSettings({ actor, ruleId, onBack, scope = 'request' }: { actor: OperationActor; ruleId: string; onBack: () => void; scope?: ApprovalScope }) {
  const { localize } = useI18n();
  const [confirmBack, setConfirmBack] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [ruleRevision, setRuleRevision] = useState(0);
  const [config, setConfig] = useState<ApprovalConfig>(emptyApprovalConfig), [users, setUsers] = useState<InternalUser[]>([]);
  const [selected, setSelected] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const node = config.nodes.find(item => item.id === selected), allowed = canManageRouting(actor), editable = ready && allowed && enabled && !busy;

  function applyData(data: Awaited<ReturnType<typeof readApprovalData>>) {
    setRuleRevision(data.rule.revision); setEnabled(data.rule.enabled !== false); setConfig(data.config); setUsers(data.users); setSelected(data.config.nodes[0]?.id ?? ''); setDirty(false); setReady(true); setError('');
  }
  useEffect(() => {
    let active = true;
    void readApprovalData(ruleId, scope).then(data => { if (active) applyData(data); }).catch(error => { if (active) setError(error instanceof Error ? error.message : '审批配置读取失败。'); });
    return () => { active = false; };
  }, [ruleId, scope]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit(next: ApprovalConfig, message = '') {
    if (!editable) return;
    setConfig(next); setDirty(true); setError(''); setNotice(message);
  }
  function update(change: Partial<ApprovalNode>) {
    if (node) edit({ ...config, nodes: config.nodes.map(item => item.id === node.id ? { ...item, ...change } : item) });
  }
  function add() {
    if (!editable) return;
    if (config.nodes.length >= 50) { setError('最多配置 50 个审批节点。'); return; }
    const next = { ...newApprovalNode(), name: '审批环节' }, nodes = [...config.nodes, next];
    edit({ ...config, nodes }, '已添加审批环节，请设置审批人。'); setSelected(next.id);
  }
  async function save() {
    if (lock.current || !editable) return;
    const issue = approvalConfigIssue(config, users); if (issue) { setError(issue); return; }
    lock.current = true; setBusy(true); setError('');
    try { const saved = await saveApprovalConfig(actor, ruleId, config, config.revision, ruleRevision, scope); setRuleRevision(value => value + 1); setConfig(saved); setDirty(false); setNotice('审批流程配置已保存。'); }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  function owner(item: ApprovalNode) {
    if (item.source === 'manager') return '申请人的汇报人';
    if (item.source === 'org') return item.stopUserIds.length ? `逐级审批至 ${item.stopUserIds.map(id => users.find(user => user.id === id)?.name ?? `${id}（已不存在）`).join('、')}（最先到达者）` : `沿申请人汇报关系向上 ${Number.isFinite(item.depth) ? item.depth : '待填写'} 级`;
    const id = item.userIds[0];
    return id ? users.find(user => user.id === id)?.name ?? `${id}（已不存在）` : '请选择一位审批人';
  }
  return <div className="approval-settings">
    <header className="approval-editor-header">
      <Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirmBack(true) : onBack()}><ArrowLeft size={16} />{localize("返回规则列表")}</Button>
      <div className="approval-toolbar-actions"><span className="sr-help">{localize(dirty ? '有未保存的修改' : config.revision ? '已保存' : '尚未配置')}</span>
        {localize(allowed && <Button disabled={!editable || !dirty} onClick={() => void save()}><Save size={16} />{localize(busy ? '处理中…' : '保存流程')}</Button>)}
      </div>
    </header>
    <div className="approval-toolbar"><Field label={localize("流程名称")}><Input aria-label={localize("审批流程名称")} maxLength={80} value={config.name} disabled={!editable} onChange={event => edit({ ...config, name: event.target.value })} /></Field><p className="approval-policy-note">{localize("每级一位审批人，按顺序审批；任一环节驳回均退回申请人。")}</p></div>
    {localize(error && <p className="sr-error" role="alert">{localize(error)}</p>)}{localize(notice && <output className="submission-rule-notice block">{localize(notice)}</output>)}
    {localize(!ready ? <p className="approval-empty">{localize(error ? '无法加载审批配置，请刷新页面重试。' : '正在读取审批配置…')}</p> : <>
    {localize(!allowed && <p className="sr-help">{localize("仅系统管理员可维护审批流程。")}</p>)}
    <div className="approval-designer">
      <section className="approval-canvas" aria-label={localize("审批流程画布")}>
        <div className="approval-canvas-heading"><div><h3>{localize("审批流程")}<span>{localize(config.nodes.length)} {localize(" 个环节")}</span></h3><p className="sr-help">{localize("点击环节设置审批人。")}</p></div><div className="approval-add-actions"><Button variant="outline" disabled={!editable || config.nodes.length >= 50} onClick={add}><Plus size={16} />{localize("添加审批环节")}</Button></div></div>
        <div className="approval-sequence"><div className="approval-terminal">{localize("申请人发起")}</div>
        {localize(Array.from({ length: config.nodes.length + 1 }, (_, index) => {
          const item = config.nodes[index]; return <div key={item?.id ?? 'end'}>
            <div className="approval-connector" aria-hidden="true" />
            {localize(item && <article className={`approval-node${selected === item.id ? ' is-selected' : ''}`}>
              <header><span>{localize("节点")}{localize(index + 1)}</span></header>
              <button type="button" className="approval-node-content" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><strong>{localize(item.name || '未命名审批')}</strong><span>{localize(owner(item))}</span></button>
            </article>)}
          </div>;
        }))}
        {localize(!config.nodes.length && <div className="approval-empty"><UserRound size={28} /><strong>{localize("添加第一个审批环节")}</strong><p>{localize("点击“添加审批环节”，再在右侧设置审批人来源。")}</p></div>)}<div className="approval-terminal">{localize("全部通过 · 流程结束")}</div></div>
      </section>
      <aside className="approval-inspector" aria-label={localize("审批环节设置")}><h3>{localize("环节设置")}{localize(node && <small>{localize("第")}{localize(config.nodes.indexOf(node) + 1)} {localize(" 个环节")}</small>)}</h3>{localize(node ? <fieldset disabled={!editable}>
        <Field label={localize("环节名称")}><Input value={node.name} maxLength={80} onChange={event => update({ name: event.target.value })} /></Field>
        <Field label={localize("审批人来源")}><NativeSelect value={node.source} onChange={event => update({ source: event.target.value as ApprovalNode['source'] })}><option value="manager">{localize("申请人的汇报人")}</option><option value="org">{localize("沿汇报关系逐级审批")}</option><option value="people">{localize("指定内部用户")}</option></NativeSelect></Field>
        {localize(node.source === 'people' && <div className="approval-field"><span>{localize("审批人")}</span>
          <UserSearchSelect key={node.id} label={localize("搜索并选择审批人")} users={users} value={node.userIds[0] ?? ''} disabled={!editable}
            emptyHint="每级仅支持一位审批人，请选择后保存。" onChange={id => update({ userIds: id ? [id] : [] })} />
        </div>)}
        {localize(node.source === 'org' && <ApprovalStopUsers key={node.id} users={users} value={node.stopUserIds} disabled={!editable} onChange={stopUserIds => update({ stopUserIds })} />)}
        {localize(node.source === 'org' && !node.stopUserIds.length && <Field label={localize("向上审批级数（1–20）")}><Input type="number" min={1} max={20} step={1} value={Number.isFinite(node.depth) ? node.depth : ''} onChange={event => update({ depth: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>)}
        <div className="approval-node-actions"><Button variant="outline" disabled={!editable} onClick={() => { const nodes = config.nodes.filter(item => item.id !== node.id); edit({ ...config, nodes }, '节点已移除，保存后生效。'); setSelected(nodes[0]?.id ?? ''); }}><Trash2 size={14} />{localize("删除环节")}</Button></div>
      </fieldset> : <div className="approval-inspector-empty"><UserRound size={24} /><strong>{localize("选择一个审批环节")}</strong><p>{localize("在左侧添加或选择环节后，在此设置该环节的审批人。")}</p></div>)}</aside>
    </div>
    </>)}
    <Dialog open={confirmBack} onOpenChange={setConfirmBack}><DialogContent><DialogHeader><DialogTitle>{localize("返回规则列表？")}</DialogTitle><DialogDescription>{localize("当前流程有未保存的修改，返回后将放弃这些修改。")}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmBack(false)}>{localize("继续编辑")}</Button><Button onClick={onBack}>{localize("放弃修改并返回")}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
