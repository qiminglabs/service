import test from 'node:test';
import assert from 'node:assert/strict';
import { withWorkOrderCollaboratorRoles } from './project-work-order-collaborators.ts';
import { withProjectAssignmentRoles } from './project-collaborator-assignment.ts';
import { projectForActor } from './service-projects.ts';
import { customerServiceProject } from './customer-service-projects.ts';

const directory = { customers: [], contacts: [], users: [], partners: [], partnerUsers: [
  { id: 'partner', name: '伙伴工程师', partnerId: 'p', status: '启用' },
] };
function fixture() {
  return {
    id: 'project', status: '进行中', serviceProviderId: 'partner:p', collaboratorAssignmentsVersion: 1,
    collaborators: {
      internal: [
        { id: 'engineer', name: '内部工程师', assignmentRoles: ['申请人'] },
        { id: 'partner', name: '同编号内部用户' },
        { id: 'former', name: '原工程师', assignmentRoles: ['服务工程师'] },
      ],
      partner: [{ id: 'partner', name: '伙伴工程师', workOrderAssignmentOnly: true }],
      customer: [{ id: 'engineer', name: '同编号客户' }],
    },
    workOrders: [
      { id: 'one', steps: [], assignee: { id: 'engineer', group: 'internal' } },
      { id: 'two', steps: [], assignees: [{ id: 'engineer', group: 'internal' }, { id: 'partner', group: 'partner' }, { id: 'missing', group: 'internal' }] },
    ],
  };
}
test('补齐新旧工单指派身份，合并去重并保留原身份、成员和权限范围', () => {
  const project = fixture(); const before = structuredClone(project);
  const result = withWorkOrderCollaboratorRoles(project);
  assert.deepEqual(result.collaborators.internal[0].assignmentRoles, ['申请人', '服务工程师']);
  assert.equal(result.collaborators.internal[1].assignmentRoles, undefined);
  assert.deepEqual(result.collaborators.internal[2].assignmentRoles, ['服务工程师']);
  assert.deepEqual(result.collaborators.partner[0].assignmentRoles, ['服务工程师']);
  assert.equal(result.collaborators.partner[0].workOrderAssignmentOnly, true);
  assert.equal(result.collaborators.customer[0].assignmentRoles, undefined);
  assert.equal(result.collaborators.internal.length, 3);
  assert.deepEqual(project, before);
  assert.equal(withWorkOrderCollaboratorRoles(result), result);
});
test('已完成协作人迁移的项目仍补齐工程师标记，各端返回一致且客户不接收内部工单', () => {
  const project = fixture();
  const normalized = withProjectAssignmentRoles(project, directory);
  assert.deepEqual(normalized.collaborators.internal[0].assignmentRoles, ['申请人', '服务工程师']);
  for (const role of ['SmartX 服务工程师', '合作伙伴服务工程师']) {
    const result = projectForActor(project, { id: 'engineer', role });
    assert.deepEqual(result.collaborators.internal[0].assignmentRoles, ['申请人', '服务工程师']);
    assert.deepEqual(result.collaborators.partner[0].assignmentRoles, ['服务工程师']);
  }
  const customer = customerServiceProject(project, directory);
  assert.deepEqual(customer.internalCollaborators[0].roles, ['申请人', '服务工程师']);
  assert.deepEqual(customer.partnerCollaborators[0].roles, ['服务工程师']);
  assert.equal(customer.workOrders, undefined);
});
test('无指派时不标记，显式空的多人指派不回退到旧单人指派', () => {
  const project = fixture();
  project.workOrders = [{ assignees: [], assignee: { id: 'engineer', group: 'internal' } }];
  assert.equal(withWorkOrderCollaboratorRoles(project), project);
});

test('历史身份统一更名，包含已改派成员，并合并新旧名称', () => {
  const project = fixture();
  project.collaborators.internal[0].assignmentRoles = ['申请人', '工单工程师', '服务工程师'];
  project.collaborators.internal[2].assignmentRoles = ['工单工程师'];
  project.collaborators.partner[0].assignmentRoles = ['工单工程师'];
  const before = structuredClone(project);
  const result = withProjectAssignmentRoles(project, directory);
  assert.deepEqual(result.collaborators.internal[0].assignmentRoles, ['申请人', '服务工程师']);
  assert.deepEqual(result.collaborators.internal[2].assignmentRoles, ['服务工程师']);
  assert.deepEqual(result.collaborators.partner[0].assignmentRoles, ['服务工程师']);
  assert.deepEqual(project, before);
  assert.equal(withWorkOrderCollaboratorRoles(result), result);
});
