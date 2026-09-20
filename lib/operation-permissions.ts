import type { OperationActor } from './request-operations';
import { isDemoAdministrator } from './demo-permissions.ts';

export const permissionRoles = {
  admin: '系统管理员',
  pm: '项目经理',
  sales: '销售经理',
  presales: '售前工程师',
  hardware: '硬件产品经理',
  engineer: '内部服务工程师',
  partner: '伙伴服务工程师',
  customer: '客户联系人',
} as const;
export type PermissionRole = keyof typeof permissionRoles;
export type PermissionResult =
  | '允许'
  | '有条件允许'
  | '禁止'
  | '不适用'
  | '无页面入口';
export type PermissionSite = '内部系统' | '客户中心' | '合作伙伴中心' | '通用';
export type PermissionObject = '服务申请' | '服务项目' | '目录与系统';
type PermissionRoute = 'ir' | 'cr' | 'pr' | 'ip' | 'pp' | 'cp' | 'cfg';
const siteNames: Record<PermissionRoute, PermissionSite> = {
  ir: '内部系统',
  cr: '客户中心',
  pr: '合作伙伴中心',
  ip: '内部系统',
  pp: '合作伙伴中心',
  cp: '客户中心',
  cfg: '通用',
};
type PermissionDefinition = {
  id: string;
  routes: PermissionRoute[];
  stages: string[];
  actions: string[];
  p: Partial<Record<PermissionRole, string>>;
  note: string;
  source: string;
  all?: PermissionResult;
};
export type OperationPermissionRow = {
  id: string;
  ruleId: string;
  site: PermissionSite;
  role: PermissionRole;
  object: PermissionObject;
  stages: string[];
  action: string;
  result: PermissionResult;
  scope: string;
  condition: string;
  portal: string;
  source: string;
};
// Read-only reference to current operation rules, not an authorization store.
// Keep rule changes aligned with the business permission checks and their tests.
const staff = (text: string): Partial<Record<PermissionRole, string>> =>
  Object.fromEntries(
    ['admin', 'pm', 'sales', 'presales', 'hardware', 'engineer'].map((k) => [
      k,
      text,
    ]),
  );
const manager = { admin: '管理员可代办', pm: '负责本记录的项目经理' };
const basis = {
  ...staff('来源内部申请人或直接内部项目创建人，或本客户所有人'),
  admin: '管理员可代办',
};
const projectManagers = {
  ...manager,
  partner: '伙伴项目创建人或非纯派单的伙伴协作人',
};
const execute = {
  ...manager,
  engineer: '项目协作人且被指派此工单',
  partner: '项目协作人且被指派此工单',
};
const requestView = {
  ...staff('本人申请、协作或审批/依据等关联申请'),
  admin: '全部申请',
  pm: '全部申请',
  customer: '本客户中本人创建或本人为客户协作人的申请',
};
const projectView = {
  admin: '全部项目',
  pm: '仅自己负责的项目',
  sales: '本人为内部协作人或当前待审批人的项目',
  engineer: '本人为内部协作人或当前待审批人的项目',
  partner: '本人创建、伙伴协作或派单关联的项目',
  customer: '所属有效客户且本人为客户协作人的项目',
};
const defs: PermissionDefinition[] = [];
function add(
  id: string,
  routes: string,
  stages: string,
  actions: string,
  p: Partial<Record<PermissionRole, string>>,
  note: string,
  source: string,
  extra: { all?: PermissionResult } = {},
) {
  defs.push({
    id,
    routes: routes.split(',') as PermissionRoute[],
    stages: stages.split('/'),
    actions: actions.split('|'),
    p,
    note,
    source,
    ...extra,
  });
}
const requestOpen = '草稿/待评估/待确认/待受理';
const projectOpen = '待启动/进行中/待复核/待确认/已暂停';
// This is the current executable/UI behavior, not the earlier proposed matrix.
add(
  'R00',
  'ir,cr',
  '草稿/待评估/待确认/待受理/评估完成/已转服务项目/已取消',
  '查看申请列表与详情',
  requestView,
  '客户不能查看内部工时、内部评估及仅内部可见资料。人员关系与客户组织须有效。',
  'lib/service-requests.ts',
);
add(
  'R01',
  'ir',
  '创建',
  '新建服务交付申请|新建技术评估申请',
  staff('启用的内部身份'),
  '管理员可选择内部发起人；来源仍为内部系统。',
  'lib/service-requests.ts',
);
add(
  'R02',
  'cr',
  '创建',
  '新建服务交付申请|新建技术评估申请',
  { admin: '可代有效客户联系人发起', customer: '仅为自己所属的启用客户发起' },
  '管理员代创建时保留客户来源、业务创建人与实际管理员。',
  'lib/service-requests.ts',
);
add(
  'R03',
  'pr',
  '创建',
  '新建服务申请',
  {},
  '伙伴中心没有服务申请入口。',
  'lib/portal-context.ts',
  { all: '不适用' },
);
add(
  'R04',
  'ir,cr',
  '草稿',
  '编辑申请基本信息|增删编辑申请项|上传或替换申请材料',
  { ...staff('须有申请访问权'), customer: '仅本人创建的草稿' },
  '必填、文件和来源目录规则仍校验；客户协作人不能编辑他人的草稿。',
  'lib/service-requests.ts',
);
add(
  'R05',
  'ir',
  '草稿',
  '提交申请',
  { ...staff('仅本人创建的申请'), admin: '可代创建人提交' },
  '须满足齐套、提交规则、有效联系人和期望服务日期要求。',
  'lib/submission-validation.ts',
);
add(
  'R06',
  'cr',
  '草稿',
  '提交申请',
  { admin: '可代创建人提交', customer: '仅本人创建的申请' },
  '客户协作人不能代他人提交；提交校验仍有效。',
  'lib/submission-validation.ts',
);
add(
  'R07',
  'ir,cr',
  '待评估',
  '调整申请项与材料',
  manager,
  '仅材料评估通过前；材料评估通过后锁定。',
  'lib/service-requests.ts',
);
add(
  'R08',
  'ir,cr',
  '待评估',
  '填写材料评估',
  manager,
  '支持需补充或评估通过；命中硬件评估时须先满足硬件通过条件。已通过不能再次评估。',
  'lib/request-assessment.ts',
);
add(
  'R09',
  'ir,cr',
  '待评估',
  '填写硬件评估',
  { admin: '可代硬件评估人', hardware: '当前分配给本人的硬件评估' },
  '仅命中硬件评估的申请；保留分配人及实际作者。',
  'lib/request-hardware-assessment.ts',
);
add(
  'R10',
  'ir,cr',
  '待评估',
  '核定申请人天',
  manager,
  '材料评估通过后；技术评估核定后进入评估完成，不走额度及方案确认。',
  'lib/request-assessment.ts',
);
add(
  'R11',
  'ir',
  '待评估',
  '关联服务依据|发起方案客户确认',
  { ...staff('本申请的内部申请人'), admin: '可代内部申请人' },
  '仅服务交付类型；先材料通过并核定，方案及额度须有效，发起确认前处理完待审批额度。',
  'lib/request-assessment.ts',
);
add(
  'R12',
  'cr',
  '待评估',
  '关联服务依据|发起方案客户确认',
  { ...staff('当前客户所有人'), admin: '可代客户所有人' },
  '仅服务交付类型；客户联系人不处理内部服务依据，方案须足额。',
  'lib/request-assessment.ts',
);
add(
  'R13',
  'ir',
  '待评估',
  '发起额度审批',
  {
    ...staff('内部申请人本人'),
    admin: '可代申请人或销售',
    sales: '内部申请人或方案指定的有效销售',
  },
  '已有核定与方案且存在额度缺口；按配置产生审批路径。',
  'lib/request-assessment.ts',
);
add(
  'R14',
  'cr',
  '待评估',
  '发起额度审批',
  { admin: '可代负责销售', sales: '方案指定的有效销售' },
  '客户发起的申请由指定销售处理额度申请。',
  'lib/request-assessment.ts',
);
add(
  'R15',
  'ir,cr',
  '待评估',
  '通过额度审批|拒绝额度审批',
  {
    ...staff('当前环节指定审批人，普通用户不得自批'),
    admin: '可代当前环节审批人，允许演示代批',
  },
  '按原审批顺序；不得改写已完成审批。',
  'lib/approval-execution.ts',
);
add(
  'R16',
  'ir,cr',
  '待确认',
  '接受服务方案|拒绝服务方案',
  { admin: '可代客户确认或拒绝', customer: '本客户任一有效客户协作人' },
  '接受进入待受理；拒绝需原因并回待评估，保留方案依据和审批。',
  'lib/request-customer-decision.ts',
);
add(
  'R17',
  'ir,cr',
  '待受理',
  '拆分并创建服务项目',
  manager,
  '全部申请项须准确分组且不能重复转换；新项目来源均为内部系统。',
  'lib/request-projects.ts',
);
add(
  'R18',
  'ir,cr',
  '待评估',
  '退回草稿',
  manager,
  '原因必填；归档评估并释放方案占用。',
  'lib/request-assessment.ts',
);
add(
  'R19',
  'ir,cr',
  '待评估/待确认/待受理',
  '取消申请',
  manager,
  '原因必填；草稿、技术评估完成及已转项目申请不能使用此操作。',
  'lib/request-cancellation.ts',
);
add(
  'R20',
  'ir,cr',
  '评估完成',
  '补充交付材料|技术评估转服务交付',
  manager,
  '仅技术评估；保留已评估材料，补齐交付要求后转为待评估的服务交付。',
  'lib/request-type-workflow.ts',
);
add(
  'R21',
  'ir,cr',
  '草稿/待评估',
  '发布补充资料',
  { ...staff('须有申请访问权'), customer: '须有申请访问权且属于本客户' },
  '客户提交必须对外可见；已发布资料不可直接重写或删除。',
  'lib/request-supplements.ts',
);
add(
  'R22',
  'ir,cr',
  '待评估/待确认/待受理',
  '录入本人工时',
  {
    ...staff('本申请内部协作人'),
    admin: '可录入，不要求预先加入协作',
    pm: '须有申请访问权',
  },
  '仅内部工时；日期、时间、当天累计不超过24小时等校验有效。',
  'lib/request-operations.ts',
);
add(
  'R23',
  'ir,cr',
  '待评估/待确认/待受理',
  '编辑有效工时|作废有效工时',
  { ...staff('仅本人有效工时；编辑须有录入资格'), admin: '可代原记录人操作' },
  '代操作保留原工时归属；作废需原因。',
  'lib/request-operations.ts',
);
add(
  'R24',
  'ir,cr',
  '待评估/待确认/待受理',
  '发起即时会议|预约会议',
  staff('须有申请访问权'),
  '本地模拟会议，日期与资料有效性仍校验。',
  'lib/request-operations.ts',
);
add(
  'R25',
  'ir,cr',
  '待评估/待确认/待受理',
  '开始或结束会议|维护会议资料',
  { ...staff('本人主持的会议'), admin: '可代主持人操作' },
  '须符合会议自身状态；附件文件校验有效。',
  'lib/request-operations.ts',
);
add(
  'R26',
  'ir,cr',
  '草稿/待评估',
  '维护客户协作人',
  { ...staff('须有申请访问权'), customer: '须有访问权，仅本客户联系人' },
  '创建人、客户所有人及固定成员不能移除。',
  'lib/service-requests.ts',
);
add(
  'R27',
  'ir,cr',
  requestOpen,
  '维护内部协作人',
  staff('须有申请访问权'),
  '保留固定申请人、客户所有人、分配项目经理及硬件评估人。',
  'lib/service-requests.ts',
);
add(
  'R28',
  'ir,cr',
  '草稿/待评估',
  '维护伙伴协作人',
  staff('须有申请访问权'),
  '仅启用伙伴及用户；加入名单不赋予伙伴服务申请入口。',
  'lib/service-requests.ts',
);
add(
  'R29',
  'ir,cr',
  '已取消/评估完成/已转服务项目',
  '增删申请协作人',
  {},
  '终态协作人锁定；管理员也不能修改。',
  'lib/request-collaboration.ts',
);
add(
  'R30',
  'ir,cr',
  '已转服务项目',
  '修改来源申请业务内容',
  {},
  '来源申请全量只读，后续业务在项目中处理。',
  'lib/request-readonly.ts',
);
add(
  'R31',
  'ir,cr',
  '已取消',
  '恢复已取消申请',
  {},
  '没有撤回或恢复逻辑。',
  'lib/request-cancellation.ts',
);
add(
  'P00',
  'ip,pp',
  '待启动/进行中/待复核/待确认/已暂停/已完成/已取消',
  '查看项目列表与详情',
  projectView,
  '项目经理按负责关系限制。伙伴仅看本人相关且对外可见资料；客户不看内部工时和复核细节。',
  'lib/service-projects.ts',
);
add(
  'P01',
  'ip',
  '创建',
  '直接创建服务项目',
  { admin: '允许，可代内部项目经理发起', pm: '允许' },
  '选择伙伴服务方仍是内部来源，不能因此改走伙伴业务路径。',
  'lib/service-project-store.ts',
);
add(
  'P02',
  'pp',
  '创建',
  '直接创建伙伴项目',
  { admin: '可代有效伙伴工程师发起', partner: '有效伙伴账号' },
  '来源为伙伴中心；服务方固定业务创建人所属企业，记录实际管理员。',
  'lib/service-project-store.ts',
);
add(
  'P03',
  'cp',
  '创建',
  '直接创建服务项目',
  {},
  '客户中心无直接创建项目入口，可提交服务申请后由内部转换。',
  'lib/portal-context.ts',
  { all: '不适用' },
);
add(
  'P04',
  'ip,pp',
  '待启动/进行中/待复核/待确认',
  '编辑项目基本信息',
  projectManagers,
  '启动后客户及服务方等字段受限；来源映射字段只读；确认后名称锁定。',
  'lib/service-projects.ts',
);
add(
  'P05',
  'ip,pp',
  '待启动',
  '编辑服务项与材料',
  projectManagers,
  '未生成工单；映射字段及目录开放范围仍校验。',
  'lib/service-project-items.ts',
);
add(
  'P06',
  'ip',
  '待启动',
  '启动项目并生成工单',
  manager,
  '无既有工单；资料、服务目录及流程配置须有效。',
  'lib/service-work-orders.ts',
);
add(
  'P07',
  'pp',
  '待启动',
  '启动项目并生成工单',
  { ...manager, partner: '本项目创建人' },
  '保留资料与工单生成校验。',
  'lib/service-work-orders.ts',
);
add(
  'P08',
  'ip',
  '进行中',
  '新增工单|取消单张工单|指派或改派工单',
  manager,
  '客户未确认；取消需原因；指派须满足服务方、有效身份和认证要求。',
  'lib/work-order-assignment.ts',
);
add(
  'P09',
  'pp',
  '进行中',
  '新增工单|取消单张工单|指派或改派工单',
  { ...manager, partner: '本项目创建人' },
  '伙伴来源只派所属企业的有效伙伴人员；普通伙伴协作人不能增减或派单。',
  'lib/work-order-assignment.ts',
);
add(
  'P10',
  'ip,pp',
  '进行中',
  '编辑工单基本信息|保存执行步骤|生成工单服务报告|提交交付物|完成工单',
  execute,
  '工单可执行且未取消、未暂停；必填步骤、资料完整性及完成校验不能跳过。',
  'lib/service-work-orders.ts',
);
add(
  'P11',
  'ip,pp',
  '进行中',
  '暂停单张工单|恢复单张工单',
  manager,
  '须符合工单自身状态。伙伴创建人没有单独暂停工单权限。',
  'lib/service-work-orders.ts',
);
add(
  'P12',
  'ip',
  '进行中',
  '提交项目复核',
  {
    admin: '可代执行工程师',
    engineer: '项目协作人且被派至少一张有效工单',
    partner: '项目协作人且被派至少一张有效工单',
  },
  '所有未取消工单全部完成；项目经理角色本身不能提交复核。',
  'lib/service-project-work-order-policy.ts',
);
add(
  'P13',
  'pp',
  '进行中',
  '提交内部复核|人天核定|关联服务依据|发起额度审批',
  {},
  '伙伴来源直接发起客户确认，不走内部复核和资产额度路径。',
  'lib/service-project-review.ts',
  { all: '不适用' },
);
add(
  'P14',
  'ip',
  '待启动/进行中/待复核',
  '录入本人工时',
  {
    ...staff('须为内部协作人'),
    ...manager,
    partner: '本项目伙伴协作人，包含派单加入的服务商工程师',
  },
  '须有有效工单可关联；以内部项目来源判断，与执行人员公司无关。',
  'lib/service-project-operations.ts',
);
add(
  'P15',
  'ip',
  '待启动/进行中/待复核',
  '编辑有效工时|作废有效工时',
  {
    ...staff('有录入资格且仅本人工时'),
    pm: '负责项目经理且仅本人工时',
    admin: '可代原记录人操作',
    partner: '有录入资格且仅本人工时',
  },
  '代改仍归原人员；编辑已确认工时会清除该条工时确认；作废需原因。',
  'lib/service-project-operations.ts',
);
add(
  'P16',
  'ip',
  '待启动/进行中/待复核',
  '确认有效工时',
  manager,
  '仅有效未作废记录；进入客户确认后不可重新确认。',
  'lib/service-project-operations.ts',
);
add(
  'P17',
  'ip',
  '待确认/已暂停/已完成/已取消',
  '录入、编辑、作废或重新确认工时',
  {},
  '发起客户确认即锁定；客户拒绝回待复核后恢复。已确认永久锁定。暂停须先恢复。',
  'lib/service-project-work-order-policy.ts',
);
add(
  'P18',
  'pp',
  projectOpen + '/已完成/已取消',
  '查看工时页面|录入或维护工时',
  {},
  '伙伴工程师发起的项目不展示工时页面，保存层也拒绝工时操作。',
  'lib/service-project-work-order-policy.ts',
  { all: '不适用' },
);
add(
  'P19',
  'ip',
  '进行中/待复核',
  '过程或最终人天核定',
  manager,
  '先确认全部有效工时；过程核定不能代替最终核定。',
  'lib/service-project-review.ts',
);
add(
  'P20',
  'ip',
  '进行中/待复核',
  '关联项目服务依据',
  basis,
  '先核定人天；资产、权益、余额及来源占用校验有效。',
  'lib/service-project-review.ts',
);
add(
  'P21',
  'ip',
  '待启动/进行中/待复核',
  '发起项目额度审批',
  basis,
  '允许启动前申请独立额度；遵守申请金额和审批配置。',
  'lib/service-project-review.ts',
);
add(
  'P22',
  'ip',
  '待启动/进行中/待复核',
  '通过项目额度审批|拒绝项目额度审批',
  {
    ...staff('当前环节指定审批人，普通用户不得自批'),
    admin: '可代当前环节审批人',
  },
  '项目经理还须是本项目负责经理；审批顺序和历史不可绕过。',
  'lib/approval-execution.ts',
);
add(
  'P23',
  'ip',
  '待复核',
  '发送报告并发起客户确认',
  { ...basis, engineer: '服务依据负责人，或项目协作人且被指派至少一张未取消工单', partner: '项目协作人且被指派至少一张未取消工单' },
  '工单全部完成，最终核定有效且依据足额，有有效客户协作人。',
  'lib/service-project-review.ts',
);
add(
  'P24',
  'ip',
  '待复核',
  '退回执行',
  manager,
  '需原因；仅待复核阶段，不作为客户确认撤回入口。',
  'lib/service-project-work-order-policy.ts',
);
add(
  'P25',
  'pp',
  '进行中',
  '发送报告并发起客户确认',
  { ...manager, engineer: '项目协作人且被指派至少一张未取消工单', partner: '本项目创建人，或项目协作人且被指派至少一张未取消工单' },
  '有效工单全部完成且有有效客户协作人；无需内部人天核定和资产依据。',
  'lib/service-project-review.ts',
);
add(
  'P26',
  'ip',
  '待确认',
  '接受项目交付',
  { admin: '可代客户确认', customer: '本客户任一有效客户协作人' },
  '最新确认有效且依据足额；接受后自动完成项目并核销资产。',
  'lib/service-project-review.ts',
);
add(
  'P27',
  'pp',
  '待确认',
  '接受项目交付',
  { admin: '可代客户确认', customer: '本客户任一有效客户协作人' },
  '最新确认有效；接受后自动完成项目，不核销内部资产。',
  'lib/service-project-review.ts',
);
add(
  'P28',
  'ip,pp',
  '待确认',
  '拒绝项目交付',
  { admin: '可代客户拒绝', customer: '本客户任一有效客户协作人' },
  '原因必填；内部项目回待复核，伙伴项目回进行中。',
  'lib/service-project-review.ts',
);
add(
  'P29',
  'ip,pp',
  '已完成',
  '撤回客户确认|修改已确认核心内容|取消已确认项目',
  {},
  '客户接受后自动完成，确认内容和工时永久锁定，无撤回入口。',
  'lib/service-project-review.ts',
);
add(
  'P30',
  'ip,pp',
  projectOpen,
  '发送服务日报或项目报告邮件',
  {
    admin: '可代执行工程师',
    engineer: '至少被派一张有效工单且有项目访问权',
    partner: '至少被派一张有效工单且有项目访问权',
  },
  '项目未关闭；暂停、复核及待确认阶段仍允许。邮件为本地记录或邮件草稿。',
  'lib/service-project-daily-reports.ts',
);
add(
  'P32',
  'ip,pp',
  projectOpen,
  '发布补充信息',
  projectView,
  '须有项目访问权；暂停时仍可发布；不等于修改已确认的交付内容。',
  'lib/service-project-supplements.ts',
);
add(
  'P33',
  'ip,pp',
  projectOpen,
  '维护客户或伙伴协作人',
  projectManagers,
  '固定身份和已指派工程师受保护；成员须符合客户或服务方范围。',
  'lib/service-project-collaborators.ts',
);
add(
  'P34',
  'ip,pp',
  projectOpen,
  '维护内部协作人',
  manager,
  '伙伴不能修改内部协作人；固定人员不可移除；新增项目经理成为负责经理。',
  'lib/service-project-collaborators.ts',
);
add(
  'P35',
  'ip,pp',
  '待启动/进行中/待复核/待确认',
  '预约或发起会议',
  projectManagers,
  '未暂停、未关闭；具体会议状态与资料校验有效。',
  'lib/service-project-operations.ts',
);
add(
  'P36',
  'ip,pp',
  '待启动/进行中/待复核/待确认',
  '开始、结束或维护会议',
  {
    admin: '可代会议主持人',
    pm: '负责项目经理且本人为会议主持人',
    partner: '有项目管理资格且为会议主持人',
  },
  '管理员可代主持人；其他人员须为会议主持人，且具有本项目管理资格。',
  'lib/service-project-operations.ts',
);
add(
  'P37',
  'ip',
  '待启动/进行中/待复核/待确认',
  '暂停整个项目',
  manager,
  '原因必填；暂停执行、工时和基础编辑，仍可补充信息、协作和报告。',
  'lib/service-project-suspension.ts',
);
add(
  'P38',
  'pp',
  '待启动/进行中/待复核/待确认',
  '暂停整个项目',
  { ...manager, partner: '本项目创建人' },
  '原因必填；伙伴用户及所属组织须启用。',
  'lib/service-project-suspension.ts',
);
add(
  'P39',
  'ip',
  '已暂停',
  '恢复整个项目',
  manager,
  '恢复到原阶段；不自动恢复单独暂停的工单。',
  'lib/service-project-suspension.ts',
);
add(
  'P40',
  'pp',
  '已暂停',
  '恢复整个项目',
  { ...manager, partner: '本项目创建人' },
  '恢复到原阶段；已完成、已取消不可恢复。',
  'lib/service-project-suspension.ts',
);
add(
  'P41',
  'ip',
  projectOpen,
  '取消整个项目',
  manager,
  '客户尚未接受且原因必填；工单同步取消，按关联依据释放本项目占用。',
  'lib/service-project-cancellation.ts',
);
add(
  'P42',
  'pp',
  projectOpen,
  '取消整个项目',
  { ...manager, partner: '本项目创建人' },
  '客户尚未接受且原因必填；不影响其他项目，已取消不可恢复。',
  'lib/service-project-cancellation.ts',
);
add(
  'P43',
  'ip,pp',
  '已暂停',
  '执行工单|编辑项目基础信息',
  {},
  '须先恢复项目；补充信息、协作人和报告另按对应行处理。',
  'lib/service-project-operations.ts',
);
add(
  'P44',
  'ip,pp',
  '已完成/已取消',
  '恢复项目|编辑核心业务内容|新增补充信息或报告',
  {},
  '终态只读，历史记录继续可查看；没有重新打开流程。',
  'lib/service-projects.ts',
);
add(
  'C01',
  'cfg',
  '任意',
  '查看服务目录列表或详情|查看目录历史版本|查看申请表单配置',
  { admin: '允许', pm: '只读查看' },
  '含内部、客户、伙伴三套表单，可查看配置和下载模板。',
  'lib/catalog-versions.ts',
);
add(
  'C02',
  'cfg',
  '任意',
  '新建服务目录|编辑服务目录|启用服务目录|停用服务目录|保存内部申请表单|保存客户申请表单|保存伙伴申请表单',
  { admin: '启用的系统管理员' },
  '项目经理只读，页面和保存事务均拒绝修改；管理员状态在事务内复核。',
  'lib/catalog-versions.ts',
);
add(
  'C03',
  'cfg',
  '任意',
  '维护客户或联系人|维护服务资产或业务对象|维护人员或伙伴主数据|维护人员认证',
  { admin: '管理员' },
  '引用数据入口只对管理员开放，具体字段和关联限制仍适用。',
  'lib/portal-context.ts',
);
add(
  'C04',
  'cfg',
  '任意',
  '维护申请字段与表单规则|维护评估分配规则|维护审批流程|维护工单执行流程|维护服务商配置|维护邮件或报告模板',
  { admin: '管理员' },
  '后台配置入口仅管理员；发布、启停、版本冲突等按具体配置校验。',
  'lib/backend-settings.ts',
);
add(
  'C06',
  'cfg',
  '任意',
  '初始化全部演示数据',
  { ...staff('允许'), partner: '允许', customer: '允许' },
  '所有角色均保留入口；需页面确认后重建本地演示数据。',
  'app/page.tsx',
);
add(
  'C07',
  'cfg',
  '任意',
  '切换演示用户',
  { ...staff('允许'), partner: '允许', customer: '允许' },
  '仅显示有效演示身份；姓名为初始演示名，浏览器中改名不改变权限规则。',
  'lib/internal-users.ts',
);
add(
  'C08',
  'cfg',
  '任意',
  '查看项目经理主页',
  { admin: '允许', pm: '允许，仅本人负责范围' },
  '以最新门户配置为准；首页中的项目仍按访问权限筛选。',
  'lib/portal-context.ts',
);
add(
  'C09',
  'cfg',
  '任意',
  '查看操作权限清单',
  { admin: '允许' },
  '只读查询；切换查看用户不会更换当前操作账号，也不会修改权限。',
  'lib/operation-permissions.ts',
);

export function permissionRoleForActor(
  actor: OperationActor,
): PermissionRole | undefined {
  if (isDemoAdministrator(actor)) return 'admin';
  const roles: Record<string, PermissionRole> = {
    'SmartX 项目经理': 'pm',
    'SmartX 销售经理': 'sales',
    'SmartX 售前工程师': 'presales',
    'SmartX 硬件产品经理': 'hardware',
    'SmartX 服务工程师': 'engineer',
    合作伙伴服务工程师: 'partner',
    客户: 'customer',
  };
  return roles[actor.role];
}

export const operationPermissionRows: OperationPermissionRow[] = defs.flatMap(
  (d) =>
    d.routes.flatMap((route) =>
      d.actions.flatMap((action, ai) =>
        (Object.keys(permissionRoles) as PermissionRole[]).map((role) => {
          const object: PermissionObject = d.id.startsWith('R')
            ? '服务申请'
            : d.id.startsWith('P')
              ? '服务项目'
              : '目录与系统';
          let scope = d.p[role] ?? '本角色没有该操作资格';
          let result: PermissionResult =
            d.all ??
            (d.p[role]
              ? scope === '允许' || scope === '只读查看'
                ? '允许'
                : '有条件允许'
              : '禁止');
          if (object === '服务申请' && role === 'partner' && !d.all) {
            result = '无页面入口';
            scope = '伙伴中心不开放服务申请';
          }
          if (
            object === '服务项目' &&
            ['presales', 'hardware'].includes(role) &&
            !d.all
          ) {
            result = '无页面入口';
            scope = '当前角色的门户未开放服务项目';
          }
          if (
            object === '服务项目' &&
            role === 'pm' &&
            d.p[role] &&
            !d.all &&
            !d.stages.includes('创建')
          )
            scope = '仅自己负责的项目；' + scope;
          if (
            object === '目录与系统' &&
            !['C06', 'C07'].includes(d.id) &&
            !d.p[role]
          ) {
            result = '无页面入口';
            scope = '当前角色没有该管理入口';
          }
          if (d.id === 'C02' && role === 'pm') {
            result = '禁止';
            scope = '可查看目录，不能进行此修改';
          }
          const stages =
            route === 'pp'
              ? d.stages.filter((stage) => stage !== '待复核')
              : d.stages;
          return {
            id: `${d.id}-${route}-${ai + 1}-${role}`,
            ruleId: d.id,
            site: siteNames[route],
            role,
            object,
            stages,
            action,
            result,
            scope,
            condition: d.note,
            portal:
              role === 'customer'
                ? '客户中心'
                : role === 'partner'
                  ? '合作伙伴中心'
                  : '服务管理中心',
            source: d.source,
          };
        }),
      ),
    ),
);

export type PermissionFilters = {
  site?: string;
  role?: string;
  object?: string;
  stage?: string;
  result?: string;
  query?: string;
};
export function filterOperationPermissions(filters: PermissionFilters) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? '';
  return operationPermissionRows.filter(
    (row) =>
      (!filters.site || row.site === filters.site || row.site === '通用') &&
      (!filters.role || row.role === filters.role) &&
      (!filters.object || row.object === filters.object) &&
      (!filters.stage ||
        row.stages.includes(filters.stage) ||
        row.stages.includes('任意')) &&
      (!filters.result || row.result === filters.result) &&
      (!query ||
        [
          row.action,
          row.scope,
          row.condition,
          row.object,
          row.site,
          permissionRoles[row.role],
        ]
          .join(' ')
          .toLocaleLowerCase()
          .includes(query)),
  );
}
