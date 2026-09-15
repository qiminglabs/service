import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingRelationshipIssue, reportingChain, moveApprovalNode, newApprovalNode, emptyApprovalConfig, approvalConfigIssue, previewApproval } from './approval-flows.ts';
import { ensureLocalInternalUsers } from './internal-users.ts';
const person = (id, reportsToUserId, status = '启用') => ({ id, name: id, email: `${id}@example.com`, department: '测试部门', status, reportsToUserId });
const users = [person('a', 'b'), person('b', 'c'), person('c'), person('off', undefined, '停用')];
const config = nodes => ({ ...emptyApprovalConfig(), nodes });

test('汇报人关联拒绝自指、长循环、不存在和停用用户，允许清空', () => {
  assert.match(reportingRelationshipIssue(users, 'a', 'a'), /自己/);
  assert.match(reportingRelationshipIssue(users, 'c', 'a'), /循环/);
  assert.match(reportingRelationshipIssue(users, 'a', 'missing'), /不存在/);
  assert.match(reportingRelationshipIssue(users, 'a', 'off'), /启用/);
  assert.equal(reportingRelationshipIssue(users, 'a', 'c'), null);
  assert.equal(reportingRelationshipIssue(users, 'b', ''), null);
  assert.deepEqual(ensureLocalInternalUsers(users).slice(0, users.length), users);
});
test('逐级解析使用用户编号；保留实际姓名，断链和循环不视为审批完成', () => {
  assert.deepEqual(reportingChain(users, 'a', 2).users.map(user => user.id), ['b', 'c']);
  assert.match(reportingChain(users, 'a', 3).issue, /未设置/);
  assert.match(reportingChain([person('a', 'b'), person('b', 'a')], 'a', 3).issue, /循环/);
  assert.match(reportingChain([person('a', 'off'), ...users.slice(1)], 'a', 1).issue, /停用/);
  assert.match(reportingChain(users, 'off', 1).issue, /申请人/);
});
test('拖拽到插入点覆盖首尾及向上向下移动，输入节点不被修改', () => {
  const nodes = ['a', 'b', 'c'].map(id => ({ ...newApprovalNode(), id }));
  assert.deepEqual(moveApprovalNode(nodes, 'a', 3).map(n => n.id), ['b', 'c', 'a']);
  assert.deepEqual(moveApprovalNode(nodes, 'c', 0).map(n => n.id), ['c', 'a', 'b']);
  assert.deepEqual(moveApprovalNode(nodes, 'a', 1), nodes);
  assert.deepEqual(moveApprovalNode(nodes, 'b', 0).map(n => n.id), ['b', 'a', 'c']);
  assert.deepEqual(nodes.map(n => n.id), ['a', 'b', 'c']);
});
test('模拟按条件跳过并展开实际汇报链，缺失整条链转兜底，不部分放行', () => {
  const chain = { ...newApprovalNode('org'), depth: 2 }, conditional = { ...newApprovalNode('conditional'), threshold: 50000 };
  const preview = previewApproval(config([chain, conditional]), users, { applicantId: 'a', amount: 10000, risk: 'normal' });
  assert.deepEqual(preview.map(step => step.status), ['ready', 'ready', 'skipped']);
  assert.deepEqual(preview.slice(0, 2).map(step => step.users[0].id), ['b', 'c']);
  chain.depth = 3;
  const missing = previewApproval(config([chain]), users, { applicantId: 'a', amount: 0, risk: 'normal' });
  assert.equal(missing.length, 1); assert.equal(missing[0].status, 'admin'); assert.deepEqual(missing[0].users, []);
  chain.missing = 'block'; assert.equal(previewApproval(config([chain]), users, { applicantId: 'a', amount: 0, risk: 'high' })[0].status, 'blocked');
});
test('保存校验拒绝无审批人、重复和无效条件；人员审批保留选择顺序', () => {
  const node = { ...newApprovalNode(), source: 'people', userIds: [] };
  assert.match(approvalConfigIssue(config([node]), users), /内部用户/);
  node.userIds = ['off']; assert.match(approvalConfigIssue(config([node]), users), /内部用户/);
  node.userIds = ['c', 'b']; node.method = 'serial';
  assert.equal(approvalConfigIssue(config([node]), users), null);
  assert.deepEqual(previewApproval(config([node]), users, { applicantId: 'a', amount: 0, risk: 'normal' })[0].users.map(user => user.id), ['c', 'b']);
  assert.match(approvalConfigIssue(config([node, node]), users), /重复/);
  node.condition = 'amount'; node.threshold = NaN; assert.match(approvalConfigIssue(config([node]), users), /金额/);
  assert.match(approvalConfigIssue(config([]), users), /1–50/);
});
