// CoinGecko API 适配器 - 作为 Binance API 的备用方案
import type { EnhancedClientOptions, EnhancedKline } from './ccxt-adapter';
import { logger } from './logger';

/**
 * 从 CoinGecko 获取 OHLC 数据（类似 K 线）
 */
export const fetchCoinGeckoOHLC = async (
  coinId: string,
  vsCurrency: string = 'usd',
  days: number = 1,
  options: EnhancedClientOptions
): Promise<EnhancedKline[]> => {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=${vsCurrency}&days=${days}`;

  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      logger.info("coingecko_fetch_attempt", {
        coinId,
        vsCurrency,
        days,
        attempt,
        url,
      });

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; market-alert/1.0)",
        },
      });

      if (!response.ok) {
        throw new Error(`CoinGecko API responded with status ${response.status}`);
      }

      const body = await response.json();

      if (!Array.isArray(body)) {
        throw new Error("Unexpected CoinGecko response shape");
      }

      // CoinGecko OHLC 格式: [timestamp, open, high, low, close]
      const klines: EnhancedKline[] = body.map((entry: number[], index: number) => {
        const [timestamp, open, high, low, close] = entry;
        const closeTime = timestamp + 300000; // 5分钟间隔

        return {
          openTime: timestamp,
          closeTime: closeTime,
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: 0, // CoinGecko OHLC 不包含成交量
        };
      });

      // 只返回最新的几条数据
      const recentKlines = klines.slice(-2);

      logger.info("coingecko_fetch_success", {
        coinId,
        count: recentKlines.length,
        firstTime: recentKlines[0]?.openTime,
        lastTime: recentKlines[recentKlines.length - 1]?.closeTime,
      });

      return recentKlines;

    } catch (error) {
      lastError = error;
      logger.warn("coingecko_fetch_error", {
        coinId,
        attempt,
        error: `${error}`,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < options.maxRetries) {
      const waitMs =
        options.backoffBaseMs * Math.pow(2, attempt - 1) +
        Math.random() * Math.max(50, options.backoffBaseMs / 2);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  logger.error("coingecko_fetch_failed", {
    coinId,
    attempts: attempt,
    lastError: `${lastError}`,
  });

  throw lastError instanceof Error ? lastError : new Error("Unknown CoinGecko fetch error");
};

/**
 * 将币种符号映射到 CoinGecko ID
 */
export const symbolToCoinGeckoId = (symbol: string): string => {
  const mappings: Record<string, string> = {
    'BTCUSDT': 'bitcoin',
    'ETHUSDT': 'ethereum',
    'ADAUSDT': 'cardano',
    'SOLUSDT': 'solana',
    'DOTUSDT': 'polkadot-new',
    'MATICUSDT': 'matic-network',
    'LINKUSDT': 'chainlink',
    'UNIUSDT': 'uniswap',
    'LTCUSDT': 'litecoin',
    'AVAXUSDT': 'avalanche-2',
  };

  return mappings[symbol.toUpperCase()] || symbol.toLowerCase();
};