import { Hono } from "hono";
import { checkDatabase } from "../db/d1";
import type { AppContext } from "../types";

const health = new Hono<AppContext>();

health.get("/healthz", async (c) => {
  const env = c.get("env");
  const dbHealthy = await checkDatabase(c.env.DB);

  return c.json({
    success: true,
    data: {
      healthy: dbHealthy,
      checks: {
        database: dbHealthy,
        webhookSecret: Boolean(env.webhookHmacSecret),
        jwtSecret: Boolean(env.jwtSecret),
      },
    },
  });
});

export default health;
