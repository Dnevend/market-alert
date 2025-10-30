import { Hono } from "hono";
import { z } from "zod";
import {
  createSymbol,
  disableSymbol,
  getSettings,
  getSymbol,
  listAlerts,
  listSymbols,
  updateSettings,
  updateSymbol,
  type SymbolRecord,
} from "../db/repo";
import { badRequest, conflict, notFound } from "../lib/errors";
import type { AppContext } from "../types";

const admin = new Hono<AppContext>();

const listSymbolsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  enabled: z
    .string()
    .transform((value) => {
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    })
    .pipe(z.union([z.boolean(), z.string()]))
    .optional(),
});

const createSymbolSchema = z.object({
  symbol: z.string().trim().min(2),
  enabled: z.boolean().optional(),
  threshold_percent: z.number().min(0).max(1).optional(),
  cooldown_minutes: z.number().int().min(1).optional(),
  webhook_url: z.string().url().optional(),
});

const updateSymbolSchema = createSymbolSchema.partial().extend({
  symbol: z.string().trim().min(2).optional(),
});

const settingsUpdateSchema = z
  .object({
    default_threshold_percent: z.number().min(0).max(1).optional(),
    window_minutes: z.number().int().min(1).optional(),
    default_cooldown_minutes: z.number().int().min(1).optional(),
    binance_base_url: z.string().url().optional(),
  })
  .strict();

const alertQuerySchema = z.object({
  symbol: z.string().optional(),
  since: z.coerce.number().optional(),
  status: z.enum(["SENT", "FAILED", "SKIPPED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const serializeSymbol = (record: SymbolRecord) => ({
  symbol: record.symbol,
  enabled: record.enabled === 1,
  threshold_percent: record.threshold_percent,
  cooldown_minutes: record.cooldown_minutes,
  webhook_url: record.webhook_url,
  created_at: record.created_at,
  updated_at: record.updated_at,
});

admin.get("/admin/symbols", async (c) => {
  const parse = listSymbolsSchema.safeParse(c.req.query());
  if (!parse.success) {
    throw badRequest("Invalid query parameters", { issues: parse.error.issues });
  }

  const { page, pageSize, enabled } = parse.data;
  const list = await listSymbols(c.env.DB, {
    page,
    pageSize,
    enabled: typeof enabled === "boolean" ? enabled : undefined,
  });

  return c.json({
    success: true,
    data: {
      items: list.items.map((item) => serializeSymbol(item)),
      pagination: {
        page,
        pageSize,
        total: list.total,
      },
    },
  });
});

admin.post("/admin/symbols", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }
  const parse = createSymbolSchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid symbol payload", { issues: parse.error.issues });
  }

  const existing = await getSymbol(c.env.DB, parse.data.symbol);
  if (existing) {
    throw conflict("Symbol already exists");
  }

  try {
    const record = await createSymbol(c.env.DB, {
      symbol: parse.data.symbol,
      enabled: parse.data.enabled,
      thresholdPercent: parse.data.threshold_percent,
      cooldownMinutes: parse.data.cooldown_minutes,
      webhookUrl: parse.data.webhook_url,
    });

    return c.json({
      success: true,
      data: serializeSymbol(record),
    });
  } catch (error) {
    throw badRequest("Failed to create symbol", { error: `${error}` });
  }
});

admin.put("/admin/symbols/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }
  const parse = updateSymbolSchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid symbol payload", { issues: parse.error.issues });
  }

  const record = await updateSymbol(c.env.DB, symbol, {
    enabled: parse.data.enabled,
    thresholdPercent: parse.data.threshold_percent,
    cooldownMinutes: parse.data.cooldown_minutes,
    webhookUrl: parse.data.webhook_url,
  });

  if (!record) {
    throw notFound("Symbol not found");
  }

  return c.json({
    success: true,
    data: serializeSymbol(record),
  });
});

admin.delete("/admin/symbols/:symbol", async (c) => {
  const symbol = c.req.param("symbol");
  const record = await disableSymbol(c.env.DB, symbol);
  if (!record) {
    throw notFound("Symbol not found");
  }
  return c.json({
    success: true,
    data: serializeSymbol(record),
  });
});

admin.get("/admin/settings", async (c) => {
  const record = await getSettings(c.env.DB);
  return c.json({
    success: true,
    data: record,
  });
});

admin.put("/admin/settings", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }
  const parse = settingsUpdateSchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid settings payload", { issues: parse.error.issues });
  }

  const updated = await updateSettings(c.env.DB, parse.data);
  return c.json({
    success: true,
    data: updated,
  });
});

admin.get("/admin/alerts", async (c) => {
  const parse = alertQuerySchema.safeParse(c.req.query());
  if (!parse.success) {
    throw badRequest("Invalid alert query", { issues: parse.error.issues });
  }

  const alerts = await listAlerts(c.env.DB, parse.data);
  return c.json({
    success: true,
    data: alerts,
  });
});

// Development-only endpoint to trigger scheduled tasks
admin.post("/admin/scheduled", async (c) => {
  console.log("🚀 Manual scheduled task triggered via admin endpoint");

  try {
    const { runMonitor } = await import("../lib/monitor");
    const results = await runMonitor(c.env);

    console.log("🚀 Manual scheduled task completed:", results);

    return c.json({
      success: true,
      data: {
        message: "Scheduled task executed successfully",
        results,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.log("🚀 Manual scheduled task failed:", error);

    return c.json({
      success: false,
      error: {
        code: "SCHEDULED_TASK_FAILED",
        message: "Failed to execute scheduled task",
        details: `${error}`,
      },
    }, 500);
  }
});

export default admin;
