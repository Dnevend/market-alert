# 区块链行情告警 Worker

基于 Cloudflare Workers 与 Hono 构建的链上行情波动监控服务，可对接 Binance 5 分钟 K 线、写入 Cloudflare D1 数据库，并在波动超阈值时发送带签名的 Webhook 告警。项目提供 Bearer Token 保护的管理接口，支持动态配置监控币种与阈值。

## 环境要求

- 建议使用 [pnpm](https://pnpm.io/)（或 npm）
- 已登录的 Cloudflare 账号与 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- 已创建的 Cloudflare D1 数据库

## 初始化步骤

1. 安装依赖：
   ```sh
   pnpm install
   ```
2. 复制环境变量模板并填写实际值：
   ```sh
   cp .env.example .env
   # 填写 WEBHOOK_HMAC_SECRET、ADMIN_BEARER_TOKEN 等字段
   ```
3. 编辑 `wrangler.jsonc`，将 `database_id` 替换为实际的 D1 数据库 ID。
4. 同步数据库结构（两种方式二选一）：
   ```sh
   # 推送完整 schema（可重复执行）
   wrangler d1 execute market-alert --local --file=./schema.sql

   # 或应用迁移记录
   wrangler d1 migrations apply market-alert
   ```
5. 若修改过 D1 绑定或环境变量，重新生成类型：
   ```sh
   pnpm cf-typegen
   ```

## 本地开发

启动本地开发服务器（带热重载）：
```sh
pnpm dev
```

默认监听 `http://127.0.0.1:8787`。本地不会自动触发 Cron，可通过 `POST /trigger` 手动模拟。

## 部署说明

发布前可先执行 dry-run 校验：
```sh
wrangler deploy --dry-run
```

确认无误后部署：
```sh
pnpm deploy
```

线上环境务必写入机密：
```sh
wrangler secret put WEBHOOK_HMAC_SECRET
wrangler secret put ADMIN_BEARER_TOKEN
```

## 配置项说明

通过 `wrangler secret`（生产）或 `.env`（本地）设置以下变量：

| 变量名 | 含义 |
| --- | --- |
| `WEBHOOK_HMAC_SECRET` | Webhook 签名密钥 |
| `ADMIN_BEARER_TOKEN` | 访问 `/admin/*` 与 `/trigger` 所需的 Bearer Token |
| `WEBHOOK_DEFAULT_URL` | 默认告警 Webhook 地址（可被币种配置覆盖） |
| `BINANCE_BASE_URL` | Binance API 基础地址 |
| `HTTP_TIMEOUT_MS` | 对外 HTTP 请求超时时间（毫秒） |
| `MAX_RETRIES` | 对外 HTTP 请求最大重试次数 |
| `RETRY_BACKOFF_BASE_MS` | 指数回退的基础延迟（毫秒） |

全局阈值、冷却时间、窗口长度可通过 `settings` 表或 `/admin/settings` 动态调整。

## API 说明

除 `/healthz` 外，其余接口均需设置 `Authorization: Bearer <ADMIN_BEARER_TOKEN>`。

- `GET /healthz`：健康检查，返回 D1 连接与关键环境变量状态。
- `POST /trigger`：手动触发监控，可带 `{"symbols":["BTCUSDT"]}` 指定币种。
- `GET /admin/symbols`：分页查询币种配置（支持 `page`、`pageSize`、`enabled`）。
- `POST /admin/symbols`：新增监控币种与阈值、Webhook 等信息。
- `PUT /admin/symbols/:symbol` / `DELETE /admin/symbols/:symbol`：更新或禁用指定币种。
- `GET /admin/settings` / `PUT /admin/settings`：读取或修改全局默认配置。
- `GET /admin/alerts`：查询告警记录，可按 `symbol`、`since`、`status`、`limit` 过滤。

### `curl` 示例

```sh
# 健康检查（无需认证）
curl http://127.0.0.1:8787/healthz

# 新增币种配置
curl -X POST http://127.0.0.1:8787/admin/symbols \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","threshold_percent":0.025}'

# 手动触发指定币种监控
curl -X POST http://127.0.0.1:8787/trigger \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"symbols":["BTCUSDT","ETHUSDT"]}'

# 查询最新告警
curl "http://127.0.0.1:8787/admin/alerts?symbol=BTCUSDT&limit=10" \
  -H "Authorization: Bearer $ADMIN_BEARER_TOKEN"
```

## 测试

项目使用 Vitest 进行基础单测（涨跌幅计算、Webhook 签名等）：
```sh
pnpm test
```

## 常见问题

- **没有触发告警**：确认全局/币种阈值设置是否正确，或是否仍在冷却期内。
- **Webhook 发送失败**：查看 `/admin/alerts` 中的状态与响应体，确认对端是否校验 `X-Signature`。
- **Binance 请求异常**：检查网络连通性与访问频率，可适当增大 `MAX_RETRIES` 与 `RETRY_BACKOFF_BASE_MS`。

## 项目结构

```
src/
  config/        # 环境变量加载、常量定义
  db/            # D1 仓储层
  lib/           # Binance 客户端、监控核心、Webhook 工具
  routes/        # Hono 路由模块
  __tests__/     # Vitest 单元测试
schema.sql       # 完整 schema（含初始数据）
migrations/      # D1 迁移脚本
```

默认 Cron 规则为每分钟触发一次（详见 `wrangler.jsonc`），可根据环境需求调整。
