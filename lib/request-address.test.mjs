import test from 'node:test';
import assert from 'node:assert/strict';
import { readAddress, writeAddress, addressComplete, addressLabel } from './request-address.ts';
import { provinceCities, provinceNames } from './china-province-city.ts';

test('内置全国省市，直辖市不展示区选项', () => {
  assert.equal(provinceNames.length, 34);
  for (const city of ['北京市','上海市','天津市','重庆市']) assert.deepEqual(provinceCities[city], [city]);
  assert.ok(provinceCities['浙江省'].includes('杭州市'));
  assert.ok(provinceCities['广东省'].includes('深圳市'));
  assert.equal(provinceCities['台湾省'].length, 22);
  assert.ok(provinceCities['香港特别行政区']);
  assert.ok(provinceCities['澳门特别行政区']);
});
test('省市可以暂不选择，详细地址仍可保存和展示', () => {
  const value = writeAddress({province:'', city:'', detail:'文三路 100 号'});
  assert.equal(addressComplete(value), true);
  assert.equal(addressLabel(value), '文三路 100 号');
  assert.equal(addressComplete(writeAddress({province:'浙江省',city:'杭州市',detail:''})),false);
});
test('旧区信息移入详细地址，反复保存不重复、不丢失', () => {
  const legacy=JSON.stringify({kind:'address',province:'浙江省',city:'杭州市',district:'西湖区',detail:'文三路 100 号'});
  const migrated=readAddress(legacy);
  assert.equal(migrated.detail,'西湖区 文三路 100 号');
  assert.equal('district' in migrated,false);
  assert.deepEqual(readAddress(writeAddress(migrated)),migrated);
  assert.equal(addressLabel(legacy),'浙江省 杭州市 西湖区 文三路 100 号');
});
