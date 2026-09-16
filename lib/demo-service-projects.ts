import type { ServiceRequest } from './service-requests';
import type { PartnerUser } from './partner-directory';
import type { buildRequestSamples } from './demo-service-requests';
import { operationIdentities } from './internal-users.ts';
import { createServiceProjects } from './request-projects.ts';
import { defaultProjectMapping, mappedServiceProject } from './request-project-mapping.ts';
import { applyCustomerDecision } from './request-customer-decision.ts';
import { newServiceProject, editServiceProject, serviceProjectStatuses, type ServiceProjectRecord, type ServiceProjectStatus } from './service-projects.ts';
import { assignInitialProjectCollaborators } from './project-collaborator-assignment.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { addProjectSupplement } from './service-project-supplements.ts';
import { applyProjectOperation } from './service-project-operations.ts';
import { cancelServiceProject } from './service-project-cancellation.ts';

type Sources = Parameters<typeof buildRequestSamples>[0] & { partnerUsers?: (Partial<PartnerUser> & { id: string })[] };

// Use the same conversion, lifecycle, cancellation and quota-release operations
// as normal projects. The reset commits requests and projects together.
export function buildProjectSamples(sources: Sources, samples: ServiceRequest[], now = new Date()) {
  const requests = structuredClone(samples);
  const projects: ServiceProjectRecord[] = [];
  const directory = {
    ...sources,
    partners: (sources.partners ?? []).flatMap(partner => partner.name ? [{ ...partner, name: partner.name, status: '启用' as const }] : []),
    partnerUsers: (sources.partnerUsers ?? []).flatMap(user => user.name && user.partnerId && user.status === '启用'
      ? [{ ...user, name: user.name, partnerId: user.partnerId, phone: user.phone ?? '', email: user.email ?? '', status: '启用' as const }] : []),
  };
  const manager = operationIdentities(sources.users).find(user => user.role === 'SmartX 项目经理');
  if (!manager) throw new Error('初始化服务项目需要有效的项目经理。');
  const at = new Date(now.getTime() - 86400000).toISOString();
  const enrich = (project: ServiceProjectRecord, target: ServiceProjectStatus, emptyPublic = false) => {
    project = addProjectSupplement(project, manager, { comment: '【演示】内部核对资源和交付范围。', files: [], mentions: [], externalVisible: false }, sources.users);
    if (!emptyPublic) {
      const contact = sources.contacts.find(person => person.customerId === project.customerId && person.status === '启用');
      if (contact) project = addProjectSupplement(project, { id: contact.id, name: contact.name, role: '客户' },
        { comment: '【演示】已确认服务窗口，请按计划安排实施。', files: [], mentions: [], externalVisible: true }, sources.users, directory);
    }
    const operationAt = new Date().toISOString();
    project = applyProjectOperation(project, { type: 'meeting-create', title: '【演示】项目启动沟通', participantNames: [manager.name] }, manager, operationAt);
    const meetingId = project.operations!.meetings[0].id;
    project = applyProjectOperation(project, { type: 'meeting-end', id: meetingId }, manager, operationAt);
    project = applyProjectOperation(project, { type: 'meeting-materials', id: meetingId, transcript: '【演示】确认服务范围、协作人和实施窗口，交付后由客户确认。' }, manager, operationAt);
    project = applyProjectOperation(project, { type: 'worklog-add', date: at.slice(0, 10), startTime: '09:00', endTime: '10:30', category: '客户沟通', description: '【演示】启动会议与服务范围核对。' }, manager, operationAt);
    for (const status of serviceProjectStatuses.slice(1, serviceProjectStatuses.indexOf(target) + 1)) {
      if (status === '已取消') break;
      project = editServiceProject(project, { ...project, status }, manager, sources.customers, directory.partners);
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
  for (const [i, status] of (['待复核', '已完成', '待启动'] as const).entries()) {
    const customer = sources.customers.find(customer => customer.status === '启用' && sources.contacts.some(person => person.customerId === customer.id && person.status === '启用'));
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
    project = appendProjectActivity(project, actor, '项目', '创建项目', project.id, at);
    projects.push(enrich(project, status));
  }
  return { requests, projects };
}
