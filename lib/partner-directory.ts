export type Partner = { id: string; name: string; status: '启用' | '停用' };
export type PartnerUser = {
  id: string;
  name: string;
  partnerId: string;
  phone: string;
  email: string;
  status: '启用' | '停用';
};

export function normalizePartnerName(name: string): string {
  return name.replace(/\s*(?:（模拟）|\(模拟\))/g, '').trim();
}

// Demo records live in the same editable directory as manually created records.
// Reserved IDs avoid collisions with existing PAR-/PUS- numeric sequences.
export const samplePartners: Partner[] = [
  {
    id: 'PAR-DEMO-001',
    name: '北京云桥信息技术有限公司',
    status: '启用',
  },
  { id: 'PAR-DEMO-002', name: '上海启川科技有限公司', status: '启用' },
  {
    id: 'PAR-DEMO-003',
    name: '深圳汇辰系统集成有限公司',
    status: '启用',
  },
];
export const samplePartnerUsers: PartnerUser[] = [
  {
    id: 'PUS-DEMO-001',
    partnerId: 'PAR-DEMO-001',
    name: '顾远',
    phone: '13800001001',
    email: 'gu.yuan@example.com',
    status: '启用',
  },
  {
    id: 'PUS-DEMO-002',
    partnerId: 'PAR-DEMO-001',
    name: '叶青',
    phone: '13800001002',
    email: 'ye.qing@example.com',
    status: '启用',
  },
  {
    id: 'PUS-DEMO-003',
    partnerId: 'PAR-DEMO-002',
    name: '程越',
    phone: '13800001003',
    email: 'cheng.yue@example.com',
    status: '启用',
  },
  {
    id: 'PUS-DEMO-004',
    partnerId: 'PAR-DEMO-002',
    name: '苏禾',
    phone: '13800001004',
    email: 'su.he@example.com',
    status: '启用',
  },
  {
    id: 'PUS-DEMO-005',
    partnerId: 'PAR-DEMO-003',
    name: '唐舟',
    phone: '13800001005',
    email: 'tang.zhou@example.com',
    status: '启用',
  },
];

export function ensurePartnerSamples(
  partners: Partner[],
  users: PartnerUser[],
) {
  partners = partners.map((partner) => ({ ...partner, name: normalizePartnerName(partner.name) }));
  return {
    partners: [
      ...partners,
      ...samplePartners.filter(
        (seed) =>
          !partners.some(
            (record) => record.id === seed.id || record.name === seed.name,
          ),
      ),
    ],
    partnerUsers: [
      ...users,
      ...samplePartnerUsers
        .filter(
          (seed) =>
            !users.some(
              (record) =>
                record.id === seed.id ||
                record.email.toLowerCase() === seed.email,
            ),
        )
        .map((seed) => {
          const samplePartner = samplePartners.find(
            (partner) => partner.id === seed.partnerId,
          )!;
          const existingPartner = partners.find(
            (partner) =>
              partner.id === seed.partnerId ||
              partner.name === samplePartner.name,
          );
          return { ...seed, partnerId: existingPartner?.id ?? seed.partnerId };
        }),
    ],
  };
}
