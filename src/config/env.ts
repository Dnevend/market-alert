import { z } from "zod";
import {
  DEFAULT_BINANCE_BASE_URL,
  DEFAULT_HTTP_TIMEOUT_MS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_BACKOFF_BASE_MS,
  DEFAULT_WEBHOOK_URL,
} from "./constants";

export interface CloudflareBindings {
  DB: D1Database;
  WEBHOOK_DEFAULT_URL?: string;
  WEBHOOK_HMAC_SECRET?: string;
  ADMIN_BEARER_TOKEN?: string;
  BINANCE_BASE_URL?: string;
  HTTP_TIMEOUT_MS?: string;
  MAX_RETRIES?: string;
  RETRY_BACKOFF_BASE_MS?: string;
}

const envSchema = z.object({
  webhookDefaultUrl: z.string().url().default(DEFAULT_WEBHOOK_URL),
  webhookHmacSecret: z.string().min(8, "WEBHOOK_HMAC_SECRET must be at least 8 characters"),
  adminBearerToken: z.string().min(8, "ADMIN_BEARER_TOKEN must be at least 8 characters"),
  binanceBaseUrl: z.string().url().default(DEFAULT_BINANCE_BASE_URL),
  httpTimeoutMs: z.coerce.number().int().positive().default(DEFAULT_HTTP_TIMEOUT_MS),
  maxRetries: z.coerce.number().int().min(1).default(DEFAULT_MAX_RETRIES),
  retryBackoffBaseMs: z.coerce.number().int().min(50).default(DEFAULT_RETRY_BACKOFF_BASE_MS),
});

export type AppEnv = z.infer<typeof envSchema>;

const cache = new WeakMap<CloudflareBindings, AppEnv>();

export const loadEnv = (bindings: CloudflareBindings): AppEnv => {
  let cached = cache.get(bindings);
  if (cached) {
    return cached;
  }

  const parsed = envSchema.parse({
    webhookDefaultUrl: bindings.WEBHOOK_DEFAULT_URL ?? DEFAULT_WEBHOOK_URL,
    webhookHmacSecret: bindings.WEBHOOK_HMAC_SECRET,
    adminBearerToken: bindings.ADMIN_BEARER_TOKEN,
    binanceBaseUrl: bindings.BINANCE_BASE_URL ?? DEFAULT_BINANCE_BASE_URL,
    httpTimeoutMs: bindings.HTTP_TIMEOUT_MS,
    maxRetries: bindings.MAX_RETRIES,
    retryBackoffBaseMs: bindings.RETRY_BACKOFF_BASE_MS,
  });

  cache.set(bindings, parsed);
  return parsed;
};

export type AppVariables = {
  env: AppEnv;
};
