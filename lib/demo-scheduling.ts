import type { ServiceRequest, CustomerRef } from './service-requests';
import type { ServiceFlowConfig } from './service-flows';
import { operationIdentities } from './internal-users.ts';
import { newServiceProject } from './service-projects.ts';
import { internalProjectProvider } from './service-project-providers.ts';
import { assignInitialProjectCollaborators } from './project-collaborator-assignment.ts';
import { appendProjectActivity } from './service-project-activity.ts';
import { startProjectWorkOrders } from './service-work-orders.ts';
import {
  assignWorkOrders,
  type AssignmentDirectory,
} from './work-order-assignment.ts';
import {
  defaultSchedule,
  resourceDirectory,
  shiftDate,
  weekStart,
  type CalendarException,
} from './scheduling.ts';

// Persist ordinary projects and assignments so both calendars and the dispatch
// page read the same editable source records. Dates follow the reset week.
export function buildSchedulingSamples(
  directory: AssignmentDirectory,
  customers: CustomerRef[],
  requests: ServiceRequest[],
  config: ServiceFlowConfig,
  now = new Date(),
) {
  const today = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
  }).format(now);
  const monday = weekStart(today);
  const date = (offset: number) => shiftDate(monday, offset);
  const at = now.toISOString();
  const manager = operationIdentities(directory.users).find(
    (actor) => actor.role === 'SmartX 项目经理',
  );
  const resources = resourceDirectory(directory, today);
  const clients = customers.filter(
    (customer) =>
      customer.status === '启用' &&
      requests.some(
        (request) => request.customerId === customer.id && request.items.length,
      ) &&
      directory.contacts.some(
        (contact) =>
          contact.customerId === customer.id && contact.status === '启用',
      ),
  );
  if (!manager || resources.length < 2 || !clients.length)
    throw new Error('调度演示需要项目经理、两名工程师及有效客户服务项。');
  const plans = [
    { name: '平台实施交付', start: 1, end: 4, assignments: [[0], [0]] },
    { name: '伙伴协同交付', start: 1, end: 3, assignments: [[1], []] },
    { name: '下周巡检服务', start: 7, end: 9, assignments: [[]] },
  ];
  const projects = plans.map((plan, index) => {
    const customer = clients[index % clients.length];
    const contact = directory.contacts.find(
      (person) => person.customerId === customer.id && person.status === '启用',
    )!;
    const templates = [
      ...new Map(
        requests
          .filter((request) => request.customerId === customer.id)
          .flatMap((request) => request.items)
          .map((item) => [item.serviceId, item]),
      ).values(),
    ];
    const assignedResource = resources[plan.assignments.flat()[0]];
    const partnerId =
      assignedResource?.group === 'partner'
        ? directory.partnerUsers.find((user) => user.id === assignedResource.id)
            ?.partnerId
        : undefined;
    let project = newServiceProject(
      {
        name: `【示例】${plan.name}`,
        customerId: customer.id,
        expectedServiceDate: date(plan.start),
        plannedCompletionDate: date(plan.end),
        serviceProviderId: partnerId
          ? `partner:${partnerId}`
          : internalProjectProvider.id,
        note: '调度工作台演示记录。',
      },
      manager,
      customers,
      directory.partners,
    );
    project = {
      ...project,
      id: `SP-DEMO-SCHEDULE-${String(index + 1).padStart(3, '0')}`,
      createdAt: at,
      updatedAt: at,
      collaboratorAssignmentsVersion: 1,
      collaborators: assignInitialProjectCollaborators(
        customer.id,
        manager,
        { ...directory, customers },
        {
          customer: [{ id: contact.id, name: contact.name, details: '' }],
        },
      ),
    };
    project.items = plan.assignments.map((_, orderIndex) => ({
      ...structuredClone(templates[(index + orderIndex) % templates.length]),
      id: `${project.id}-ITEM-${orderIndex + 1}`,
    }));
    project = appendProjectActivity(
      project,
      manager,
      '项目',
      '创建项目',
      project.id,
      at,
    );
    project = startProjectWorkOrders(
      project,
      manager,
      directory.users,
      config,
      { ...directory, customers },
      at,
    );
    for (const [orderIndex, people] of plan.assignments.entries()) {
      if (!people.length) continue;
      project = assignWorkOrders(
        project,
        manager,
        {
          orderIds: [project.workOrders![orderIndex].id],
          assignees: people.map((index) => resources[index]),
        },
        directory,
        at,
      );
    }
    return project;
  });
  const data = defaultSchedule();
  data.revision = 1;
  const exceptions: Array<{
    person: number;
    offset: number;
    kind: CalendarException['kind'];
    note: string;
  }> = [
    { person: 1, offset: 4, kind: '调休休息', note: '周末值守补休' },
    { person: 0, offset: 5, kind: '加班上班', note: '周末技术支持' },
  ];
  data.exceptions = exceptions.map((entry, index) => ({
    id: `CAL-DEMO-${index + 1}`,
    resourceKey: resources[entry.person].key,
    start: date(entry.offset),
    end: date(entry.offset),
    kind: entry.kind,
    note: entry.note,
  }));
  return { projects, data };
}
