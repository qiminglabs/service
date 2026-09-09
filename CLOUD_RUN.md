# Cloud Run 部署

仓库保留现有 OpenAI Sites 构建方式，同时通过根目录 `Dockerfile` 支持 Cloud Run。容器会构建 Vinext Worker，并由 Node HTTP 适配层监听 Cloud Run 注入的 `PORT`。

## 从已关联的 GitHub 仓库部署

在 Google Cloud 控制台打开 **Cloud Run**，选择 **连接代码库**：

- 代码库提供方：Developer Connect
- 代码库：`qiminglabs/service`
- 分支：`^main$`
- 构建类型：Dockerfile
- 构建上下文目录：`/`
- Dockerfile：`/Dockerfile`
- 建议服务名称：`smartx-service-catalog`

容器暴露 8080 端口，并提供 `/healthz` 健康检查。Cloud Run 会通过 `PORT` 环境变量指定实际监听端口，无需手工覆盖。

## 功能助手配置

不要把密钥写入仓库或普通构建参数。将 OpenAI API 密钥保存到 Secret Manager，再把最新版 Secret 以环境变量 `OPENAI_API_KEY` 挂载到 Cloud Run 服务。另设普通环境变量 `ASSISTANT_MODEL`，值使用当前 OpenAI 项目有权调用的模型名称。

未配置这两个变量时，业务 Demo 仍可使用，但悬浮功能助手会提示模型服务尚未配置。

## 组织访问

部署成功后为 Cloud Run 服务启用 Identity-Aware Proxy（IAP），再把组织 Google Group 或员工账号授予 `IAP-secured Web App User`（`roles/iap.httpsResourceAccessor`）。不要为了从 Google Sites 跳转而把服务设成公开访问。

当前 Demo 记录仍保存在访问者浏览器的本地存储中，不会因部署到 Cloud Run 自动变成共享数据库。
