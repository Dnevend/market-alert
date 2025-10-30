import { Hono } from "hono";
import { z } from "zod";
import { runMonitor } from "../lib/monitor";
import { badRequest } from "../lib/errors";
import type { AppContext } from "../types";

const bodySchema = z
  .object({
    symbols: z.array(z.string().trim().min(1)).min(1).optional(),
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

  const results = await runMonitor(c.env, {
    symbols: parsed.data?.symbols,
  });

  return c.json({
    success: true,
    data: results,
  });
});

export default trigger;