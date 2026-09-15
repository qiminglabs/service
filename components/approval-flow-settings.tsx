'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Plus, Save, Trash2, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { UserSearchSelect } from '@/components/user-search-select';
import { NativeSelect } from '@/components/ui/native-select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import { readApprovalData, saveApprovalConfig } from '@/lib/approval-flow-store';
import { approvalConfigIssue, emptyApprovalConfig, newApprovalNode, type ApprovalConfig, type ApprovalNode } from '@/lib/approval-flows';
import type { InternalUser } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="approval-field"><span>{label}</span>{children}</label>; }

function ApprovalStopUsers({ users, value, disabled, onChange }: { users: InternalUser[]; value: string[]; disabled: boolean; onChange: (ids: string[]) => void }) {
  const [query, setQuery] = useState('');
  const available = users.filter(user => user.status === '启用' && !value.includes(user.id));
  const selected = value.map(id => users.find(user => user.id === id) ?? { id, name: id, email: '', status: '已不存在' });
  const matches = available.filter(user => `${user.name} ${user.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="approval-field" role="group" aria-label="审批截止人">
    <span>审批截止人 <small>（可多选）</small></span>
    <Input aria-label="搜索审批截止人" placeholder="搜索姓名或邮箱" value={query} disabled={disabled} onChange={event => setQuery(event.target.value)} />
    <div className="approval-stop-users">
      {[...selected, ...matches].map(user => <label key={user.id}>
        <input type="checkbox" checked={value.includes(user.id)} disabled={disabled} onChange={event => onChange(event.target.checked ? [...value, user.id] : value.filter(id => id !== user.id))} />
        <span>{user.name}<small>{user.email}</small>{user.status !== '启用' && <small>不可用，请取消选择</small>}</span>
      </label>)}
      {!selected.length && !matches.length && <p className="sr-help">没有匹配的内部用户</p>}
    </div>
    <small className="sr-help">{value.length ? `已选 ${value.length} 人。沿汇报关系遇到其中任意一人，由其完成最后一级审批。` : '未选择时按指定级数审批；选择后以最先遇到的截止人为终点。'}</small>
  </div>;
}

export function ApprovalFlowSettings({ actor, ruleId, onBack }: { actor: OperationActor; ruleId: string; onBack: () => void }) {
  const [confirmBack, setConfirmBack] = useState(false);
  const [config, setConfig] = useState<ApprovalConfig>(emptyApprovalConfig), [users, setUsers] = useState<InternalUser[]>([]);
  const [selected, setSelected] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const lock = useRef(false);
  const node = config.nodes.find(item => item.id === selected), allowed = canManageRouting(actor), editable = ready && allowed && !busy;

  function applyData(data: Awaited<ReturnType<typeof readApprovalData>>) {
    setConfig(data.config); setUsers(data.users); setSelected(data.config.nodes[0]?.id ?? ''); setDirty(false); setReady(true); setError('');
  }
  useEffect(() => {
    let active = true;
    void readApprovalData(ruleId).then(data => { if (active) applyData(data); }).catch(error => { if (active) setError(error instanceof Error ? error.message : '审批配置读取失败。'); });
    return () => { active = false; };
  }, [ruleId]);
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
    try { const saved = await saveApprovalConfig(actor, ruleId, config, config.revision); setConfig(saved); setDirty(false); setNotice('审批流程配置已保存。'); }
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
      <Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirmBack(true) : onBack()}><ArrowLeft size={16} />返回规则列表</Button>
      <div className="approval-toolbar-actions"><span className="sr-help">{dirty ? '有未保存的修改' : config.revision ? '已保存' : '尚未配置'}</span>
        {allowed && <Button disabled={!editable || !dirty} onClick={() => void save()}><Save size={16} />{busy ? '处理中…' : '保存流程'}</Button>}
      </div>
    </header>
    <div className="approval-toolbar"><Field label="流程名称"><Input aria-label="审批流程名称" maxLength={80} value={config.name} disabled={!editable} onChange={event => edit({ ...config, name: event.target.value })} /></Field><p className="approval-policy-note">每级一位审批人，按顺序审批；任一环节驳回均退回申请人。</p></div>
    {error && <p className="sr-error" role="alert">{error}</p>}{notice && <output className="submission-rule-notice block">{notice}</output>}
    {!ready ? <p className="approval-empty">{error ? '无法加载审批配置，请刷新页面重试。' : '正在读取审批配置…'}</p> : <>
    {!allowed && <p className="sr-help">仅系统管理员可维护审批流程。</p>}
    <div className="approval-designer">
      <section className="approval-canvas" aria-label="审批流程画布">
        <div className="approval-canvas-heading"><div><h3>审批流程 <span>{config.nodes.length} 个环节</span></h3><p className="sr-help">点击环节设置审批人。</p></div><div className="approval-add-actions"><Button variant="outline" disabled={!editable || config.nodes.length >= 50} onClick={add}><Plus size={16} />添加审批环节</Button></div></div>
        <div className="approval-sequence"><div className="approval-terminal">申请人发起</div>
        {Array.from({ length: config.nodes.length + 1 }, (_, index) => {
          const item = config.nodes[index]; return <div key={item?.id ?? 'end'}>
            <div className="approval-connector" aria-hidden="true" />
            {item && <article className={`approval-node${selected === item.id ? ' is-selected' : ''}`}>
              <header><span>节点 {index + 1}</span></header>
              <button type="button" className="approval-node-content" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><strong>{item.name || '未命名审批'}</strong><span>{owner(item)}</span></button>
            </article>}
          </div>;
        })}
        {!config.nodes.length && <div className="approval-empty"><UserRound size={28} /><strong>添加第一个审批环节</strong><p>点击“添加审批环节”，再在右侧设置审批人来源。</p></div>}<div className="approval-terminal">全部通过 · 流程结束</div></div>
      </section>
      <aside className="approval-inspector" aria-label="审批环节设置"><h3>环节设置{node && <small>第 {config.nodes.indexOf(node) + 1} 个环节</small>}</h3>{node ? <fieldset disabled={!editable}>
        <Field label="环节名称"><Input value={node.name} maxLength={80} onChange={event => update({ name: event.target.value })} /></Field>
        <Field label="审批人来源"><NativeSelect value={node.source} onChange={event => update({ source: event.target.value as ApprovalNode['source'] })}><option value="manager">申请人的汇报人</option><option value="org">沿汇报关系逐级审批</option><option value="people">指定内部用户</option></NativeSelect></Field>
        {node.source === 'people' && <div className="approval-field"><span>审批人</span>
          <UserSearchSelect key={node.id} label="搜索并选择审批人" users={users} value={node.userIds[0] ?? ''} disabled={!editable}
            emptyHint="每级仅支持一位审批人，请选择后保存。" onChange={id => update({ userIds: id ? [id] : [] })} />
        </div>}
        {node.source === 'org' && <ApprovalStopUsers key={node.id} users={users} value={node.stopUserIds} disabled={!editable} onChange={stopUserIds => update({ stopUserIds })} />}
        {node.source === 'org' && !node.stopUserIds.length && <Field label="向上审批级数（1–20）"><Input type="number" min={1} max={20} step={1} value={Number.isFinite(node.depth) ? node.depth : ''} onChange={event => update({ depth: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>}
        <div className="approval-node-actions"><Button variant="outline" disabled={!editable} onClick={() => { const nodes = config.nodes.filter(item => item.id !== node.id); edit({ ...config, nodes }, '节点已移除，保存后生效。'); setSelected(nodes[0]?.id ?? ''); }}><Trash2 size={14} />删除环节</Button></div>
      </fieldset> : <div className="approval-inspector-empty"><UserRound size={24} /><strong>选择一个审批环节</strong><p>在左侧添加或选择环节后，在此设置该环节的审批人。</p></div>}</aside>
    </div>
    </>}
    <Dialog open={confirmBack} onOpenChange={setConfirmBack}><DialogContent><DialogHeader><DialogTitle>返回规则列表？</DialogTitle><DialogDescription>当前流程有未保存的修改，返回后将放弃这些修改。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmBack(false)}>继续编辑</Button><Button onClick={onBack}>放弃修改并返回</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
