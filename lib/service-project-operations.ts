import { isDemoAdministrator, canActForUser } from './demo-permissions.ts';
import { projectWorklogsLocked } from './service-project-work-order-policy.ts';
import { canViewServiceProject } from './service-projects.ts';
import type { OperationActor, RequestAction } from './request-operations';
import type { CatalogService } from './service-requests';
import { canManageProjectAsManager } from './service-project-work-order-policy.ts';
import { calculateWorklogPricing } from './project-worklog-pricing.ts';
import {
  localDate,
  worklogHours,
  formatWorklogHours,
  isAdministrator,
  isInternal,
  meetingAttachments,
  meetingAttachmentIssue,
} from './request-operations.ts';
import {
  canManageServiceProjects,
  type ServiceProjectRecord,
} from './service-projects.ts';
import {
  appendProjectActivity,
  projectOperationsOf,
  type ProjectActivity,
} from './service-project-activity.ts';

export type ProjectOperationAction =
  | { type: 'worklog-confirm'; ids: string[] }
  | Exclude<
      Extract<
        RequestAction,
        { type: `meeting-${string}` | `worklog-${string}` }
      >,
      { type: 'meeting-notify' | 'worklog-add' | 'worklog-edit' }
    >
  | (Extract<RequestAction, { type: 'worklog-add' | 'worklog-edit' }> & { workOrderId: string })
  | {
      type: 'meeting-notify';
      id: string;
      userIds: string[];
      contactIds: string[];
      partnerIds?: string[];
    };
export function canRecordProjectWorklog(
  record: ServiceProjectRecord,
  actor: OperationActor,
): boolean {
  return (
    !!actor.id &&
    !projectWorklogsLocked(record) &&
    !['已完成', '已取消', '已暂停'].includes(record.status) &&
    canViewServiceProject(actor, record) && (isDemoAdministrator(actor) || actor.role === 'SmartX 项目经理' ||
      (isInternal(actor.role)
        ? !!record.collaborators?.internal?.some(
            (person) => person.id === actor.id,
          )
        : actor.role === '合作伙伴服务工程师' && !!record.collaborators?.partner?.some(person => person.id === actor.id)))
  );
}
export function canConfirmProjectWorklog(record: ServiceProjectRecord, actor: OperationActor) {
  return !projectWorklogsLocked(record) && !['已完成', '已取消', '已暂停'].includes(record.status) && canManageProjectAsManager(record, actor);
}
export function canPerformProjectOperation(record: ServiceProjectRecord, actor: OperationActor, type: ProjectOperationAction['type']): boolean {
  if (['已完成', '已取消', '已暂停'].includes(record.status)) return false;
  if (type === 'worklog-confirm') return canConfirmProjectWorklog(record, actor);
  return type === 'worklog-add' || type === 'worklog-edit' || type === 'worklog-void'
    ? canRecordProjectWorklog(record, actor)
    : canManageServiceProjects(actor, record);
}
export function applyProjectOperation(
  record: ServiceProjectRecord,
  action: ProjectOperationAction,
  actor: OperationActor,
  now = new Date().toISOString(),
  services: CatalogService[] = [],
): ServiceProjectRecord {
  if (action.type.startsWith('worklog-') && projectWorklogsLocked(record))
    throw new Error('项目无需工时或已发起客户确认，工时已锁定，不能新增、编辑、作废或重新确认。');
  if (record.status === '已暂停') throw new Error('项目已暂停，请先恢复项目。');
  if (['已完成', '已取消'].includes(record.status))
    throw new Error('当前项目已结束，仅可查看历史记录。');
  if (!actor.name || !canPerformProjectOperation(record, actor, action.type))
    throw new Error('当前身份无权执行此项目操作。');
  const ops = structuredClone(projectOperationsOf(record));
  let category: ProjectActivity['category'] = '会议';
  let title = '';
  let detail = '';
  const requireText = (value: string, label: string) => {
    if (!value.trim()) throw new Error(`请填写${label}。`);
  };
  switch (action.type) {
    case 'meeting-schedule': {
      requireText(action.title, '会议主题');
      const date = action.scheduledDate;
      const time = action.scheduledTime;
      const start = new Date(`${date}T${time}:00`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !/^([01]\d|2[0-3]):[0-5]\d$/.test(time) ||
        !Number.isFinite(start.getTime()) ||
        localDate(start) !== date
      )
        throw new Error('请选择有效的预约日期和开始时间。');
      if (start.getTime() <= new Date(now).getTime())
        throw new Error('预约开始时间必须晚于当前时间。');
      if (![15, 30, 45, 60, 90, 120, 180, 240].includes(action.durationMinutes))
        throw new Error('请选择有效的会议时长。');
      ops.meetings.unshift({
        id: crypto.randomUUID(),
        title: action.title.trim(),
        createdAt: now,
        host: actor.name,
        hostId: actor.id,
        participantNames: [],
        status: '已预约',
        mode: 'local-demo',
        scheduledDate: date,
        scheduledTime: time,
        durationMinutes: action.durationMinutes,
      });
      category = '会议';
      title = '预约模拟会议';
      detail = `${action.title.trim()} · ${date} ${time} · ${action.durationMinutes} 分钟`;
      break;
    }
    case 'meeting-notify': {
      const meeting = ops.meetings.find((m) => m.id === action.id);
      if (!meeting || !['已预约', '进行中'].includes(meeting.status))
        throw new Error('仅未结束的会议可以发送通知。');
      const userIds = [...new Set(action.userIds)];
      const contactIds = [...new Set(action.contactIds)];
      const partnerIds = [...new Set(action.partnerIds ?? [])];
      if (!userIds.length && !contactIds.length && !partnerIds.length)
        throw new Error('请至少选择一位协作人。');
      const internalNames = userIds.map((id) => {
        const person = record.collaborators?.internal?.find((p) => p.id === id);
        if (!person) throw new Error('内部协作人已变更，请重新选择通知对象。');
        return person.name;
      });
      const externalNames = contactIds.map((id) => {
        const person = record.collaborators?.customer?.find((p) => p.id === id);
        if (!person) throw new Error('外部协作人已变更，请重新选择通知对象。');
        return person.name;
      });
      const partnerNames = partnerIds.map((id) => {
        const person = record.collaborators?.partner?.find(
          (person) => person.id === id,
        );
        if (!person)
          throw new Error('合作伙伴协作人已变更，请重新选择通知对象。');
        return person.name;
      });
      return appendProjectActivity(
        { ...record, revision: record.revision + 1, updatedAt: now },
        actor,
        '会议',
        '发送会议通知',
        [
          meeting.title,
          meeting.scheduledDate
            ? `${meeting.scheduledDate} ${meeting.scheduledTime} · ${meeting.durationMinutes} 分钟`
            : '',
          internalNames.length ? `内部协作人：${internalNames.join('、')}` : '',
          externalNames.length ? `外部协作人：${externalNames.join('、')}` : '',
          partnerNames.length
            ? `合作伙伴协作人：${partnerNames.join('、')}`
            : '',
          '本地模拟，未实际发送',
        ]
          .filter(Boolean)
          .join(' · '),
        now,
      );
    }
    case 'meeting-start': {
      const meeting = ops.meetings.find((m) => m.id === action.id);
      if (!meeting || meeting.status !== '已预约')
        throw new Error('仅已预约的会议可以开始。');
      if (meeting.hostId !== actor.id && !isAdministrator(actor.role))
        throw new Error('仅主持人可开始会议。');
      meeting.status = '进行中';
      meeting.startedAt = now;
      if (!meeting.participantNames.length) {
        meeting.participantNames = [
          ...new Set(
            [
              meeting.host,
              ...(record.collaborators?.partner?.map((person) => person.name) ??
                []),
              ...(record.collaborators?.internal?.map(
                (person) => person.name,
              ) ?? []),
              ...(record.collaborators?.customer?.map(
                (person) => person.name,
              ) ?? []),
            ].filter(Boolean),
          ),
        ];
      }
      category = '会议';
      title = '开始模拟会议';
      detail = meeting.title;
      break;
    }
    case 'meeting-create': {
      requireText(action.title, '会议主题');
      ops.meetings.unshift({
        id: crypto.randomUUID(),
        title: action.title.trim(),
        createdAt: now,
        host: actor.name,
        hostId: actor.id,
        participantNames: action.participantNames,
        status: '进行中',
        startedAt: now,
        mode: 'local-demo',
      });
      category = '会议';
      title = '发起模拟会议';
      detail = action.title;
      break;
    }
    case 'meeting-end': {
      const meeting = ops.meetings.find((m) => m.id === action.id);
      if (!meeting || meeting.status !== '进行中')
        throw new Error('会议不存在或已结束。');
      if (meeting.hostId !== actor.id && !isAdministrator(actor.role))
        throw new Error('仅主持人可结束会议。');
      meeting.status = '已结束';
      meeting.endedAt = now;
      category = '会议';
      title = '结束模拟会议';
      detail = meeting.title;
      break;
    }
    case 'meeting-attachments-add': {
      const meeting = ops.meetings.find((m) => m.id === action.id);
      if (!meeting) throw new Error('会议不存在。');
      if (meeting.hostId !== actor.id && !isAdministrator(actor.role))
        throw new Error('仅主持人可维护会议附件。');
      if (!action.files.length) throw new Error('请选择附件。');
      const ids = new Set(meetingAttachments(meeting).map((file) => file.id));
      for (const file of action.files) {
        const issue = meetingAttachmentIssue(file);
        if (issue) throw new Error(issue);
        if (ids.has(file.id)) throw new Error('附件已存在，请勿重复保存。');
        ids.add(file.id);
      }
      meeting.attachments = [...(meeting.attachments ?? []), ...action.files];
      category = '会议';
      title = '上传会议附件';
      detail = `${meeting.title} · ${action.files.map((file) => file.name).join('、')}`;
      break;
    }
    case 'meeting-attachment-delete': {
      const meeting = ops.meetings.find((m) => m.id === action.id);
      if (!meeting) throw new Error('会议不存在。');
      if (meeting.hostId !== actor.id && !isAdministrator(actor.role))
        throw new Error('仅主持人可维护会议附件。');
      const file = meetingAttachments(meeting).find(
        (item) => item.id === action.fileId,
      );
      if (!file) throw new Error('附件不存在或已删除。');
      meeting.attachments = (meeting.attachments ?? []).filter(
        (item) => item.id !== action.fileId,
      );
      if (meeting.recording?.id === action.fileId) delete meeting.recording;
      category = '会议';
      title = '删除会议附件';
      detail = `${meeting.title} · ${file.name}`;
      break;
    }
    case 'meeting-materials': {
      const meeting = ops.meetings.find((m) => m.id === action.id);
      if (!meeting || meeting.status !== '已结束')
        throw new Error('请先结束会议，再归档会议资料。');
      if (meeting.hostId !== actor.id && !isAdministrator(actor.role))
        throw new Error('仅主持人可归档会议资料。');
      if (action.recording) {
        if (
          action.recording.blob.size !== action.recording.size ||
          action.recording.size <= 0 ||
          action.recording.size > 20 * 1024 * 1024 ||
          !['video/mp4', 'video/webm'].includes(action.recording.blob.type)
        )
          throw new Error('录制文件仅支持 20 MB 以内的 MP4 或 WebM。');
        meeting.recording = action.recording;
      }
      if (!meeting.recording && !action.transcript.trim())
        throw new Error('请上传录制或填写转写正文。');
      meeting.transcript = action.transcript.trim();
      category = '会议';
      title = '归档会议资料';
      detail = meeting.title;
      break;
    }
    case 'worklog-confirm': {
      if (!action.ids.length || new Set(action.ids).size !== action.ids.length) throw new Error('请选择待确认工时，且不能重复选择。');
      const logs = action.ids.map(id => {
        const log = ops.worklogs.find(row => row.id === id);
        if (!log || log.voidedAt || log.confirmedAt) throw new Error('工时已更新或不再待确认，请重新打开项目。');
        if (!record.workOrders?.some(order => order.id === log.workOrderId)) throw new Error('请先将工时关联到有效工单。');
        return log;
      });
      logs.forEach(log => Object.assign(log, { confirmedAt: now, confirmedById: actor.id, confirmedBy: actor.name }));
      category = '工时'; title = '确认工时';
      detail = logs.map(log => `${log.userName} · ${log.date} · ${formatWorklogHours(log.hours)} 小时`).join('；');
      break;
    }
    case 'worklog-add':
    case 'worklog-edit': {
      const existing =
        action.type === 'worklog-edit'
          ? ops.worklogs.find((w) => w.id === action.id)
          : undefined;
      if (
        action.type === 'worklog-edit' &&
        (!existing || existing.voidedAt || !canActForUser(actor, existing.userId))
      )
        throw new Error('只能编辑自己的有效工时记录。');
      if (!canRecordProjectWorklog(record, actor))
        throw new Error('仅项目经理或当前项目的协作人可以录入自己的工时。');
      if (!action.workOrderId?.trim()) throw new Error('请选择关联工单。');
      const order = record.workOrders?.find(order => order.id === action.workOrderId);
      if (!order) throw new Error('关联工单不存在或不属于当前项目。');
      if (order.status === '已取消' && existing?.workOrderId !== order.id)
        throw new Error('不能将工时关联到已取消的工单。');
      const d = new Date(action.date + 'T12:00:00');
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(action.date) ||
        Number.isNaN(d.getTime()) ||
        localDate(d) !== action.date ||
        action.date > localDate(new Date(now))
      )
        throw new Error('请选择有效且不晚于今天的工作日期。');
      const hours = worklogHours(action.startTime, action.endTime);
      if (hours === null)
        throw new Error(
          '请选择有效的起始时间和终止时间，终止时间须晚于起始时间（同一天）。',
        );
      const dayTotal = ops.worklogs
        .filter(
          (w) =>
            w.userId === (existing?.userId ?? actor.id) &&
            w.date === action.date &&
            !w.voidedAt &&
            w.id !== existing?.id,
        )
        .reduce((s, w) => s + w.hours, 0);
      if (dayTotal + hours > 24 + 1e-9)
        throw new Error('该成员当天累计工时不能超过 24 小时。');
      requireText(action.description, '工作内容');
      requireText(action.category, '工作类型');
      const updatedLog = {
        id: existing?.id ?? crypto.randomUUID(),
        userId: existing?.userId ?? actor.id,
        userName: existing?.userName ?? actor.name,
        date: action.date,
        startTime: action.startTime,
        endTime: action.endTime,
        hours,
        workOrderId: order.id,
        pricing: calculateWorklogPricing(order, hours, services, existing?.workOrderId === order.id ? existing.pricing : undefined),
        category: action.category,
        description: action.description.trim(),
        createdAt: existing?.createdAt ?? now,
      };
      if (existing) { Object.assign(existing, updatedLog); delete existing.confirmedAt; delete existing.confirmedById; delete existing.confirmedBy; }
      else ops.worklogs.unshift(updatedLog);
      category = '工时';
      title = existing ? '编辑工时' : '录入工时';
      detail = `${order.id} · ${order.item.serviceName} · ${action.date} ${action.startTime}–${action.endTime} · ${formatWorklogHours(hours)} 小时 · ${action.description.trim()}`;
      break;
    }
    case 'worklog-void': {
      const log = ops.worklogs.find((w) => w.id === action.id);
      if (!log || log.voidedAt || !canActForUser(actor, log.userId))
        throw new Error('只能作废自己的有效工时记录。');
      requireText(action.reason, '作废原因');
      log.voidedAt = now;
      log.voidReason = action.reason.trim();
      category = '工时';
      title = '作废工时';
      detail = `${log.date} · ${log.hours} 小时 · ${log.voidReason}`;
      break;
    }
    default:
      throw new Error('不支持的项目操作。');
  }
  return appendProjectActivity(
    {
      ...record,
      operations: ops,
      revision: record.revision + 1,
      updatedAt: now,
    },
    actor,
    category,
    title,
    detail,
    now,
    category !== '工时',
  );
}
