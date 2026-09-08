# 第一版模块清单

当前仅建立目录和职责边界。所有目录中只有说明文件，没有功能实现。

## 应用入口

| 目录 | 边界 |
| --- | --- |
| `apps/web` | 未来组合销售、项目经理、工程师、客户四种 Demo 视角 |
| `apps/api` | 未来组合所有业务模块，提供单体后端入口 |

## 业务模块

| 模块 | 目录 | 第一版职责 |
| --- | --- | --- |
| 主数据 | `modules/master-data` | 维护 Demo 引用的客户、联系人、资产和业务对象，以及对象间的归属关系 |
| 服务目录 | `modules/service-catalog` | 固定两个服务子项及各自的步骤模板，用于生成两张工单 |
| 服务申请 | `modules/service-request` | 销售创建并提交申请；保存两个申请子项和审批结果 |
| 服务项目 | `modules/service-project` | 审批后转换项目，管理项目整体状态与完成条件 |
| 派单 | `modules/dispatch` | 项目经理为两张工单手动选择工程师 |
| 工单 | `modules/work-order` | 由两个申请子项各生成一张工单，承载执行状态 |
| 工单步骤 | `modules/work-step` | 从固定模板生成步骤，记录工程师逐步完成情况 |
| 交付物 | `modules/deliverable` | 保存工程师上传的交付物及其工单关联 |
| 工时 | `modules/time-entry` | 保存工程师在工单上填写的工时 |
| 完成复核 | `modules/completion-review` | 汇总两张工单、步骤、交付物和工时，供项目经理复核 |
| 客户确认 | `modules/customer-confirmation` | 客户查看复核结果并确认，确认后项目完成 |
| 活动记录 | `modules/activity-log` | 保存普通状态历史和操作时间线，不提供不可篡改保证 |

## 共享目录

| 目录 | 边界 |
| --- | --- |
| `packages/database` | 未来的 PostgreSQL 连接、迁移和种子数据 |
| `packages/contracts` | 跨模块公共类型与稳定契约 |
| `packages/demo-auth` | 固定 Demo 用户与角色切换，不做真实认证和复杂权限 |
| `packages/testkit` | 未来的端到端场景数据和测试工具 |
| `infra/postgres` | 未来的本地 PostgreSQL 配置 |

## 模块依赖方向

```text
master-data     service-catalog
      \             /
       service-request
              |
       service-project
              |
     dispatch + work-order
                    |
                work-step
                 /     \
        deliverable   time-entry
                 \     /
           completion-review
                    |
         customer-confirmation
                    |
          service-project 完成

activity-log 旁路记录各模块的状态与操作。
```

## 第一版边界约束

- 只实现这一条成功闭环，不增加驳回、暂停、合并、改派、撤销、自动确认等分支。
- 申请固定包含两个服务子项；转项目时每个子项生成一张工单。
- 两张工单的步骤全部完成，并且交付物和工时已填写后，项目经理才能复核。
- 项目经理复核后才允许客户确认；客户确认后项目完成。
- 文件对象存储不在范围内，后续实现时小型 Demo 交付物可直接存 PostgreSQL。
