import { demoServiceExecution, populateDemoWorkOrders } from './demo-service-execution.ts';
import { startProjectWorkOrders, submitProjectReview } from './service-work-orders.ts';
import type { ServiceFlowConfig } from './service-flows';
import type { ServiceRequest } from './service-requests';
import type { PartnerUser } from './partner-directory';
import type { buildRequestSamples } from './demo-service-requests';
import { operationIdentities } from './internal-users.ts';
import { createServiceProjects } from './request-projects.ts';
import { defaultProjectMapping, mappedServiceProject } from './request-project-mapping.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { newServiceProject, serviceProjectStatuses, type ServiceProjectRecord, type ServiceProjectStatus } from './service-projects.ts';
import { assignInitialProjectCollaborators } from './project-collaborator-assignment.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { addProjectSupplement } from './service-project-supplements.ts';
import { applyProjectOperation } from './service-project-operations.ts';
import { cancelServiceProject } from './service-project-cancellation.ts';
import { applyProjectReview, calculateProjectReviewEffort, canManageProjectReviewBasis, projectReviewCoverage, updateProjectReviewReservations, settleProjectSource, type ProjectReviewContext } from './service-project-review.ts';
import { canonicalMailTemplate, parseMailConfig } from './service-mail-templates.ts';
import { applyMailTemplate, sendProjectDailyReport } from './service-project-daily-reports.ts';

type Sources = Parameters<typeof buildRequestSamples>[0] & { partnerUsers?: (Partial<PartnerUser> & { id: string })[] };

// Use the same conversion, lifecycle, cancellation and quota-release operations
// as normal projects. The reset commits requests and projects together.
export function buildProjectSamples(sources: Sources, samples: ServiceRequest[], now = new Date(), executionConfig?: ServiceFlowConfig, approvalRules?: ProjectReviewContext['rules']) {
  const requests = structuredClone(samples);
  const projects: ServiceProjectRecord[] = [];
  const confirmationTargets = new Map<string, ServiceProjectStatus>();
  const directory = {
    ...sources,
    partners: (sources.partners ?? []).flatMap(partner => partner.name ? [{ ...partner, name: partner.name, status: '启用' as const }] : []),
    partnerUsers: (sources.partnerUsers ?? []).flatMap(user => user.name && user.partnerId && user.status === '启用'
      ? [{ ...user, name: user.name, partnerId: user.partnerId, phone: user.phone ?? '', email: user.email ?? '', status: '启用' as const }] : []),
  };
  const manager = operationIdentities(sources.users).find(user => user.role === 'SmartX 项目经理');
  if (!manager) throw new Error('初始化服务项目需要有效的项目经理。');
  const at = new Date(now.getTime() - 4 * 86400000).toISOString();
  const execution = executionConfig ?? demoServiceExecution(sources, at).config;
  const engineer = operationIdentities(sources.users).find(user => user.role === 'SmartX 服务工程师') ?? manager;
  const enrich = (project: ServiceProjectRecord, target: ServiceProjectStatus, emptyPublic = false) => {
    if (engineer.id !== manager.id && !project.collaborators?.internal?.some(person => person.id === engineer.id)) project = { ...project, collaborators: { ...project.collaborators, internal: [...(project.collaborators?.internal ?? []), { id: engineer.id, name: engineer.name, details: '' }] } };
    project = addProjectSupplement(project, manager, { comment: '【演示】内部核对资源和交付范围。', files: [], mentions: [], externalVisible: false }, sources.users);
    if (!emptyPublic) {
      const contact = sources.contacts.find(person => person.customerId === project.customerId && person.status === '启用');
      if (contact) project = addProjectSupplement(project, { id: contact.id, name: contact.name, role: '客户' },
        { comment: '【演示】已确认服务窗口，请按计划安排实施。', files: [], mentions: [], externalVisible: true }, sources.users, directory);
    }
    const operationAt = at;
    project = applyProjectOperation(project, { type: 'meeting-create', title: '【演示】项目启动沟通', participantNames: [manager.name] }, manager, operationAt);
    const meetingId = project.operations!.meetings[0].id;
    project = applyProjectOperation(project, { type: 'meeting-end', id: meetingId }, manager, operationAt);
    project = applyProjectOperation(project, { type: 'meeting-materials', id: meetingId, transcript: '【演示】确认服务范围、协作人和实施窗口，交付后由客户确认。' }, manager, operationAt);
    for (const status of serviceProjectStatuses.slice(1, serviceProjectStatuses.indexOf(target) + 1)) {
      if (status === '已取消') break;
      if (status === '进行中') {
        project = startProjectWorkOrders({ ...project, plannedCompletionDate: new Date(new Date(`${project.expectedServiceDate}T12:00:00Z`).getTime() + 3 * 86400000).toISOString().slice(0, 10) }, manager, sources.users, execution, sources, at);
        if (project.createdSite !== '合作伙伴中心') project = applyProjectOperation(project, { type: 'worklog-add', workOrderId: project.workOrders![0].id, date: at.slice(0, 10), startTime: '09:00', endTime: '10:30', category: '客户沟通', description: '【演示】启动会议与服务范围核对。' }, manager, operationAt);
        const partner = project.createdSite === '合作伙伴中心' ? directory.partnerUsers.find(user => project.collaborators?.partner?.some(person => person.id === user.id)) : undefined;
        const executor = partner ? { id: partner.id, name: partner.name, role: '合作伙伴服务工程师' } : engineer;
        project = populateDemoWorkOrders(project, executor, emptyPublic ? 'cancel' : target === '进行中' ? 'progress' : 'complete', at);
        const contact = sources.contacts.find(person => person.status === '启用' && project.collaborators?.customer?.some(member => member.id === person.id));
        if (!contact) throw new Error('初始化服务日报需要有效的客户协作人。');
        const customerName = sources.customers.find(customer => customer.id === project.customerId)?.name ?? '';
        const stages = [
          { title: '实施准备', work: '已核对服务范围、环境清单及实施窗口。\n已完成参与人员和操作前检查项确认。', plan: '按计划开展服务实施，持续记录执行进展。' },
          { title: '实施进展', work: `围绕${(project.items ?? []).map(item => item.serviceName).join('、')}开展服务实施。\n已记录现场检查结果，并与客户同步当前进展。`, plan: '继续推进剩余步骤，整理验证记录和待确认事项。' },
          { title: '验证进展', work: '已整理当前实施记录，并对已完成部分开展验证。\n已同步问题清单与后续跟进责任人。', plan: emptyPublic ? '等待客户确认调整后的实施安排。' : target === '进行中' ? '继续完成剩余实施与验证工作。' : '整理交付文件，提交复核并跟进客户确认。' },
        ];
        for (const [day, stage] of stages.entries()) {
          const recordedAt = new Date(Date.parse(at) + (day * 24 + 6) * 3600000).toISOString();
          const date = recordedAt.slice(0, 10);
          const input = applyMailTemplate({
            kind: 'daily', date, subject: `【示例日报】${project.name} · ${stage.title}`, to: contact.email || 'customer@example.com', cc: '',
            greeting: `${customerName}的老师`, customerEngineers: contact.name, projectManager: manager.name, engineers: executor.name,
            startTime: '09:00', endTime: '18:00', serviceNumber: project.id, relatedFiles: [], workContent: stage.work, nextPlan: stage.plan,
          }, canonicalMailTemplate(parseMailConfig(undefined), 'daily', undefined, customerName), project.name);
          project = sendProjectDailyReport(project, executor, { ...input, subject: `【示例日报】${project.name} · ${date} · ${stage.title}`, workContent: stage.work, nextPlan: stage.plan }, recordedAt);
        }
      } else if (status === '待确认' || status === '已完成') {
        // Finish the review only after all source requests and projects exist.
        confirmationTargets.set(project.id, target);
        break;
      } else if (status === '待复核') project = submitProjectReview(project, engineer, at);
      project = appendProjectActivity(project, manager, '项目', '变更项目状态', status);
    }
    return project;
  }
  // A real split retains disjoint work orders, entitlement balances and snapshots.
  for (const [requestId, cancelled] of [['SR-DEMO-003', false], ['SR-DEMO-004', true]] as const) {
    const index = requests.findIndex(request => request.id === requestId);
    if (index < 0) continue;
    let request = requests[index];
    const contact = sources.contacts.find(person => person.customerId === request.customerId && person.status === '启用');
    if (!contact) throw new Error('项目样例缺少客户联系人。');
    if (request.status === '待确认') request = applyCustomerDecision(request, { id: contact.id, name: contact.name, role: '客户' }, request.customerId, true, '', at);
    const responsible = operationIdentities(sources.users).find(user => user.id === request.operations?.assessment?.managerId) ?? manager;
    const groups = cancelled ? [{ id: 'SP-DEMO-CANCELLED', name: '【示例】计划调整取消项目', note: '', itemIds: request.items.map(item => item.id) }]
      : request.items.map((item, i) => ({ id: `SP-DEMO-CONVERTED-${i + 1}`, name: `【示例】${item.serviceName}交付项目`, note: '', itemIds: [item.id] }));
    request = createServiceProjects(request, responsible, groups, `demo-conversion-${requestId}`, at);
    const creation = request.operations!.projectCreation!;
    for (const [i, entry] of creation.projects.entries()) {
      let project = mappedServiceProject(request, entry, creation, defaultProjectMapping(), directory.partners, directory);
      project = enrich(project, cancelled ? '进行中' : (['待启动', '进行中', '待确认'] as const)[i % 3], cancelled);
      if (cancelled) {
        const result = cancelServiceProject(project, manager, sources.users, '【演示】客户调整实施计划，本次项目取消。', request);
        project = result.project;
        request = result.source ?? request;
      }
      projects.push(project);
    }
    requests[index] = request;
  }
  for (const [i, status] of (['待复核', '已完成', '进行中'] as const).entries()) {
    const customer = sources.customers.find(customer => customer.status === '启用' && requests.some(request => request.customerId === customer.id && request.items.length) && sources.contacts.some(person => person.customerId === customer.id && person.status === '启用'));
    if (!customer) throw new Error('项目样例缺少有效客户。');
    const partner = i === 2 ? directory.partnerUsers.find(user => directory.partners.some(company => company.id === user.partnerId)) : undefined;
    const actor = partner ? { id: partner.id, name: partner.name, role: '合作伙伴服务工程师' } : manager;
    const contact = sources.contacts.find(person => person.customerId === customer.id && person.status === '启用')!;
    let project = newServiceProject({ name: `【示例】${partner ? '合作伙伴协同交付' : status === '已完成' ? '已验收交付' : '交付成果复核'}`, customerId: customer.id,
      expectedServiceDate: new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10),
      serviceProviderId: partner ? `partner:${partner.partnerId}` : 'provider:smartx', note: '当前服务项目功能演示。' }, actor, sources.customers, directory.partners);
    project = { ...project, id: `SP-DEMO-DIRECT-${i + 1}`, createdAt: at, updatedAt: at, collaboratorAssignmentsVersion: 1,
      collaborators: assignInitialProjectCollaborators(customer.id, actor, directory, {
        customer: [{ id: contact.id, name: contact.name, details: '' }],
        internal: [{ id: manager.id, name: manager.name, details: '', assignmentRoles: ['项目经理'] }],
        partner: partner ? directory.partnerUsers.filter(user => user.partnerId === partner.partnerId).map(user => ({ id: user.id, name: user.name, details: user.email })) : [],
      }) };
    const sourceItems = [...new Map(requests.filter(request => request.customerId === customer.id).flatMap(request => request.items).filter(item => status !== '已完成' || !['巡检权益', '升级权益'].includes(sources.services.find(service => service.id === item.serviceId)?.priceUnit ?? '')).map(item => [item.serviceId, item])).values()].slice(0, 2);
    if (!sourceItems.length) throw new Error('项目样例缺少可用服务项。');
    project.items = sourceItems.map((item, index) => ({ ...structuredClone(item), id: `${project.id}-ITEM-${index + 1}` }));
    project = appendProjectActivity(project, actor, '项目', '创建项目', project.id, at);
    projects.push(enrich(project, status));
  }
  const identities = operationIdentities(sources.users);
  const admin = identities.find(actor => actor.role === 'SmartX 系统管理员');
  if (!admin) throw new Error('初始化项目复核需要有效的系统管理员。');
  const ctx: ProjectReviewContext = { ...directory, requests, assets: structuredClone(sources.assets), businessObjects: structuredClone(sources.businessObjects),
    rules: approvalRules ?? { version: 1, rules: [], defaultUserId: admin.id }, conversions: { inspection: { days: 0.3, version: 1 }, upgrade: { days: 0.3, version: 1 } }, mailTemplates: parseMailConfig(undefined) };
  for (let index = 0; index < projects.length; index++) {
    let project = projects[index];
    if (project.status !== '待复核') continue;
    const at = new Date(now.getTime() - 86400000).toISOString();
    project = applyProjectOperation(project, { type: 'worklog-confirm', ids: project.operations!.worklogs.map(log => log.id) }, manager, at);
    project = applyProjectReview(project, { type: 'effort', items: calculateProjectReviewEffort(project, ctx).map(line => ({ itemId: line.itemId, finalBillableDays: line.billableDays })), note: '【示例】按实际工时核定。' }, manager, ctx, at);
    Object.assign(ctx, updateProjectReviewReservations(project, ctx));
    const target = confirmationTargets.get(project.id);
    if (target) {
      const owner = identities.find(actor => canManageProjectReviewBasis(project, actor, ctx));
      if (!owner) throw new Error('项目样例缺少服务依据负责人。');
      for (const row of projectReviewCoverage(project, ctx).filter(row => row.gap > 0)) {
        project = applyProjectReview(project, { type: 'gap-submit', method: row.method, days: row.gap, reason: '【示例】批准本次演示项目服务额度。' }, owner, ctx, at);
        while (project.review!.approvals.at(-1)!.state === '待审批') {
          const approval = project.review!.approvals.at(-1)!;
          const approver = identities.find(actor => actor.id === approval.approverId);
          if (!approver) throw new Error('项目样例缺少当前环节审批人。');
          project = applyProjectReview(project, { type: 'gap-decide', id: approval.id, approve: true, note: '【示例】同意。' }, approver, ctx, at);
        }
      }
      const contact = sources.contacts.find(person => person.status === '启用' && project.collaborators?.customer?.some(member => member.id === person.id))!;
      project = applyProjectReview(project, { type: 'confirm', note: '【示例】请确认交付内容及服务消耗。', mail: {
        kind: 'project', date: at.slice(0, 10), subject: `${project.name} · 交付确认`, to: contact.email || 'customer@example.com', cc: '',
        greeting: contact.name, customerEngineers: contact.name, projectManager: manager.name, engineers: engineer.name,
        startTime: '09:00', endTime: '10:30', serviceNumber: project.id, workContent: '【示例】已完成服务执行及交付验证。', nextPlan: '【示例】请客户确认交付结果。',
      } }, owner, ctx, at);
      if (target === '已完成') {
        project = applyProjectReview(project, { type: 'customer-decision', confirmationId: project.review!.confirmations.at(-1)!.id, accepted: true, reason: '' }, { id: contact.id, name: contact.name, role: '客户' }, ctx, at);
        Object.assign(ctx, updateProjectReviewReservations(project, ctx));
        const source = settleProjectSource(project, ctx);
        if (source) requests[requests.findIndex(request => request.id === source.id)] = source;
      }
    }
    projects[index] = project;
  }
  return { requests, projects, assets: ctx.assets, businessObjects: ctx.businessObjects };
}
