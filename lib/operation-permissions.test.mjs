import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import {
  operationPermissionRows,
  filterOperationPermissions,
  permissionRoleForActor,
} from './operation-permissions.ts';
import { backendSettingsSections } from './backend-settings.ts';
import { resolvePortalContext } from './portal-context.ts';
import { canManageCatalog } from './catalog-versions.ts';
import { canViewServiceProject } from './service-projects.ts';
import { canRecordProjectWorklog } from './service-project-operations.ts';
import { canExecuteSpecificWorkOrder } from './service-work-orders.ts';

const admin = { id: 'USR-006', name: '管理员', role: 'SmartX 系统管理员' };
const pm = { id: 'USR-003', name: '经理', role: 'SmartX 项目经理' };
const partner = {
  id: 'partner-user',
  name: '伙伴',
  role: '合作伙伴服务工程师',
};
const rule = (id, role, site = '内部系统') =>
  operationPermissionRows.filter(
    (row) => row.ruleId === id && row.role === role && row.site === site,
  );
const project = () => ({
  id: 'project',
  status: '进行中',
  createdSite: '内部系统',
  createdById: pm.id,
  collaborators: {
    internal: [{ id: pm.id, assignmentRoles: ['项目经理'] }],
    partner: [{ id: partner.id, workOrderAssignmentOnly: true }],
    customer: [],
  },
  workOrders: [
    {
      id: 'order',
      status: '进行中',
      assignees: [{ id: partner.id, group: 'partner' }],
    },
  ],
});

test('权限清单条目唯一，代码依据存在，不再展示已删除能力', () => {
  assert.ok(operationPermissionRows.length > 500);
  assert.equal(
    new Set(operationPermissionRows.map((row) => row.id)).size,
    operationPermissionRows.length,
  );
  for (const row of operationPermissionRows) {
    assert.ok(row.stages.length > 0);
    assert.ok(row.action && row.scope && row.condition);
    assert.ok(
      existsSync(new URL('../' + row.source, import.meta.url)),
      row.source,
    );
  }
  assert.ok(
    !operationPermissionRows.some((row) =>
      /重新分配申请评估负责人|创建模板报告|手动点击完成项目/.test(row.action),
    ),
  );
  assert.ok(
    operationPermissionRows.some((row) => row.action === '生成工单服务报告'),
  );
});

test('站点、用户角色、业务阶段、操作关键字及结果可组合筛选', () => {
  const rows = filterOperationPermissions({
    site: '内部系统',
    role: 'partner',
    object: '服务项目',
    stage: '进行中',
    result: '有条件允许',
    query: ' 工时 ',
  });
  assert.ok(rows.length > 0);
  assert.ok(
    rows.every(
      (row) =>
        row.site === '内部系统' &&
        row.role === 'partner' &&
        row.object === '服务项目' &&
        row.stages.includes('进行中') &&
        row.result === '有条件允许',
    ),
  );
  assert.equal(
    filterOperationPermissions({ query: '不存在的操作XYZ' }).length,
    0,
  );
  assert.ok(
    filterOperationPermissions({
      site: '客户中心',
      role: 'admin',
      object: '目录与系统',
    }).every((row) => row.site === '通用'),
  );
  assert.ok(
    !filterOperationPermissions({
      site: '合作伙伴中心',
      object: '服务项目',
      stage: '待复核',
    }).length,
  );
});

test('用户按实际角色映射，姓名变更不改变权限，未知或伪造管理员不匹配', () => {
  assert.equal(permissionRoleForActor({ ...pm, name: '改名' }), 'pm');
  assert.equal(permissionRoleForActor(partner), 'partner');
  assert.equal(permissionRoleForActor({ ...admin, id: 'unknown' }), undefined);
  assert.equal(
    permissionRoleForActor({ id: 'x', name: 'x', role: '未知角色' }),
    undefined,
  );
});

test('清单与现行目录只读、项目经理负责范围保持一致', () => {
  assert.equal(canManageCatalog(pm), false);
  assert.ok(rule('C02', 'pm', '通用').every((row) => row.result === '禁止'));
  assert.ok(rule('C01', 'pm', '通用').every((row) => row.result === '允许'));
  assert.equal(canManageCatalog(admin), true);
  const own = project();
  assert.equal(canViewServiceProject(pm, own), true);
  assert.equal(canViewServiceProject({ ...pm, id: 'other-pm' }, own), false);
  assert.ok(rule('P00', 'pm').every((row) => row.scope.includes('自己负责')));
});

test('内部派给伙伴须记工时，伙伴来源不适用，待确认及确认后管理员也锁定', () => {
  const p = project();
  assert.equal(canRecordProjectWorklog(p, partner), true);
  assert.ok(rule('P14', 'partner').every((row) => row.result === '有条件允许'));
  for (const actor of [admin, partner]) {
    assert.equal(
      canRecordProjectWorklog({ ...p, createdSite: '合作伙伴中心' }, actor),
      false,
    );
    assert.ok(
      rule('P18', permissionRoleForActor(actor), '合作伙伴中心').every(
        (row) => row.result === '不适用',
      ),
    );
    assert.equal(
      canRecordProjectWorklog(
        {
          ...p,
          status: '待确认',
          review: { confirmations: [{ state: '待确认' }] },
        },
        actor,
      ),
      false,
    );
    assert.equal(
      canRecordProjectWorklog(
        { ...p, status: '已完成', customerConfirmationLocked: true },
        actor,
      ),
      false,
    );
    assert.ok(
      rule('P17', permissionRoleForActor(actor)).every(
        (row) => row.result === '禁止',
      ),
    );
  }
});

test('工单执行的指派及暂停限制与权限查询保持一致', () => {
  const p = project();
  assert.equal(canExecuteSpecificWorkOrder(p, p.workOrders[0], partner), true);
  assert.equal(
    canExecuteSpecificWorkOrder(
      p,
      { ...p.workOrders[0], assignees: [] },
      partner,
    ),
    false,
  );
  assert.equal(
    canExecuteSpecificWorkOrder(
      { ...p, status: '已暂停' },
      p.workOrders[0],
      admin,
    ),
    false,
  );
  assert.ok(
    rule('P10', 'partner').every((row) => row.scope.includes('被指派此工单')),
  );
  assert.ok(rule('P43', 'admin').every((row) => row.result === '禁止'));
});

test('只读清单入口沿用后台权限，查询不改变当前用户或业务数据', () => {
  assert.ok(
    backendSettingsSections.some(
      (section) => section.key === 'operation-permissions',
    ),
  );
  assert.ok(resolvePortalContext(admin, {}).views.includes('field-settings'));
  assert.ok(!resolvePortalContext(pm, {}).views.includes('field-settings'));
  for (const role of ['SmartX 售前工程师', 'SmartX 硬件产品经理']) {
    const actor = { id: 'user', name: 'user', role };
    assert.ok(resolvePortalContext(actor, {}).views.includes('projects'));
    assert.ok(
      rule('P10', permissionRoleForActor(actor)).every(
        (row) => row.result === '禁止',
      ),
    );
  }
  const before = JSON.stringify(operationPermissionRows);
  filterOperationPermissions({
    role: 'customer',
    site: '客户中心',
    query: '确认',
  });
  assert.equal(JSON.stringify(operationPermissionRows), before);
  assert.equal(admin.role, 'SmartX 系统管理员');
});

test('清单包含两种来源下执行工程师发报告及发起确认的权限与前置条件', () => {
  for (const [id, site] of [['P23', '内部系统'], ['P25', '合作伙伴中心']]) {
    for (const role of ['engineer', 'partner']) {
      const rows = rule(id, role, site);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].result, '有条件允许');
      assert.match(rows[0].scope, /被指派/);
      assert.match(rows[0].condition, /工单全部完成/);
    }
  }
  assert.match(rule('P23', 'partner')[0].condition, /最终核定有效且依据足额/);
});
