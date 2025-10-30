# 区块链市场异常波动监控服务

你是一名资深后端工程师，请用 **TypeScript + Hono** 开发一个运行在 **Cloudflare Workers** 上的“区块链市场异常波动监控服务”。数据存储使用 **Cloudflare D1**。请一次性输出**完整可运行项目**所需的代码与文件（含 `src/**` 源码、`schema.sql`、迁移脚本、`wrangler.toml`、`README.md`、示例 `.env.example`、基础单元测试），并保证能用 `wrangler` 本地开发与部署。

## 一、业务目标

- 监控可配置的一组 **CEX 币种**（如 `BTCUSDT`、`ETHUSDT`）的价格波动。
- 当**5 分钟窗口**内的**价格波动幅度**（默认阈值：±2%）被触发时，通过 **webhook** 推送告警。
- 币种集合与阈值可通过数据库**动态配置**，无需改代码即可调整。
- 支持后续扩展为不同窗口、不同交易所或多个 webhook。

## 二、外部依赖

- 行情源：**币安公开 API**（base URL：`https://api.binance.com/`）

  - 使用 **K 线**接口（5m）计算 5 分钟内涨跌幅；注意网络重试与速率限制。
  - 建议示例：`/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2`

- 告警 Webhook 地址（默认，亦可覆盖）：
  `https://fwalert.com/xxx`

## 三、运行与触发

- 提供两种触发方式：

  1. **定时任务（Cron Triggers）**：每 1 分钟拉取一次并计算；
  2. **手动触发 HTTP API**：便于调试与回填。

- 定时与路由均在 Hono 中实现；在 `wrangler.toml` 配置生产与开发的 cron 表达式。

## 四、波动计算与告警策略

- 取最近两个 5 分钟 K 线的 **收盘价**，计算涨跌幅：`(close_t - close_t-1) / close_t-1`。
- 阈值（默认 ±2%）可按**全局默认**或**币种单独阈值**生效，优先级：币种 > 全局。
- **去抖/防刷**：同一币种在同一窗口内（例如 10 分钟冷却期，可配置）只发送一次告警。
- **幂等性**：对同一 `symbol + window_end` 生成固定的 `idempotency_key`，避免重复发送。
- **重试**：Webhook 失败（HTTP 5xx 或超时）进行有限次指数退避重试；记录状态。
- **安全签名**：对 Webhook 请求体使用 `HMAC-SHA256`（密钥从环境变量），添加 `X-Signature` 头。

## 五、项目结构（建议）

```
/src
  /config
    env.ts           # 环境变量装载与校验
    constants.ts     # 常量：默认阈值、超时、重试、冷却期等
  /lib
    binance.ts       # 调币安 API、重试、速率限制
    compute.ts       # 涨跌幅计算、窗口逻辑
    webhook.ts       # Webhook 发送、签名、重试、幂等
    logger.ts        # 统一日志（console + 结构化）
    errors.ts        # 自定义错误类型
  /db
    d1.ts            # D1 连接封装
    repo.ts          # 仓储层（symbols、settings、alerts）
  /routes
    admin.ts         # 配置管理 RESTful 接口（见下）
    trigger.ts       # 手动触发监控
    health.ts        # 健康检查
  index.ts           # Hono app 入口 + Cron handler
schema.sql           # D1 初始化 schema
migrations/          # 迁移脚本（可按 0001_init.sql）
wrangler.toml
README.md
.env.example
```

## 六、数据库设计（Cloudflare D1）

请提供 `schema.sql` 与迁移文件，至少包含：

- `symbols`：可监控币种

  - `id` (PK), `symbol` (TEXT UNIQUE, e.g. "BTCUSDT"), `enabled` (INTEGER 0/1), `webhook_url` (TEXT, 可空)
  - `threshold_percent` (REAL, 可空), `cooldown_minutes` (INTEGER, 可空), `created_at`, `updated_at`

- `settings`：全局配置（仅一行）

  - `id` (PK 固定 1), `default_threshold_percent` (REAL, 默认 0.02)
  - `window_minutes` (INTEGER, 默认 5), `default_cooldown_minutes` (INTEGER, 默认 10)
  - `binance_base_url` (TEXT, 默认 `https://api.binance.com`)

- `alerts`：告警记录与去重

  - `id` (PK), `symbol` (TEXT), `change_percent` (REAL), `direction` (TEXT: "UP"/"DOWN")
  - `window_start` (INTEGER epoch ms), `window_end` (INTEGER epoch ms)
  - `idempotency_key` (TEXT UNIQUE), `status` (TEXT: "SENT"/"SKIPPED"/"FAILED")
  - `response_code` (INTEGER, 可空), `response_body` (TEXT, 可空), `created_at`

- 为常用查询加索引：`CREATE INDEX idx_alerts_symbol_window ON alerts(symbol, window_end);`

并包含**初始种子数据**（如：`BTCUSDT`, `ETHUSDT`，`enabled=1`）。

## 七、HTTP API 设计（Hono 路由）

所有管理接口需 **Bearer Token** 鉴权（从环境变量读取），并返回标准 JSON：

```json
{ "success": true, "data": ... }
```

- `GET /healthz`：存活检查，包含 D1 连通性与必需 env 校验结果。
- `POST /trigger`：手动触发一次监控（可选 body：`symbols?: string[]`）。
- `GET /admin/symbols`：列表（支持分页与按 `enabled` 过滤）。
- `POST /admin/symbols`：新增币种：`{ symbol, enabled?, threshold_percent?, cooldown_minutes?, webhook_url? }`
- `PUT /admin/symbols/:symbol`：更新同上字段（部分可选）。
- `DELETE /admin/symbols/:symbol`：软删或禁用，二选一即可（实现说明）。
- `GET /admin/settings` / `PUT /admin/settings`：读取/更新全局默认配置。
- `GET /admin/alerts`：最近告警查询（支持 `symbol`、`since`、`status` 过滤）。

## 八、环境变量与常量抽取

- `WEBHOOK_DEFAULT_URL`（默认 webhook）
- `WEBHOOK_HMAC_SECRET`
- `ADMIN_BEARER_TOKEN`
- `BINANCE_BASE_URL`（可覆盖）
- `HTTP_TIMEOUT_MS`、`MAX_RETRIES`、`RETRY_BACKOFF_BASE_MS`
- D1 绑定名称与数据库名称（在 `wrangler.toml` 中配置）
  请提供 `.env.example` 并在 `env.ts` 中做类型与必填校验（若缺失启动即报错）。

## 九、健壮性与工程要求

- **速率限制与重试**：对币安请求使用退避与抖动；超时可配置。
- **错误处理**：统一错误中间件，返回明确 `code` 与 `message`；避免泄露敏感 env。
- **日志**：结构化打印关键事件（请求、阈值命中、retry、webhook 响应、DB 异常）。
- **测试**：至少对 `compute.ts`（涨跌幅、阈值判断、去抖/冷却）和 `webhook.ts`（签名与幂等）提供基础单测。
- **幂等**：生成 `idempotency_key = sha256(symbol + window_end + threshold)`；向 `alerts` 写入前先查唯一键。
- **部署文档**：`README.md` 说明本地运行、D1 初始化（`wrangler d1 execute`）、迁移、部署、配置 cron、API 示例 `curl`。
- **安全**：所有 `/admin/*` 与 `/trigger` 需 Bearer Token；记录审计日志。
- **可扩展性**：将交易所适配抽象为接口，留出扩展点（如 OKX、Bybit）。

## 十、数据模型与示例

- 告警 Webhook 请求体示例：

```json
{
  "symbol": "BTCUSDT",
  "change_percent": -0.0234,
  "direction": "DOWN",
  "window_minutes": 5,
  "window_start": 1730266800000,
  "window_end": 1730267100000,
  "observed_at": 1730267100123,
  "source": "binance",
  "links": {
    "kline_api": "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=5m&limit=2"
  }
}
```

- 头部：`X-Signature: <hex(hmac_sha256(body, WEBHOOK_HMAC_SECRET))>`

## 十一、验收标准（必须满足）

1. 本地 `wrangler dev` 可启动，`/healthz` 返回 `success: true`。
2. 使用 `POST /admin/symbols` 添加新币种后，`POST /trigger` 能根据实时 K 线计算并在超阈值时发送 webhook。
3. 冷却期内重复触发不再重复发送；`alerts` 表记录准确。
4. `README.md` 覆盖初始化、迁移、部署与常见故障排查。
5. 代码风格一致、模块化、常量与 env 抽取清晰。

---

## 你需要输出

- 完整项目文件内容（分块展示），且文件名清晰标注。
- `README.md`（含部署与使用步骤、`curl` 示例）。
- `wrangler.toml`（含 D1 绑定与 Cron）。
- `schema.sql` 与 `migrations/**`。
- 至少 3 个 API 的 `curl` 示例。
- 至少 3 个基础测试用例。
- 关键函数含简短注释与边界说明。

---

### 备注

- 如果币安 API 临时不可用，请在代码中优雅降级并记录错误；不要让 Worker 崩溃。
- 允许使用轻量依赖（如 `zod` 校验、`itty-router-openapi` 或直接 Hono 内置特性），优先保持轻量。

---