import type { ServiceProjectRecord } from './service-projects';
import { assignedEngineers } from './service-work-orders.ts';

// Repair missing identities for existing members only; never grant membership
// or change the access scope of an engineer while reading a project.
export function withWorkOrderCollaboratorRoles(project: ServiceProjectRecord): ServiceProjectRecord {
  const assigned = new Set((project.workOrders ?? []).flatMap(order =>
    assignedEngineers(order).map(person => `${person.group}:${person.id}`)));
  let changed = false;
  const collaborators = { ...project.collaborators };
  for (const group of ['internal', 'partner'] as const) {
    const people = collaborators[group];
    if (!people) continue;
    collaborators[group] = people.map(person => {
      const roles = [...new Set((person.assignmentRoles ?? []).map(role => role === '工单工程师' ? '服务工程师' : role))];
      if (assigned.has(`${group}:${person.id}`) && !roles.includes('服务工程师')) roles.push('服务工程师');
      if (roles.length === (person.assignmentRoles?.length ?? 0) && roles.every((role, index) => role === person.assignmentRoles?.[index])) return person;
      changed = true;
      return { ...person, assignmentRoles: roles };
    });
  }
  return changed ? { ...project, collaborators } : project;
}
