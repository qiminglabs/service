'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { RuleDeleteDialog } from '@/components/rule-delete-dialog';
import { canManageRouting } from '@/lib/assessment-routing-store';
import { responsibleTeams } from '@/lib/customer-teams';
import { readExecutionData, saveExecutionConfig } from '@/lib/execution-flow-store';
import { copyExecutionFlow, copyExecutionStep, emptyExecutionConfig, executionStepTypes, matchExecutionFlow, newExecutionStep, type ExecutionAssignment, type ExecutionConfig, type ExecutionFlow, type ExecutionStep } from '@/lib/execution-flows';
import type { OperationActor } from '@/lib/request-operations';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="execution-field"><span>{label}</span>{children}</label>;
}
function Flag({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="execution-flag"><Checkbox checked={checked} onCheckedChange={onChange} />{label}</label>;
}
const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean);
type Data = Awaited<ReturnType<typeof readExecutionData>>;

export function ExecutionFlowSettings({ tab, actor }: { tab: string; actor: OperationActor }) {
  const [data, setData] = useState<Data>({ config: emptyExecutionConfig(), workspace: { services: [], customers: [], users: [] } });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [flow, setFlow] = useState<ExecutionFlow>(), [rule, setRule] = useState<ExecutionAssignment>(), [deleteRule, setDeleteRule] = useState<ExecutionAssignment>();
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [importStep, setImportStep] = useState('');
  const [testService, setTestService] = useState(''), [testTeam, setTestTeam] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const locked = useRef(false), revision = useRef(0), fileLock = useRef(false);
  const allowed = canManageRouting(actor), flowsTab = tab === 'execution-flows';
  const { config, workspace } = data;
  const teams = [...new Set([...responsibleTeams, ...workspace.customers.map(customer => customer.team).filter((team): team is string => !!team), ...config.assignments.flatMap(rule => rule.customerTeams)])];
  async function reload() {
    try { setData(await readExecutionData()); setReady(true); setError(''); }
    catch (error) { setError(error instanceof Error ? error.message : '配置读取失败，请重试。'); }
  }
  useEffect(() => {
    let active = true;
    void readExecutionData().then(value => { if (active) { setData(value); setReady(true); } }).catch(() => { if (active) setError('配置读取失败，请刷新重试。'); });
    return () => { active = false; };
  }, []);
  async function persist(next: ExecutionConfig, close = false) {
    if (locked.current || !ready || !allowed) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const saved = await saveExecutionConfig(actor, next, flow || rule || deleteRule ? revision.current : config.revision);
      setData(previous => ({ ...previous, config: saved }));
      if (close) { setFlow(undefined); setRule(undefined); setDeleteRule(undefined); }
      setNotice('配置已保存。');
    } catch (error) { setError(error instanceof Error ? error.message : '保存失败，请重试。'); }
    finally { locked.current = false; setBusy(false); }
  }
  function editFlow(value?: ExecutionFlow, copy = false) {
    revision.current = config.revision; setError(''); setImportStep('');
    setFlow(value ? copy ? copyExecutionFlow(value) : structuredClone(value) : { id: crypto.randomUUID(), name: '', description: '', enabled: false, steps: [] });
  }
  function updateStep(id: string, change: Partial<ExecutionStep>) {
    setFlow(previous => previous && ({ ...previous, steps: previous.steps.map(step => step.id === id ? { ...step, ...change } : step) }));
  }
  function moveStep(index: number, offset: number) {
    if (!flow || index + offset < 0 || index + offset >= flow.steps.length) return;
    const steps = [...flow.steps]; [steps[index], steps[index + offset]] = [steps[index + offset], steps[index]];
    setFlow({ ...flow, steps });
  }
  async function attach(stepId: string, files: File[]) {
    if (fileLock.current || !files.length) return;
    fileLock.current = true; setFileBusy(true); setError('');
    try {
      const current = flow?.steps.find(step => step.id === stepId);
      if (!current || current.attachments.length + files.length > 10) throw new Error('每个步骤最多添加 10 个说明附件。');
      if (files.some(file => file.size > 5 * 1024 * 1024)) throw new Error('单个说明附件不能超过 5 MB。');
      const attachments = await Promise.all(files.map(file => new Promise<{ id: string; name: string; size: number; data: string }>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(new Error('附件读取失败，请重试。'));
        reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name, size: file.size, data: String(reader.result) }); reader.readAsDataURL(file);
      })));
      setFlow(previous => previous && ({ ...previous, steps: previous.steps.map(step => step.id === stepId ? { ...step, attachments: [...step.attachments, ...attachments] } : step) }));
    } catch (error) { setError(error instanceof Error ? error.message : '附件添加失败。'); }
    finally { fileLock.current = false; setFileBusy(false); }
  }
  function editRule(value?: ExecutionAssignment) {
    revision.current = config.revision; setError('');
    setRule(value ? structuredClone(value) : { id: crypto.randomUUID(), name: '', serviceId: '', customerTeams: [], flowId: '', priority: 0, enabled: true });
  }
  const filteredFlows = config.flows.filter(flow => (!query || `${flow.name} ${flow.description}`.includes(query)) && (status === 'all' || flow.enabled === (status === 'enabled')));
  const filteredRules = config.assignments.filter(rule => (!query || `${rule.name} ${workspace.services.find(service => service.id === rule.serviceId)?.name ?? ''}`.includes(query)) && (status === 'all' || rule.enabled === (status === 'enabled'))).sort((a, b) => b.priority - a.priority);
  const preview = testService ? matchExecutionFlow(config, testService, testTeam) : undefined;
  const catalogName = (id: string) => workspace.services.find(service => service.id === id)?.name ?? `${id}（已不存在）`;
  const editorError = error && <p className="sr-error" role="alert">{error}</p>;

  return <div className="execution-settings">
    <div className="execution-toolbar">
      <div className="execution-filters"><Input aria-label="搜索" placeholder={flowsTab ? '搜索流程名称或说明' : '搜索规则或服务目录'} value={query} onChange={event => setQuery(event.target.value)} />
        <NativeSelect aria-label="状态筛选" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option></NativeSelect>
        <Button variant="outline" disabled={busy} onClick={reload}>刷新</Button></div>
      <Button disabled={!ready || !allowed} onClick={() => flowsTab ? editFlow() : editRule()}><Plus size={16} />{flowsTab ? '新建执行流程' : '新建分配规则'}</Button>
    </div>
    {!allowed && <p className="execution-help">仅系统管理员可编辑配置。</p>}
    {!flow && !rule && !deleteRule && editorError}
    {notice && <p className="execution-notice" role="status">{notice}</p>}
    {!ready ? <p className="execution-empty">{error ? '暂时无法加载配置，请点击刷新重试。' : '正在加载配置…'}</p> : flowsTab ? <>
      <div className="table-scroll"><table className="reference-table app-list-table"><thead><tr><th>流程名称</th><th>步骤数</th><th>适用目录</th><th>状态</th><th>最后修改</th><th>操作</th></tr></thead><tbody>
        {filteredFlows.map(flow => { const serviceIds = [...new Set(config.assignments.filter(rule => rule.flowId === flow.id && rule.enabled).map(rule => rule.serviceId))]; return <tr key={flow.id}>
          <td><strong>{flow.name}</strong>{flow.description && <p className="execution-cell-note">{flow.description}</p>}</td>
          <td>{flow.steps.filter(step => step.enabled).length} / {flow.steps.length}<span className="execution-cell-note">启用 / 全部</span></td>
          <td><span title={serviceIds.map(catalogName).join('、')}>{serviceIds.length ? serviceIds.map(catalogName).join('、') : '未分配'}</span></td>
          <td><span className="reference-status" data-status={flow.enabled ? '启用' : '停用'}>{flow.enabled ? '启用' : '停用'}</span></td>
          <td>{flow.updatedAt ? new Date(flow.updatedAt).toLocaleString('zh-CN', { hour12: false }) : '—'}<span className="execution-cell-note">{flow.updatedBy}</span></td>
          <td><div className="execution-actions"><Button variant="ghost" onClick={() => editFlow(flow)}>{allowed ? '编辑' : '查看'}</Button><Button variant="ghost" disabled={!allowed} onClick={() => editFlow(flow, true)}><Copy size={14} />复制</Button></div></td>
        </tr>; })}
        {!filteredFlows.length && <tr><td colSpan={6} className="execution-empty">{config.flows.length ? '没有符合筛选条件的流程。' : '暂无执行流程。新建流程后，在流程内添加服务步骤。'}</td></tr>}
      </tbody></table></div>
      <details className="execution-guidance"><summary>流程与步骤使用说明</summary><p>步骤按顺序展示，不限制提前处理。必做步骤须全部完成；可选步骤允许跳过。标记为交付物的步骤，其产出纳入交付内容。</p><p>步骤由各流程独立维护，复制后互不影响。说明附件用于指导执行，与执行时提交的文件或文档产出分开。</p></details>
    </> : <>
      <p className="execution-help">按服务目录和客户负责团队匹配，优先级数值越大越优先。团队不限制时可作为该目录的兜底规则。</p>
      <div className="table-scroll"><table className="reference-table app-list-table"><thead><tr><th>规则名称</th><th>服务目录</th><th>客户负责团队</th><th>执行流程</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead><tbody>
        {filteredRules.map(rule => <tr key={rule.id}><td><strong>{rule.name}</strong></td><td>{catalogName(rule.serviceId)}</td><td>{rule.customerTeams.join('、') || '不限制'}</td><td>{config.flows.find(flow => flow.id === rule.flowId)?.name ?? '流程不存在'}</td><td>{rule.priority}</td><td>{rule.enabled ? '启用' : '停用'}</td><td><div className="execution-actions"><Button variant="ghost" onClick={() => editRule(rule)}>{allowed ? '编辑' : '查看'}</Button><Button variant="ghost" disabled={!allowed} onClick={() => { revision.current = config.revision; setError(''); setDeleteRule(rule); }}>删除</Button></div></td></tr>)}
        {!filteredRules.length && <tr><td colSpan={7} className="execution-empty">{config.assignments.length ? '没有符合筛选条件的规则。' : '暂无分配规则。先创建并启用流程，再为服务目录分配流程。'}</td></tr>}
      </tbody></table></div>
      <section className="execution-test"><h3>匹配测试</h3><div className="execution-grid"><Field label="服务目录"><NativeSelect value={testService} onChange={event => setTestService(event.target.value)}><option value="">请选择服务目录</option>{workspace.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</NativeSelect></Field><Field label="客户负责团队"><NativeSelect value={testTeam} onChange={event => setTestTeam(event.target.value)}><option value="">未指定团队</option>{teams.map(team => <option key={team}>{team}</option>)}</NativeSelect></Field></div>
        <p className="execution-test-result" role="status">{!testService ? '选择条件，查看已保存规则的匹配结果。' : preview ? `采用「${preview.flow.name}」 · 命中「${preview.rule.name}」 · 优先级 ${preview.rule.priority}` : '未匹配到执行流程，请为该目录配置适用规则。'}</p>
      </section>
    </>}

    <Dialog open={!!flow} onOpenChange={open => { if (!open && !busy && !fileBusy) { setFlow(undefined); setError(''); } }}>
      <DialogContent className="execution-dialog" showCloseButton={!busy && !fileBusy}>
        <DialogHeader><DialogTitle>{config.flows.some(item => item.id === flow?.id) ? '编辑执行流程' : '新建执行流程'}</DialogTitle><DialogDescription>维护流程及其服务步骤。步骤复制后独立保存。</DialogDescription></DialogHeader>
        {flow && <><div className="execution-editor-body"><fieldset disabled={!allowed || busy || fileBusy}>
          <div className="execution-grid"><Field label="流程名称 *"><Input value={flow.name} maxLength={120} onChange={event => setFlow({ ...flow, name: event.target.value })} /></Field><Field label="状态"><NativeSelect value={String(flow.enabled)} onChange={event => setFlow({ ...flow, enabled: event.target.value === 'true' })}><option value="false">停用</option><option value="true">启用</option></NativeSelect></Field></div>
          <Field label="流程说明"><Textarea value={flow.description} onChange={event => setFlow({ ...flow, description: event.target.value })} /></Field>
          <div className="execution-steps-heading"><h3>流程步骤 <span>{flow.steps.length}</span></h3><Button variant="outline" onClick={() => setFlow({ ...flow, steps: [...flow.steps, newExecutionStep()] })}><Plus size={16} />添加步骤</Button></div>
          <div className="execution-import"><NativeSelect aria-label="选择要复制的步骤" value={importStep} onChange={event => setImportStep(event.target.value)}><option value="">从其他流程选择步骤</option>{config.flows.filter(source => source.id !== flow.id).map(source => <optgroup label={source.name} key={source.id}>{source.steps.map(step => <option key={step.id} value={`${source.id}/${step.id}`}>{step.name}</option>)}</optgroup>)}</NativeSelect><Button variant="outline" disabled={!importStep} onClick={() => { const [sourceId, stepId] = importStep.split('/'); const step = config.flows.find(source => source.id === sourceId)?.steps.find(step => step.id === stepId); if (step) setFlow({ ...flow, steps: [...flow.steps, copyExecutionStep(step)] }); setImportStep(''); }}>复制到流程</Button></div>
          {!flow.steps.length && <p className="execution-empty">还没有步骤，请添加或从其他流程复制。</p>}
          {flow.steps.map((step, index) => <details key={step.id} className="execution-step" open>
            <summary><span className="execution-step-number">{index + 1}</span><strong>{step.name || '未命名步骤'}</strong><span className="execution-step-meta">{executionStepTypes[step.type]} · {step.required ? '必须完成' : '可选完成'}{step.deliverable ? ' · 交付物' : ''}{!step.enabled ? ' · 停用' : ''}</span></summary>
            <div className="execution-step-body"><div className="execution-actions execution-step-actions"><Button variant="ghost" aria-label={`上移步骤 ${index + 1}`} disabled={index === 0} onClick={() => moveStep(index, -1)}><ArrowUp size={15} />上移</Button><Button variant="ghost" aria-label={`下移步骤 ${index + 1}`} disabled={index === flow.steps.length - 1} onClick={() => moveStep(index, 1)}><ArrowDown size={15} />下移</Button><Button variant="ghost" onClick={() => setFlow({ ...flow, steps: [...flow.steps.slice(0, index + 1), copyExecutionStep(step), ...flow.steps.slice(index + 1)] })}><Copy size={15} />复制</Button><Button variant="ghost" onClick={() => setFlow({ ...flow, steps: flow.steps.filter(item => item.id !== step.id) })}><Trash2 size={15} />移除</Button></div>
              <div className="execution-grid"><Field label="步骤名称 *"><Input value={step.name} onChange={event => updateStep(step.id, { name: event.target.value })} /></Field><Field label="步骤类型"><NativeSelect value={step.type} onChange={event => updateStep(step.id, { type: event.target.value as ExecutionStep['type'] })}>{Object.entries(executionStepTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</NativeSelect></Field></div>
              <div className="execution-flags"><Flag label="启用步骤" checked={step.enabled} onChange={enabled => updateStep(step.id, { enabled })} /><Flag label="必须完成" checked={step.required} onChange={required => updateStep(step.id, { required })} /><Flag label="作为交付物" checked={step.deliverable} onChange={deliverable => updateStep(step.id, { deliverable })} /></div>
              <Field label="步骤说明"><Textarea value={step.description} onChange={event => updateStep(step.id, { description: event.target.value })} /></Field>
              <Field label="说明链接（每行一个）"><Textarea defaultValue={step.links.join('\n')} onBlur={event => updateStep(step.id, { links: lines(event.target.value) })} placeholder="https://…" /></Field>
              <Field label="说明附件（单个不超过 5 MB，最多 10 个）"><Input type="file" multiple onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void attach(step.id, files); }} /></Field>
              {step.attachments.length > 0 && <ul className="execution-attachments">{step.attachments.map(file => <li key={file.id}><a href={file.data} download={file.name}>{file.name}</a><span>{Math.ceil(file.size / 1024)} KB</span><Button variant="ghost" aria-label={`移除附件 ${file.name}`} onClick={() => updateStep(step.id, { attachments: step.attachments.filter(item => item.id !== file.id) })}><Trash2 size={14} /></Button></li>)}</ul>}
              {step.type === 'form' && <Field label="表单字段（每行一个，文本填写）"><Textarea defaultValue={step.formFields.join('\n')} onBlur={event => updateStep(step.id, { formFields: lines(event.target.value) })} placeholder={'例如：\n检查结果\n处理说明'} /></Field>}
              {step.type === 'upload' && <div className="execution-grid execution-grid-three"><Field label="允许的文件后缀"><Input value={step.fileExtensions} placeholder="如 .pdf,.docx，留空不限" onChange={event => updateStep(step.id, { fileExtensions: event.target.value })} /></Field><Field label="最多文件数"><Input type="number" min={1} max={50} value={step.maxFiles} onChange={event => updateStep(step.id, { maxFiles: Number(event.target.value) })} /></Field><Field label="单文件上限（MB）"><Input type="number" min={1} max={100} value={step.maxFileSizeMB} onChange={event => updateStep(step.id, { maxFileSizeMB: Number(event.target.value) })} /></Field></div>}
              {step.type === 'document' && <Field label="文档模板内容"><Textarea value={step.documentTemplate} rows={5} onChange={event => updateStep(step.id, { documentTemplate: event.target.value })} placeholder="填写文档结构或预置正文" /></Field>}
            </div>
          </details>)}
        </fieldset></div><DialogFooter>{editorError}<Button variant="outline" disabled={busy || fileBusy} onClick={() => { setFlow(undefined); setError(''); }}>取消</Button><Button disabled={!allowed || busy || fileBusy} onClick={() => { const saved = { ...flow, name: flow.name.trim(), updatedAt: new Date().toISOString(), updatedBy: actor.name }; void persist({ ...config, flows: config.flows.some(item => item.id === flow.id) ? config.flows.map(item => item.id === flow.id ? saved : item) : [...config.flows, saved] }, true); }}>{fileBusy ? '正在添加附件…' : busy ? '正在保存…' : '保存流程'}</Button></DialogFooter></>}
      </DialogContent>
    </Dialog>

    <Dialog open={!!rule} onOpenChange={open => { if (!open && !busy) { setRule(undefined); setError(''); } }}><DialogContent className="execution-dialog execution-rule-dialog" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>{config.assignments.some(item => item.id === rule?.id) ? '编辑分配规则' : '新建分配规则'}</DialogTitle><DialogDescription>服务目录与团队条件同时满足时命中；多个团队满足任一即可。</DialogDescription></DialogHeader>
      {rule && <><div className="execution-editor-body"><fieldset disabled={!allowed || busy}>
        <Field label="规则名称 *"><Input value={rule.name} onChange={event => setRule({ ...rule, name: event.target.value })} /></Field>
        <Field label="服务目录 *"><NativeSelect value={rule.serviceId} onChange={event => setRule({ ...rule, serviceId: event.target.value })}><option value="">请选择服务目录</option>{rule.serviceId && !workspace.services.some(service => service.id === rule.serviceId) && <option value={rule.serviceId}>{catalogName(rule.serviceId)}</option>}{workspace.services.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</NativeSelect></Field>
        <div className="execution-field"><span>客户负责团队（不选表示不限制）</span><div className="execution-flags">{teams.map(team => <Flag key={team} label={team} checked={rule.customerTeams.includes(team)} onChange={checked => setRule({ ...rule, customerTeams: checked ? [...rule.customerTeams, team] : rule.customerTeams.filter(value => value !== team) })} />)}</div></div>
        <Field label="执行流程 *"><NativeSelect value={rule.flowId} onChange={event => setRule({ ...rule, flowId: event.target.value })}><option value="">请选择已启用的流程</option>{config.flows.map(flow => <option key={flow.id} value={flow.id} disabled={!flow.enabled}>{flow.name}{!flow.enabled ? '（停用）' : ''}</option>)}</NativeSelect></Field>
        <div className="execution-grid"><Field label="优先级（数值越大越优先）"><Input type="number" min={0} max={9999} value={rule.priority} onChange={event => setRule({ ...rule, priority: Number(event.target.value) })} /></Field><Field label="状态"><NativeSelect value={String(rule.enabled)} onChange={event => setRule({ ...rule, enabled: event.target.value === 'true' })}><option value="true">启用</option><option value="false">停用</option></NativeSelect></Field></div>
        <p className="execution-help">每个目录可以配置一条团队不限制、优先级为 0 的规则，作为默认流程。</p>
      </fieldset></div><DialogFooter>{editorError}<Button variant="outline" disabled={busy} onClick={() => { setRule(undefined); setError(''); }}>取消</Button><Button disabled={!allowed || busy} onClick={() => void persist({ ...config, assignments: config.assignments.some(item => item.id === rule.id) ? config.assignments.map(item => item.id === rule.id ? rule : item) : [...config.assignments, rule] }, true)}>{busy ? '正在保存…' : '保存规则'}</Button></DialogFooter></>}
    </DialogContent></Dialog>
    <RuleDeleteDialog open={!!deleteRule} requirement={deleteRule?.name ?? ''} description="删除后，该规则不再参与流程匹配。执行流程本身会保留。" busy={busy} error={error} onCancel={() => { setDeleteRule(undefined); setError(''); }} onConfirm={() => void persist({ ...config, assignments: config.assignments.filter(rule => rule.id !== deleteRule?.id) }, true)} />
  </div>;
}
