import { DEFAULT_BINANCE_LIMIT } from "../config/constants";
import { logger } from "./logger";

export type BinanceClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
};

export type BinanceKline = {
  openTime: number;
  closeTime: number;
  close: number;
};

const jitter = (base: number) => Math.random() * base;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const buildKlinesUrl = (
  baseUrl: string,
  symbol: string,
  interval: string,
  limit = DEFAULT_BINANCE_LIMIT
): URL => {
  const url = new URL("/api/v3/klines", baseUrl);
  url.searchParams.set("symbol", symbol.toUpperCase());
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  return url;
};

export const fetchRecentKlines = async (
  symbol: string,
  interval: string,
  options: BinanceClientOptions
): Promise<BinanceKline[]> => {
  const url = buildKlinesUrl(options.baseUrl, symbol, interval);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
      });
      console.log("🚀 ~ fetchRecentKlines ~ response:", JSON.stringify(response.body));

      if (!response.ok) {
        lastError = new Error(
          `Binance API responded with status ${response.status}`
        );
        logger.warn("binance_fetch_non_ok", {
          symbol,
          interval,
          status: response.status,
          attempt,
        });
      } else {
        const body = (await response.json()) as unknown;
        if (!Array.isArray(body)) {
          throw new Error("Unexpected Binance response shape");
        }
        const parsed = body.map((entry) => {
          if (!Array.isArray(entry) || entry.length < 7) {
            throw new Error("Malformed kline entry");
          }
          return {
            openTime: Number(entry[0]),
            closeTime: Number(entry[6]),
            close: Number(entry[4]),
          };
        });
        return parsed;
      }
      return [{ openTime: 0, closeTime: 0, close: 0 }];
    } catch (error) {
      lastError = error;
      logger.warn("binance_fetch_error", {
        symbol,
        interval,
        attempt,
        error: `${error}`,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < options.maxRetries) {
      const waitMs =
        options.backoffBaseMs * Math.pow(2, attempt - 1) +
        jitter(options.backoffBaseMs);
      await delay(waitMs);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch Binance klines after retries");
};
