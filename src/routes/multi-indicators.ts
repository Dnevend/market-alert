import { Hono } from "hono";
import { z } from "zod";
import {
  getIndicatorTypes,
  getSymbolIndicators,
  createSymbolIndicator,
  updateSymbolIndicator,
  getSymbolIndicator,
} from "../db/repo";
import { badRequest, notFound } from "../lib/errors";
import type { AppContext } from "../types";

const multiIndicators = new Hono<AppContext>();

// 指标类型相关Schema
const indicatorTypeQuerySchema = z.object({
  active: z.coerce.boolean().optional(),
});

// 符号指标配置Schema
const createSymbolIndicatorSchema = z.object({
  symbol: z.string().trim().min(2),
  indicatorType: z.string().min(1), // 指标类型名称
  thresholdValue: z.number(),
  thresholdOperator: z.enum(['>', '<', '>=', '<=', '=', '!=']),
  enabled: z.boolean().optional(),
  cooldownMinutes: z.number().int().min(1).optional(),
  webhookUrl: z.string().url().optional().or(z.literal("")),
});

const updateSymbolIndicatorSchema = createSymbolIndicatorSchema.partial().extend({
  symbol: z.string().trim().min(2).optional(),
});

// 告警查询Schema
const alertQuerySchema = z.object({
  symbol: z.string().optional(),
  indicatorType: z.string().optional(),
  since: z.coerce.number().optional(),
  status: z.enum(["SENT", "SKIPPED", "FAILED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

// 获取所有指标类型
multiIndicators.get("/admin/indicator-types", async (c) => {
  const parse = indicatorTypeQuerySchema.safeParse(c.req.query());
  if (!parse.success) {
    throw badRequest("Invalid query parameters", { issues: parse.error.issues });
  }

  const { active } = parse.data;
  const indicatorTypes = await getIndicatorTypes(c.env.DB);

  const filteredTypes = active !== undefined
    ? indicatorTypes.filter(type => type.is_active === (active ? 1 : 0))
    : indicatorTypes;

  return c.json({
    success: true,
    data: filteredTypes,
  });
});

// 获取符号指标配置列表
multiIndicators.get("/admin/symbol-indicators", async (c) => {
  const symbol = c.req.query("symbol");
  const indicatorType = c.req.query("indicatorType");

  const indicators = await getSymbolIndicators(c.env.DB, symbol, indicatorType);

  return c.json({
    success: true,
    data: indicators,
  });
});

// 获取特定符号的特定指标配置
multiIndicators.get("/admin/symbol-indicators/:symbol/:indicatorType", async (c) => {
  const symbol = c.req.param("symbol");
  const indicatorType = c.req.param("indicatorType");

  const indicator = await getSymbolIndicator(c.env.DB, symbol, indicatorType);

  if (!indicator) {
    throw notFound("Symbol indicator configuration not found");
  }

  return c.json({
    success: true,
    data: indicator,
  });
});

// 创建符号指标配置
multiIndicators.post("/admin/symbol-indicators", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const parse = createSymbolIndicatorSchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid symbol indicator payload", { issues: parse.error.issues });
  }

  const { indicatorType, symbol, ...configData } = parse.data;

  // 获取指标类型ID
  const indicatorTypes = await getIndicatorTypes(c.env.DB);
  const indicatorTypeRecord = indicatorTypes.find(type => type.name === indicatorType);

  if (!indicatorTypeRecord) {
    throw badRequest("Invalid indicator type", { indicatorType });
  }

  try {
    const record = await createSymbolIndicator(c.env.DB, {
      symbol,
      indicatorTypeId: indicatorTypeRecord.id,
      thresholdValue: configData.thresholdValue,
      thresholdOperator: configData.thresholdOperator,
      enabled: configData.enabled,
      cooldownMinutes: configData.cooldownMinutes,
      webhookUrl: configData.webhookUrl === "" ? null : configData.webhookUrl,
    });

    console.log(`[ADMIN] Created symbol indicator: ${symbol}-${indicatorType}`, {
      thresholdValue: configData.thresholdValue,
      operator: configData.thresholdOperator,
      enabled: configData.enabled,
    });

    return c.json({
      success: true,
      data: record,
    });
  } catch (error) {
    console.error(`[ADMIN] Failed to create symbol indicator: ${symbol}-${indicatorType}`, error);
    throw badRequest("Failed to create symbol indicator", { error: `${error}` });
  }
});

// 更新符号指标配置
multiIndicators.put("/admin/symbol-indicators/:symbol/:indicatorType", async (c) => {
  const symbol = c.req.param("symbol");
  const indicatorType = c.req.param("indicatorType");

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const parse = updateSymbolIndicatorSchema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid symbol indicator payload", { issues: parse.error.issues });
  }

  // 验证指标类型存在
  const indicatorTypes = await getIndicatorTypes(c.env.DB);
  const indicatorTypeRecord = indicatorTypes.find(type => type.name === indicatorType);

  if (!indicatorTypeRecord) {
    throw badRequest("Invalid indicator type", { indicatorType });
  }

  const updates: any = {};
  if (typeof parse.data.thresholdValue !== 'undefined') {
    updates.thresholdValue = parse.data.thresholdValue;
  }
  if (typeof parse.data.thresholdOperator !== 'undefined') {
    updates.thresholdOperator = parse.data.thresholdOperator;
  }
  if (typeof parse.data.enabled !== 'undefined') {
    updates.enabled = parse.data.enabled;
  }
  if (typeof parse.data.cooldownMinutes !== 'undefined') {
    updates.cooldownMinutes = parse.data.cooldownMinutes;
  }
  if (typeof parse.data.webhookUrl !== 'undefined') {
    updates.webhookUrl = parse.data.webhookUrl === "" ? null : parse.data.webhookUrl;
  }

  try {
    const record = await updateSymbolIndicator(c.env.DB, symbol, indicatorType, updates);

    if (!record) {
      throw notFound("Symbol indicator not found");
    }

    console.log(`[ADMIN] Updated symbol indicator: ${symbol}-${indicatorType}`, updates);

    return c.json({
      success: true,
      data: record,
    });
  } catch (error) {
    console.error(`[ADMIN] Failed to update symbol indicator: ${symbol}-${indicatorType}`, error);
    throw badRequest("Failed to update symbol indicator", { error: `${error}` });
  }
});

// 删除/禁用符号指标配置
multiIndicators.delete("/admin/symbol-indicators/:symbol/:indicatorType", async (c) => {
  const symbol = c.req.param("symbol");
  const indicatorType = c.req.param("indicatorType");

  const record = await updateSymbolIndicator(c.env.DB, symbol, indicatorType, { enabled: false });

  if (!record) {
    throw notFound("Symbol indicator not found");
  }

  console.log(`[ADMIN] Disabled symbol indicator: ${symbol}-${indicatorType}`);

  return c.json({
    success: true,
    data: record,
  });
});

// 获取多指标告警记录
multiIndicators.get("/admin/alerts-multi", async (c) => {
  const parse = alertQuerySchema.safeParse(c.req.query());
  if (!parse.success) {
    throw badRequest("Invalid alert query parameters", { issues: parse.error.issues });
  }

  const { listAlertsNew } = await import("../db/repo");
  const alerts = await listAlertsNew(c.env.DB, parse.data);

  return c.json({
    success: true,
    data: alerts,
  });
});

// 触发多指标监控（开发用）
multiIndicators.post("/admin/trigger-multi-indicators", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const schema = z.object({
    symbols: z.array(z.string()).optional(),
    useMultiIndicators: z.boolean().optional(),
  });

  const parse = schema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid request payload", { issues: parse.error.issues });
  }

  console.log("🚀 Manual multi-indicator monitor triggered via admin endpoint");

  try {
    const { runMultiIndicatorMonitor } = await import("../lib/monitor");
    const results = await runMultiIndicatorMonitor(c.env, parse.data);

    console.log("🚀 Manual multi-indicator monitor completed:", results);

    return c.json({
      success: true,
      data: {
        message: "Multi-indicator monitor executed successfully",
        results,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.log("🚀 Manual multi-indicator monitor failed:", error);

    return c.json({
      success: false,
      error: {
        code: "MULTI_INDICATOR_MONITOR_FAILED",
        message: "Failed to execute multi-indicator monitor",
        details: `${error}`,
      },
    }, 500);
  }
});

// 批量设置符号指标配置
multiIndicators.post("/admin/batch-indicators", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw badRequest("Invalid JSON payload");
  }

  const schema = z.object({
    symbol: z.string().trim().min(2),
    indicators: z.array(z.object({
      indicatorType: z.string(),
      thresholdValue: z.number(),
      thresholdOperator: z.enum(['>', '<', '>=', '<=', '=', '!=']),
      enabled: z.boolean().default(true),
      cooldownMinutes: z.number().int().min(1).optional(),
      webhookUrl: z.string().url().optional().or(z.literal("")),
    })),
  });

  const parse = schema.safeParse(body);
  if (!parse.success) {
    throw badRequest("Invalid batch indicators payload", { issues: parse.error.issues });
  }

  const { symbol, indicators } = parse.data;
  const indicatorTypes = await getIndicatorTypes(c.env.DB);
  const results = [];

  console.log(`[ADMIN] Batch creating indicators for symbol: ${symbol}`, {
    indicatorCount: indicators.length,
  });

  for (const indicatorConfig of indicators) {
    const indicatorTypeRecord = indicatorTypes.find(type => type.name === indicatorConfig.indicatorType);

    if (!indicatorTypeRecord) {
      results.push({
        indicatorType: indicatorConfig.indicatorType,
        success: false,
        error: "Invalid indicator type",
      });
      continue;
    }

    try {
      const record = await createSymbolIndicator(c.env.DB, {
        symbol,
        indicatorTypeId: indicatorTypeRecord.id,
        thresholdValue: indicatorConfig.thresholdValue,
        thresholdOperator: indicatorConfig.thresholdOperator,
        enabled: indicatorConfig.enabled,
        cooldownMinutes: indicatorConfig.cooldownMinutes,
        webhookUrl: indicatorConfig.webhookUrl === "" ? null : indicatorConfig.webhookUrl,
      });

      results.push({
        indicatorType: indicatorConfig.indicatorType,
        success: true,
        data: record,
      });
    } catch (error) {
      console.error(`[ADMIN] Failed to create indicator ${indicatorConfig.indicatorType} for ${symbol}`, error);
      results.push({
        indicatorType: indicatorConfig.indicatorType,
        success: false,
        error: `${error}`,
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;

  console.log(`[ADMIN] Batch indicators completed for ${symbol}`, {
    total: results.length,
    success: successCount,
    failures: failureCount,
  });

  return c.json({
    success: failureCount === 0,
    data: {
      symbol,
      total: results.length,
      success: successCount,
      failures: failureCount,
      results,
    },
  }, failureCount > 0 ? 207 : 200);
});

export default multiIndicators;