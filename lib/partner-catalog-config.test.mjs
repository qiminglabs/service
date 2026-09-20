import test from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConfig,
  resolveRequestConfig,
  readRequestConfigs,
  customerRequestConfigId,
  partnerRequestConfigId,
} from './service-requests.ts';
import { commitCatalogVersion, createStoredCatalogService, canManageCatalog } from './catalog-versions.ts';

const admin = { id: 'USR-006', name: '陆明', role: 'SmartX 系统管理员' };
const manager = { id: 'USR-003', name: '赵言', role: 'SmartX 项目经理' };
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
        users: [{ ...admin, status: '启用' }, { ...manager, status: '启用' }],
        customers: [{ id: 'c1' }],
      },
    },
    {
      id: partnerRequestConfigId(service.id),
      payload: structuredClone(customer),
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

test('伙伴表单保存进入目录版本，三套表单互不覆盖；相同内容不增加版本', async (t) => {
  const stores = fixture();
  storage(t, stores);
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
  }, admin);
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
  }, admin);
  assert.equal(payload(stores, 'workspace').services[0].version, 3);
  assert.equal(payload(stores, 'catalog-history:s1').length, 2);
  await commitCatalogVersion('s1', {
    audience: 'customer',
    config: { ...customerBefore, fields: [], materials: [] },
    reason: '修改客户配置',
  }, admin);
  assert.deepEqual(payload(stores, partnerRequestConfigId('s1')), config);
});

test('版本保存失败时回滚，保留原表单与目录版本', async (t) => {
  const stores = fixture();
  storage(t, stores, (record) => record.id === partnerRequestConfigId('s1'));
  const before = structuredClone(stores);
  assert.deepEqual(stores, before);
  await assert.rejects(
    commitCatalogVersion('s1', {
      audience: 'partner',
      config: { ...customer, fields: ['nodes'] },
      reason: '修改',
    }, admin),
    /模拟存储失败/,
  );
  assert.deepEqual(stores, before);
});

test('项目经理保留目录查看权限，但新建、编辑、启停及三种申请配置均只读', async t => {
  const { resolvePortalContext } = await import('./portal-context.ts');
  const stores = fixture(); storage(t, stores);
  assert.ok(resolvePortalContext(manager, {}).views.includes('catalog'));
  assert.equal(canManageCatalog(manager, payload(stores, 'workspace').users), false);
  assert.equal(canManageCatalog(admin, payload(stores, 'workspace').users), true);
  const before = structuredClone(stores);
  await assert.rejects(createStoredCatalogService({ ...service, id: 'new' }, manager), /仅启用的系统管理员/);
  for (const change of [
    { service: { ...service, name: '改名' }, reason: '编辑' },
    { service: { ...service, status: '已停用' }, reason: '停用' },
    ...['internal', 'customer', 'partner'].map(audience => ({ audience, config: { ...customer, fields: [] }, reason: '配置' })),
  ]) await assert.rejects(commitCatalogVersion(service.id, change, manager), /仅启用的系统管理员/);
  assert.deepEqual(stores, before);
  assert.equal((await readRequestConfigs('customer'))[0].serviceId, service.id);
});

test('目录事务重读管理员启用状态，缺少身份或身份伪造不能保存', async t => {
  const stores = fixture(); storage(t, stores);
  for (const actor of [undefined, { ...manager, role: admin.role }, { ...admin, role: manager.role }]) {
    await assert.rejects(commitCatalogVersion(service.id, { service: { ...service, status: '已停用' }, reason: '状态变更' }, actor), /仅启用的系统管理员/);
  }
  payload(stores, 'workspace').users.find(user => user.id === admin.id).status = '停用';
  const before = structuredClone(stores);
  await assert.rejects(commitCatalogVersion(service.id, { service: { ...service, status: '已停用' }, reason: '状态变更' }, admin), /仅启用的系统管理员/);
  await assert.rejects(createStoredCatalogService({ ...service, id: 'new' }, admin), /仅启用的系统管理员/);
  assert.deepEqual(stores, before);
});

test('管理员可新建目录、编辑和启停，创建保持草稿并拒绝重复编号', async t => {
  const stores = fixture(); storage(t, stores);
  await createStoredCatalogService({ ...service, id: 'new', status: '已启用' }, admin);
  const created = payload(stores, 'workspace').services.find(record => record.id === 'new');
  assert.equal(created.status, '草稿'); assert.equal(created.version, 1); assert.equal(created.owner, admin.name);
  await assert.rejects(createStoredCatalogService({ ...service, id: 'new' }, admin), /编码已存在/);
  await commitCatalogVersion('new', { service: { ...created, name: '新服务' }, reason: '编辑' }, admin);
  const edited = payload(stores, 'workspace').services.find(record => record.id === 'new');
  assert.equal(edited.name, '新服务'); assert.equal(edited.version, 2);
  await commitCatalogVersion('new', { service: { ...edited, status: '已启用' }, reason: '启用' }, admin);
  assert.equal(payload(stores, 'workspace').services.find(record => record.id === 'new').status, '已启用');
});
