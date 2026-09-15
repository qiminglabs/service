import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesUserSearch, userSearchOptions } from './user-search.ts';

const users = [
  { id: 'pm-1', name: '张明', email: 'zhang.ming@example.com', department: '项目管理部', status: '启用' },
  { id: 'pm-2', name: '张明', email: 'other@example.com', department: '项目管理部', status: '启用' },
  { id: 'sales', name: '销售', email: 'sales@example.com', department: '销售部', status: '启用' },
  { id: 'inactive', name: '旧负责人', email: 'old@example.com', department: '项目管理部', status: '停用' },
];

test('按姓名或邮箱匹配，忽略首尾空格和大小写，不匹配部门', () => {
  assert.equal(matchesUserSearch(users[0], '张明'), true);
  assert.equal(matchesUserSearch(users[0], '  ZHANG.MING@EXAMPLE.COM  '), true);
  assert.equal(matchesUserSearch(users[0], '项目管理部'), false);
  assert.equal(matchesUserSearch(users[0], 'missing'), false);
});

test('同名人员通过邮箱区分，选择仍绑定用户编号，角色筛选不被搜索放宽', () => {
  const { items, selected } = userSearchOptions(users, 'pm-2', ['pm-1', 'pm-2']);
  assert.equal(selected.id, 'pm-2');
  assert.deepEqual(items.filter(user => matchesUserSearch(user, '张明')).map(user => user.id), ['pm-1', 'pm-2']);
  assert.deepEqual(items.filter(user => matchesUserSearch(user, 'other@')).map(user => user.id), ['pm-2']);
  assert.deepEqual(items.filter(user => matchesUserSearch(user, 'sales@')), []);
  assert.deepEqual(userSearchOptions(users, '', []).items, []);
});

test('停用、已删除和不符合角色限制的已选人员保留回显但不可重新选择', () => {
  for (const id of ['inactive', 'deleted', 'sales']) {
    const { items, selected } = userSearchOptions(users, id, ['pm-1']);
    assert.equal(selected.id, id);
    assert.equal(selected.disabled, true);
    assert.deepEqual(items.filter(user => !user.disabled).map(user => user.id), ['pm-1']);
  }
  assert.equal(userSearchOptions(users, '').selected, null);
});

test('大量人员保持完整搜索范围，不因显示上限遗漏后面的用户', () => {
  const directory = Array.from({ length: 500 }, (_, index) => ({ ...users[0], id: String(index), email: `user${index}@example.com` }));
  const { items, availableCount } = userSearchOptions(directory, '');
  assert.equal(availableCount, 500);
  assert.deepEqual(items.filter(user => matchesUserSearch(user, 'user499@')).map(user => user.id), ['499']);
});
