import { logger } from "./logger";

export type KrakenClientOptions = {
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  backoffBaseMs: number;
};

export type KrakenOHLC = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// Kraken symbol mapping: BTCUSDT -> XBTUSDT
const mapSymbolToKraken = (symbol: string): string => {
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

  return symbolMap[symbol.toUpperCase()] || symbol.toUpperCase();
};

// Map interval from our format to Kraken's format
const mapIntervalToKraken = (interval: string): string => {
  const intervalMap: Record<string, string> = {
    '1m': '1',
    '3m': '3',
    '5m': '5',
    '15m': '15',
    '30m': '30',
    '1h': '60',
    '4h': '240',
    '1d': '1440',
  };

  return intervalMap[interval] || '5'; // Default to 5 minutes
};

const jitter = (base: number) => Math.random() * base;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const buildKrakenOHLCUrl = (
  baseUrl: string,
  symbol: string,
  interval: string,
  since?: number
): URL => {
  const url = new URL("/0/public/OHLC", baseUrl);
  const krakenSymbol = mapSymbolToKraken(symbol);
  const krakenInterval = mapIntervalToKraken(interval);

  url.searchParams.set("pair", krakenSymbol);
  url.searchParams.set("interval", krakenInterval);
  if (since) {
    url.searchParams.set("since", String(since));
  }
  return url;
};

export const fetchKrakenOHLC = async (
  symbol: string,
  interval: string,
  options: KrakenClientOptions,
  count = 2
): Promise<KrakenOHLC[]> => {
  const url = buildKrakenOHLCUrl(options.baseUrl, symbol, interval);

  let attempt = 0;
  let lastError: unknown;

  while (attempt < options.maxRetries) {
    attempt += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      logger.info("kraken_fetch_attempt", {
        symbol,
        interval,
        attempt,
        url: url.toString(),
      });

      const response = await fetch(url.toString(), {
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "User-Agent": "Market-Alert/1.0",
        },
      });

      if (!response.ok) {
        throw new Error(
          `Kraken API responded with status ${response.status}: ${response.statusText}`
        );
      }

      const body = await response.json() as any;

      if (body.error && body.error.length > 0) {
        throw new Error(`Kraken API error: ${body.error.join(', ')}`);
      }

      if (!body.result) {
        throw new Error("Invalid Kraken response format");
      }

      // Kraken returns data as { "pair": [[timestamp, open, high, low, close, vwap, volume, count, ...]] }
      const pairs = Object.keys(body.result);
      if (pairs.length === 0) {
        throw new Error("No trading pair data in Kraken response");
      }

      const pairData = body.result[pairs[0]];
      if (!Array.isArray(pairData)) {
        throw new Error("Invalid OHLC data format from Kraken");
      }

      // Take the most recent 'count' entries (they are in chronological order)
      const recentData = pairData.slice(-count);

      const parsed: KrakenOHLC[] = recentData.map((entry: any[]) => {
        if (!Array.isArray(entry) || entry.length < 8) {
          throw new Error("Malformed Kraken OHLC entry");
        }

        return {
          time: Math.floor(Number(entry[0]) / 1000), // Convert milliseconds to seconds
          open: Number(entry[1]),
          high: Number(entry[2]),
          low: Number(entry[3]),
          close: Number(entry[4]),
          volume: Number(entry[6]), // Volume is at index 6
        };
      });

      logger.info("kraken_fetch_success", {
        symbol,
        interval,
        dataPoints: parsed.length,
        latestTime: parsed[parsed.length - 1]?.time,
      });

      return parsed;

    } catch (error) {
      lastError = error;
      logger.warn("kraken_fetch_error", {
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
    : new Error(`Failed to fetch Kraken OHLC data for ${symbol} after retries`);
};

// Function to convert Kraken OHLC data to our existing EnhancedKline format
export const krakenToEnhancedKline = (krakenOHLC: KrakenOHLC) => {
  return {
    timestamp: krakenOHLC.time * 1000, // Convert to milliseconds
    open: krakenOHLC.open,
    high: krakenOHLC.high,
    low: krakenOHLC.low,
    close: krakenOHLC.close,
    volume: krakenOHLC.volume,
  };
};