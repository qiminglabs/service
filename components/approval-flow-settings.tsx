'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Copy, GitBranch, GripVertical, Plus, Save, Trash2, UserRound, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import { fixedIdentityRoles } from '@/lib/internal-users';
import { readApprovalData, saveApprovalConfig } from '@/lib/approval-flow-store';
import { approvalConfigIssue, emptyApprovalConfig, moveApprovalNode, newApprovalNode, previewApproval, type ApprovalConfig, type ApprovalNode, type ApprovalPreviewStep } from '@/lib/approval-flows';
import type { InternalUser } from '@/lib/service-requests';
import type { OperationActor } from '@/lib/request-operations';

const methods = { all: '会签 · 所有人同意', any: '或签 · 任一人同意', serial: '依次审批 · 按人员顺序' };
const components = [
  { kind: 'normal', label: '普通审批', help: '每次申请均执行', Icon: UserRound },
  { kind: 'conditional', label: '条件审批', help: '满足条件才执行', Icon: GitBranch },
  { kind: 'org', label: '逐级审批', help: '按汇报关系逐级展开', Icon: Users },
] as const;
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="approval-field"><span>{label}</span>{children}</label>; }
function conditionLabel(node: ApprovalNode) { return node.condition === 'always' ? '始终生效' : node.condition === 'risk' ? '风险等级为高时执行' : `申请金额 ≥ ${Number.isFinite(node.threshold) ? node.threshold.toLocaleString('zh-CN') : '待填写'} 元`; }

export function ApprovalFlowSettings({ actor }: { actor: OperationActor }) {
  const [config, setConfig] = useState<ApprovalConfig>(emptyApprovalConfig), [users, setUsers] = useState<InternalUser[]>([]);
  const [selected, setSelected] = useState(''), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [confirmReload, setConfirmReload] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false), [steps, setSteps] = useState<ApprovalPreviewStep[] | null>(null);
  const [applicant, setApplicant] = useState(''), [amount, setAmount] = useState('20000'), [risk, setRisk] = useState<'normal' | 'high'>('normal');
  const [dropSlot, setDropSlot] = useState<number | null>(null), [dragging, setDragging] = useState('');
  const lock = useRef(false), suppressClick = useRef(false);
  const drag = useRef<{ key: string; x: number; y: number; pointer: number; active: boolean; slot: number | null } | null>(null);
  const node = config.nodes.find(item => item.id === selected), allowed = canManageRouting(actor), editable = ready && allowed && !busy;
  const activeUsers = users.filter(user => user.status === '启用');

  function applyData(data: Awaited<ReturnType<typeof readApprovalData>>) {
    setConfig(data.config); setUsers(data.users); setSelected(data.config.nodes[0]?.id ?? ''); setDirty(false); setSteps(null); setReady(true); setError('');
    setApplicant(previous => data.users.some(user => user.id === previous && user.status === '启用') ? previous : data.users.find(user => user.status === '启用')?.id ?? '');
  }
  useEffect(() => {
    let active = true;
    void readApprovalData().then(data => { if (active) applyData(data); }).catch(error => { if (active) setError(error instanceof Error ? error.message : '审批配置读取失败。'); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  async function reload() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try { applyData(await readApprovalData()); setConfirmReload(false); setNotice('已重新加载保存的配置。'); }
    catch (error) { setError(error instanceof Error ? error.message : '加载失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  function edit(next: ApprovalConfig, message = '') {
    if (!editable) return;
    setConfig(next); setDirty(true); setSteps(null); setError(''); setNotice(message);
  }
  function update(change: Partial<ApprovalNode>) {
    if (node) edit({ ...config, nodes: config.nodes.map(item => item.id === node.id ? { ...item, ...change } : item) });
  }
  function add(kind: typeof components[number]['kind'], at = config.nodes.length) {
    if (!editable) return;
    if (config.nodes.length >= 50) { setError('最多配置 50 个审批节点。'); return; }
    const next = newApprovalNode(kind), nodes = [...config.nodes]; nodes.splice(at, 0, next);
    edit({ ...config, nodes }, '已添加审批节点，请设置审批人和生效条件。'); setSelected(next.id);
  }
  function move(id: string, at: number) { edit({ ...config, nodes: moveApprovalNode(config.nodes, id, at) }, '审批顺序已调整，保存后保留。'); setSelected(id); }
  async function save() {
    if (lock.current || !editable) return;
    const issue = approvalConfigIssue(config, users); if (issue) { setError(issue); return; }
    lock.current = true; setBusy(true); setError('');
    try { const saved = await saveApprovalConfig(actor, config, config.revision); setConfig(saved); setDirty(false); setNotice('审批流程配置已保存。'); }
    catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  async function simulate() {
    if (lock.current || !ready) return;
    setPreviewOpen(true); setSteps(null); setError('');
    if (!amount.trim()) { setError('请填写模拟申请金额。'); return; }
    lock.current = true; setBusy(true);
    try { const latest = await readApprovalData(); setUsers(latest.users); setSteps(previewApproval(config, latest.users, { applicantId: applicant, amount: Number(amount), risk })); }
    catch (error) { setError(error instanceof Error ? error.message : '模拟失败，请重试。'); }
    finally { lock.current = false; setBusy(false); }
  }
  function owner(item: ApprovalNode) {
    if (item.source === 'manager') return '申请人的汇报人';
    if (item.source === 'org') return `沿申请人汇报关系向上 ${Number.isFinite(item.depth) ? item.depth : '待填写'} 级`;
    if (item.source === 'role') return item.role;
    return item.userIds.map(id => users.find(user => user.id === id)?.name ?? `${id}（已不存在）`).join('、') || '请选择审批人';
  }
  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!editable || event.button !== 0) return;
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-approval-drag]');
    if (handle) drag.current = { key: handle.dataset.approvalDrag!, x: event.clientX, y: event.clientY, pointer: event.pointerId, active: false, slot: null };
  }
  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) return;
    if (!current.active) event.currentTarget.setPointerCapture(event.pointerId);
    current.active = true; suppressClick.current = true; event.preventDefault(); setDragging(current.key);
    const bounds = event.currentTarget.querySelector('.approval-canvas')!.getBoundingClientRect();
    const inside = event.clientX >= bounds.left && event.clientX <= bounds.right && event.clientY >= bounds.top && event.clientY <= bounds.bottom;
    let at: number | null = null, distance = Infinity;
    if (inside) event.currentTarget.querySelectorAll<HTMLElement>('[data-approval-slot]').forEach(slot => {
      const rect = slot.getBoundingClientRect(), d = Math.abs(event.clientY - (rect.top + rect.height / 2));
      if (d < distance) { distance = d; at = Number(slot.dataset.approvalSlot); }
    });
    current.slot = at; setDropSlot(at);
  }
  function pointerUp(event: ReactPointerEvent<HTMLDivElement>, cancel = false) {
    const current = drag.current; if (!current || current.pointer !== event.pointerId) return;
    drag.current = null; setDropSlot(null); setDragging('');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancel && current.active && current.slot !== null) {
      if (current.key.startsWith('new:')) add(current.key.slice(4) as typeof components[number]['kind'], current.slot); else move(current.key, current.slot);
    }
    window.setTimeout(() => { suppressClick.current = false; }, 0);
  }

  return <div className="approval-settings">
    <div className="approval-toolbar"><Field label="流程名称"><Input aria-label="审批流程名称" maxLength={80} value={config.name} disabled={!editable} onChange={event => edit({ ...config, name: event.target.value })} /></Field>
      <div className="approval-toolbar-actions"><span className="sr-help">{dirty ? '有未保存的修改' : config.revision ? '已保存' : '尚未配置'}</span>
        <Button variant="outline" disabled={busy} onClick={() => dirty ? setConfirmReload(true) : void reload()}>重新加载</Button>
        <Button variant="outline" disabled={!ready || busy} onClick={() => { const issue = approvalConfigIssue(config, users); setError(issue ?? ''); setNotice(issue ? '' : '配置校验通过。可模拟查看汇报链和实际审批人。'); }}><CheckCheck size={16} />校验</Button>
        <Button variant="outline" disabled={!ready || busy} onClick={() => void simulate()}>模拟审批路径</Button>
        {allowed && <Button disabled={!editable || !dirty} onClick={() => void save()}><Save size={16} />{busy ? '处理中…' : '保存流程'}</Button>}
      </div>
    </div>
    {error && <p className="sr-error" role="alert">{error}</p>}{notice && <p className="submission-rule-notice" role="status">{notice}</p>}
    {!ready ? <p className="approval-empty">{error ? '无法加载审批配置，请重新加载。' : '正在读取审批配置…'}</p> : <>
    {!allowed && <p className="sr-help">仅系统管理员可维护审批流程。</p>}
    <div className="approval-designer" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={event => pointerUp(event)} onPointerCancel={event => pointerUp(event, true)}>
      <aside className="approval-library" aria-label="审批组件"><h3>添加审批级别</h3><p className="sr-help">拖入流程，或点击添加。</p>{components.map(({ kind, label, help, Icon }) => <Button key={kind} variant="outline" className="approval-palette" data-approval-drag={`new:${kind}`} disabled={!editable} onClick={() => { if (!suppressClick.current) add(kind); }}><Icon size={18} /><span>{label}<small>{help}</small></span><GripVertical size={14} /></Button>)}</aside>
      <main className="approval-canvas" aria-label="审批流程画布"><div className="approval-canvas-heading"><strong>审批顺序</strong><span>{config.nodes.length} 个配置节点</span></div><div className="approval-terminal">申请人发起</div>
        {Array.from({ length: config.nodes.length + 1 }, (_, index) => {
          const item = config.nodes[index]; return <div key={item?.id ?? 'end'}>
            <div className={`approval-drop-slot${dropSlot === index ? ' is-over' : ''}`} data-approval-slot={index}>{dropSlot === index && <span>放置在此处</span>}</div>
            {item && <article className={`approval-node${selected === item.id ? ' is-selected' : ''}${dragging === item.id ? ' is-dragging' : ''}`}>
              <header><Button variant="ghost" disabled={!editable} className="approval-grip" data-approval-drag={item.id} aria-label={`拖动${item.name}`} onClick={() => { if (!suppressClick.current) setSelected(item.id); }}><GripVertical size={16} />拖动</Button><span>节点 {index + 1}</span><Button variant="ghost" size="icon-sm" disabled={!editable || index === 0} aria-label={`上移${item.name}`} onClick={() => move(item.id, index - 1)}><ArrowUp size={15} /></Button><Button variant="ghost" size="icon-sm" disabled={!editable || index === config.nodes.length - 1} aria-label={`下移${item.name}`} onClick={() => move(item.id, index + 2)}><ArrowDown size={15} /></Button></header>
              <button type="button" className="approval-node-content" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><strong>{item.name || '未命名审批'}</strong><span>{owner(item)}</span>{['people', 'role'].includes(item.source) && <small>{methods[item.method]}</small>}<em>{conditionLabel(item)}</em></button>
            </article>}
          </div>;
        })}
        {!config.nodes.length && <p className="approval-empty">从左侧添加第一个审批级别。</p>}<div className="approval-terminal">全部通过 · 流程结束</div><Button variant="outline" disabled={!editable} className="approval-add" onClick={() => add('normal')}><Plus size={16} />添加审批级别</Button>
      </main>
      <aside className="approval-inspector" aria-label="审批级别设置"><h3>级别设置{node && <small>节点 {config.nodes.indexOf(node) + 1}</small>}</h3>{node ? <fieldset disabled={!editable}>
        <Field label="级别名称"><Input value={node.name} maxLength={80} onChange={event => update({ name: event.target.value })} /></Field>
        <Field label="审批人来源"><NativeSelect value={node.source} onChange={event => update({ source: event.target.value as ApprovalNode['source'] })}><option value="manager">申请人的汇报人</option><option value="org">沿汇报关系逐级审批</option><option value="people">指定内部用户</option><option value="role">指定角色</option></NativeSelect></Field>
        {node.source === 'people' && <div className="approval-people"><span>审批人（按选择顺序）</span>{[...node.userIds, ...activeUsers.map(user => user.id).filter(id => !node.userIds.includes(id))].map(id => { const user = users.find(user => user.id === id); return <label key={id}><Checkbox checked={node.userIds.includes(id)} disabled={!editable || (!node.userIds.includes(id) && user?.status !== '启用')} onCheckedChange={checked => update({ userIds: checked ? [...node.userIds, id] : node.userIds.filter(value => value !== id) })} /><span>{user?.name ?? id}{user?.status !== '启用' && '（不可用，请移除）'}{node.userIds.includes(id) && <small>第 {node.userIds.indexOf(id) + 1} 位</small>}</span></label>; })}</div>}
        {node.source === 'role' && <Field label="审批角色"><NativeSelect value={node.role} onChange={event => update({ role: event.target.value })}>{[...new Set(Object.values(fixedIdentityRoles))].map(role => <option key={role} value={role}>{role}</option>)}</NativeSelect></Field>}
        {node.source === 'org' && <Field label="向上审批级数（1–20）"><Input type="number" min={1} max={20} step={1} value={Number.isFinite(node.depth) ? node.depth : ''} onChange={event => update({ depth: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>}
        {(node.source === 'manager' || node.source === 'org') && <p className="sr-help">从申请人开始，读取「引用数据 → 内部用户」的汇报人关系。</p>}
        {['people', 'role'].includes(node.source) && <Field label="同级多人审批方式"><NativeSelect value={node.method} onChange={event => update({ method: event.target.value as ApprovalNode['method'] })}>{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field>}
        <hr /><Field label="此级生效条件"><NativeSelect value={node.condition} onChange={event => update({ condition: event.target.value as ApprovalNode['condition'] })}><option value="always">始终生效</option><option value="amount">申请金额达到阈值</option><option value="risk">风险等级为高</option></NativeSelect></Field>
        {node.condition === 'amount' && <Field label="金额阈值（元）"><Input type="number" min={0} step="0.01" value={Number.isFinite(node.threshold) ? node.threshold : ''} onChange={event => update({ threshold: event.target.value === '' ? NaN : Number(event.target.value) })} /></Field>}
        {node.condition !== 'always' && <p className="sr-help">未满足条件时跳过此级，继续后续节点。</p>}
        <hr /><Field label="此级驳回时"><NativeSelect value={node.reject} onChange={event => update({ reject: event.target.value as ApprovalNode['reject'] })}><option value="return">退回申请人，修改后重新发起</option><option value="end">结束本次申请</option></NativeSelect></Field>
        <Field label="找不到审批人时"><NativeSelect value={node.missing} onChange={event => update({ missing: event.target.value as ApprovalNode['missing'] })}><option value="admin">交由流程管理员处理</option><option value="block">暂停流转，补充审批人</option></NativeSelect></Field>
        <div className="approval-toolbar-actions"><Button variant="outline" disabled={!editable || config.nodes.length >= 50} onClick={() => { const copy = { ...structuredClone(node), id: crypto.randomUUID(), name: `${node.name.slice(0, 76)}（副本）` }, nodes = [...config.nodes]; nodes.splice(nodes.indexOf(node) + 1, 0, copy); edit({ ...config, nodes }); setSelected(copy.id); }}><Copy size={14} />复制</Button><Button variant="outline" disabled={!editable} onClick={() => { const nodes = config.nodes.filter(item => item.id !== node.id); edit({ ...config, nodes }, '节点已移除，保存后生效。'); setSelected(nodes[0]?.id ?? ''); }}><Trash2 size={14} />删除</Button></div>
      </fieldset> : <p className="sr-help">选择节点以编辑审批规则。</p>}</aside>
    </div>
    {previewOpen && <section className="approval-preview" aria-label="审批路径模拟"><div className="approval-canvas-heading"><strong>模拟审批路径</strong><Button variant="ghost" onClick={() => setPreviewOpen(false)}>收起</Button></div><div className="approval-preview-form">
      <Field label="内部申请人"><NativeSelect value={applicant} onChange={event => { setApplicant(event.target.value); setSteps(null); }}><option value="">请选择</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name} · {user.department}</option>)}</NativeSelect></Field>
      <Field label="申请金额（元）"><Input type="number" min={0} step="0.01" value={amount} onChange={event => { setAmount(event.target.value); setSteps(null); }} /></Field><Field label="风险等级"><NativeSelect value={risk} onChange={event => { setRisk(event.target.value as 'normal' | 'high'); setSteps(null); }}><option value="normal">普通风险</option><option value="high">高风险</option></NativeSelect></Field><Button disabled={busy} onClick={() => void simulate()}>重新模拟</Button>
    </div><p className="sr-help">使用当前编辑内容与最新内部用户关系预览，不创建审批任务。</p>
    <div className="approval-preview-path" aria-live="polite">{steps ? steps.map((step, index) => <div key={`${step.nodeId}-${index}`} className="approval-preview-step" data-status={step.status}><strong>{index + 1}. {step.name}</strong><span>{step.status === 'skipped' ? '已跳过' : step.status === 'blocked' ? '暂停流转' : step.status === 'admin' ? '转管理员处理' : step.users.map(user => user.name).join(' → ')}</span>{step.method && <small>{methods[step.method]}</small>}<small>{step.detail}</small></div>) : <p className="sr-help">设置申请条件后，点击重新模拟。</p>}</div>
    {steps && <p className={steps.every(step => step.status === 'skipped') || steps.some(step => step.status === 'blocked' || step.status === 'admin') ? 'sr-error' : 'sr-help'}>{steps.every(step => step.status === 'skipped') ? '没有有效审批节点，请调整生效条件；不会自动视为通过。' : steps.some(step => step.status === 'blocked' || step.status === 'admin') ? '存在无法解析审批人的节点，请先完善汇报关系或由管理员处理。后续节点仅作预览。' : '上述有效审批节点全部通过后结束流程。'}</p>}
    </section>}
    </>}
    <Dialog open={confirmReload} onOpenChange={setConfirmReload}><DialogContent><DialogHeader><DialogTitle>重新加载审批配置？</DialogTitle><DialogDescription>当前未保存的修改将被放弃，恢复最近保存的审批流程。</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={busy} onClick={() => setConfirmReload(false)}>继续编辑</Button><Button disabled={busy} onClick={() => void reload()}>放弃修改并重新加载</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
