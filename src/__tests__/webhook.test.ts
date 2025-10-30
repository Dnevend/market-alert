import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hmacSha256Hex } from "../lib/crypto";
import { sendWebhook } from "../lib/webhook";

const webhookOptions = {
  timeoutMs: 50,
  maxRetries: 2,
  backoffBaseMs: 10,
};

describe("webhook sender", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signs payloads with HMAC headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve("ok"),
    });
    vi.stubGlobal("fetch", fetchMock);

    const payload = { symbol: "BTCUSDT", change_percent: 0.021 };
    const secret = "super-secret-key";

    const result = await sendWebhook("https://example.com/webhook", payload, secret, webhookOptions);

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const call = fetchMock.mock.calls[0];
    const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
    const signature = headers["x-signature"];
    const expectedSignature = await hmacSha256Hex(secret, JSON.stringify(payload));
    expect(signature).toBe(expectedSignature);
  });

  it("retries on server errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 502,
        text: () => Promise.resolve("upstream error"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve("ok"),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWebhook("https://example.com/webhook", { ok: true }, "secret", {
      timeoutMs: 20,
      maxRetries: 2,
      backoffBaseMs: 5,
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns failure when retries exhausted", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("boom"),
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWebhook("https://example.com/webhook", { ok: false }, "secret", {
      timeoutMs: 20,
      maxRetries: 2,
      backoffBaseMs: 5,
    });

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
