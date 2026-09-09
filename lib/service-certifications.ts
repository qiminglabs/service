import type { InternalUser } from './service-requests';
import type { Partner, PartnerUser } from './partner-directory';

export const serviceCertificationOptions = [
  'SMTX OS 认证',
  'CloudTower 认证',
] as const;
export const catalogCertificationOptions = [
  ...serviceCertificationOptions,
  '无认证要求',
];
export type CertificationHolderType = 'internal' | 'partner';
export type ServiceCertification = {
  id: string;
  certification: (typeof serviceCertificationOptions)[number];
  holderType: CertificationHolderType;
  userId: string;
  userName: string;
  expiresOn: string;
  status: '启用' | '停用';
};

export function certificationUsers(
  holderType: string,
  users: InternalUser[],
  partnerUsers: PartnerUser[],
  partners: Partner[],
): (InternalUser | PartnerUser)[] {
  if (holderType === 'internal')
    return users.filter((user) => user.status === '启用');
  if (holderType === 'partner')
    return partnerUsers.filter(
      (user) =>
        user.status === '启用' &&
        partners.some(
          (partner) =>
            partner.id === user.partnerId && partner.status === '启用',
        ),
    );
  return [];
}

export function createServiceCertification(
  form: Record<string, string>,
  records: ServiceCertification[],
  users: InternalUser[],
  partnerUsers: PartnerUser[],
  partners: Partner[],
): ServiceCertification {
  const certification = serviceCertificationOptions.find(
    (option) => option === form.certification,
  );
  if (!certification) throw new Error('请选择有效的认证内容。');
  const user = certificationUsers(
    form.holderType,
    users,
    partnerUsers,
    partners,
  ).find((person) => person.id === form.userId);
  if (!user) throw new Error('请选择已启用的内部用户或合作伙伴用户。');
  const expiresOn = form.expiresOn ?? '';
  const date = new Date(`${expiresOn}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) ||
    !Number.isFinite(date.getTime()) ||
    date.getUTCFullYear() < 1 ||
    date.toISOString().slice(0, 10) !== expiresOn
  )
    throw new Error('请选择有效的到期日。');
  if (
    records.some(
      (record) =>
        record.status === '启用' &&
        record.holderType === form.holderType &&
        record.userId === user.id &&
        record.certification === certification &&
        record.expiresOn === expiresOn,
    )
  )
    throw new Error('该用户已存在相同认证及到期日的启用记录。');
  const nextSequence =
    records.reduce((max, record) => {
      const match = /^CRT-(\d+)$/.exec(record.id);
      return Math.max(max, match ? Number(match[1]) : 0);
    }, 0) + 1;
  return {
    id: `CRT-${String(nextSequence).padStart(3, '0')}`,
    certification,
    holderType: form.holderType as CertificationHolderType,
    userId: user.id,
    userName: user.name,
    expiresOn,
    status: '启用',
  };
}

export function ensureCertificationSamples(
  records: ServiceCertification[],
  users: InternalUser[],
  partnerUsers: PartnerUser[],
  partners: Partner[],
): ServiceCertification[] {
  const specifications = [
    {
      id: 'CRT-DEMO-001',
      holderType: 'internal',
      preferredId: 'USR-001',
      certification: serviceCertificationOptions[0],
      expiresOn: '2027-06-30',
    },
    {
      id: 'CRT-DEMO-002',
      holderType: 'internal',
      preferredId: 'USR-004',
      certification: serviceCertificationOptions[1],
      expiresOn: '2027-09-30',
    },
    {
      id: 'CRT-DEMO-003',
      holderType: 'partner',
      preferredId: 'PUS-DEMO-001',
      certification: serviceCertificationOptions[0],
      expiresOn: '2027-12-31',
    },
  ] as const;
  const result = [...records];
  for (const sample of specifications) {
    if (result.some((record) => record.id === sample.id)) continue;
    const candidates = certificationUsers(
      sample.holderType,
      users,
      partnerUsers,
      partners,
    );
    const user =
      candidates.find((person) => person.id === sample.preferredId) ??
      candidates[0];
    if (!user) continue;
    if (
      result.some(
        (record) =>
          record.holderType === sample.holderType &&
          record.userId === user.id &&
          record.certification === sample.certification &&
          record.expiresOn === sample.expiresOn,
      )
    )
      continue;
    result.push({
      id: sample.id,
      holderType: sample.holderType,
      certification: sample.certification,
      userId: user.id,
      userName: user.name,
      expiresOn: sample.expiresOn,
      status: '启用',
    });
  }
  return result;
}
