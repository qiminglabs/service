import { demoSubmissionRuleId } from './demo-submission-rules.ts';
import { submissionRulesId } from './submission-rule-schema.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initializeCustomerOwners, resetLocalDemoData } from './initialize-demo-data.ts';
import { localInternalUsers } from './internal-users.ts';
import { importedServiceCatalogSeeds } from '../app/service-catalog-import.ts';
import { requestSamplesMarker } from './demo-service-requests.ts';
import { planSalesOwnerIssue, assessmentLockIssue } from './request-assessment.ts';
import { requestIssues, fieldLabels, requestFieldIsVisible, requestFieldIsRequired, newItem, itemBasicIssues } from './service-requests.ts';
import { requestFormOrder, requestFieldGridColumn } from './request-form-layout.ts';

const initial = {
  services: importedServiceCatalogSeeds.map((s, i) => ({ id: `svc-${i}`, name: s.serviceName, category: s.serviceCategory, status: '已启用', deliveryMethods: ['远程', '现场'], priceUnit: s.pricingUnit ?? '服务人天', priceCoefficient: 1, defaultQuantity: 1 })),
  customers: [1, 2, 3].map(n => ({ id: `c${n}`, name: `客户${n}`, status: '启用' })),
  contacts: [1, 2, 3].map(n => ({ id: `contact${n}`, name: `联系人${n}`, customerId: `c${n}`, status: '启用' })),
  businessObjects: [1, 2, 3].map(n => ({ id: `obj${n}`, name: `集群${n}`, customerId: `c${n}`, status: '启用', product: 'SMTX OS 系统', nodeCount: 4, upgradeEntitlement: 4, inspectionEntitlement: 4 })),
  users: localInternalUsers,
  assets: [{ id: 'asset1', customerId: 'c1', name: '远程人天', status: '启用', balanceDays: 10 }],
  requestFields: [{ id: 'version', name: '初始版本号', options: [{ value: '5.0.1', enabled: true }, { value: '旧版本', enabled: false }] }],
  partners: [{ id: 'partner1' }], partnerUsers: [{ id: 'partner-user1' }], serviceCertifications: [{ id: 'cert1' }],
};

test('为全部未分配/无效所有人的客户分配有效销售，保留有效分配，不修改输入', () => {
  const customers = [...initial.customers, { id: 'custom', ownerUserId: 'USR-002' }, { id: 'inactive-owner', ownerUserId: 'USR-005' }];
  const before = structuredClone(customers);
  const assigned = initializeCustomerOwners(customers, initial.users);
  assert.ok(assigned.every(customer => initial.users.some(user => user.id === customer.ownerUserId && user.status === '启用')));
  assert.equal(assigned[3].ownerUserId, 'USR-002');
  assert.equal(assigned[4].ownerUserId, 'USR-001');
  assert.deepEqual(customers, before);
});

function storage(t, fail = false) {
  const old = globalThis.indexedDB;
  t.after(() => { if (old) globalThis.indexedDB = old; else delete globalThis.indexedDB; });
  const stores = {
    requests: [{ id: 'old-request', materials: ['old-blob'], operations: { projects: ['old-project'] } }],
    configs: [{ serviceId: 'old-service' }],
    references: [{ id: 'workspace', payload: { custom: true } }, { id: 'catalog-history:old-service', payload: [1, 2] }],
  };
  globalThis.indexedDB = { open(name) {
    assert.equal(name, 'smartx-service-request-local-v1');
    const request = { result: { close() {}, transaction(names, mode) {
      assert.deepEqual(names, ['requests', 'configs', 'references']);
      assert.equal(mode, 'readwrite');
      const staged = structuredClone(stores);
      let aborted = false;
      const tx = {
        abort() { aborted = true; queueMicrotask(() => tx.onabort()); },
        objectStore(name) { return {
          clear() { staged[name] = []; },
          add(record) { if (fail && name === 'references') throw new Error('模拟存储失败'); staged[name].push(structuredClone(record)); },
        }; },
      };
      queueMicrotask(() => { if (!aborted) { Object.assign(stores, staged); tx.oncomplete(); } });
      return tx;
    } } };
    queueMicrotask(() => request.onsuccess());
    return request;
  } };
  return stores;
}

test('一次确认恢复全部三个数据表、主数据、配置及 16 条一致的样例', async t => {
  const stores = storage(t);
  const before = structuredClone(initial);
  const labels = structuredClone(fieldLabels);
  await resetLocalDemoData(initial);
  const workspace = stores.references.find(r => r.id === 'workspace').payload;
  assert.equal(workspace.customerOwnersInitialized, true);
  assert.ok(workspace.customers.every(c => c.ownerUserId));
  assert.deepEqual(workspace.assets, initial.assets);
  assert.deepEqual(workspace.serviceCertifications, initial.serviceCertifications);
  assert.deepEqual(workspace.partners, initial.partners);
  assert.deepEqual(workspace.partnerUsers, initial.partnerUsers);
  assert.equal(stores.requests.length, 16);
  assert.equal(stores.configs.length, initial.services.length);
  assert.equal(stores.configs[0].fieldOptions.version, undefined);
  assert.ok(stores.configs.every(config => !config.fields.includes('version')));
  assert.equal(stores.references.filter(r => r.id.startsWith('customer-request-config:')).length, initial.services.length);
  assert.ok(stores.references.some(r => r.id === requestSamplesMarker));
  const demoRules = stores.references.find(r => r.id === submissionRulesId).payload;
  assert.equal(demoRules.length, 1);
  assert.equal(demoRules[0].id, demoSubmissionRuleId);
  assert.equal(demoRules[0].active.enabled, true);
  assert.ok(!JSON.stringify(stores).includes('old-service'));
  assert.ok(!JSON.stringify(stores).includes('old-request'));
  for (const kind of ['inspection', 'upgrade']) {
    const history = stores.references.find(r => r.id === `entitlement-conversion-${kind}`).payload;
    assert.equal(history.length, 1);
    assert.equal(history[0].days, 0.3);
    assert.equal(history[0].version, 1);
  }
  for (const request of stores.requests) {
    assert.deepEqual(requestIssues(request, workspace), []);
    assert.equal(planSalesOwnerIssue(request, workspace.customers, workspace.users), null);
    assert.equal(assessmentLockIssue(request, stores.requests, workspace.assets, workspace.businessObjects), null);
  }
  assert.deepEqual(initial, before);
  assert.deepEqual(fieldLabels, labels);
  stores.requests.push({ id: 'later-edit' });
  await resetLocalDemoData(initial);
  assert.equal(stores.requests.length, 16);
});

test('写入失败回滚，构建样例失败也不会清除原数据', async t => {
  const stores = storage(t, true);
  const before = structuredClone(stores);
  await assert.rejects(resetLocalDemoData(initial), /模拟存储失败/);
  assert.deepEqual(stores, before);
  await assert.rejects(resetLocalDemoData({ ...initial, services: [] }));
  assert.deepEqual(stores, before);
});

test('初始化入口在角色左侧，取消不重置，确认有锁和覆盖范围提示', () => {
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  const component = readFileSync(new URL('../components/initialize-data-button.tsx', import.meta.url), 'utf8');
  const header = page.slice(page.indexOf('function Header('), page.indexOf('function EmptyResult('));
  assert.ok(header.indexOf('<InitializeDataButton') < header.indexOf('<DropdownMenu>'));
  assert.match(component, /setOpen\(true\)/);
  assert.match(component, /<AlertDialogCancel disabled=\{busy\} autoFocus>取消/);
  assert.match(component, /await onInitialize\(\)/);
  assert.match(component, /if \(lock.current \|\| disabled\) return/);
  assert.match(component, /无法撤销/);
  assert.match(page, /if \(resetting.current\) return/);
  assert.match(page, /<Workspace key=\{generation\}/);
});

test('重新初始化移除五个旧字段，内外部目录最后一行设置选填需求说明和现场必填地址', async t => {
  const stores = storage(t);
  const fields = [
    { id: 'productForm', name: '产品形态', options: ['纯软件', '一体机'] },
    ...[['expectedProvider', '期望服务商'], ['address', '地址'], ['tibCount', 'TiB 数'], ['instanceCount', '实例数'], ['clusterCount', '集群数']].map(([id, name]) => ({id, name, options: []})),
  ];
  await resetLocalDemoData({...initial, requestFields: [...initial.requestFields, ...fields], partners: [{id:'partner1', name:'演示合作伙伴'}]});
  const items = stores.requests.flatMap(record => record.items);
  const removed = ['productForm', 'tibCount', 'clusterCount', 'instanceCount', 'expectedProvider'];
  const customerConfigs = stores.references.filter(record => record.id.startsWith('customer-request-config:')).map(record => record.payload);
  const workspace = stores.references.find(record => record.id === 'workspace').payload;
  assert.equal(customerConfigs.length, stores.configs.length);
  for (const config of [...stores.configs, ...customerConfigs]) {
    assert.ok(config.fields.includes('address'));
    assert.deepEqual(requestFormOrder(config).slice(-2), ['description', 'address']);
    assert.deepEqual(config.basicFields.description, { enabled: true, required: false });
    assert.equal(config.fieldWidths.description, 'half');
    assert.equal(config.fieldWidths.address, 'half');
    assert.equal(requestFieldGridColumn(config, 'description'), '1 / span 1');
    assert.equal(requestFieldGridColumn(config, 'address'), 'span 1');
    assert.equal(requestFieldIsVisible(config, 'address', '远程'), false);
    assert.equal(requestFieldIsRequired(config, 'address', '远程'), false);
    assert.equal(requestFieldIsVisible(config, 'address', '现场'), true);
    assert.equal(requestFieldIsRequired(config, 'address', '现场'), true);
    assert.equal(requestFieldIsRequired(config, 'address', '["远程","现场"]'), true);
    const item = newItem(workspace.services.find(s => s.id === config.serviceId), config);
    item.method = '现场';
    assert.ok(itemBasicIssues(item).some(issue => issue.includes('地址')));
    assert.ok(!itemBasicIssues(item).includes('需求说明'));
    item.method = '远程';
    assert.ok(!itemBasicIssues(item).some(issue => issue.includes('地址')));
  }
  for (const id of removed) {
    assert.ok(workspace.requestFields.some(field => field.id === id));
    assert.ok(items.every(item => !(id in item.values) && !item.config.fields.includes(id)));
    for (const config of [...stores.configs, ...customerConfigs]) {
      assert.ok(!config.fields.includes(id));
      assert.ok(!(id in config.fieldOptions));
      assert.ok(!(id in (config.fieldRequired ?? {})));
    }
  }
  assert.ok(items.every(item => item.description.trim()));
  assert.equal(stores.references.find(record => record.id === 'entitlement-conversion-inspection').payload[0].days, 0.3);
  assert.equal(stores.references.find(record => record.id === 'entitlement-conversion-upgrade').payload[0].days, 0.3);
});

test('初始化规则使用现有身份，预览覆盖命中、默认分配、逐级截止和缺失汇报人兜底', async t => {
  const { parseRoutingConfig, assessmentRoutingId } = await import('./assessment-routing-schema.ts');
  const { resolveAssessmentRoute } = await import('./assessment-routing.ts');
  const { approvalRulesId, readApprovalRulesPayload } = await import('./approval-rules.ts');
  const { resolveApprovalPreview } = await import('./approval-preview.ts');
  const { reportingRelationshipIssue } = await import('./approval-flows.ts');
  const { fixedIdentityRoles } = await import('./internal-users.ts');
  const stores = storage(t);
  const rolesBefore = structuredClone(fixedIdentityRoles);
  await resetLocalDemoData({ ...initial, customers: initial.customers.map((c, index) => ({ ...c, team: ['金融', '商业', '其他'][index] })) });
  const workspace = stores.references.find(r => r.id === 'workspace').payload;
  assert.deepEqual(workspace.users.map(u => u.id), initial.users.map(u => u.id));
  assert.deepEqual(fixedIdentityRoles, rolesBefore);
  for (const user of workspace.users) assert.equal(reportingRelationshipIssue(workspace.users, user.id, user.reportsToUserId ?? ''), null);
  const { runValidationQueue } = await import('./submission-validation.ts');
  const rules = stores.references.find(r => r.id === submissionRulesId).payload;
  for (const request of stores.requests) {
    const person = workspace.users.find(user => user.id === request.createdById);
    const currentActor = { id: person.id, name: person.name, role: fixedIdentityRoles[person.id] };
    const events = ['submit', ...(request.status === '待确认' || request.status === '待受理' ? ['assessment-pass', 'request-confirmation'] : [])];
    assert.deepEqual(runValidationQueue(request, { ...workspace, currentActor }, events, rules), [], request.id);
  }
  const config = parseRoutingConfig(stores.references.find(r => r.id === assessmentRoutingId).payload);
  assert.equal(config.manager.rules.length, 4);
  assert.equal(config.hardware.rules.length, 1);
  assert.ok([...config.manager.rules, ...config.hardware.rules].every(rule => rule.updatedAt && rule.updatedBy === '陆明'));
  const remote = stores.requests.find(r => r.id === 'SR-DEMO-006');
  const onsite = stores.requests.find(r => r.id === 'SR-DEMO-007');
  assert.equal(resolveAssessmentRoute(remote, 'hardware', config, workspace.users).matchedBy, 'default');
  assert.equal(resolveAssessmentRoute(onsite, 'hardware', config, workspace.users).matchedBy, 'default');
  assert.equal(remote.operations.assessment.routing.hardware.userId, 'USR-008');
  assert.ok(remote.internalParticipants.some(p => p.userId === 'USR-008'));
  const approvals = readApprovalRulesPayload(stores.references.find(r => r.id === approvalRulesId).payload);
  assert.equal(approvals.rules.length, 2);
  const preview = id => resolveApprovalPreview(stores.requests.find(r => r.id === id), approvals.rules, workspace.users, workspace.customers, approvals.defaultUserId);
  const chain = preview('SR-DEMO-008');
  assert.equal(chain.rule.id, 'demo-approval-onsite');
  assert.deepEqual(chain.steps[0].approvers.map(a => a.id), ['USR-003', 'USR-006']);
  assert.equal(chain.steps[0].approvers.at(-1).cutoff, true);
  assert.equal(chain.steps[1].approvers[0].id, 'USR-008');
  assert.equal(preview('SR-DEMO-009').defaultApprover.id, 'USR-006');
  const missing = preview('SR-DEMO-010');
  assert.equal(missing.rule.id, 'demo-approval-finance');
  assert.match(missing.steps[0].fallbackReason, /未设置汇报人/);
  assert.equal(missing.steps[0].approvers[0].fallback, true);
  assert.equal(missing.steps[0].approvers[0].id, approvals.defaultUserId);
});

test('请求重建使用当前保存的审批规则和目录，生成完整审批历史及三组共用材料', async t => {
  const { planRuleBasedRequestSamples, ruleBasedRequestSamplesMarker } = await import('./reinitialize-request-samples.ts');
  const { approvalRulesId } = await import('./approval-rules.ts');
  const { requestMaterialGroups, synchronizeRequestMaterials } = await import('./request-materials.ts');
  const { createHash } = await import('node:crypto');
  const stores = storage(t);
  await resetLocalDemoData({ ...initial, customers: initial.customers.map((c, i) => ({ ...c, team: ['金融', '商业', '其他'][i] })) });
  const refs = stores.references.filter(r => r.id !== ruleBasedRequestSamplesMarker);
  const approvals = refs.find(r => r.id === approvalRulesId).payload;
  // Prove rebuilding reads the saved rule, rather than reusing the demo rule factory.
  approvals.rules.find(r => r.id === 'demo-approval-onsite').flow.nodes[1].userIds = ['USR-004'];
  const before = structuredClone({ refs, configs: stores.configs });
  const samples = planRuleBasedRequestSamples(refs, stores.configs);
  assert.equal(samples.length, 16);
  const onsite = samples.find(r => r.id === 'SR-DEMO-008');
  const approval = onsite.operations.assessment.approvals.at(-1);
  assert.equal(approval.state, '已通过');
  assert.deepEqual(approval.workflow.steps.map(s => s.approverId), ['USR-003', 'USR-006', 'USR-004']);
  assert.ok(approval.workflow.steps.every(s => s.state === '已通过' && s.decidedAt && s.note));
  assert.equal(onsite.operations.activities.filter(a => a.category === '审批').length, 4);
  for (const id of ['SR-DEMO-011', 'SR-DEMO-012', 'SR-DEMO-013']) {
    const sample = samples.find(r => r.id === id);
    const group = requestMaterialGroups(sample).find(g => g.requirement.name === '环境信息表（共用示例）');
    assert.equal(group.shared, true);
    assert.equal(group.members.length, sample.items.length);
    assert.equal(group.material.files.length, 1);
    const file = group.material.files[0];
    for (const member of group.members) {
      const saved = member.item.materials.find(m => m.requirementId === member.requirement.id).files;
      assert.equal(saved[0].id, file.id);
      assert.equal(await saved[0].blob.text(), await file.blob.text());
    }
    const digest = createHash('sha256').update(Buffer.from(await group.requirement.template.blob.arrayBuffer())).digest('hex');
    assert.equal(group.requirement.templateDigest, digest);
    const remaining = synchronizeRequestMaterials({ ...sample, items: sample.items.slice(1) });
    assert.ok(remaining.items.every(item => item.materials.some(m => m.files?.some(f => f.id === file.id))));
  }
  assert.deepEqual({ refs, configs: stores.configs }, before);
  assert.equal(planRuleBasedRequestSamples(stores.references, stores.configs), null);
});
