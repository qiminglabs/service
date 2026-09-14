import type { RequestConfig } from './service-requests';

export const fieldRequirementLabels = {
  onsite: '服务方式为现场时显示且必填',
  'standard-or-enterprise': '授权版本为标准版或企业版时显示且必填',
  enterprise: '授权版本为企业版时显示且必填',
} as const;
export type FieldRequirement = keyof typeof fieldRequirementLabels;
export const editionFeatureFields = [
  { id: 'trafficVisualization', name: '是否开启流量可视化', requirement: 'standard-or-enterprise' },
  { id: 'installSfs', name: '是否安装文件存储（SFS）', requirement: 'standard-or-enterprise' },
  { id: 'installSks', name: '是否安装容器管理平台（SKS）', requirement: 'enterprise' },
] as const;
export function editionFieldRequirement(id: string): FieldRequirement | undefined {
  return editionFeatureFields.find(field => field.id === id)?.requirement;
}
export function isEditionRequirement(requirement?: FieldRequirement) {
  return requirement === 'standard-or-enterprise' || requirement === 'enterprise';
}
export function withEditionFieldDependency(config: RequestConfig, editionOptions: string[]): RequestConfig {
  if (!config.fields.some(id => isEditionRequirement(config.fieldRequiredWhen?.[id]))) return config;
  const fields = config.fields.includes('edition') ? config.fields : ['edition', ...config.fields];
  const order = [...(config.fieldOrder ?? config.fields)];
  if (!order.includes('edition')) {
    const index = order.findIndex(id => isEditionRequirement(config.fieldRequiredWhen?.[id]));
    order.splice(index < 0 ? order.length : index, 0, 'edition');
  }
  return {
    ...config,
    fields,
    fieldOrder: order,
    fieldRequired: { ...config.fieldRequired, edition: true },
    fieldOptions: { ...config.fieldOptions, edition: config.fieldOptions.edition ?? editionOptions },
  };
}
export function fieldOptionsIssue(options: { value: string; enabled: boolean }[]): string | null {
  const values = options.map(option => option.value.trim());
  if (!values.length) return '请至少新建一个选项。';
  if (values.some(value => !value)) return '选项名称不能为空。';
  if (new Set(values).size !== values.length) return '选项已存在（包含已停用选项），请修改或启用原选项。';
  return null;
}
