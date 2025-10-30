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

// Add OpenAPI documentation routes (public)
app.route("/", openapiRoutes);

// Add original routes
app.route("/", health);
app.route("/", auth);

// 需要鉴权的路由
app.use("*", async (c, next) => {
  // 应用以太坊JWT鉴权中间件
  const { requireEthereumAuth } = await import("./middleware/auth");
  return requireEthereumAuth(c, next);
});

app.route("/", trigger);
app.route("/", users);
app.route("/", admin);

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
          const results = await runMonitor(env as CloudflareBindings);
          logger.info("cron_completed", { results });
        } catch (error) {
          logger.error("cron_failed", { error: `${error}` });
        }
      })()
    );
  },
} as ExportedHandler<CloudflareBindings>;
