import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  serviceCertificationOptions,
  catalogCertificationOptions,
  certificationUsers,
  createServiceCertification,
  ensureCertificationSamples,
} from './service-certifications.ts';
import { localInternalUsers } from './internal-users.ts';
import { samplePartners, samplePartnerUsers } from './partner-directory.ts';

const form = {
  certification: 'SMTX OS 认证',
  holderType: 'internal',
  userId: 'USR-001',
  expiresOn: '2027-06-30',
};
const create = (
  input = form,
  records = [],
  users = localInternalUsers,
  partnerUsers = samplePartnerUsers,
  partners = samplePartners,
) => createServiceCertification(input, records, users, partnerUsers, partners);

test('服务目录与服务认证共用选项，无认证要求不能登记为个人认证', () => {
  assert.deepEqual(catalogCertificationOptions, [
    ...serviceCertificationOptions,
    '无认证要求',
  ]);
  assert.throws(
    () => create({ ...form, certification: '无认证要求' }),
    /认证内容/,
  );
  assert.throws(
    () => create({ ...form, certification: '虚构认证' }),
    /认证内容/,
  );
  const source = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  assert.match(source, /options=\{catalogCertificationOptions\}/);
  assert.match(source, /serviceCertificationOptions\.map/);
});

test('可关联内部与合作伙伴用户，姓名读取主数据，停用或错误类型不可关联', () => {
  const internal = create();
  assert.equal(
    internal.userName,
    localInternalUsers.find((user) => user.id === form.userId).name,
  );
  const partner = create({
    ...form,
    holderType: 'partner',
    userId: samplePartnerUsers[0].id,
  });
  assert.equal(partner.userName, samplePartnerUsers[0].name);
  assert.equal(partner.status, '启用');
  assert.throws(() => create({ ...form, holderType: 'partner' }), /已启用/);
  assert.throws(() => create({ ...form, holderType: 'customer' }), /已启用/);
  assert.throws(() => create({ ...form, userId: 'missing' }), /已启用/);
  assert.throws(
    () =>
      create(
        form,
        [],
        localInternalUsers.map((user) => ({ ...user, status: '停用' })),
      ),
    /已启用/,
  );
  assert.deepEqual(
    certificationUsers(
      'partner',
      [],
      samplePartnerUsers,
      samplePartners.map((partner) => ({ ...partner, status: '停用' })),
    ),
    [],
  );
  assert.deepEqual(
    certificationUsers(
      'partner',
      [],
      samplePartnerUsers.map((user) => ({ ...user, status: '停用' })),
      samplePartners,
    ),
    [],
  );
});

test('到期日必填，严格校验日历日期，允许补录历史日期', () => {
  for (const expiresOn of [
    '',
    '2027-02-29',
    '2027-04-31',
    '2027-13-01',
    '2027-1-1',
    'invalid',
    '0000-01-01',
  ])
    assert.throws(() => create({ ...form, expiresOn }), /到期日/);
  assert.equal(
    create({ ...form, expiresOn: '2028-02-29' }).expiresOn,
    '2028-02-29',
  );
  assert.equal(
    create({ ...form, expiresOn: '2020-01-01' }).expiresOn,
    '2020-01-01',
  );
});

test('拒绝重复启用记录，续期可登记新日期，编号不与样例或既有记录冲突', () => {
  const first = create();
  assert.throws(() => create(form, [first]), /已存在/);
  assert.equal(
    create({ ...form, expiresOn: '2028-06-30' }, [first]).id,
    'CRT-002',
  );
  assert.equal(
    create(form, [{ ...first, id: 'CRT-008', status: '停用' }]).id,
    'CRT-009',
  );
  const samples = ensureCertificationSamples(
    [],
    localInternalUsers,
    samplePartnerUsers,
    samplePartners,
  );
  assert.equal(
    create({ ...form, expiresOn: '2028-06-30' }, samples).id,
    'CRT-001',
  );
});

test('三条样例均关联主数据，反复加载保留停用、日期、手工记录，不重复写入', () => {
  const samples = ensureCertificationSamples(
    [],
    localInternalUsers,
    samplePartnerUsers,
    samplePartners,
  );
  assert.equal(samples.length, 3);
  assert.deepEqual(
    new Set(samples.map((record) => record.holderType)),
    new Set(['internal', 'partner']),
  );
  for (const record of samples) {
    const users =
      record.holderType === 'internal'
        ? localInternalUsers
        : samplePartnerUsers;
    assert.equal(
      users.find((user) => user.id === record.userId).name,
      record.userName,
    );
  }
  const saved = [
    ...samples.map((record) => ({
      ...record,
      expiresOn: '2029-01-01',
      status: '停用',
    })),
    create(),
  ];
  assert.deepEqual(
    ensureCertificationSamples(
      saved,
      localInternalUsers,
      samplePartnerUsers,
      samplePartners,
    ),
    saved,
  );
  assert.deepEqual(ensureCertificationSamples([], [], [], []), []);
  assert.deepEqual(structuredClone(saved), saved);
});
