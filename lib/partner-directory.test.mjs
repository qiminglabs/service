import test from 'node:test';
import assert from 'node:assert/strict';
import { ensurePartnerSamples, samplePartners, normalizePartnerName } from './partner-directory.ts';

test('合作伙伴名称统一清理标记，旧数据迁移不重复建公司且保留关联', () => {
  assert.equal(normalizePartnerName('某公司 （模拟）'), '某公司');
  assert.equal(normalizePartnerName('某公司(模拟)'), '某公司');
  const old = [{ ...samplePartners[0], id: 'custom-partner', name: `${samplePartners[0].name}（模拟）`, status: '停用' }];
  const result = ensurePartnerSamples(old, []);
  assert.equal(result.partners.length, samplePartners.length);
  assert.deepEqual(result.partners[0], { ...old[0], name: samplePartners[0].name });
  assert.equal(result.partnerUsers[0].partnerId, 'custom-partner');
  assert.deepEqual(ensurePartnerSamples(result.partners, result.partnerUsers), result);
  assert.ok(old[0].name.includes('（模拟）'));
});
