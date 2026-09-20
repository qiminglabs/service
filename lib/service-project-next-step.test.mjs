import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceProjectNextStep, customerProjectNextStep } from './service-project-next-step.ts';
import { projectReviewFingerprint } from './service-project-review.ts';
const directory = {
  users: [{ id: 'USR-003', name: '项目经理甲', status: '启用' }, { id: 'USR-004', name: '工程师甲', status: '启用' }, { id: 'USR-002', name: '销售甲', status: '启用' }],
  contacts: [{ id: 'c', customerId: 'company', name: '客户甲', status: '启用' }],
  partners: [{ id: 'partner', status: '启用' }], partnerUsers: [{ id: 'partner-user', partnerId: 'partner', name: '伙伴甲', status: '启用' }],
};
const customers = [{ id: 'company', ownerUserId: 'USR-002', status: '启用' }];
const fixture = () => ({ id: 'project', status: '进行中', customerId: 'company', createdById: 'USR-003', createdSite: '内部系统',
  collaborators: { internal: [{ id: 'USR-003', assignmentRoles: ['项目经理'] }, { id: 'USR-004' }], customer: [{ id: 'c' }], partner: [{ id: 'partner-user' }] },
  operations: { worklogs: [] }, review: { approvals: [], confirmations: [] },
  workOrders: [{ id: 'order', status: '进行中', item: {}, assignees: [{ id: 'USR-004', name: '工程师甲', group: 'internal' }], steps: [] }],
});
const next = (p, external = false, refs = directory) => serviceProjectNextStep(p, refs, customers, external);

test('工单执行与手动提交复核提示匹配真实指派，暂停工单不可提示提交', () => {
  const p = fixture();
  assert.match(next(p).actor, /工程师甲/);
  assert.match(next(p).action, /完成已指派工单/);
  p.workOrders[0].status = '已完成';
  assert.match(next(p).action, /任意已指派.*提交复核/);
  p.workOrders[0].status = '已暂停';
  assert.match(next(p).actor, /项目经理甲/);
  assert.match(next(p).action, /恢复工单/);
  p.workOrders[0].status = '待执行'; p.workOrders[0].assignees = [];
  assert.match(next(p).action, /未指派工单/);
});

test('合作伙伴创建项目完成工单后直接由创建人发起确认', () => {
  const p = { ...fixture(), createdSite: '合作伙伴中心', createdById: 'partner-user', serviceProviderId: 'partner:partner' };
  p.workOrders[0].status = '已完成';
  assert.equal(next(p).site, '合作伙伴中心');
  assert.match(next(p).actor, /伙伴甲/);
  assert.match(next(p).action, /发送报告并发起确认/);
  assert.doesNotMatch(next(p).action, /复核/);
});

test('复核提示区分工时确认、人天核定、额度审批和服务依据，外部不展示内部详情', () => {
  const p = { ...fixture(), status: '待复核' };
  p.operations.worklogs.push({ id: 'log', hours: 1 });
  assert.match(next(p).action, /确认待确认工时/);
  p.operations.worklogs[0].confirmedAt = '2026-09-20';
  assert.match(next(p).action, /核定人天/);
  p.review.effort = { stage: '最终', lines: [], fingerprint: projectReviewFingerprint(p) };
  p.review.approvals.push({ id: 'approval', independent: true, days: 1, state: '待审批', approverId: 'USR-002' });
  assert.match(next(p).actor, /销售甲/);
  assert.match(next(p).action, /额度审批/);
  assert.doesNotMatch(next(p, true).action, /工时|人天|额度/);
  p.review.approvals[0].state = '已通过';
  assert.match(next(p).action, /足额后发送报告/);
});

test('确认由有效客户协作人处理，通过后系统自动完成项目', () => {
  const p = { ...fixture(), status: '待确认' };
  p.review.confirmations.push({ id: 'confirmation', state: '待确认' });
  assert.equal(next(p).site, '客户中心');
  assert.match(next(p).actor, /客户甲/);
  assert.match(next(p).action, /确认或拒绝/);
  const disabled = { ...directory, contacts: [{ ...directory.contacts[0], status: '停用' }] };
  assert.equal(next(p, false, disabled).site, '服务管理中心');
  p.review.confirmations[0].state = '已确认';
  assert.match(next(p).action, /系统自动完成项目/);
});

test('暂停、取消和完成提示不引导继续执行，停用工程师不被指定', () => {
  const p = fixture();
  assert.match(next({ ...p, status: '已暂停' }).action, /恢复项目/);
  assert.equal(next({ ...p, status: '已取消' }).site, undefined);
  assert.equal(next({ ...p, status: '已完成' }).site, undefined);
  const refs = { ...directory, users: directory.users.filter(user => user.id !== 'USR-004') };
  p.workOrders[0].status = '已完成';
  assert.equal(next(p, false, refs).actor, '系统管理员');
});

test('客户提示只用公开投影；待确认、拒绝、已确认及失效各有对应提示', () => {
  const p = { status: '待确认', internalCollaborators: [{ name: '项目经理甲', roles: ['项目经理'] }], collaborators: [{ name: '客户甲' }], confirmation: { state: '待确认' } };
  assert.equal(customerProjectNextStep(p).site, '客户中心');
  assert.match(customerProjectNextStep({ ...p, confirmationStale: true }).action, /等待服务方/);
  assert.equal(customerProjectNextStep({ ...p, confirmationStale: true }).site, undefined);
  assert.match(customerProjectNextStep({ ...p, confirmation: { state: '已确认' } }).action, /系统自动完成/);
  assert.match(customerProjectNextStep({ ...p, status: '待复核', confirmation: { state: '已拒绝' } }).action, /拒绝原因/);
  assert.match(customerProjectNextStep({ ...p, status: '已暂停' }).action, /恢复项目/);
});
