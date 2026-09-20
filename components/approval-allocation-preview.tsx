'use client';

import { useEffect, useState } from 'react';
import { NativeSelect } from '@/components/ui/native-select';
import type { ApprovalScope } from '@/lib/approval-scope';
import { readApprovalPreviewData } from '@/lib/approval-flow-store';
import { resolveApprovalPreview } from '@/lib/approval-preview';

type Data = Awaited<ReturnType<typeof readApprovalPreviewData>>;
export function ApprovalAllocationPreview({ refreshKey, dirty = false, scope = 'request' }: { refreshKey: string | number; dirty?: boolean; scope?: ApprovalScope }) {
  const [data, setData] = useState<Data>();
  const [sampleId, setSampleId] = useState('');
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  useEffect(() => {
    let active = true, generation = 0;
    async function load() {
      const current = ++generation;
      setLoading(true); setError('');
      try {
        const latest = await readApprovalPreviewData(scope);
        if (active && current === generation) setData(latest);
      } catch (issue) {
        if (active && current === generation) setError(issue instanceof Error ? issue.message : '分配预览读取失败，请重试。');
      } finally {
        if (active && current === generation) setLoading(false);
      }
    }
    void load();
    window.addEventListener('focus', load);
    return () => { active = false; window.removeEventListener('focus', load); };
  }, [refreshKey, sampleId, scope]);
  const samples = data?.requests ?? [];
  const sample = samples.find(request => request.id === sampleId);
  const preview = sample && data && !loading && !error ? resolveApprovalPreview(sample, data.collection.rules, data.users, data.dictionary.customers, data.collection.defaultUserId) : undefined;
  return <section className="routing-preview approval-allocation-preview" aria-label="分配预览">
    <strong>分配预览</strong>
    <NativeSelect aria-label={scope === 'project' ? '预览服务项目' : '预览服务请求'} value={sample ? sampleId : ''} onChange={event => setSampleId(event.target.value)} disabled={loading || !!error || !samples.length}>
      <option value="">{loading ? '正在读取…' : error ? '读取失败' : samples.length ? `选择服务${scope === 'project' ? '项目' : '请求'}` : `暂无涉及特殊审批的${scope === 'project' ? '项目' : '请求'}`}</option>
      {samples.map(request => <option key={request.id} value={request.id}>{request.id} · {data?.dictionary.customers.find(customer => customer.id === request.customerId)?.name ?? request.customerId} · {scope === 'project' ? request.title : request.status}</option>)}
    </NativeSelect>
    {dirty && <p className="sr-help approval-preview-note">默认审批人有未保存的修改，预览仍使用已保存配置。</p>}
    {error && <p className="sr-error" role="alert">{error}</p>}
    {preview && <div className="routing-preview-result" aria-live="polite">
      {preview.requirement === 'not-required' ? <p>无需特殊审批，当前服务依据额度充足。</p> : preview.requirement === 'pending' ? <p>当前没有有效的服务依据方案，暂无法判断是否需要特殊审批。</p> : !preview.rule ? <>
        <p>未命中特殊审批规则。{preview.defaultApprover ? <>默认审批人：<strong>{preview.defaultApprover.name}</strong></> : !preview.issue && '未设置默认审批人，待分配。'}</p>
        {preview.issue && <p className="sr-error">{preview.issue}</p>}
      </> : <>
        <p>命中规则：<strong>{preview.rule.name}</strong> · 优先级 {preview.rule.priority}</p>
        <p className="sr-help">申请人：{sample?.createdBy || sample?.owner || '未记录'}</p>
        {preview.issue && <p className="sr-error">{preview.issue}</p>}
        {!!preview.steps.length && <ol className="approval-preview-steps">
          {preview.steps.map((step, index) => <li key={step.id}>
            <strong>{index + 1}. {step.name || '未命名环节'}</strong>
            {!!step.approvers.length && <ol className="approval-preview-people">{step.approvers.map((person, level) => <li key={`${person.id}-${level}`}><span className="sr-help">第 {level + 1} 级</span><span>{person.name}</span>{person.cutoff && <span className="approval-preview-cutoff">审批截止人</span>}{person.fallback && <span className="approval-preview-cutoff">默认审批人兜底</span>}</li>)}</ol>}
            {step.fallbackReason && <p className="sr-help">{step.fallbackReason} 由默认审批人完成本环节审批。</p>}
            {step.issue && <p className="sr-error">{step.issue}</p>}
          </li>)}
        </ol>}
        {!preview.issue && !preview.steps.some(step => step.issue) && <p className="sr-help">以上为全部审批通过时的顺序；任一环节驳回均退回申请人。</p>}
      </>}
    </div>}
  </section>;
}
