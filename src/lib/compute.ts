import { sha256Hex } from "./crypto";

export type AlertDirection = "UP" | "DOWN";

export type PriceWindow = {
  previousClose: number;
  currentClose: number;
  windowStart: number;
  windowEnd: number;
};

export const calculatePercentChange = (previous: number, current: number): number => {
  if (previous === 0) {
    return 0;
  }
  return (current - previous) / previous;
};

export const getDirection = (changePercent: number): AlertDirection =>
  changePercent >= 0 ? "UP" : "DOWN";

export const shouldTriggerAlert = (changePercent: number, thresholdPercent: number): boolean =>
  Math.abs(changePercent) >= Math.abs(thresholdPercent);

export const isWithinCooldown = (
  lastWindowEnd: number | null,
  nextWindowEnd: number,
  cooldownMinutes: number,
): boolean => {
  if (!lastWindowEnd) {
    return false;
  }
  const cooldownMs = cooldownMinutes * 60 * 1000;
  return nextWindowEnd - lastWindowEnd < cooldownMs;
};

export const toPriceWindow = (candles: Array<{ openTime: number; closeTime: number; close: number }>): PriceWindow | null => {
  if (candles.length < 2) {
    return null;
  }
  const previous = candles[candles.length - 2];
  const current = candles[candles.length - 1];

  return {
    previousClose: previous.close,
    currentClose: current.close,
    windowStart: current.openTime,
    windowEnd: current.closeTime,
  };
};

export const generateIdempotencyKey = async (
  symbol: string,
  windowEnd: number,
  thresholdPercent: number,
): Promise<string> => sha256Hex(`${symbol}:${windowEnd}:${thresholdPercent}`);
