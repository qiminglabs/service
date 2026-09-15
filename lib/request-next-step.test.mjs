import test from 'node:test';
import assert from 'node:assert/strict';
import { requestNextStep } from './request-next-step.ts';
import { localInternalUsers } from './internal-users.ts';
import { emptyAssessment } from './request-assessment.ts';
import { hardwareReviewSource } from './request-hardware-assessment.ts';

const customers = [{ id: 'c1', name: '客户', status: '启用', ownerUserId: 'USR-001' }];
const contacts = [{ id: 'p1', customerId: 'c1', name: '客户甲', status: '启用' }];
function request(status = '待评估') {
  return { id: 'r1', title: '测试', customerId: 'c1', createdById: 'USR-002', createdByAudience: 'internal',
    status, items: [], externalCollaborators: [{ contactId: 'p1', name: '客户甲' }],
    operations: { assessment: { ...emptyAssessment(), managerId: 'USR-003', manager: '赵言',
      routing: { manager: { userId: 'USR-003' }, hardware: { userId: 'USR-008' } } } } };
}
const hint = (record, users = localInternalUsers, directory = contacts) => requestNextStep(record, users, customers, directory);
function assessed(withPlan = true) {
  const record = request();
  record.operations.assessment.rounds = [{ outcome: '评估通过' }];
  record.operations.assessment.effort = { days: 2 };
  if (withPlan) record.operations.assessment.plans = [{ id: 'plan', effort: 2, allocations: [], salesId: 'USR-001' }];
  return record;
}

test('内外部草稿分别指向申请人所在站点', () => {
  const record = request('草稿');
  assert.equal(hint(record).site, '服务管理中心');
  assert.match(hint(record).actor, /陈屿/);
  assert.match(hint(record).action, /提交申请/);
  Object.assign(record, { createdById: 'p1', createdByAudience: 'customer' });
  assert.equal(hint(record).site, '客户中心');
  assert.match(hint(record).actor, /客户甲/);
});

test('评估依次引导硬件评估、材料评估、人天核定，并识别过期硬件结论', () => {
  const record = request();
  record.items = [{ id: 'i1', serviceId: 'SC-IMP-008', values: {} }];
  assert.match(hint(record).actor, /沈川/);
  assert.match(hint(record).action, /硬件产品经理评估/);
  record.operations.assessment.hardware = { reviewerId: 'USR-008', assignmentId: 'hw', rounds: [{
    assignmentId: 'hw', authorId: 'USR-008', outcome: '评估通过', source: hardwareReviewSource(record),
  }] };
  assert.match(hint(record).actor, /赵言/);
  assert.match(hint(record).action, /材料评估/);
  record.items[0].values = { version: 'new' };
  assert.match(hint(record).actor, /沈川/);
  record.operations.assessment.rounds.push({ outcome: '评估通过' });
  assert.match(hint(record).action, /人天核定/);
});

test('内部申请由申请人关联依据，客户申请由客户所有人关联', () => {
  const record = assessed(false);
  assert.match(hint(record).actor, /陈屿/);
  assert.match(hint(record).action, /服务依据关联/);
  Object.assign(record, { createdByAudience: 'customer', createdById: 'p1' });
  assert.match(hint(record).actor, /王琪（客户所有人）/);
  record.operations.assessment.plans = [{ id: 'old', releasedAt: 'now', allocations: [], effort: 2 }];
  assert.match(hint(record).action, /服务依据关联/);
});

test('额度不足按实际权限发起审批，审批环节变化时跟随当前审批人', () => {
  const record = assessed();
  assert.match(hint(record).actor, /陈屿/);
  assert.match(hint(record).action, /发起特殊审批/);
  const approval = { planId: 'plan', days: 2, state: '待审批', approverId: 'USR-001', workflow: { steps: [
    { approverId: 'USR-001', state: '已通过', nodeName: '销售审批' },
    { approverId: 'USR-006', state: '待审批', nodeName: '二级审批' },
  ] } };
  record.operations.assessment.approvals.push(approval);
  assert.match(hint(record).actor, /陆明/);
  assert.match(hint(record).action, /二级审批/);
  approval.state = '已拒绝';
  assert.match(hint(record).action, /重新发起特殊审批/);
  approval.state = '已通过';
  assert.match(hint(record).actor, /陈屿/);
  assert.match(hint(record).action, /发起客户确认/);
});

test('额度充足或零计价时直接引导客户确认，旧方案的审批不阻塞新方案', () => {
  const record = assessed();
  record.operations.assessment.plans[0].allocations = [{ days: 2 }];
  record.operations.assessment.approvals = [{ planId: 'old', state: '待审批' }];
  assert.match(hint(record).action, /发起客户确认/);
  record.operations.assessment.effort.days = 0;
  record.operations.assessment.plans[0].effort = 0;
  record.operations.assessment.plans[0].allocations = [];
  assert.match(hint(record).action, /发起客户确认/);
});

test('客户确认只指向当前客户有效协作人，缺少可操作用户时引导管理员', () => {
  const record = request('待确认');
  assert.equal(hint(record).site, '客户中心');
  assert.match(hint(record).actor, /客户甲/);
  const directory = [{ ...contacts[0], status: '停用' }, { id: 'p2', name: '无权限联系人', status: '启用', customerId: 'c1' }];
  assert.match(hint(record, localInternalUsers, directory).actor, /系统管理员/);
  record.status = '待评估';
  record.operations.assessment.routing.manager.userId = '';
  assert.match(hint(record).action, /分配有效的项目经理/);
  record.operations.assessment.routing.manager.userId = 'USR-003';
  assert.match(hint(record, localInternalUsers.map(user => user.id === 'USR-003' ? { ...user, status: '停用' } : user)).action, /分配有效的项目经理/);
});

test('待受理说明项目功能尚未开放，终态不再指派后续操作', () => {
  assert.match(hint(request('待受理')).actor, /赵言/);
  assert.match(hint(request('待受理')).action, /当前暂不可操作/);
  for (const status of ['已取消', '已转服务项目']) {
    assert.equal(hint(request(status)).site, undefined);
    assert.equal(hint(request(status)).actor, undefined);
  }
});
