import { describe, expect, it } from "vitest";
import {
  calculatePercentChange,
  generateIdempotencyKey,
  isWithinCooldown,
  shouldTriggerAlert,
} from "../lib/compute";

describe("compute utilities", () => {
  it("calculates percent change correctly", () => {
    const change = calculatePercentChange(100, 105);
    expect(change).toBeCloseTo(0.05, 5);
  });

  it("detects threshold breaches", () => {
    expect(shouldTriggerAlert(0.025, 0.02)).toBe(true);
    expect(shouldTriggerAlert(0.015, 0.02)).toBe(false);
  });

  it("evaluates cooldown windows", () => {
    const base = Date.now();
    const tenMinutesMs = 10 * 60 * 1000;
    expect(isWithinCooldown(base, base + tenMinutesMs - 1000, 10)).toBe(true);
    expect(isWithinCooldown(base, base + tenMinutesMs + 1000, 10)).toBe(false);
  });

  it("generates deterministic idempotency keys", async () => {
    const keyA = await generateIdempotencyKey("BTCUSDT", 12345, 0.02);
    const keyB = await generateIdempotencyKey("BTCUSDT", 12345, 0.02);
    expect(keyA).toBe(keyB);
  });
});
