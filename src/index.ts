import { Hono } from "hono";
import { cors } from "hono/cors";
import admin from "./routes/admin";
import auth from "./routes/auth";
import users from "./routes/users";
import health from "./routes/health";
import trigger from "./routes/trigger";
import openapiRoutes from "./lib/openapi-simple";
import { AppError } from "./lib/errors";
import { logger } from "./lib/logger";
import { runMonitor } from "./lib/monitor";
import { loadEnv } from "./config/env";
import type { AppContext } from "./types";

const app = new Hono<AppContext>();

// CORS配置 - 允许所有跨域请求
app.use(
  "*",
  cors({
    origin: "*", // 允许所有来源
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], // 允许的HTTP方法
    allowHeaders: ["Content-Type", "Authorization"], // 允许的请求头
    exposeHeaders: ["Content-Length", "Content-Range"], // 暴露的响应头
    maxAge: 86400, // 预检请求缓存时间（24小时）
    credentials: true, // 允许携带凭据
  })
);

app.use("*", async (c, next) => {
  const env = loadEnv(c.env);
  c.set("env", env);
  return next();
});

app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  logger.info("request_completed", {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: duration,
  });
});

// 公开路由（不需要鉴权）
app.get("/", (c) =>
  c.json({
    success: true,
    data: {
      service: "market-alert",
      version: "1.0.0",
    },
  })
);

// Add OpenAPI documentation routes (public) with /docs prefix
app.route("/docs", openapiRoutes);

// Add original routes
app.route("/", health);
app.route("/", auth);

// 需要鉴权的路由
app.use("*", async (c, next) => {
  // 开发环境检查：如果是本地开发或有debug header，跳过认证
  const isDevelopment =
    c.req.header("x-debug-mode") === "dev" ||
    c.req.url.includes("localhost") ||
    c.req.url.includes("127.0.0.1");

  // 为测试目的：添加测试 header 检查
  const isTestMode =
    c.req.header("x-test-mode") === "binance-test";

  if (isDevelopment || isTestMode) {
    // 设置默认用户信息
    c.set("userAddress", "0x0000000000000000000000000000000000000000");
    c.set("userRole", "admin");
    console.log(`🔓 Auth bypassed: ${isDevelopment ? 'development' : 'test'} mode`);
    return next();
  }

  // 生产环境应用以太坊JWT鉴权中间件
  const { requireEthereumAuth } = await import("./middleware/auth");
  return requireEthereumAuth(c, next);
});

app.route("/", trigger);
app.route("/", users);
app.route("/", admin);

// Add multi-indicator routes
import multiIndicators from "./routes/multi-indicators";
app.route("/", multiIndicators);

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "Route Not Found",
      },
    },
    404
  )
);

app.onError((err, c) => {
  if (err instanceof AppError) {
    return c.json(
      {
        success: false,
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
        },
      },
      err.status as any
    );
  }

  logger.error("unhandled_error", { error: `${err}` });
  return c.json(
    {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal Server Error",
      },
    },
    500
  );
});

export default {
  ...app,
  fetch: app.fetch,
  scheduled: async (
    controller: ScheduledController,
    env: CloudflareBindings,
    ctx: ExecutionContext
  ) => {
    logger.info("cron_started", { timestamp: Date.now() });

    ctx.waitUntil(
      (async () => {
        try {
          // 同时运行传统监控和多指标监控
          const promises = [];

          // 1. 运行传统监控（确保兼容性）
          logger.info("cron_starting_legacy_monitor");
          promises.push(
            (async () => {
              try {
                const legacyResults = await runMonitor(env as CloudflareBindings);
                logger.info("cron_legacy_completed", { results: legacyResults, monitorType: "legacy" });
                return legacyResults;
              } catch (error) {
                  logger.error("cron_legacy_failed", { error: `${error}` });
                  return [];
                }
              })()
          );

          // 2. 检查并运行多指标监控（如果有配置）
          const { getSymbolIndicators } = await import("./db/repo");
          const multiIndicatorConfigs = await getSymbolIndicators(env.DB);

          if (multiIndicatorConfigs.length > 0) {
            logger.info("cron_starting_multi_indicator_monitor", {
              indicatorCount: multiIndicatorConfigs.length,
              symbols: [...new Set(multiIndicatorConfigs.map(c => c.symbol))]
            });

            promises.push(
              (async () => {
                try {
                  const { runMultiIndicatorMonitor } = await import("./lib/monitor");
                  const multiResults = await runMultiIndicatorMonitor(env as CloudflareBindings, {
                    useMultiIndicators: true,
                    symbols: undefined, // 监控所有启用的符号
                  });
                  logger.info("cron_multi_indicator_completed", { results: multiResults, monitorType: "multi-indicator" });
                  return multiResults;
                } catch (error) {
                  logger.error("cron_multi_indicator_failed", { error: `${error}` });
                  return [];
                }
              })()
            );
          } else {
            logger.info("cron_no_multi_indicator_configs", { reason: "skipping_multi_indicator_monitor" });
          }

          // 等待所有监控完成
          const allResults = await Promise.allSettled(promises);

          logger.info("cron_all_monitors_completed", {
            legacyMonitorStatus: allResults[0].status,
            multiIndicatorStatus: allResults[1]?.status || 'skipped',
            totalResults: allResults.filter(r => r.status === 'fulfilled').length,
            triggeredCount: allResults.reduce((sum, result) =>
              sum + (result.status === 'fulfilled' ? result.value?.filter?.(r => r.triggered)?.length || 0 : 0), 0)
          });

        } catch (error) {
          logger.error("cron_failed", { error: `${error}` });
        }
      })()
    );
  },
} as ExportedHandler<CloudflareBindings>;
