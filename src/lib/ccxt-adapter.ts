import { logger } from './logger';

export type EnhancedClientOptions = {
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
};

export type EnhancedKline = {
  openTime: number;
  closeTime: number;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
};

const jitter = (base: number) => Math.random() * base;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


/**
 * 构建增强的 Binance API URL
 */
export const buildEnhancedKlinesUrl = (
  baseUrl: string,
  symbol: string,
  interval: string,
  limit = 2
): URL => {
  const url = new URL("/api/v3/klines", baseUrl);
  url.searchParams.set("symbol", symbol.toUpperCase());
  url.searchParams.set("interval", interval);
  url.searchParams.set("limit", String(limit));
  return url;
};

/**
 * 将 Binance K线数据转换为增强的 Kline 格式
 */
export const convertToEnhancedKline = (entry: unknown[]): EnhancedKline => {
  if (!Array.isArray(entry) || entry.length < 7) {
    throw new Error("Malformed kline entry");
  }

  return {
    openTime: Number(entry[0]),
    open: Number(entry[1]),
    high: Number(entry[2]),
    low: Number(entry[3]),
    close: Number(entry[4]),
    volume: Number(entry[5]),
    closeTime: Number(entry[6]),
  };
};

/**
 * 获取增强的 K 线数据（直接使用 Binance API，模仿 CCXT 接口）
 */
export const fetchEnhancedKlines = async (
  symbol: string,
  interval: string,
  options: EnhancedClientOptions,
  limit = 2
): Promise<EnhancedKline[]> => {
  const baseUrl = "https://api.binance.com";
  const url = buildEnhancedKlinesUrl(baseUrl, symbol, interval, limit);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      logger.info("enhanced_fetch_attempt", {
        symbol,
        interval,
        limit,
        attempt,
        url: url.toString(),
      });

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Binance API responded with status ${response.status}`);
      }

      const body = await response.json();

      if (!Array.isArray(body)) {
        throw new Error("Unexpected Binance response shape");
      }

      const klines = body.map(convertToEnhancedKline);

      logger.info("enhanced_fetch_success", {
        symbol,
        interval,
        count: klines.length,
        firstTime: klines[0].openTime,
        lastTime: klines[klines.length - 1].closeTime,
      });

      return klines;

    } catch (error) {
      lastError = error;
      logger.warn("enhanced_fetch_error", {
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

      logger.info("enhanced_retry_wait", { waitMs, attempt });
      await delay(waitMs);
    }
  }

  logger.error("enhanced_fetch_failed", {
    symbol,
    interval,
    attempts: attempt,
    lastError: `${lastError}`,
  });

  throw lastError instanceof Error
    ? lastError
    : new Error(`Failed to fetch enhanced klines for ${symbol} after ${options.maxRetries} retries`);
};

/**
 * 获取交易对的最新价格（用于验证）
 */
export const fetchTickerPrice = async (
  symbol: string,
  options: EnhancedClientOptions
): Promise<number> => {
  const baseUrl = "https://api.binance.com";
  const url = new URL("/api/v3/ticker/price", baseUrl);
  url.searchParams.set("symbol", symbol.toUpperCase());

  try {
    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`Ticker API responded with status ${response.status}`);
    }

    const ticker = await response.json() as { price?: number };
    return ticker.price || 0;
  } catch (error) {
    logger.error("ticker_error", {
      symbol,
      error: `${error}`,
    });
    throw error;
  }
};