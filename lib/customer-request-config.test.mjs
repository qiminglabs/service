import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  customerRequestConfigId,
  readRequestConfigs,
  resolveRequestConfig,
  serviceAvailableForRequest,
  defaultConfig,
  newItem,
  newRequest,
  itemBasicIssues,
  itemIssues,
  requestIssues,
  storedFile,
} from './service-requests.ts';

const service = {
  id: 'SC-IMP-001',
  name: '平台新装',
  category: '产品实施交付',
  deliveryMethods: ['远程', '现场'],
  status: '已启用',
  priceUnit: '人天',
  allowedInitiatorSites: ['内部系统', '客户中心'],
};
const internal = defaultConfig(service);
const customer = {
  ...defaultConfig(service),
  revision: 4,
  fields: ['nodes', 'version'],
  fieldRequired: { nodes: true, version: false },
  fieldOptions: { version: ['6.3.0'] },
  basicFields: {
    description: { enabled: false, required: false },
    businessObjects: { enabled: false, required: false },
  },
  materials: [
    {
      id: 'customer-environment',
      name: '客户环境清单',
      required: true,
      instructions: '填写服务器与网络准备情况',
      template: storedFile(new File(['客户模板'], '环境模板.txt')),
      onlineTemplateUrl: 'https://docs.qq.com/doc/example',
    },
    { id: 'optional', name: '补充说明', required: false, instructions: '' },
  ],
};

// Drive the real storage reader without accessing or altering browser data.
function mockStorage(t, stores) {
  const calls = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  });
  globalThis.indexedDB = {
    open() {
      const open = {
        result: {
          close() {},
          transaction(store, mode) {
            assert.equal(mode, 'readonly');
            calls.push(store);
            const tx = {
              objectStore() {
                return {
                  getAll: () => ({
                    result: structuredClone(stores[store] ?? []),
                  }),
                };
              },
            };
            queueMicrotask(() => tx.oncomplete());
            return tx;
          },
        },
      };
      queueMicrotask(() => open.onsuccess());
      return open;
    },
  };
  return calls;
}

test('客户中心与内部申请读取各自配置，不混入目录历史及其他引用数据', async (t) => {
  const calls = mockStorage(t, {
    configs: [internal],
    references: [
      { id: 'workspace', payload: { services: [service] } },
      { id: 'catalog-history:' + service.id, payload: [customer] },
      { id: customerRequestConfigId(service.id), payload: customer },
      { id: customerRequestConfigId('wrong-id'), payload: internal },
    ],
  });
  const customerConfigs = await readRequestConfigs('customer');
  assert.equal(customerConfigs.length, 1);
  const item = newItem(service, resolveRequestConfig(service, customerConfigs));
  assert.deepEqual(item.config.fields, ['nodes', 'version']);
  assert.deepEqual(item.config.fieldOptions, { version: ['6.3.0'] });
  assert.equal(item.config.materials[0].name, '客户环境清单');
  assert.equal(await item.config.materials[0].template.blob.text(), '客户模板');
  assert.equal(
    item.config.materials[0].onlineTemplateUrl,
    customer.materials[0].onlineTemplateUrl,
  );
  const internalConfigs = await readRequestConfigs('internal');
  assert.deepEqual(
    resolveRequestConfig(service, internalConfigs).fields,
    internal.fields,
  );
  assert.deepEqual(calls, ['references', 'configs']);
});

test('显式空配置不回退，未配置时与目录设置页使用同一默认配置', async (t) => {
  const stores = { configs: [internal], references: [] };
  mockStorage(t, stores);
  assert.deepEqual(
    resolveRequestConfig(service, await readRequestConfigs('customer')),
    resolveRequestConfig(service, []),
  );
  stores.references.push({
    id: customerRequestConfigId(service.id),
    payload: { ...customer, fields: [], materials: [] },
  });
  const item = newItem(
    service,
    resolveRequestConfig(service, await readRequestConfigs('customer')),
  );
  assert.deepEqual(item.config.fields, []);
  assert.deepEqual(item.config.materials, []);
  assert.deepEqual(itemIssues(item), []);
});

test('客户必填参数与材料校验采用客户快照，选填字段及隐藏字段不阻止提交', () => {
  const item = newItem(service, customer);
  assert.deepEqual(itemBasicIssues(item), ['节点数（正整数）']);
  item.values.nodes = '3';
  assert.deepEqual(itemBasicIssues(item), []);
  assert.deepEqual(itemIssues(item), ['上传客户环境清单']);
  item.materials = [
    {
      requirementId: 'customer-environment',
      files: [storedFile(new File(['完成内容'], '环境.txt'))],
    },
  ];
  assert.deepEqual(itemIssues(item), []);
});

test('目录更新只影响新申请项，不改写已填字段、材料或配置快照', () => {
  const config = structuredClone(customer);
  const old = newItem(service, config);
  old.values.nodes = '3';
  old.materials = [
    {
      requirementId: 'customer-environment',
      files: [storedFile(new File(['已有资料'], '旧材料.txt'))],
    },
  ];
  config.fields.push('edition');
  config.materials[0].name = '新材料';
  const fresh = newItem(service, config);
  assert.ok(fresh.config.fields.includes('edition'));
  assert.ok(!old.config.fields.includes('edition'));
  assert.equal(old.config.materials[0].name, '客户环境清单');
  assert.equal(old.values.nodes, '3');
  assert.equal(old.materials[0].files[0].name, '旧材料.txt');
});

test('目录按允许发起站点过滤，停用或取消开放的项目不可提交', () => {
  const internalOnly = { ...service, allowedInitiatorSites: ['内部系统'] };
  assert.equal(serviceAvailableForRequest(internalOnly, 'customer'), false);
  assert.equal(serviceAvailableForRequest(internalOnly, 'internal'), true);
  assert.equal(
    serviceAvailableForRequest(
      { ...service, allowedInitiatorSites: [] },
      'customer',
    ),
    false,
  );
  assert.equal(
    serviceAvailableForRequest({ ...service, status: '已停用' }, 'customer'),
    false,
  );
  assert.equal(
    serviceAvailableForRequest(
      { ...service, allowedInitiatorSites: undefined },
      'customer',
    ),
    true,
  );
  const record = {
    ...newRequest('客户申请', 'c1', '张三', '', 'p1', '客户'),
    businessImpact: '测试环境',
    description: '部署',
    items: [newItem(service, { ...customer, fields: [], materials: [] })],
  };
  const refs = {
    customers: [{ id: 'c1', status: '启用' }],
    contacts: [{ id: 'p1', customerId: 'c1', status: '启用' }],
    businessObjects: [],
    services: [internalOnly],
  };
  assert.deepEqual(requestIssues(record, { ...refs, audience: 'customer' }), [
    '申请项 1：服务目录未开放给当前申请站点',
  ]);
  assert.deepEqual(
    requestIssues(record, { ...refs, audience: 'internal' }),
    [],
  );
});

test('目录设置和申请表单共用配置读取；添加时刷新，材料使用统一分区入口', () => {
  const source = readFileSync(
    new URL('../components/service-requests.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /const audience = customerPortal \? 'customer' : 'internal'/,
  );
  assert.match(source, /const latest = await readRequestConfigs\(audience\)/);
  assert.match(
    source,
    /newItem\(service, await prepareMaterialDeduplication\(resolveRequestConfig\(service, latest\)\)\)/,
  );
  assert.match(
    source.slice(source.indexOf('export function RequestCatalogSettings')),
    /readRequestConfigs\(audience\)/,
  );
  assert.match(source, /availableServices\s*\.filter/);
  assert.match(source, /checkSubmissionQueue\(record, props.currentActor, events\)/);
  assert.match(source, /requestMaterialGroup\(draft, materialTarget.itemId, materialTarget.requirementId\)/);
  assert.match(source, /<RequestMaterialsPanel record={draft}/);
});
