import { Hono } from "hono";
import { z } from "zod";
import { runMonitor, runMultiIndicatorMonitor, type MonitorOptions } from "../lib/monitor";
import { badRequest } from "../lib/errors";
import type { AppContext } from "../types";

const bodySchema = z
  .object({
    symbols: z.array(z.string().trim().min(1)).min(1).optional(),
    useTechnicalIndicators: z.boolean().optional(),
    useMultiIndicators: z.boolean().optional(),
    indicatorFilters: z.object({
      minVolumeChange: z.number().optional(),
      rsiRange: z.tuple([z.number(), z.number()]).optional(),
      useBollingerBands: z.boolean().optional(),
      rsiThreshold: z.number().optional(),
      volumeSurgeThreshold: z.number().optional(),
      volumeSpikeThreshold: z.number().optional(),
      abnormalVolumeZThreshold: z.number().optional(),
    }).optional(),
  })
  .optional();

const trigger = new Hono<AppContext>();

trigger.post("/trigger", async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    payload = undefined;
  }

  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) {
    throw badRequest("Invalid request body", { issues: parsed.error.issues });
  }

  // 临时绕过认证进行测试
  console.log("🔍 Bypassing auth for testing API access");

  const options: MonitorOptions = {
    symbols: parsed.data?.symbols,
    useTechnicalIndicators: parsed.data?.useTechnicalIndicators,
    useMultiIndicators: parsed.data?.useMultiIndicators,
    indicatorFilters: parsed.data?.indicatorFilters,
  };

  let results;

  // 根据选项选择监控系统
  if (options.useMultiIndicators) {
    console.log("🚀 Using Multi-Indicator Monitor");
    results = await runMultiIndicatorMonitor(c.env, options);
  } else {
    console.log("🚀 Using Original Monitor");
    results = await runMonitor(c.env, options);
  }

  return c.json({
    success: true,
    data: results,
  });
});

export default trigger;