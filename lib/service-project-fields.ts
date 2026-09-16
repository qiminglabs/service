import type { RequestField } from '../components/request-field-settings';
import { serviceProjectStatuses } from './service-project-status.ts';

export const initialProjectFields: RequestField[] = [
  { id: 'name', name: '项目名称', type: 'text', options: [] },
  {
    id: 'expectedServiceDate',
    name: '期望服务日期',
    type: 'date',
    options: [],
  },
  {
    id: 'customerId',
    name: '客户',
    type: 'lookup',
    referenceTarget: 'customers',
    options: [],
  },
  {
    id: 'serviceProviderId',
    name: '服务方',
    type: 'lookup',
    referenceTarget: 'partners',
    options: [],
  },
  { id: 'note', name: '项目说明', type: 'textarea', options: [] },
  { id: 'id', name: '项目编号', type: 'text', options: [] },
  {
    id: 'status',
    name: '项目状态',
    type: 'single',
    options: serviceProjectStatuses.map((value) => ({ value, enabled: true })),
  },
  {
    id: 'createdBy',
    name: '创建人',
    type: 'lookup',
    referenceTarget: 'users',
    options: [],
  },
  { id: 'createdAt', name: '创建时间', type: 'date', options: [] },
];

export const projectFieldRules: Record<string, string> = {
  name: '必填，最多 100 字',
  expectedServiceDate: '必填，使用服务申请的日期格式',
  customerId: '必填，关联客户对象，单选',
  serviceProviderId: '合作伙伴创建时固定为所属企业；内部创建时可选择北京志凌海纳科技有限公司或合作伙伴',
  note: '选填',
  id: '创建时自动生成，后续禁止编辑',
  status: '创建时为待启动，按项目流程变更；未结束的项目可取消',
  createdBy: '自动记录当前用户，后续禁止编辑',
  createdAt: '自动记录创建日期及时间，后续禁止编辑',
};

export function isSystemProjectField(id: string) {
  return initialProjectFields.some((field) => field.id === id);
}

export function normalizeProjectFields(
  fields: RequestField[] = [],
): RequestField[] {
  return [...initialProjectFields.map((seed) => {
    const stored = fields.find((field) => field.id === seed.id);
    return {
      ...stored,
      ...seed,
      referenceTarget: seed.referenceTarget,
      name: seed.id === 'expectedServiceDate' && stored?.name?.trim() === '期望服务时间'
        ? seed.name
        : stored?.name?.trim() || seed.name,
      options: structuredClone(seed.options),
    };
  }), ...fields.filter(field => !isSystemProjectField(field.id)).map(field => structuredClone(field))];
}
