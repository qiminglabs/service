import type { ContactRef, InternalUser } from './service-requests';
import type { Partner, PartnerUser } from './partner-directory';
import type { OperationActor } from './request-operations';
import { fixedIdentityRoles } from './internal-users.ts';
import {
  canManageServiceProjects,
  type ServiceProjectRecord,
} from './service-projects.ts';

export const projectCollaboratorGroups = [
  { key: 'customer', title: '客户协作人' },
  { key: 'internal', title: '内部协作人' },
  { key: 'partner', title: '合作伙伴协作人' },
] as const;
export type ProjectCollaboratorGroup =
  (typeof projectCollaboratorGroups)[number]['key'];
export type ProjectCollaborator = { id: string; name: string; details: string; assignmentRoles?: string[] };
export type ProjectCollaboratorOption = ProjectCollaborator & {
  disabled?: boolean;
};
export type ProjectCollaborators = Partial<
  Record<ProjectCollaboratorGroup, ProjectCollaborator[]>
>;
export type ProjectCollaboratorDirectory = {
  contacts: ContactRef[];
  users: InternalUser[];
  partners: Partner[];
  partnerUsers: PartnerUser[];
};

function partnerUsersForProject(
  serviceProviderId: string,
  directory: ProjectCollaboratorDirectory,
) {
  const partner = directory.partners.find(
    (partner) =>
      `partner:${partner.id}` === serviceProviderId &&
      partner.status === '启用',
  );
  return partner
    ? directory.partnerUsers.filter((person) => person.partnerId === partner.id)
    : [];
}

export function projectCollaboratorOptions(
  customerId: string,
  directory: ProjectCollaboratorDirectory,
  serviceProviderId = '',
): Record<ProjectCollaboratorGroup, ProjectCollaborator[]> {
  return {
    customer: directory.contacts
      .filter(
        (person) =>
          person.customerId === customerId && person.status === '启用',
      )
      .map((person) => ({
        id: person.id,
        name: person.name,
        details: [person.phone, person.email].filter(Boolean).join(' · '),
      })),
    internal: directory.users
      .filter((person) => person.status === '启用')
      .map((person) => ({
        id: person.id,
        name: person.name,
        details: person.email ?? '',
      })),
    partner: partnerUsersForProject(serviceProviderId, directory)
      .filter((person) => person.status === '启用')
      .map((person) => ({
        id: person.id,
        name: person.name,
        details: [person.phone, person.email].filter(Boolean).join(' · '),
      })),
  };
}

// Match the request picker display/search fields without changing save-time eligibility.
export function projectCollaboratorDialogOptions(
  customerId: string,
  directory: ProjectCollaboratorDirectory,
  serviceProviderId = '',
): Record<ProjectCollaboratorGroup, ProjectCollaboratorOption[]> {
  return {
    customer: directory.contacts
      .filter((person) => person.customerId === customerId)
      .map((person) => ({
        id: person.id,
        name: person.name,
        details: [person.phone, person.email].filter(Boolean).join(' · '),
        disabled: person.status !== '启用',
      })),
    internal: directory.users
      .filter((person) => person.status === '启用')
      .map((person) => ({
        id: person.id,
        name: person.name,
        details: [fixedIdentityRoles[person.id], person.email]
          .filter(Boolean)
          .join(' · '),
      })),
    partner: partnerUsersForProject(serviceProviderId, directory).map(
      (person) => ({
        id: person.id,
        name: person.name,
        details: [person.phone, person.email].filter(Boolean).join(' · '),
        disabled: person.status !== '启用',
      }),
    ),
  };
}

export function resolveProjectCollaborators(
  customerId: string,
  selected: ProjectCollaborators,
  directory: ProjectCollaboratorDirectory,
  serviceProviderId = '',
): ProjectCollaborators {
  const options = projectCollaboratorOptions(
    customerId,
    directory,
    serviceProviderId,
  );
  return Object.fromEntries(
    projectCollaboratorGroups.map(({ key }) => [
      key,
      [...new Set((selected[key] ?? []).map((person) => person.id))].map(
        (id) => {
          const person = options[key].find((item) => item.id === id);
          if (!person) throw new Error('所选协作人不可用，请重新选择。');
          return { ...person };
        },
      ),
    ]),
  );
}

export function editProjectCollaborators(
  previous: ServiceProjectRecord,
  group: ProjectCollaboratorGroup,
  ids: string[],
  actor: OperationActor,
  directory: ProjectCollaboratorDirectory,
): ServiceProjectRecord {
  if (!canManageServiceProjects(actor, previous))
    throw new Error('当前身份无权维护此服务项目的协作人。');
  if (['已完成', '已取消'].includes(previous.status))
    throw new Error('已结束的项目不可编辑。');
  if (!projectCollaboratorGroups.some((item) => item.key === group))
    throw new Error('协作人类型无效。');
  const available = projectCollaboratorOptions(
    previous.customerId,
    directory,
    previous.serviceProviderId,
  )[group];
  const existing = previous.collaborators?.[group] ?? [];
  const fixed = existing.find(person => person.assignmentRoles?.length && !ids.includes(person.id));
  if (fixed) throw new Error(`${fixed.name}为默认分配协作人，不允许移除。`);
  const selected = [...new Set(ids)].map((id) => {
    // Retain fixed applicants even after deactivation, while still enforcing
    // the service-provider boundary for every partner selection.
    const person =
      available.find((item) => item.id === id) ??
      (group !== 'partner' || (existing.some(person => person.id === id && person.assignmentRoles?.length)
        && directory.partnerUsers.some(person => person.id === id && `partner:${person.partnerId}` === previous.serviceProviderId))
        ? existing.find((item) => item.id === id)
        : undefined);
    if (!person) throw new Error('所选协作人不可用，请重新选择。');
    const roles = existing.find(entry => entry.id === id)?.assignmentRoles;
    return { ...person, ...(roles?.length ? { assignmentRoles: [...roles] } : {}) };
  });
  return {
    ...previous,
    collaborators: { ...previous.collaborators, [group]: selected },
    revision: previous.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}
