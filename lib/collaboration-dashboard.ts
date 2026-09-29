import type { OperationActor } from './request-operations';
import { canAccessRequest, type ServiceRequest } from './service-requests.ts';
import {
  canViewServiceProject,
  type ServiceProjectRecord,
} from './service-projects.ts';
import {
  isRequestApplicant,
  requestAudience,
} from './request-collaboration.ts';
import {
  assessedEffort,
  assessmentOf,
  canManageAssessmentBasis,
  canSubmitGapApproval,
  currentPlan,
} from './request-assessment.ts';
import { canPerformAssessmentRole } from './assessment-routing.ts';
import {
  hardwareItems,
  hardwarePassIssue,
} from './request-hardware-assessment.ts';
import { requestApprovalRemainingDays } from './request-approval-quota.ts';
import { requestTypeOf } from './request-types.ts';
import {
  canManageProjectReviewBasis,
  currentProjectReviewApproval,
  pendingProjectWorklogs,
  projectReviewStale,
  type ProjectReviewContext,
} from './service-project-review.ts';
import { isPartnerCreatedProject } from './service-project-work-order-policy.ts';

import {
  projectWorkspaceFollowups,
  sortWorkspaceFollowups,
  workspaceActivities,
  type WorkspaceFollowup,
} from './workspace-dashboard.ts';
import { projectOverdue } from './project-manager-dashboard.ts';

export type CollaborationTask = WorkspaceFollowup;

export function collaborationDashboard(
  projects: ServiceProjectRecord[],
  requests: ServiceRequest[],
  actor: OperationActor,
  context: ProjectReviewContext,
  today = new Date().toLocaleDateString('sv-SE'),
) {
  // Visibility is applied before every count and list, including for administrators.
  const visibleRequests = requests.filter((record) =>
    canAccessRequest(record, { actor, directory: context.users }),
  );
  const visibleProjects = projects.filter((project) =>
    canViewServiceProject(actor, project),
  );
  const myRequests = visibleRequests.filter((record) =>
    isRequestApplicant(record, actor),
  );
  const myProjects = visibleProjects.filter(
    (project) =>
      project.createdById === actor.id ||
      myRequests.some((record) => record.id === project.sourceServiceRequestId),
  );
  const collaborationRequests = visibleRequests.filter(
    (record) =>
      !myRequests.includes(record) &&
      record.internalParticipants?.some((person) => person.userId === actor.id),
  );
  const collaborationProjects = visibleProjects.filter(
    (project) =>
      !myProjects.includes(project) &&
      project.collaborators?.internal?.some((person) => person.id === actor.id),
  );
  const tasks: CollaborationTask[] = projectWorkspaceFollowups(
    [...myProjects, ...collaborationProjects],
    today,
  );
  const addRequest = (record: ServiceRequest, kind: string) =>
    tasks.push({
      id: record.id,
      title: record.title,
      customerId: record.customerId,
      kind,
      view: 'requests',
      date: record.expectedServiceDate ?? '',
      overdue: false,
    });
  for (const record of visibleRequests) {
    if (record.status === '草稿') {
      if (isRequestApplicant(record, actor)) addRequest(record, '提交申请');
      continue;
    }
    if (record.status !== '待评估') continue;
    const assessment = assessmentOf(record);
    const basisAssigned =
      requestAudience(record) === 'internal'
        ? isRequestApplicant(record, actor)
        : context.customers.some(
            (customer) =>
              customer.id === record.customerId &&
              customer.ownerUserId === actor.id,
          );
    const passed = assessment.rounds.some(
      (round) => round.outcome === '评估通过',
    );
    if (
      actor.role === 'SmartX 硬件产品经理' &&
      !passed &&
      hardwareItems(record).length &&
      hardwarePassIssue(record, context.users) &&
      canPerformAssessmentRole(record, actor, 'hardware', context.users)
    )
      addRequest(record, '硬件评估');
    // Only the active approval node belongs to this user; admin override is not a personal assignment.
    const plan = currentPlan(record);
    const pending = assessment.approvals.filter(
      (approval) => approval.planId === plan?.id && approval.state === '待审批',
    );
    if (
      pending.some(
        (approval) =>
          (approval.workflow?.steps.find((step) => step.state === '待审批')
            ?.approverId ?? approval.approverId) === actor.id,
      )
    )
      addRequest(record, '申请额度审批');
    if (
      !passed ||
      assessedEffort(record) === undefined ||
      requestTypeOf(record) === '技术评估'
    )
      continue;
    if (!plan) {
      if (
        basisAssigned &&
        canManageAssessmentBasis(
          record,
          actor,
          context.customers,
          context.users,
        )
      )
        addRequest(record, '关联服务依据');
    } else if (!pending.length) {
      if (requestApprovalRemainingDays(record) > 1e-8) {
        if (
          (isRequestApplicant(record, actor) || plan.salesId === actor.id) &&
          canSubmitGapApproval(record, actor, context.users)
        )
          addRequest(record, '发起申请额度审批');
      } else if (
        basisAssigned &&
        canManageAssessmentBasis(
          record,
          actor,
          context.customers,
          context.users,
        )
      )
        addRequest(record, '发起申请客户确认');
    }
  }
  for (const project of visibleProjects) {
    if (
      !['待启动', '进行中', '待复核'].includes(project.status) ||
      isPartnerCreatedProject(project)
    )
      continue;
    const add = (kind: string) =>
      tasks.push({
        id: project.id,
        title: project.name,
        customerId: project.customerId,
        kind,
        view: 'projects',
        date: project.plannedCompletionDate ?? '',
        overdue: projectOverdue(project, today),
      });
    const approval = currentProjectReviewApproval(project);
    if (approval?.state === '待审批') {
      if (
        (approval.workflow?.steps.find((step) => step.state === '待审批')
          ?.approverId ?? approval.approverId) === actor.id
      )
        add('项目额度审批');
      continue;
    }
    const source = requests.find(
      (record) => record.id === project.sourceServiceRequestId,
    );
    const basisAssigned =
      (source ? source.createdById : project.createdById) === actor.id ||
      context.customers.some(
        (customer) =>
          customer.id === project.customerId &&
          customer.ownerUserId === actor.id,
      );
    if (
      basisAssigned &&
      project.status === '待复核' &&
      project.review?.effort &&
      project.review.effort.stage !== '过程' &&
      !projectReviewStale(project) &&
      !pendingProjectWorklogs(project).length &&
      canManageProjectReviewBasis(project, actor, context)
    )
      add('项目服务依据与确认');
  }
  sortWorkspaceFollowups(tasks);
  const newestFirst = <T extends { updatedAt: string; id: string }>(
    records: T[],
  ) =>
    records.sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
    );
  const activities = workspaceActivities(
    [...myProjects, ...collaborationProjects],
    [...myRequests, ...collaborationRequests],
  );
  return {
    tasks,
    activities,
    myProjects: newestFirst(myProjects),
    myRequests: newestFirst(myRequests),
    collaborationProjects: newestFirst(collaborationProjects),
    collaborationRequests: newestFirst(collaborationRequests),
  };
}
