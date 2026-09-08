# Master Data

第一版负责维护 Demo 业务流程引用的客户、联系人、资产和业务对象主数据；不连接 CRM、CMDB 或外部资产系统。

## 设计基准

- [`MASTER_DATA_FIELDS.md`](./MASTER_DATA_FIELDS.md)：主数据对象字段的单一事实源。后续相关页面、表单、接口、数据库和测试数据必须遵循该字段表。

## 模块边界

- 模块内定义客户、联系人、资产、业务对象及其关联和校验规则。
- Demo 页面只维护和引用这些数据，不在页面层重新定义字段。
- 固定 Demo 用户与角色切换仍由 `packages/demo-auth` 管理，不属于本模块字段表。
- 数据库种子入口位于 `packages/database`，端到端场景构造位于 `packages/testkit`。
