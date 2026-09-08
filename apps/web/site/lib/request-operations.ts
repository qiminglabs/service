import type { ServiceRequest, StoredFile } from './service-requests';

export type RequestAsset = {
  id: string;
  customerId: string;
  name: string;
  status: string;
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
  status: '进行中' | '已结束';
  endedAt?: string;
  mode: 'local-demo';
  recording?: StoredFile;
  transcript?: string;
};
export type RequestWorklog = {
  id: string;
  userId: string;
  userName: string;
  date: string;
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
    系统管理员: 'SmartX 系统管理员',
    销售: 'SmartX 员工',
    售前: 'SmartX 员工',
    PMO: 'SmartX 员工',
    审批人: 'SmartX 员工',
    项目经理: 'SmartX 项目经理',
    服务工程师: 'SmartX 服务工程师',
  };
  return Object.hasOwn(legacy, value) ? legacy[value] : value;
}
export function isAdministrator(role: string) {
  return role === 'SmartX 系统管理员';
}
export function canEvaluate(role: string) {
  return ['SmartX 员工', 'SmartX 系统管理员'].includes(role);
}
export function canApprove(role: string) {
  return canEvaluate(role);
}
export function isInternal(role: string) {
  return [
    'SmartX 系统管理员',
    'SmartX 员工',
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
  | { type: 'meeting-end'; id: string }
  | {
      type: 'meeting-materials';
      id: string;
      recording?: StoredFile;
      transcript: string;
    }
  | {
      type: 'worklog-add';
      date: string;
      hours: number;
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
  if (record.status === '草稿')
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
      throw new Error('仅 SmartX 员工或 SmartX 系统管理员可执行此操作。');
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
    case 'worklog-add': {
      const person = record.internalParticipants?.find(
        (p) => p.userId === actor.id,
      );
      if (!person)
        throw new Error('仅当前请求的内部协作人可以录入自己的工时。');
      const d = new Date(action.date + 'T12:00:00');
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(action.date) ||
        Number.isNaN(d.getTime()) ||
        localDate(d) !== action.date ||
        action.date > localDate(new Date(now))
      )
        throw new Error('请选择有效且不晚于今天的工作日期。');
      if (
        !Number.isFinite(action.hours) ||
        action.hours <= 0 ||
        action.hours > 24 ||
        !Number.isInteger(action.hours * 4)
      )
        throw new Error('工时须为 0.25 小时的倍数，每天不超过 24 小时。');
      const dayTotal = ops.worklogs
        .filter(
          (w) => w.userId === actor.id && w.date === action.date && !w.voidedAt,
        )
        .reduce((s, w) => s + w.hours, 0);
      if (dayTotal + action.hours > 24)
        throw new Error('该成员当天累计工时不能超过 24 小时。');
      requireText(action.description, '工作内容');
      requireText(action.category, '工作类型');
      ops.worklogs.unshift({
        id: crypto.randomUUID(),
        userId: actor.id,
        userName: actor.name,
        date: action.date,
        hours: action.hours,
        category: action.category,
        description: action.description.trim(),
        createdAt: now,
      });
      category = '工时';
      title = '录入内部工时';
      detail = `${action.date} · ${action.hours} 小时 · ${action.description.trim()}`;
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
          throw new Error('特批由 SmartX 员工或 SmartX 系统管理员提交。');
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
