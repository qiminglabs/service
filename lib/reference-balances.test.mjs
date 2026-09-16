import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  withDefaultAssetBalances,
  parseEntitlementQuantity,
} from './reference-balances.ts';

test('服务资产样例补齐 10、5、0 天，已使用资产不恢复余额', () => {
  const records = [
    { id: 'AST-001', status: '使用中' },
    { id: 'AST-002', status: '启用' },
    { id: 'AST-003', status: '已使用' },
  ];
  assert.deepEqual(
    withDefaultAssetBalances(records).map((record) => record.balanceDays),
    [10, 5, 0],
  );
  assert.equal(
    withDefaultAssetBalances([{ id: 'AST-001', status: '已使用' }])[0]
      .balanceDays,
    0,
  );
  assert.ok(records.every((record) => !Object.hasOwn(record, 'balanceDays')));
});

test('已保存余额（包括零和小数）、状态及自建资产不被默认值覆盖，迁移幂等', () => {
  const records = [
    { id: 'AST-001', status: '停用', balanceDays: 0 },
    { id: 'AST-002', status: '使用中', balanceDays: 2.75 },
    { id: 'custom', status: '启用' },
  ];
  assert.deepEqual(withDefaultAssetBalances(records), records);
  const seeded = withDefaultAssetBalances([{ id: 'AST-001', status: '启用' }]);
  assert.deepEqual(withDefaultAssetBalances(seeded), seeded);
});

test('权益编辑允许零及节点数上限，拒绝空白、负数、小数、超限及无效节点数', () => {
  assert.equal(parseEntitlementQuantity('0', 8), 0);
  assert.equal(parseEntitlementQuantity('8', 8), 8);
  assert.equal(parseEntitlementQuantity(' 3 ', 8), 3);
  for (const raw of ['', ' ', '-1', '1.5', '9', 'Infinity', 'NaN', 'bad'])
    assert.equal(parseEntitlementQuantity(raw, 8), null, raw);
  for (const nodeCount of [0, -1, 1.5, Infinity, NaN])
    assert.equal(parseEntitlementQuantity('1', nodeCount), null);
});

test('权益列表使用输入框和失焦保存，列表与创建表单名称均包含已冻结', () => {
  const source = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  for (const label of ['升级权益（含已冻结）', '巡检权益（含已冻结）']) {
    assert.ok(source.includes(`<th>${label}</th>`));
    assert.ok(source.includes(`${label} <em>*</em>`));
  }
  assert.match(source, /defaultValue=\{record\[field\]\}/);
  assert.match(source, /max=\{record.nodeCount\}/);
  assert.match(
    source,
    /props.onEntitlementChange\(record.id, field, quantity\)/,
  );
  assert.match(source, /else event.target.value = String\(record\[field\]\)/);
  assert.match(source, /balanceDays: '5'/);
  assert.match(source, /setAssets\(withDefaultAssetBalances/);
});
