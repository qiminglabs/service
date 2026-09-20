import { mailConfigFromRows } from './service-mail-templates.ts';
import { isPartnerCreatedProject } from './service-project-work-order-policy.ts';
import { openDatabase, readLocal, type ServiceRequest } from './service-requests.ts';
import { applyProjectReview,settleProjectSource,updateProjectReviewReservations,type ProjectReviewContext,type ProjectReviewAction } from './service-project-review.ts';
import { projectApprovalRulesId, scopedApprovalRules, initialProjectApprovalRules } from './approval-scope.ts';
import { entitlementPricingContext } from './request-pricing.ts';
import { canViewServiceProject, projectForActor, type ServiceProjectRecord } from './service-projects.ts';
import { customerServiceProject, type CustomerServiceProject } from './customer-service-projects.ts';
import type { OperationActor } from './request-operations';
export function projectReviewContext(references: { id: string; payload?: any }[], requests: ServiceRequest[], skipReview = false): ProjectReviewContext {
  const workspace = references.find(row => row.id === 'workspace')?.payload;
  if (!workspace) throw new Error('无法读取项目复核引用数据。');
  return { mailTemplates: mailConfigFromRows(references), partners: workspace.partners ?? [], partnerUsers: workspace.partnerUsers ?? [], services: workspace.services ?? [], assets: workspace.assets ?? [], businessObjects: workspace.businessObjects ?? [], users: workspace.users ?? [], customers: workspace.customers ?? [], contacts: workspace.contacts ?? [], requests,
    conversions: skipReview ? {} : entitlementPricingContext(references, requests).conversions,
    rules: skipReview ? { version: 1, rules: [] } : scopedApprovalRules(references, 'project') };
}
export async function readProjectReviewContext(skipReview = false) {
  const [refs, requests] = await Promise.all([readLocal<{ id: string; payload?: any }>('references'), readLocal<ServiceRequest>('requests')]);
  return projectReviewContext(refs, requests, skipReview);
}
export async function saveProjectReview(id: string, revision: number, action: ProjectReviewAction, actor: OperationActor): Promise<ServiceProjectRecord | CustomerServiceProject> {
  const db = await openDatabase();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(['requests', 'references'], 'readwrite'), refs = tx.objectStore('references');
    const referenceRead = refs.getAll(), requestRead = tx.objectStore('requests').getAll();
    let pending = 2, result: ServiceProjectRecord | CustomerServiceProject;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('复核保存失败，原记录已保留。'));
    tx.onerror = () => reject(tx.error);
    const commit = () => {
      if (--pending) return;
      try {
        const rows = referenceRead.result;
        const p = rows.find((row: any) => row.id === `service-project:${id}`)?.payload as ServiceProjectRecord | undefined;
        if (!p || (actor.role !== '客户' && !canViewServiceProject(actor, p))) throw new Error('项目不存在或无权访问。');
        if (p.revision !== revision) throw new Error('项目已被更新，请重新打开详情后重试。');
        if (!isPartnerCreatedProject(p) && !rows.some((row: { id: string }) => row.id === projectApprovalRulesId)) {
          const config = { id: projectApprovalRulesId, payload: initialProjectApprovalRules(rows) };
          rows.push(config); refs.put(config);
        }
        const ctx = projectReviewContext(rows, requestRead.result, isPartnerCreatedProject(p));
        const identity = actor.role === '客户' ? ctx.contacts.find(c => c.id === actor.id) : actor.role === '合作伙伴服务工程师' ? ctx.partnerUsers?.find(u => u.id === actor.id) : ctx.users.find(u => u.id === actor.id);
        if (!identity) throw new Error('操作人已失效。');
        const next = applyProjectReview(p, action, { ...actor, name: identity.name }, ctx);
        const workspace = rows.find((row: any) => row.id === 'workspace');
        const completed = p.status !== '已完成' && next.status === '已完成';
        if (['effort', 'basis'].includes(action.type) || completed) refs.put({ ...workspace, payload: { ...workspace.payload, ...updateProjectReviewReservations(next, ctx) } });
        if (completed && !isPartnerCreatedProject(p)) { const source = settleProjectSource(next, ctx); if (source) tx.objectStore('requests').put(source); }
        refs.put({ id: `service-project:${id}`, payload: next });
        result = actor.role === '客户' ? customerServiceProject(next, workspace.payload) : projectForActor(next, actor);
      } catch (error) { tx.abort(); reject(error); }
    };
    referenceRead.onsuccess = commit; requestRead.onsuccess = commit;
  }); } finally { db.close(); }
}
