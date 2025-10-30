import type { MiddlewareHandler } from "hono";
import { unauthorized } from "../lib/errors";
import type { AppContext } from "../types";

export const requireBearerAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;

  if (!token) {
    throw unauthorized("Missing bearer token");
  }

  const env = c.get("env");
  if (token !== env.adminBearerToken) {
    throw unauthorized("Invalid bearer token");
  }

  await next();
};
