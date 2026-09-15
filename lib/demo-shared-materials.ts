import { requestMaterialGroups, saveRequestMaterialGroup } from './request-materials.ts';
import type { ServiceRequest, StoredFile } from './service-requests';
import type { OperationActor } from './request-operations';

// Demo-specific form snapshots; current service catalog definitions stay unchanged.
export function addSharedMaterialSample(record: ServiceRequest, actor: OperationActor): ServiceRequest {
  const templateText = '# 环境信息表\n\n客户：\n集群名称：\n节点数量：\n维护窗口：\n';
  const templateBlob = new Blob([templateText], { type: 'text/markdown;charset=utf-8' });
  const template: StoredFile = { id: 'demo-shared-environment-template', name: '环境信息表模板.md', size: templateBlob.size, blob: templateBlob, uploadedAt: record.createdAt, uploadedById: actor.id, uploaderAudience: 'internal' };
  return { ...record, items: record.items.map(item => ({ ...item, config: { ...item.config, materials: [...item.config.materials, {
    id: `${item.id}-shared-environment`, name: '环境信息表（共用示例）', required: true, instructions: '本请求多个服务项共用一份环境信息表。',
    deduplicate: true, template, templateDigest: 'ecb2bab63b43431a19df65bc3cdbeedc289ed1b47d6fc33d984c9d77c926749e',
  }] } })) };
}

export function fillSharedSampleMaterials(record: ServiceRequest, actor: OperationActor): ServiceRequest {
  let next = record;
  for (const group of requestMaterialGroups(record).filter(group => group.shared)) {
    const content = `# ${group.requirement.name}（共用示例）\n\n申请：${record.id}\n服务项：${group.members.map(member => member.item.serviceName).join('、')}\n期望服务日期：${record.expectedServiceDate}\n\n以上服务项使用同一份环境清单与维护窗口信息。正式执行前请重新核对。\n`;
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const file: StoredFile = { id: `${record.id}-shared-${group.members[0].requirement.id}`, name: `${group.requirement.name}（共用）.md`, size: blob.size, blob, uploadedAt: record.createdAt, uploadedById: actor.id, uploaderAudience: 'internal' };
    next = saveRequestMaterialGroup(next, group.members[0].item.id, group.members[0].requirement.id, { requirementId: group.requirement.id, files: [file] }, actor);
  }
  return next;
}
