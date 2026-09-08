import type { Assessment } from './request-assessment';
import type { ServiceRequest, StoredFile } from './service-requests';

// Same-day local times, with minute precision. Historical logs may lack times.
export function worklogHours(
  startTime: string,
  endTime: string,
): number | null {
  const valid = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!valid.test(startTime) || !valid.test(endTime)) return null;
  const minutes = (time: string) =>
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const duration = minutes(endTime) - minutes(startTime);
  return duration > 0 ? duration / 60 : null;
}

export function formatWorklogHours(hours: number): string {
  return String(Number(hours.toFixed(2)));
}

export type RequestAsset = {
  id: string;
  customerId: string;
  name: string;
  status: string;
  balanceDays?: number;
};
export type OperationActor = { id: string; name: string; role: string };
export type RequestActivity = {
  id: string;
  at: string;
  actor: string;
  actorId: string;
  category: '协作' | '会议' | '工时' | '评估' | '审批' | '服务依据' | '提交';
  title: string;
  detail: string;
};
export type RequestMeeting = {
  id: string;
  title: string;
  createdAt: string;
  host: string;
  hostId: string;
  participantNames: string[];
  status: '已预约' | '进行中' | '已结束';
  scheduledDate?: string;
  scheduledTime?: string;
  durationMinutes?: number;
  startedAt?: string;
  endedAt?: string;
  mode: 'local-demo';
  recording?: StoredFile;
  attachments?: StoredFile[];
  transcript?: string;
};

export const meetingAttachmentAccept =
  '.doc,.docx,.pdf,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.png,.jpg,.jpeg,.zip,.mp4,.webm';
export function meetingAttachmentIssue(file: StoredFile): string | null {
  if (
    !file.id ||
    !file.name.trim() ||
    !(file.blob instanceof Blob) ||
    file.blob.size !== file.size ||
    file.size <= 0
  )
    return '请选择有效且非空的附件。';
  if (file.size > 20 * 1024 * 1024) return '单个附件不能超过 20 MB。';
  if (
    !meetingAttachmentAccept
      .split(',')
      .includes('.' + file.name.split('.').at(-1)?.toLowerCase())
  )
    return '请上传文档、表格、演示文稿、图片、ZIP 或视频文件。';
  return null;
}
export function meetingAttachments(meeting: RequestMeeting): StoredFile[] {
  const files = [...(meeting.attachments ?? [])];
  if (
    meeting.recording &&
    !files.some((file) => file.id === meeting.recording!.id)
  )
    files.push(meeting.recording);
  return files;
}
export function meetingTranscript(meeting: RequestMeeting) {
  const original = meeting.transcript?.trim();
  if (original && original.toLowerCase() !== 'test')
    return { text: meeting.transcript!, example: false };
  return {
    example: true,
    text: '00:00  主持人（示例）\n本次会议围绕服务申请的目标、服务范围和待补充材料进行沟通，先确认本次希望解决的问题与预期交付结果。\n\n02:15  客户代表（示例）\n希望先明确服务包含的工作及不包含的事项。涉及现网操作时，需要提前说明影响范围，并协调业务窗口。\n\n05:40  技术代表（示例）\n评估前需要核对环境清单、产品版本以及网络拓扑。材料中的未知项请明确标注，不适用项请说明原因。\n\n09:20  主持人（示例）\n内部团队将根据补充材料评估工作量，核对服务依据，并整理服务范围和费用概览供后续确认。\n\n12:05  客户代表（示例）\n请列出仍需提供的材料及对接人。计划和实施窗口待服务范围明确后再进一步讨论。\n\n15:30  主持人（示例）\n本次待办包括补齐环境资料、澄清服务边界和核对可用服务依据。本次沟通不替代正式服务确认或审批。',
  };
}
export type RequestWorklog = {
  id: string;
  userId: string;
  userName: string;
  date: string;
  startTime?: string;
  endTime?: string;
  hours: number;
  category: string;
  description: string;
  createdAt: string;
  voidedAt?: string;
  voidReason?: string;
};
export type RequestBasis = {
  id: string;
  kind: 'asset' | 'exception';
  itemIds: string[];
  assetId?: string;
  name: string;
  quantity: number;
  unit: '人天';
  reason: string;
  state: '待核对' | '待审批' | '有效' | '已拒绝' | '已移除';
  createdAt: string;
  createdBy: string;
  creatorId: string;
  approverId?: string;
  approverName?: string;
  decidedAt?: string;
  decisionNote?: string;
  decidedBy?: string;
};
export type RequestEvaluation = {
  id: string;
  scope: string;
  opinion: string;
  risks: string;
  effort: number;
  authorId: string;
  author: string;
  createdAt: string;
  updatedAt: string;
  state: '草稿' | '待审批' | '已通过' | '已拒绝';
  approverId: string;
  approverName: string;
  basisIds: string[];
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string;
};
export type RequestOperations = {
  supplements?: import('./request-supplements').RequestSupplement[];
  customerDecisions?: import('./request-customer-decision').CustomerDecision[];
  assessment?: Assessment;
  assessmentHistory?: Assessment[];
  draftReturns?: { at: string; actorId: string; reason: string }[];
  meetings: RequestMeeting[];
  worklogs: RequestWorklog[];
  bases: RequestBasis[];
  evaluations: RequestEvaluation[];
  activities: RequestActivity[];
};
export const emptyOperations = (): RequestOperations => ({
  meetings: [],
  worklogs: [],
  bases: [],
  evaluations: [],
  activities: [],
});
export function operationsOf(record: ServiceRequest): RequestOperations {
  return { ...emptyOperations(), ...record.operations };
}
export function migrateRoleLabel(value: string): string {
  const legacy: Record<string, string> = {
    'SmartX 员工': 'SmartX 销售经理',
    销售经理: 'SmartX 销售经理',
    系统管理员: 'SmartX 系统管理员',
    销售: 'SmartX 销售经理',
    售前: 'SmartX 销售经理',
    PMO: 'SmartX 销售经理',
    审批人: 'SmartX 销售经理',
    项目经理: 'SmartX 项目经理',
    服务工程师: 'SmartX 服务工程师',
  };
  return Object.hasOwn(legacy, value) ? legacy[value] : value;
}
export function isAdministrator(role: string) {
  return role === 'SmartX 系统管理员';
}
export function canEvaluate(role: string) {
  return ['SmartX 销售经理', 'SmartX 系统管理员'].includes(role);
}
export function canApprove(role: string) {
  return canEvaluate(role);
}
export function isInternal(role: string) {
  return [
    'SmartX 系统管理员',
    'SmartX 销售经理',
    'SmartX 项目经理',
    'SmartX 服务工程师',
  ].includes(role);
}
export function localDate(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function appendActivity(
  record: ServiceRequest,
  actor: OperationActor,
  category: RequestActivity['category'],
  title: string,
  detail = '',
  now = new Date().toISOString(),
): ServiceRequest {
  const ops = operationsOf(record);
  return {
    ...record,
    operations: {
      ...ops,
      activities: [
        ...ops.activities,
        {
          id: crypto.randomUUID(),
          at: now,
          actor: actor.name,
          actorId: actor.id,
          category,
          title,
          detail,
        },
      ],
    },
  };
}
export function basisUsable(
  basis: RequestBasis,
  record: ServiceRequest,
  assets: RequestAsset[],
) {
  return (
    basis.state === '有效' &&
    (basis.kind === 'exception' ||
      assets.some(
        (a) =>
          a.id === basis.assetId &&
          a.customerId === record.customerId &&
          ['启用', '使用中'].includes(a.status),
      ))
  );
}
export function uncoveredItems(
  record: ServiceRequest,
  assets: RequestAsset[],
  basisIds?: string[],
) {
  const bases = operationsOf(record).bases.filter(
    (b) =>
      basisUsable(b, record, assets) && (!basisIds || basisIds.includes(b.id)),
  );
  return record.items.filter(
    (item) => !bases.some((b) => b.itemIds.includes(item.id)),
  );
}

function ensureQuantityCovered(
  record: ServiceRequest,
  assets: RequestAsset[],
  effort: number,
  basisIds?: string[],
) {
  const total = operationsOf(record)
    .bases.filter(
      (b) =>
        basisUsable(b, record, assets) &&
        (!basisIds || basisIds.includes(b.id)),
    )
    .reduce((sum, b) => sum + b.quantity, 0);
  if (total < effort)
    throw new Error(
      '有效服务依据的计划人天不足以覆盖评估人天，请补充资产或特批。',
    );
}
type EvaluationInput = Pick<
  RequestEvaluation,
  'scope' | 'opinion' | 'risks' | 'effort' | 'approverId' | 'approverName'
>;
export type RequestAction =
  | { type: 'meeting-create'; title: string; participantNames: string[] }
  | {
      type: 'meeting-schedule';
      title: string;
      scheduledDate: string;
      scheduledTime: string;
      durationMinutes: number;
    }
  | { type: 'meeting-start'; id: string }
  | { type: 'meeting-end'; id: string }
  | { type: 'meeting-attachments-add'; id: string; files: StoredFile[] }
  | { type: 'meeting-attachment-delete'; id: string; fileId: string }
  | {
      type: 'meeting-materials';
      id: string;
      recording?: StoredFile;
      transcript: string;
    }
  | {
      type: 'worklog-add';
      date: string;
      startTime: string;
      endTime: string;
      category: string;
      description: string;
    }
  | {
      type: 'worklog-edit';
      id: string;
      date: string;
      startTime: string;
      endTime: string;
      category: string;
      description: string;
    }
  | { type: 'worklog-void'; id: string; reason: string }
  | {
      type: 'basis-add';
      kind: 'asset' | 'exception';
      itemIds: string[];
      assetId?: string;
      quantity: number;
      reason: string;
      approverId?: string;
      approverName?: string;
    }
  | { type: 'basis-decide'; id: string; approve: boolean; note: string }
  | { type: 'basis-remove'; id: string; reason: string }
  | {
      type: 'evaluation-save';
      id?: string;
      input: EvaluationInput;
      submit: boolean;
    }
  | { type: 'evaluation-decide'; id: string; approve: boolean; note: string };

export function applyRequestAction(
  record: ServiceRequest,
  action: RequestAction,
  actor: OperationActor,
  assets: RequestAsset[],
  now = new Date().toISOString(),
): ServiceRequest {
  if (!actor.id || !actor.name || !isInternal(actor.role))
    throw new Error('请选择内部操作人。');
  if (record.status === '草稿' && !['meeting-attachments-add', 'meeting-attachment-delete'].includes(action.type))
    throw new Error('提交申请后才能使用内部工作模块。');
  if (['已取消', '已转工单'].includes(record.status))
    throw new Error('当前请求已结束，仅可查看历史记录。');
  const ops = structuredClone(operationsOf(record));
  let status = record.status;
  let category: RequestActivity['category'] = '审批';
  let title = '';
  let detail = '';
  const requireText = (s: string, label: string) => {
    if (!s.trim()) throw new Error(`请填写${label}。`);
  };
  const requirePmo = () => {
    if (!canEvaluate(actor.role))
      throw new Error('仅 SmartX 销售经理或 SmartX 系统管理员可执行此操作。');
  };
  const requireAssessment = () => {
    if (record.status !== '待评估')
      throw new Error('仅待评估阶段可调整评估或服务依据。');
  };
  const quantity = (n: number) => {
    if (!Number.isFinite(n) || n <= 0 || n > 100000)
      throw new Error('请填写有效的正数数量。');
  };
  const assignedReviewer = (approverId?: string, creatorId?: string) => {
    if (!canApprove(actor.role) || actor.id !== approverId)
      throw new Error('请切换至指定审批人账号处理。');
    if (actor.id === creatorId) throw new Error('不能审批自己提交的记录。');
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
              ...(record.internalParticipants?.map((person) => person.name) ??
                []),
              ...(record.externalCollaborators?.map((person) => person.name) ??
                []),
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
    case 'worklog-add':
    case 'worklog-edit': {
      const existing =
        action.type === 'worklog-edit'
          ? ops.worklogs.find((w) => w.id === action.id)
          : undefined;
      if (
        action.type === 'worklog-edit' &&
        (!existing || existing.voidedAt || existing.userId !== actor.id)
      )
        throw new Error('只能编辑自己的有效工时记录。');
      if (!canRecordWorklog(record, actor))
        throw new Error('仅项目经理或当前请求的内部协作人可以录入自己的工时。');
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
            w.userId === actor.id &&
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
        userId: actor.id,
        userName: actor.name,
        date: action.date,
        startTime: action.startTime,
        endTime: action.endTime,
        hours,
        category: action.category,
        description: action.description.trim(),
        createdAt: existing?.createdAt ?? now,
      };
      if (existing) Object.assign(existing, updatedLog);
      else ops.worklogs.unshift(updatedLog);
      category = '工时';
      title = existing ? '编辑内部工时' : '录入内部工时';
      detail = `${action.date} ${action.startTime}–${action.endTime} · ${formatWorklogHours(hours)} 小时 · ${action.description.trim()}`;
      break;
    }
    case 'worklog-void': {
      const log = ops.worklogs.find((w) => w.id === action.id);
      if (!log || log.voidedAt || log.userId !== actor.id)
        throw new Error('只能作废自己的有效工时记录。');
      requireText(action.reason, '作废原因');
      log.voidedAt = now;
      log.voidReason = action.reason.trim();
      category = '工时';
      title = '作废内部工时';
      detail = `${log.date} · ${log.hours} 小时 · ${log.voidReason}`;
      break;
    }
    case 'basis-add': {
      requireAssessment();
      quantity(action.quantity);
      requireText(
        action.reason,
        action.kind === 'asset' ? '使用说明' : '特批原因',
      );
      if (
        !action.itemIds.length ||
        action.itemIds.some((id) => !record.items.some((i) => i.id === id))
      )
        throw new Error('请选择本请求中的申请项。');
      const asset = assets.find(
        (a) =>
          a.id === action.assetId &&
          a.customerId === record.customerId &&
          a.status === '启用',
      );
      if (action.kind === 'asset') {
        requirePmo();
        if (!asset) throw new Error('请选择当前客户已启用的资产。');
        if (
          ops.bases.some(
            (b) =>
              b.assetId === asset.id && !['已移除', '已拒绝'].includes(b.state),
          )
        )
          throw new Error('此资产已关联，请勿重复关联。');
      } else {
        if (!canEvaluate(actor.role))
          throw new Error('特批由 SmartX 销售经理或 SmartX 系统管理员提交。');
        if (
          !action.approverId ||
          !action.approverName ||
          action.approverId === actor.id
        )
          throw new Error('请选择其他内部用户作为特批审批人。');
      }
      ops.bases.unshift({
        id: crypto.randomUUID(),
        kind: action.kind,
        assetId: action.kind === 'asset' ? asset!.id : undefined,
        name: action.kind === 'asset' ? asset!.name : '服务额度特批',
        itemIds: [...new Set(action.itemIds)],
        quantity: action.quantity,
        unit: '人天',
        reason: action.reason.trim(),
        state: action.kind === 'asset' ? '待核对' : '待审批',
        createdAt: now,
        createdBy: actor.name,
        creatorId: actor.id,
        approverId: action.approverId,
        approverName: action.approverName,
      });
      category = '服务依据';
      title = action.kind === 'asset' ? '关联客户资产' : '提交额度特批';
      detail = `${action.kind === 'asset' ? asset!.name : '特批'} · ${action.quantity} 人天 · ${action.reason}`;
      break;
    }
    case 'basis-decide': {
      requireAssessment();
      const basis = ops.bases.find((b) => b.id === action.id);
      if (!basis || !['待核对', '待审批'].includes(basis.state))
        throw new Error('此依据已处理或不存在。');
      requireText(action.note, '处理意见');
      if (basis.kind === 'asset') {
        requirePmo();
        if (
          !assets.some(
            (a) =>
              a.id === basis.assetId &&
              a.customerId === record.customerId &&
              a.status === '启用',
          )
        )
          throw new Error('资产已失效，请重新关联。');
      } else assignedReviewer(basis.approverId, basis.creatorId);
      basis.state = action.approve ? '有效' : '已拒绝';
      basis.decidedAt = now;
      basis.decidedBy = actor.name;
      basis.decisionNote = action.note.trim();
      title = `${basis.kind === 'asset' ? '资产核对' : '特批审批'}${action.approve ? '通过' : '拒绝'}`;
      detail = action.note;
      break;
    }
    case 'basis-remove': {
      requireAssessment();
      requirePmo();
      requireText(action.reason, '移除原因');
      const basis = ops.bases.find((b) => b.id === action.id);
      if (!basis || basis.state === '已移除')
        throw new Error('依据已移除或不存在。');
      if (
        ops.evaluations.some(
          (e) => e.state === '待审批' && e.basisIds.includes(basis.id),
        )
      )
        throw new Error('该依据正用于评估审批，请先处理评估审批。');
      basis.state = '已移除';
      basis.decisionNote = action.reason;
      basis.decidedAt = now;
      basis.decidedBy = actor.name;
      category = '服务依据';
      title = '移除服务依据';
      detail = `${basis.name} · ${action.reason}`;
      break;
    }
    case 'evaluation-save': {
      requireAssessment();
      requirePmo();
      const previous = action.id
        ? ops.evaluations.find((e) => e.id === action.id)
        : undefined;
      if (
        action.id &&
        (!previous ||
          previous.state !== '草稿' ||
          previous.authorId !== actor.id)
      )
        throw new Error('仅能编辑自己的评估草稿。');
      if (ops.evaluations.some((e) => e.state === '待审批'))
        throw new Error('已有评估待审批，请先完成当前审批。');
      if (action.submit) {
        requireText(action.input.scope, '服务范围');
        requireText(action.input.opinion, '评估意见');
        quantity(action.input.effort);
        if (
          !action.input.approverId ||
          !action.input.approverName ||
          action.input.approverId === actor.id
        )
          throw new Error('请选择其他内部用户审批评估。');
        if (uncoveredItems(record, assets).length)
          throw new Error(
            '请先为所有申请项关联已核对的客户资产或已通过的特批。',
          );
        ensureQuantityCovered(record, assets, action.input.effort);
      }
      const evaluation: RequestEvaluation = {
        ...action.input,
        id: previous?.id ?? crypto.randomUUID(),
        authorId: actor.id,
        author: actor.name,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        state: action.submit ? '待审批' : '草稿',
        basisIds: ops.bases
          .filter((b) => basisUsable(b, record, assets))
          .map((b) => b.id),
      };
      ops.evaluations = previous
        ? ops.evaluations.map((e) => (e.id === previous.id ? evaluation : e))
        : [evaluation, ...ops.evaluations];
      category = '评估';
      title = action.submit ? '提交评估审批' : '保存评估草稿';
      detail = action.input.opinion;
      break;
    }
    case 'evaluation-decide': {
      requireAssessment();
      const evaluation = ops.evaluations.find((e) => e.id === action.id);
      if (!evaluation || evaluation.state !== '待审批')
        throw new Error('评估记录已处理或不存在。');
      assignedReviewer(evaluation.approverId, evaluation.authorId);
      requireText(action.note, '审批意见');
      if (
        action.approve &&
        uncoveredItems(record, assets, evaluation.basisIds).length
      )
        throw new Error('服务依据不完整或已失效，不能通过评估。');
      if (action.approve)
        ensureQuantityCovered(
          record,
          assets,
          evaluation.effort,
          evaluation.basisIds,
        );
      evaluation.state = action.approve ? '已通过' : '已拒绝';
      evaluation.decidedAt = now;
      evaluation.decidedBy = actor.name;
      evaluation.decisionNote = action.note.trim();
      evaluation.updatedAt = now;
      status = action.approve ? '待确认' : '待评估';
      title = action.approve ? '评估审批通过' : '评估审批拒绝';
      detail = `${action.note} · 请求${action.approve ? '进入待确认' : '保留待评估，可重新评估'}`;
      break;
    }
  }
  return appendActivity(
    { ...record, status, operations: ops },
    actor,
    category,
    title,
    detail,
    now,
  );
}

export function requestReturnNotice(record: ServiceRequest): { title: string; reason: string } | null {
  if (record.status === '草稿') {
    const returned = record.operations?.draftReturns?.at(-1);
    return returned ? { title: '退回原因', reason: returned.reason.trim() || '未记录退回原因。' } : null;
  }
  if (record.status === '已取消') {
    const cancelled = record.operations?.activities.filter(event =>
      ['取消服务请求', '服务请求已取消', '取消请求', '已取消'].includes(event.title),
    ).at(-1);
    return { title: '取消原因', reason: cancelled?.detail.trim() || '未记录取消原因。' };
  }
  return null;
}

export function canRecordWorklog(record: ServiceRequest, actor: OperationActor): boolean {
  return Boolean(actor.id) && isInternal(actor.role)
    && !['草稿', '已取消', '已转工单'].includes(record.status)
    && (actor.role === 'SmartX 项目经理' || Boolean(record.internalParticipants?.some(person => person.userId === actor.id)));
}
