import { logger } from './logger';
import * as userAgent from 'fake-useragent';
import { fetchKrakenOHLC, krakenToEnhancedKline, type KrakenClientOptions } from './kraken';

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
 * 生成真实的 User-Agent 字符串
 */
const generateRealisticUserAgent = (): string => {
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36 Edg/118.0.2088.76'
  ];

  return userAgents[Math.floor(Math.random() * userAgents.length)];
};

/**
 * 生成随机请求头来模拟真实浏览器
 */
const generateRealisticHeaders = (): Record<string, string> => {
  return {
    'User-Agent': generateRealisticUserAgent(),
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'cross-site',
    'Sec-Ch-Ua': '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"'
  };
};


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
 * 获取增强的 K 线数据（使用 Kraken API，替换原来的 Binance API）
 */
export const fetchEnhancedKlines = async (
  symbol: string,
  interval: string,
  options: EnhancedClientOptions,
  limit = 2,
  baseUrl?: string,
  useMockData?: boolean
): Promise<EnhancedKline[]> => {
  // 使用传入的 baseUrl 或默认 Kraken URL
  const defaultBaseUrl = baseUrl || "https://api.kraken.com";

  // CORS 代理备用方案
  const proxyUrls = [
    "https://corsproxy.io/?",
    "https://api.allorigins.win/raw?url="
  ];

  let useProxy = false;
  // 开发环境检查：如果设置了 useMockData 或者 URL 包含 mock，使用模拟数据
  if (useMockData || defaultBaseUrl.includes('mock')) {
    logger.info("enhanced_fetch_mock", { symbol, interval, limit, exchange: "kraken" });

    // 生成模拟数据
    const now = Date.now();
    const mockKlines: EnhancedKline[] = [];

    for (let i = limit - 1; i >= 0; i--) {
      const timestamp = now - (i * 5 * 60 * 1000);
      const basePrice = symbol.includes('BTC') ? 108000 : symbol.includes('ETH') ? 3800 : 100;
      const randomChange = (Math.random() - 0.5) * 0.002;
      const price = basePrice * (1 + randomChange);

      mockKlines.push({
        openTime: timestamp - 300000,
        closeTime: timestamp,
        open: Number((price * (1 + Math.random() * 0.001)).toFixed(2)),
        high: Number((price * (1 + Math.random() * 0.002)).toFixed(2)),
        low: Number((price * (1 - Math.random() * 0.002)).toFixed(2)),
        close: Number(price.toFixed(2)),
        volume: Number((Math.random() * 1000).toFixed(2)),
      });
    }

    return mockKlines;
  }

  try {
    logger.info("kraken_fetch_start", { symbol, interval, limit, baseUrl: defaultBaseUrl });

    const krakenOptions: KrakenClientOptions = {
      baseUrl: defaultBaseUrl,
      timeoutMs: options.timeoutMs,
      maxRetries: options.maxRetries,
      backoffBaseMs: options.backoffBaseMs,
    };

    const krakenOHLC = await fetchKrakenOHLC(symbol, interval, krakenOptions, limit);

    const enhancedKlines = krakenOHLC.map((krakenData) => {
      const enhancedKline = krakenToEnhancedKline(krakenData);
      return {
        openTime: enhancedKline.timestamp,
        closeTime: enhancedKline.timestamp + (mapIntervalToMs(interval) - 1), // Approximate close time
        open: enhancedKline.open,
        high: enhancedKline.high,
        low: enhancedKline.low,
        close: enhancedKline.close,
        volume: enhancedKline.volume,
      };
    });

    logger.info("kraken_fetch_success", {
      symbol,
      interval,
      count: enhancedKlines.length,
      firstTime: enhancedKlines[0]?.openTime,
      lastTime: enhancedKlines[enhancedKlines.length - 1]?.closeTime,
    });

    return enhancedKlines;

  } catch (error) {
    logger.error("kraken_fetch_error", {
      symbol,
      interval,
      error: `${error}`,
    });

    // 不再降级到模拟数据，直接抛出错误
    throw error instanceof Error
      ? error
      : new Error(`Failed to fetch Kraken OHLC data for ${symbol}`);
  }
};

// 辅助函数：将 interval 字符串转换为毫秒数
const mapIntervalToMs = (interval: string): number => {
  const intervalMap: Record<string, number> = {
    '1m': 1 * 60 * 1000,
    '3m': 3 * 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '30m': 30 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };
  return intervalMap[interval] || 5 * 60 * 1000; // 默认 5 分钟
};

/**
 * 获取交易对的最新价格（使用 Kraken Ticker API）
 */
export const fetchTickerPrice = async (
  symbol: string,
  options: EnhancedClientOptions
): Promise<number> => {
  const baseUrl = "https://api.kraken.com";
  const url = new URL("/0/public/Ticker", baseUrl);

  // Kraken symbol mapping
  const symbolMap: Record<string, string> = {
    'BTCUSDT': 'XBTUSDT',
    'ETHUSDT': 'ETHUSDT',
    'ADAUSDT': 'ADAUSDT',
    'SOLUSDT': 'SOLUSDT',
    'DOTUSDT': 'DOTUSDT',
    'LINKUSDT': 'LINKUSDT',
    'MATICUSDT': 'MATICUSDT',
    'AVAXUSDT': 'AVAXUSDT',
  };

  const krakenSymbol = symbolMap[symbol.toUpperCase()] || symbol.toUpperCase();
  url.searchParams.set("pair", krakenSymbol);

  try {
    logger.info("kraken_ticker_fetch", { symbol, krakenSymbol });

    const response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(options.timeoutMs),
      headers: {
        "User-Agent": "Market-Alert/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`Kraken Ticker API responded with status ${response.status}`);
    }

    const tickerData = await response.json() as any;

    if (tickerData.error && tickerData.error.length > 0) {
      throw new Error(`Kraken Ticker API error: ${tickerData.error.join(', ')}`);
    }

    if (!tickerData.result) {
      throw new Error("Invalid Kraken ticker response format");
    }

    // Extract the price from the first trading pair
    const pairs = Object.keys(tickerData.result);
    if (pairs.length === 0) {
      throw new Error("No trading pair data in Kraken ticker response");
    }

    const pairData = tickerData.result[pairs[0]];
    if (!pairData || !pairData.c || !Array.isArray(pairData.c) || pairData.c.length === 0) {
      throw new Error("Invalid price data format from Kraken ticker");
    }

    const price = Number(pairData.c[0]); // c[0] is the current price

    logger.info("kraken_ticker_success", {
      symbol,
      krakenSymbol,
      price,
    });

    return price || 0;
  } catch (error) {
    logger.error("kraken_ticker_error", {
      symbol,
      error: `${error}`,
    });
    throw error;
  }
};