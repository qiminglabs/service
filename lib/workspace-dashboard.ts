import type { ServiceProjectRecord } from './service-projects';
import type { ServiceRequest } from './service-requests';
import {
  projectFollowups,
  projectOverdue,
} from './project-manager-dashboard.ts';

export type WorkspaceFollowup = {
  id: string;
  title: string;
  customerId: string;
  kind: string;
  view: 'projects' | 'requests';
  date: string;
  overdue: boolean;
};

export function projectWorkspaceFollowups(
  projects: ServiceProjectRecord[],
  today: string,
): WorkspaceFollowup[] {
  return projects.flatMap((project) =>
    projectFollowups(project).map((kind) => ({
      id: project.id,
      title: project.name,
      customerId: project.customerId,
      kind,
      view: 'projects' as const,
      date: project.plannedCompletionDate ?? '',
      overdue: projectOverdue(project, today),
    })),
  );
}

export function sortWorkspaceFollowups(tasks: WorkspaceFollowup[]) {
  return tasks.sort(
    (a, b) =>
      Number(b.overdue) - Number(a.overdue) ||
      (a.date || '9999').localeCompare(b.date || '9999') ||
      a.id.localeCompare(b.id) ||
      a.kind.localeCompare(b.kind),
  );
}

export function workspaceActivities(
  projects: ServiceProjectRecord[],
  requests: ServiceRequest[] = [],
) {
  return [
    ...projects.flatMap((project) =>
      (project.operations?.activities ?? []).map((activity) => ({
        ...activity,
        recordId: project.id,
        recordTitle: project.name,
        customerId: project.customerId,
        view: 'projects' as const,
      })),
    ),
    ...requests.flatMap((request) =>
      (request.operations?.activities ?? []).map((activity) => ({
        ...activity,
        recordId: request.id,
        recordTitle: request.title,
        customerId: request.customerId,
        view: 'requests' as const,
      })),
    ),
  ]
    .filter((activity) => Number.isFinite(Date.parse(activity.at)))
    .sort(
      (a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id),
    )
    .slice(0, 10);
}
