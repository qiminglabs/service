import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProjectMapping, parseProjectMapping, mappedServiceProject, mappedProjectName } from './request-project-mapping.ts';
import { createServiceProjects, projectCreationSaveIssue } from './request-projects.ts';
import { defaultConfig, newItem } from './service-requests.ts';
const pm = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
const service = { id: 'catalog', name: '平台实施', deliveryMethods: ['远程'], status: '已启用', category: '产品实施交付' };
function fixture() {
  const first = newItem(service, defaultConfig(service));
  first.description = '实施范围';
  first.materials = [{ requirementId: 'req-file', files: [{ id: 'file', name: '方案.txt', blob: new Blob(['真实附件内容']), uploadedAt: '2026-09-16' }, { id: 'online', name: '在线方案', kind: 'online', url: 'https://example.com/doc', content: '在线材料内容' }] }];
  const second = structuredClone(first); second.id = 'second';
  return { id: 'request', title: '请求标题', customerId: 'customer', contactId: 'contact', description: '申请说明', expectedServiceDate: '2026-09-20', status: '待受理', items: [first, second], operations: { activities: [], assessment: { managerId: pm.id, plans: [], approvals: [], effort: { lines: [{ itemId: first.id, estimatedDays: 1.5, billableDays: 3 }] } } } };
}
const groups = r => r.items.map((item, index) => ({ id: `project-${index}`, name: `分组 ${index + 1}`, note: '', itemIds: [item.id] }));
function convert(r, mapping = defaultProjectMapping(), split = groups(r), partners = []) {
  const next = createServiceProjects(r, pm, split, 'conversion', '2026-09-16T10:00:00Z', mapping);
  return { next, projects: next.operations.projectCreation.projects.map(project => mappedServiceProject(next, project, next.operations.projectCreation, mapping, partners)) };
}
test('请求字段、重复目录服务项、材料字节、在线材料和核定明细随分组映射为独立项目', async () => {
  const r = fixture();
  const { projects, next } = convert(r);
  assert.equal(projectCreationSaveIssue(next, r, pm), null);
  assert.deepEqual(projects.map(p => p.items.length), [1, 1]);
  for (const project of projects) {
    assert.equal(project.sourceServiceRequestId, r.id);
    assert.equal(project.customerId, r.customerId);
    assert.equal(project.note, r.description);
    assert.equal(project.expectedServiceDate, r.expectedServiceDate);
    assert.equal(project.status, '待启动');
    assert.equal(project.serviceProviderId, 'provider:smartx');
    assert.equal(project.serviceProviderName, '北京志凌海纳科技有限公司');
    assert.equal(project.createdById, pm.id);
    assert.equal(await project.items[0].materials[0].files[0].blob.text(), '真实附件内容');
    assert.equal(project.items[0].materials[0].files[1].url, 'https://example.com/doc');
    assert.equal(project.items[0].materials[0].files[1].content, '在线材料内容');
  }
  assert.equal(projects[0].requestConversion.workOrders[0].pricing.billableDays, 3);
  projects[0].items[0].description = '项目独立修改';
  assert.equal(r.items[0].description, '实施范围');
  assert.equal(projects[1].items[0].description, '实施范围');
});
test('配置可调整字段来源，保存时使用最新版本并阻止过期映射', () => {
  const r = fixture();
  const config = defaultProjectMapping();
  config.fields.name = 'description'; config.fields.note = 'title'; config.fields.description = 'serviceName'; config.fields.serviceProviderId = 'smartx'; config.revision = 2;
  assert.equal(mappedProjectName(r, config), r.description);
  const { projects, next } = convert(r, config);
  assert.equal(projects[0].note, r.title);
  assert.equal(projects[0].items[0].description, r.items[0].description);
  assert.equal(projects[0].serviceProviderId, 'provider:smartx');
  assert.equal(projectCreationSaveIssue(next, r, pm, config), null);
  assert.ok(projectCreationSaveIssue(next, r, pm, { ...config, revision: 3 }));
  config.fields.note = '';
  assert.equal(projects[0].requestConversion.mapping.fields.note, 'title');
});
test('必需关联不允许清空或跨类型映射，未知目标及损坏配置不静默回退', () => {
  for (const target of ['customerId']) {
    const config = defaultProjectMapping(); config.fields[target] = '';
    assert.throws(() => parseProjectMapping(config), /映射来源无效/);
  }
  const config = defaultProjectMapping(); config.fields.status = 'title';
  assert.throws(() => parseProjectMapping(config), /不支持/);
  assert.throws(() => parseProjectMapping({ revision: 1 }), /无效/);
});
test('日期未确定时须显式补充，不使用创建日冒充服务日期；服务方固定为默认公司或留空', () => {
  const r = fixture(); r.expectedServiceDate = '';
  assert.throws(() => convert(r), /期望服务日期/);
  const split = groups(r).map(group => ({ ...group, expectedServiceDate: '2026-09-25' }));
  assert.equal(convert(r, undefined, split).projects[0].expectedServiceDate, '2026-09-25');
  assert.throws(() => convert(r, undefined, split.map(group => ({ ...group, expectedServiceDate: '2026-02-30' }))), /有效/);
  const mapping = defaultProjectMapping();
  mapping.fields.serviceProviderId = '';
  assert.equal(convert(r, mapping, split).projects[0].serviceProviderId, '');
});
