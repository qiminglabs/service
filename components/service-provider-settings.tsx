'use client';

import { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Combobox, ComboboxInput, ComboboxContent, ComboboxEmpty, ComboboxList, ComboboxItem } from '@/components/ui/combobox';
import type { Partner } from '@/lib/partner-directory';
import type { OperationActor } from '@/lib/request-operations';
import { canManageRouting } from '@/lib/assessment-routing-store';
import { ServiceProviderConflict } from '@/lib/service-provider-settings';
import { readServiceProviders, saveServiceProvider, type ServiceProviderData } from '@/lib/service-provider-store';

export function ServiceProviderSettings({ actor }: { actor: OperationActor }) {
  const [data, setData] = useState<ServiceProviderData | null>(null);
  const [adding, setAdding] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [target, setTarget] = useState<{ id: string; name: string; enabled: boolean } | null>(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    readServiceProviders().then(value => { if (active) setData(value); }).catch(() => { if (active) setError('服务商配置读取失败，请重新进入该页签。'); });
    return () => { active = false; mounted.current = false; };
  }, []);
  const allowed = canManageRouting(actor) && !!data?.users.some(user => user.id === actor.id && user.status === '启用');
  const entries = data?.config.entries ?? [];
  const available = (data?.partners ?? []).filter(partner => partner.status === '启用' && !entries.some(entry => entry.partnerId === partner.id));
  const selected = available.find(partner => partner.id === selectedId) ?? null;
  async function save(partnerId: string, enabled: boolean) {
    if (!partnerId || !data || lock.current) return;
    lock.current = true; setBusy(true); setFormError(''); setNotice(''); setError('');
    const name = data.partners.find(partner => partner.id === partnerId)?.name ?? partnerId;
    const action = enabled ? entries.some(entry => entry.partnerId === partnerId) ? '启用' : '添加' : '停用';
    try {
      const saved = await saveServiceProvider(partnerId, enabled, data.config.revision, actor);
      if (!mounted.current) return;
      setData(saved); setTarget(null); setAdding(false); setSelectedId('');
      setNotice(`已${action}服务商「${name}」`);
    } catch (issue) {
      if (!mounted.current) return;
      if (issue instanceof ServiceProviderConflict) {
        try {
          const latest = await readServiceProviders();
          if (mounted.current) { setData(latest); setTarget(null); setAdding(false); setSelectedId(''); setError(issue.message); }
        } catch { if (mounted.current) setFormError('配置已变更，读取最新数据失败，请重新进入该页签。'); }
      } else setFormError(issue instanceof Error ? issue.message : '保存失败，请重试。');
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  function providerTable(enabled: boolean) {
    const providers = entries.filter(entry => entry.enabled === enabled);
    return <div className="table-scroll"><table className="reference-table app-list-table provider-settings-table">
      <thead><tr><th>企业名称</th><th>企业状态</th><th>{enabled ? '修改时间' : '停用时间'}</th><th>{enabled ? '修改人' : '停用人'}</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>{providers.map(entry => {
        const partner = data?.partners.find(partner => partner.id === entry.partnerId);
        const name = partner?.name ?? '企业已移除';
        return <tr key={entry.partnerId}>
          <td><strong>{name}</strong><small className="provider-settings-meta">{entry.partnerId}</small></td>
          <td>{partner?.status ?? '已移除'}</td>
          <td>{new Date(entry.updatedAt).toLocaleString('zh-CN', { hour12: false })}</td>
          <td>{entry.updatedBy || '—'}</td><td>{enabled ? '启用' : '停用'}</td>
          <td><Button variant="ghost" disabled={!allowed || busy || !partner || (!enabled && partner.status !== '启用')} onClick={() => { setTarget({ id: entry.partnerId, name, enabled: !enabled }); setFormError(''); setNotice(''); }}>{enabled ? '停用' : '启用'}</Button></td>
        </tr>;
      })}{!providers.length && <tr><td colSpan={6} className="routing-empty">{!data ? error ? '暂时无法读取服务商' : '正在读取配置…' : enabled ? '暂无服务商' : '暂无已停用服务商'}</td></tr>}</tbody>
    </table></div>;
  }
  return <div className="request-flow-settings provider-settings">
    {notice && <p className="provider-settings-feedback" role="status">{notice}</p>}
    {error && <p className="provider-settings-feedback sr-error" role="alert">{error}</p>}
    <section className="routing-rules" aria-label="服务商列表">
      <div className="submission-rules-toolbar"><strong>服务商</strong><Button disabled={!allowed || busy} onClick={() => { setAdding(true); setSelectedId(''); setFormError(''); setNotice(''); }}><Plus size={16} />添加服务商</Button></div>
      {providerTable(true)}
    </section>
    <details className="routing-rules disabled-rule-versions" aria-label="服务商（已停用）">
      <summary className="submission-rules-toolbar"><strong>服务商（已停用）</strong></summary>
      {providerTable(false)}
    </details>
    <Dialog open={adding} onOpenChange={open => { if (!open && !busy) setAdding(false); }}>
      <DialogContent className="provider-settings-dialog" aria-describedby={undefined} showCloseButton={!busy}>
        <DialogHeader><DialogTitle>添加服务商</DialogTitle></DialogHeader>
        <div className="provider-settings-company-field">
          <label htmlFor="service-provider-company">企业 <span className="text-destructive">*</span></label>
          <Combobox items={available} value={selected} disabled={busy || !allowed} required
            itemToStringLabel={(partner: Partner) => partner.name}
            itemToStringValue={(partner: Partner) => partner.id}
            isItemEqualToValue={(a: Partner, b: Partner) => a.id === b.id}
            filter={(partner: Partner, query: string) => `${partner.name} ${partner.id}`.toLowerCase().includes(query.trim().toLowerCase())}
            onValueChange={(partner: Partner | null) => { setSelectedId(partner?.id ?? ''); setFormError(''); }}>
            <ComboboxInput id="service-provider-company" className="w-full" aria-label="选择企业" aria-required="true" placeholder="搜索企业名称、编号" disabled={busy || !allowed} showClear />
            <ComboboxContent><ComboboxEmpty>{available.length ? '未找到匹配企业' : '暂无可添加的企业'}</ComboboxEmpty>
              <ComboboxList>{(partner: Partner) => <ComboboxItem key={partner.id} value={partner}><span><span className="block break-words">{partner.name}</span><small className="block text-muted-foreground">{partner.id}</small></span></ComboboxItem>}</ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
        {formError && <p className="sr-error" role="alert">{formError}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setAdding(false)}>取消</Button><Button disabled={busy || !allowed || !selected} onClick={() => void save(selectedId, true)}>{busy ? '保存中…' : '添加'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!target} onOpenChange={open => { if (!open && !busy) setTarget(null); }}>
      <DialogContent aria-describedby={undefined} showCloseButton={!busy}>
        <DialogHeader><DialogTitle>{target?.enabled ? '启用服务商' : '停用服务商'}</DialogTitle></DialogHeader>
        <p>确认{target?.enabled ? '启用' : '停用'}服务商「{target?.name}」？</p>
        {formError && <p className="sr-error" role="alert">{formError}</p>}
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setTarget(null)}>取消</Button><Button variant={target?.enabled ? 'default' : 'destructive'} disabled={busy || !allowed} onClick={() => { if (target) void save(target.id, target.enabled); }}>{busy ? '保存中…' : '确认'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
