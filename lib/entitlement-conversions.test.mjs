import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConversionDays, appendConversionVersion, ensureConversionHistory } from './entitlement-conversions.ts';

test('换算系数支持正整数和一位小数，拒绝无效输入', () => {
  for (const [input, expected] of [['1', 1], ['0.5', 0.5], ['0.1', 0.1], [' 2.2 ', 2.2]]) assert.equal(parseConversionDays(input), expected);
  for (const input of ['', '0', '-1', 'NaN', 'Infinity', '0.01', '0.25', '0.00001', '1000001', 'abc']) assert.equal(parseConversionDays(input), null);
});
test('连续编辑追加版本并完整保留历史系数、时间、修改人及备注', () => {
  const first = appendConversionVersion([], 0.5, '张三', '首次配置');
  const snapshot = structuredClone(first);
  const next = appendConversionVersion(first, 2, '李四', ' 调整系数 ');
  assert.deepEqual(first, snapshot);
  assert.deepEqual(next[0], snapshot[0]);
  assert.equal(next[1].version, 2);
  assert.equal(next[1].days, 2);
  assert.equal(next[1].updatedBy, '李四');
  assert.equal(next[1].note, '调整系数');
  assert.notEqual(next[0].id, next[1].id);
  assert.ok(!Number.isNaN(Date.parse(next[1].updatedAt)));
  assert.throws(() => appendConversionVersion(next, 2, '李四', ''), /未变化/);
  assert.throws(() => appendConversionVersion(next, -1, '李四', ''), /大于/);
});
test('巡检和升级的版本独立递增', () => {
  const inspection = appendConversionVersion([], 1, '张三', '');
  const upgrade = appendConversionVersion([], 2, '张三', '');
  assert.equal(inspection[0].version, 1);
  assert.equal(upgrade[0].version, 1);
  assert.equal(appendConversionVersion(inspection, 0.5, '李四', '')[1].version, 2);
  assert.equal(upgrade.length, 1);
});

test('默认系数为 0.3，初始化幂等且不覆盖已编辑历史', () => {
  const initial = ensureConversionHistory(undefined);
  assert.equal(initial[0].days, 0.3);
  assert.equal(initial[0].version, 1);
  assert.equal(initial[0].updatedBy, '系统预置');
  assert.equal(ensureConversionHistory(initial), initial);
  assert.equal(ensureConversionHistory([])[0].days, 0.3);
  const edited = appendConversionVersion(initial, 0.5, '张三', '调整');
  assert.equal(ensureConversionHistory(edited), edited);
  assert.equal(edited.at(-1).version, 2);
});
