import test from 'node:test';
import assert from 'node:assert/strict';
import { reportingRelationshipIssue, reportingChain, newApprovalNode, emptyApprovalConfig, approvalConfigIssue, normalizeApprovalConfig } from './approval-flows.ts';
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
test('保存校验拒绝无审批人、重复节点和结束申请的驳回设置', () => {
  const node = { ...newApprovalNode(), source: 'people', userIds: [] };
  assert.match(approvalConfigIssue(config([node]), users), /内部用户/);
  node.userIds = ['off']; assert.match(approvalConfigIssue(config([node]), users), /内部用户/);
  node.userIds = ['c', 'b']; assert.match(approvalConfigIssue(config([node]), users), /仅支持一位/);
  node.userIds = ['c'];
  assert.equal(approvalConfigIssue(config([node]), users), null);
  assert.match(approvalConfigIssue(config([node, node]), users), /重复/);
  node.reject = 'end'; assert.match(approvalConfigIssue(config([node]), users), /节点规则/);
  assert.match(approvalConfigIssue(config([]), users), /1–50/);
});

test('截止人包含在审批链中，多个截止人取沿途最先到达者，与选择顺序无关', () => {
  assert.deepEqual(reportingChain(users, 'a', 1, ['c']), { users: [users[1], users[2]] });
  assert.deepEqual(reportingChain(users, 'a', 20, ['c', 'b']), { users: [users[1]] });
  assert.deepEqual(reportingChain(users, 'a', 20, ['b', 'c']), { users: [users[1]] });
  assert.deepEqual(reportingChain(users, 'b', 20, ['c']), { users: [users[2]] });
  const longChain = Array.from({ length: 26 }, (_, i) => person(`u${i}`, i < 25 ? `u${i + 1}` : undefined));
  const result = reportingChain(longChain, 'u0', 2, ['u25']);
  assert.equal(result.issue, undefined);
  assert.equal(result.users.length, 25);
  assert.equal(result.users.at(-1).id, 'u25');
});

test('截止人模式未命中、断链、停用和循环均不视为审批完成', () => {
  const unrelated = [...users, person('other')];
  assert.match(reportingChain(unrelated, 'a', 1, ['other']).issue, /未到达审批截止人/);
  assert.match(reportingChain(users, 'a', 1, ['off']).issue, /截止人.*停用/);
  assert.match(reportingChain(users, 'a', 1, ['missing']).issue, /截止人.*不存在/);
  assert.match(reportingChain([person('a', 'b'), person('b', 'a'), person('c')], 'a', 1, ['c']).issue, /循环/);
  assert.match(reportingChain([person('a', 'off'), ...users.slice(1)], 'a', 1, ['c']).issue, /停用/);
});

test('截止人配置独立于单级审批人，拒绝重复或不可用人员', () => {
  const node = { ...newApprovalNode('org'), depth: NaN, stopUserIds: ['b', 'c'] };
  assert.equal(approvalConfigIssue(config([node]), users), null);
  assert.deepEqual(normalizeApprovalConfig(config([node])).nodes[0].stopUserIds, ['b', 'c']);
  node.stopUserIds = ['b', 'b']; assert.match(approvalConfigIssue(config([node]), users), /截止人配置无效/);
  node.stopUserIds = ['off']; assert.match(approvalConfigIssue(config([node]), users), /截止人.*停用/);
  node.stopUserIds = []; assert.match(approvalConfigIssue(config([node]), users), /层数/);
  node.source = 'manager'; node.stopUserIds = ['c'];
  assert.deepEqual(normalizeApprovalConfig(config([node])).nodes[0].stopUserIds, ['c']);
});
