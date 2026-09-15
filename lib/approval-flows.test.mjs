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
test('旧审批节点清除全部生效条件，驳回统一退回申请人，保留审批顺序和人员', () => {
  const legacy = config([
    { ...newApprovalNode(), name: '条件审批', condition: 'amount', threshold: 50000, reject: 'end', source: 'people', userIds: ['c'], method: 'serial' },
    { ...newApprovalNode('org'), condition: 'risk', threshold: 10000, reject: 'end', depth: 3 },
  ]);
  const before = structuredClone(legacy);
  const normalized = normalizeApprovalConfig(legacy);
  assert.deepEqual(normalized.nodes.map(node => node.id), legacy.nodes.map(node => node.id));
  assert.ok(normalized.nodes.every(node => node.reject === 'return' && !('condition' in node) && !('threshold' in node)));
  assert.equal(normalized.nodes[0].name, '普通审批');
  assert.deepEqual(normalized.nodes[0].userIds, ['c']);
  assert.equal('method' in normalized.nodes[0], false);
  assert.equal(normalized.nodes[1].source, 'org');
  assert.equal(normalized.nodes[1].depth, 3);
  assert.deepEqual(normalizeApprovalConfig(normalized), normalized);
  assert.deepEqual(legacy, before);
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

test('移除指定角色后要求重新选择用户，不沿用旧角色节点中隐藏的人员', () => {
  const direct = { ...newApprovalNode(), source: 'people', userIds: ['b'], role: 'SmartX 项目经理' };
  const role = { ...newApprovalNode(), source: 'role', role: 'SmartX 销售经理', userIds: ['b'], method: 'any' };
  const legacy = config([role, direct, newApprovalNode('org')]);
  const normalized = normalizeApprovalConfig(legacy);
  assert.equal(normalized.nodes[0].source, 'people');
  assert.deepEqual(normalized.nodes[0].userIds, []);
  assert.equal('method' in normalized.nodes[0], false);
  assert.equal(normalized.nodes[0].id, role.id);
  assert.deepEqual(normalized.nodes[1].userIds, ['b']);
  assert.equal(normalized.nodes[2].source, 'org');
  assert.ok(normalized.nodes.every(node => !('role' in node)));
  assert.match(approvalConfigIssue(normalized, users), /内部用户/);
  normalized.nodes[0].userIds = ['c'];
  assert.equal(approvalConfigIssue(normalized, users), null);
  assert.deepEqual(normalizeApprovalConfig(normalized), normalized);
  assert.equal(legacy.nodes[0].source, 'role');
});

test('旧多人配置不自动挑选审批人，单人配置保留且所有审批方式字段移除', () => {
  const legacy = config([
    { ...newApprovalNode(), source: 'people', userIds: ['b', 'c'], method: 'all' },
    { ...newApprovalNode(), source: 'people', userIds: ['b'], method: 'any' },
    { ...newApprovalNode('org'), method: 'serial' },
  ]);
  const normalized = normalizeApprovalConfig(legacy);
  assert.deepEqual(normalized.nodes[0].userIds, []);
  assert.deepEqual(normalized.nodes[1].userIds, ['b']);
  assert.ok(normalized.nodes.every(node => !('method' in node)));
  assert.match(approvalConfigIssue(normalized, users), /一位已启用/);
  normalized.nodes[0].userIds = ['c'];
  assert.equal(approvalConfigIssue(normalized, users), null);
  assert.deepEqual(normalizeApprovalConfig(normalized), normalized);
  assert.deepEqual(legacy.nodes[0].userIds, ['b', 'c']);
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

test('截止人配置兼容旧流程、独立于单级审批人，拒绝重复或不可用人员', () => {
  const old = newApprovalNode('org'); delete old.stopUserIds;
  const normalized = normalizeApprovalConfig(config([old]));
  assert.deepEqual(normalized.nodes[0].stopUserIds, []);
  assert.equal(approvalConfigIssue(normalized, users), null);
  const node = { ...newApprovalNode('org'), depth: NaN, stopUserIds: ['b', 'c'] };
  assert.equal(approvalConfigIssue(config([node]), users), null);
  assert.deepEqual(normalizeApprovalConfig(config([node])).nodes[0].stopUserIds, ['b', 'c']);
  node.stopUserIds = ['b', 'b']; assert.match(approvalConfigIssue(config([node]), users), /截止人配置无效/);
  node.stopUserIds = ['off']; assert.match(approvalConfigIssue(config([node]), users), /截止人.*停用/);
  node.stopUserIds = []; assert.match(approvalConfigIssue(config([node]), users), /层数/);
  node.source = 'manager'; node.stopUserIds = ['c'];
  assert.deepEqual(normalizeApprovalConfig(config([node])).nodes[0].stopUserIds, []);
});


test('旧节点异常处理策略在读取规范化时移除，统一保留其余配置', () => {
  const old = config([{ ...newApprovalNode(), missing: 'admin' }, { ...newApprovalNode('org'), missing: 'block' }]);
  const before = structuredClone(old);
  const normalized = normalizeApprovalConfig(old);
  assert.ok(normalized.nodes.every(node => !('missing' in node)));
  assert.deepEqual(normalized.nodes.map(node => node.id), old.nodes.map(node => node.id));
  assert.equal(approvalConfigIssue(normalized, users), null);
  assert.deepEqual(normalizeApprovalConfig(normalized), normalized);
  assert.deepEqual(old, before);
});
