import type {
  OperationActor,
  RequestMeeting,
  RequestWorklog,
} from './request-operations';
import type { ServiceProjectRecord } from './service-projects';

export type ProjectActivity = {
  id: string;
  at: string;
  actor: string;
  actorId: string;
  category: '项目' | '服务项' | '协作' | '补充信息' | '会议' | '工时';
  title: string;
  detail: string;
  externalVisible?: boolean;
};
export type ProjectOperations = {
  meetings: RequestMeeting[];
  worklogs: RequestWorklog[];
  activities: ProjectActivity[];
};
export function projectOperationsOf(
  record: ServiceProjectRecord,
): ProjectOperations {
  return { meetings: [], worklogs: [], activities: [], ...record.operations };
}
export function appendProjectActivity(
  record: ServiceProjectRecord,
  actor: OperationActor,
  category: ProjectActivity['category'],
  title: string,
  detail = '',
  now = new Date().toISOString(),
  externalVisible = true,
): ServiceProjectRecord {
  const operations = projectOperationsOf(record);
  return {
    ...record,
    operations: {
      ...operations,
      activities: [
        ...operations.activities,
        {
          id: crypto.randomUUID(),
          at: now,
          actor: actor.name,
          actorId: actor.id,
          category,
          title,
          detail,
          externalVisible,
        },
      ],
    },
  };
}
