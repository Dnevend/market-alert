import { hmacSha256Hex } from "./crypto";
import { logger } from "./logger";

export type WebhookPayload = Record<string, unknown>;

export type WebhookOptions = {
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
};

export type WebhookResult = {
  success: boolean;
  status?: number;
  body?: string;
  attempts: number;
  error?: string;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const shouldRetry = (status?: number, error?: unknown): boolean => {
  if (error) {
    return true;
  }
  if (!status) {
    return false;
  }
  return status >= 500;
};

export const sendWebhook = async (
  url: string,
  payload: WebhookPayload,
  secret: string,
  options: WebhookOptions,
): Promise<WebhookResult> => {
  const body = JSON.stringify(payload);
  const signature = await hmacSha256Hex(secret, body);

  let attempt = 0;
  let lastError: unknown;
  let lastStatus: number | undefined;
  let lastBody: string | undefined;

  while (attempt < options.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-signature": signature,
        },
        body,
        signal: controller.signal,
      });

      lastStatus = response.status;
      lastBody = await response.text();

      if (response.ok) {
        return {
          success: true,
          status: response.status,
          body: lastBody,
          attempts: attempt,
        };
      }

      lastError = new Error(`Webhook responded with status ${response.status}`);
      logger.warn("webhook_non_ok", { url, status: response.status, attempt });
    } catch (error) {
      lastError = error;
      logger.error("webhook_error", { url, attempt, error: `${error}` });
    } finally {
      clearTimeout(timeoutId);
    }

    if (attempt < options.maxRetries && shouldRetry(lastStatus, lastError)) {
      const waitMs =
        options.backoffBaseMs * Math.pow(2, attempt - 1) +
        Math.random() * Math.max(50, options.backoffBaseMs / 2);
      await delay(waitMs);
    } else {
      break;
    }
  }

  return {
    success: false,
    status: lastStatus,
    body: lastBody,
    attempts: attempt,
    error: lastError instanceof Error ? lastError.message : "Unknown error",
  };
};
