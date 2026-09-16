import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planPartnerCatalogConfigs,
  initializePartnerCatalogConfigs,
} from './partner-catalog-config.ts';
import {
  defaultConfig,
  resolveRequestConfig,
  readRequestConfigs,
  customerRequestConfigId,
  partnerRequestConfigId,
} from './service-requests.ts';
import { commitCatalogVersion } from './catalog-versions.ts';

const service = {
  id: 's1',
  name: '服务甲',
  category: '实施',
  version: 2,
  status: '已启用',
  deliveryMethods: ['远程', '现场'],
  priceUnit: '服务人天',
};
const customer = {
  ...defaultConfig(service),
  revision: 7,
  fields: ['edition', 'nodes'],
  fieldOrder: ['method', 'edition', 'nodes', 'description'],
  fieldWidths: { nodes: 'half', description: 'full' },
  fieldRowStarts: ['description'],
  fieldRequired: { nodes: true },
  fieldRequiredWhen: { nodes: 'onsite' },
  fieldOptions: { edition: ['标准版'] },
  materials: [
    {
      id: 'm1',
      name: '客户材料',
      required: true,
      instructions: '按模板填写',
      onlineTemplateUrl: 'https://example.com/template',
      template: { id: 'file1', name: '模板.txt', blob: new Blob(['模板内容']) },
    },
  ],
};
const fixture = () => ({
  references: [
    {
      id: 'workspace',
      payload: {
        services: [structuredClone(service)],
        customers: [{ id: 'c1' }],
      },
    },
    {
      id: customerRequestConfigId(service.id),
      payload: structuredClone(customer),
    },
  ],
  configs: [defaultConfig(service)],
});
const payload = (stores, id) =>
  stores.references.find((record) => record.id === id)?.payload;

// Transaction-level fake to exercise the real initialization, readers and version
// commits without touching the user's IndexedDB. Writes publish only on commit.
function storage(t, stores, failPut = () => false) {
  const old = globalThis.indexedDB;
  const oldWindow = globalThis.window;
  t.after(() => {
    if (old) globalThis.indexedDB = old;
    else delete globalThis.indexedDB;
    if (oldWindow) globalThis.window = oldWindow;
    else delete globalThis.window;
  });
  globalThis.window = { dispatchEvent() {} };
  globalThis.indexedDB = {
    open() {
      const open = {
        result: {
          close() {},
          transaction(names, mode) {
            const staged = structuredClone(stores);
            let pending = 0;
            let aborted = false;
            let scheduled = false;
            const complete = () => {
              if (scheduled) return;
              scheduled = true;
              queueMicrotask(() => {
                scheduled = false;
                if (aborted || pending) return;
                if (mode === 'readwrite') Object.assign(stores, staged);
                tx.oncomplete?.();
              });
            };
            const request = (result) => {
              pending++;
              const req = { result: structuredClone(result) };
              queueMicrotask(() => {
                if (aborted) return;
                req.onsuccess?.();
                pending--;
                complete();
              });
              return req;
            };
            const tx = {
              abort() {
                aborted = true;
                queueMicrotask(() => tx.onabort?.());
              },
              objectStore(name) {
                return {
                  getAll() {
                    return request(staged[name]);
                  },
                  get(id) {
                    return request(
                      staged[name].find(
                        (record) => (record.id ?? record.serviceId) === id,
                      ),
                    );
                  },
                  put(record) {
                    if (failPut(record)) throw new Error('模拟存储失败');
                    assert.equal(mode, 'readwrite');
                    const id = record.id ?? record.serviceId;
                    const index = staged[name].findIndex(
                      (value) => (value.id ?? value.serviceId) === id,
                    );
                    if (index >= 0)
                      staged[name][index] = structuredClone(record);
                    else staged[name].push(structuredClone(record));
                    complete();
                  },
                };
              },
            };
            return tx;
          },
        },
      };
      queueMicrotask(() => open.onsuccess());
      return open;
    },
  };
}

test('以客户中心实际配置初始化所有目录，复制布局、规则、选项和模板文件', async () => {
  const stores = fixture();
  const inactive = { ...service, id: 's2', status: '已停用' };
  payload(stores, 'workspace').services.push(inactive);
  const before = structuredClone(stores);
  const writes = planPartnerCatalogConfigs(stores.references);
  assert.equal(writes.length, 2);
  assert.deepEqual(
    writes[0].payload,
    resolveRequestConfig(service, [customer]),
  );
  assert.equal(
    await writes[0].payload.materials[0].template.blob.text(),
    '模板内容',
  );
  assert.deepEqual(writes[1].payload, resolveRequestConfig(inactive, []));
  writes[0].payload.fieldOptions.edition.push('企业版');
  assert.deepEqual(stores, before);
});

test('合作伙伴配置初始化后独立保存，客户后续修改及反复加载均不覆盖，新增目录仍可初始化', async (t) => {
  const stores = fixture();
  storage(t, stores);
  await initializePartnerCatalogConfigs();
  const initial = structuredClone(
    payload(stores, partnerRequestConfigId('s1')),
  );
  payload(stores, customerRequestConfigId('s1')).fields = [];
  await initializePartnerCatalogConfigs();
  assert.deepEqual(payload(stores, partnerRequestConfigId('s1')), initial);
  payload(stores, partnerRequestConfigId('s1')).fields = [];
  payload(stores, partnerRequestConfigId('s1')).materials = [];
  payload(stores, 'workspace').services.push({ ...service, id: 'new' });
  await initializePartnerCatalogConfigs();
  assert.deepEqual(payload(stores, partnerRequestConfigId('s1')).fields, []);
  assert.ok(payload(stores, partnerRequestConfigId('new')));
  assert.equal(
    stores.references.filter(
      (record) => record.id === partnerRequestConfigId('s1'),
    ).length,
    1,
  );
  const partnerConfigs = await readRequestConfigs('partner');
  assert.equal(partnerConfigs.length, 2);
  assert.deepEqual(
    partnerConfigs.find((config) => config.serviceId === 's1').materials,
    [],
  );
  assert.equal((await readRequestConfigs('customer')).length, 1);
  assert.equal((await readRequestConfigs('internal')).length, 1);
});

test('伙伴表单保存进入目录版本，三套表单互不覆盖；相同内容不增加版本', async (t) => {
  const stores = fixture();
  storage(t, stores);
  await initializePartnerCatalogConfigs();
  const internalBefore = structuredClone(stores.configs);
  const customerBefore = structuredClone(
    payload(stores, customerRequestConfigId('s1')),
  );
  const config = {
    ...structuredClone(payload(stores, partnerRequestConfigId('s1'))),
    revision: 8,
    fields: ['nodes'],
    materials: [],
  };
  const saved = await commitCatalogVersion('s1', {
    audience: 'partner',
    config,
    reason: '修改合作伙伴中心申请配置',
  });
  assert.deepEqual(saved, config);
  assert.deepEqual(stores.configs, internalBefore);
  assert.deepEqual(
    payload(stores, customerRequestConfigId('s1')),
    customerBefore,
  );
  assert.deepEqual(payload(stores, partnerRequestConfigId('s1')), config);
  assert.equal(payload(stores, 'workspace').services[0].version, 3);
  const history = payload(stores, 'catalog-history:s1');
  assert.equal(history.length, 2);
  assert.deepEqual(
    history[0].partner,
    resolveRequestConfig(service, [customer]),
  );
  assert.deepEqual(history[1].partner, config);
  assert.deepEqual(history[1].customer, customerBefore);
  await commitCatalogVersion('s1', {
    audience: 'partner',
    config: { ...config, revision: 9 },
    reason: '重复保存',
  });
  assert.equal(payload(stores, 'workspace').services[0].version, 3);
  assert.equal(payload(stores, 'catalog-history:s1').length, 2);
  await commitCatalogVersion('s1', {
    audience: 'customer',
    config: { ...customerBefore, fields: [], materials: [] },
    reason: '修改客户配置',
  });
  assert.deepEqual(payload(stores, partnerRequestConfigId('s1')), config);
});

test('初始化或版本保存失败时回滚，保留原表单与目录版本', async (t) => {
  const stores = fixture();
  storage(t, stores, (record) => record.id === partnerRequestConfigId('s1'));
  const before = structuredClone(stores);
  await assert.rejects(initializePartnerCatalogConfigs(), /模拟存储失败/);
  assert.deepEqual(stores, before);
  await assert.rejects(
    commitCatalogVersion('s1', {
      audience: 'partner',
      config: customer,
      reason: '修改',
    }),
    /模拟存储失败/,
  );
  assert.deepEqual(stores, before);
});
