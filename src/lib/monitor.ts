import {
  ALERT_SOURCE,
  DEFAULT_COOLDOWN_MINUTES,
  DEFAULT_THRESHOLD_PERCENT,
  DEFAULT_WINDOW_INTERVAL,
  DEFAULT_WINDOW_MINUTES,
} from "../config/constants";
import type { CloudflareBindings } from "../config/env";
import { loadEnv } from "../config/env";
import {
  fetchEnhancedKlines,
  type EnhancedClientOptions,
  type EnhancedKline,
} from "./ccxt-adapter";
import {
  calculatePercentChange,
  generateIdempotencyKey,
  getDirection,
  isWithinCooldown,
  shouldTriggerAlert,
  createEnhancedPriceWindow,
  shouldTriggerAlertWithIndicators,
  type EnhancedPriceWindow,
} from "./compute-enhanced";
import { logger } from "./logger";
import {
  findAlertByIdempotency,
  getEnabledSymbols,
  getLatestAlertForSymbol,
  getSettings,
  getSymbol,
  recordAlert,
  type AlertStatus,
  type SymbolRecord,
} from "../db/repo";
import { sendWebhook } from "./webhook";

export type MonitorOptions = {
  symbols?: string[];
  useTechnicalIndicators?: boolean;
  indicatorFilters?: {
    minVolumeChange?: number;
    rsiRange?: [number, number];
    useBollingerBands?: boolean;
    rsiThreshold?: number;
  };
};

export type MonitorResult = {
  symbol: string;
  status: AlertStatus;
  triggered: boolean;
  changePercent?: number;
  windowEnd?: number;
  reason?: string;
};

const normalizeSymbol = (value: string) => value.toUpperCase();

const resolveSymbols = async (
  bindings: CloudflareBindings,
  requested?: string[],
): Promise<{ symbols: SymbolRecord[]; skipped: MonitorResult[] }> => {
  if (!requested || requested.length === 0) {
    const enabled = await getEnabledSymbols(bindings.DB);
    return {
      symbols: enabled,
      skipped: [],
    };
  }

  const unique = Array.from(new Set(requested.map(normalizeSymbol)));
  const found: SymbolRecord[] = [];
  const skipped: MonitorResult[] = [];

  for (const symbol of unique) {
    const record = await getSymbol(bindings.DB, symbol);
    if (!record) {
      skipped.push({
        symbol,
        status: "SKIPPED",
        triggered: false,
        reason: "symbol_not_found",
      });
      continue;
    }
    if (record.enabled !== 1) {
      skipped.push({
        symbol,
        status: "SKIPPED",
        triggered: false,
        reason: "symbol_disabled",
      });
      continue;
    }
    found.push(record);
  }

  return { symbols: found, skipped };
};

const mapWindowToInterval = (windowMinutes: number): string => {
  const mapping: Record<number, string> = {
    1: "1m",
    3: "3m",
    5: "5m",
    15: "15m",
    30: "30m",
    60: "1h",
  };
  return mapping[windowMinutes] ?? DEFAULT_WINDOW_INTERVAL;
};

export const runMonitor = async (
  bindings: CloudflareBindings,
  options: MonitorOptions = {},
): Promise<MonitorResult[]> => {
  const env = loadEnv(bindings);
  const settings = await getSettings(bindings.DB);
  const windowMinutes = settings?.window_minutes ?? DEFAULT_WINDOW_MINUTES;
  const interval = mapWindowToInterval(windowMinutes);
  const thresholdDefault = settings?.default_threshold_percent ?? DEFAULT_THRESHOLD_PERCENT;
  const cooldownDefault = settings?.default_cooldown_minutes ?? DEFAULT_COOLDOWN_MINUTES;

  // 默认启用技术指标，但可以通过选项禁用
  const useTechnicalIndicators = options.useTechnicalIndicators !== false;
  const indicatorFilters = {
    minVolumeChange: 0.2,
    rsiRange: [20, 80] as [number, number],
    useBollingerBands: true,
    ...options.indicatorFilters,
  };

  const { symbols, skipped } = await resolveSymbols(bindings, options.symbols);

  const clientOptions: EnhancedClientOptions = {
    timeoutMs: env.httpTimeoutMs,
    maxRetries: env.maxRetries,
    backoffBaseMs: env.retryBackoffBaseMs,
  };

  const results: MonitorResult[] = [...skipped];

  for (const symbol of symbols) {
    const symbolValue = normalizeSymbol(symbol.symbol);
    const thresholdPercent = symbol.threshold_percent ?? thresholdDefault;
    const cooldownMinutes = symbol.cooldown_minutes ?? cooldownDefault;
    const webhookUrl = symbol.webhook_url ?? env.webhookDefaultUrl;

    try {
      // 根据是否使用技术指标决定获取多少K线数据
      const klineCount = useTechnicalIndicators ? 25 : 2; // 技术指标需要更多历史数据
      const klines = await fetchEnhancedKlines(symbolValue, interval, clientOptions, klineCount);

      let shouldTrigger: boolean;
      let enhancedWindow: EnhancedPriceWindow | null = null;
      let changePercent: number;

      if (useTechnicalIndicators) {
        enhancedWindow = createEnhancedPriceWindow(klines);

        if (!enhancedWindow) {
          results.push({
            symbol: symbolValue,
            status: "SKIPPED",
            triggered: false,
            reason: "insufficient_data",
          });
          continue;
        }

        changePercent = enhancedWindow.priceChangePercent;
        shouldTrigger = shouldTriggerAlertWithIndicators(enhancedWindow, thresholdPercent, indicatorFilters);
      } else {
        // 简单模式：只使用基础价格变化计算
        const { enhancedKlinesToPriceWindow } = await import("./compute-enhanced");
        const simpleWindow = enhancedKlinesToPriceWindow(klines);

        if (!simpleWindow) {
          results.push({
            symbol: symbolValue,
            status: "SKIPPED",
            triggered: false,
            reason: "insufficient_data",
          });
          continue;
        }

        changePercent = simpleWindow.priceChangePercent;
        shouldTrigger = shouldTriggerAlert(changePercent, thresholdPercent);

        // 为兼容性创建简化的 enhancedWindow
        enhancedWindow = {
          ...simpleWindow,
          indicators: undefined,
        };
      }

      if (!shouldTrigger) {
        const reason = useTechnicalIndicators ? "below_threshold_or_filters" : "below_threshold";
        results.push({
          symbol: symbolValue,
          status: "SKIPPED",
          triggered: false,
          changePercent,
          windowEnd: enhancedWindow!.windowEnd,
          reason,
        });
        continue;
      }

      const direction = getDirection(changePercent);

      const idempotencyKey = await generateIdempotencyKey(
        symbolValue,
        enhancedWindow.windowEnd,
        thresholdPercent,
      );

      const existing = await findAlertByIdempotency(bindings.DB, idempotencyKey);
      if (existing) {
        results.push({
          symbol: symbolValue,
          status: existing.status,
          triggered: existing.status === "SENT",
          changePercent: existing.change_percent,
          windowEnd: existing.window_end,
          reason: "duplicate",
        });
        continue;
      }

      const latestAlert = await getLatestAlertForSymbol(bindings.DB, symbolValue);
      if (
        latestAlert &&
        isWithinCooldown(latestAlert.window_end, enhancedWindow.windowEnd, cooldownMinutes)
      ) {
        await recordAlert(bindings.DB, {
          symbol: symbolValue,
          changePercent,
          direction,
          windowStart: enhancedWindow.windowStart,
          windowEnd: enhancedWindow.windowEnd,
          idempotencyKey,
          status: "SKIPPED",
          responseCode: null,
          responseBody: "cooldown_active",
        });
        results.push({
          symbol: symbolValue,
          status: "SKIPPED",
          triggered: false,
          changePercent,
          windowEnd: enhancedWindow.windowEnd,
          reason: "cooldown_active",
        });
        continue;
      }

      // 根据是否使用技术指标生成不同格式的 payload
      const basePayload = {
        symbol: symbolValue,
        change_percent: changePercent,
        direction,
        window_minutes: windowMinutes,
        window_start: enhancedWindow!.windowStart,
        window_end: enhancedWindow!.windowEnd,
        observed_at: Date.now(),
        source: ALERT_SOURCE,
        links: {
          binance: `https://www.binance.com/en/trade/${symbolValue}`,
          tradingview: `https://www.tradingview.com/chart/?symbol=BINANCE:${symbolValue}`,
        },
      };

      const payload = useTechnicalIndicators ? {
        ...basePayload,
        price_data: {
          open: enhancedWindow!.open,
          high: enhancedWindow!.high,
          low: enhancedWindow!.low,
          close: enhancedWindow!.currentClose,
          volume: enhancedWindow!.volume,
          price_change: enhancedWindow!.priceChange,
        },
        technical_indicators: enhancedWindow!.indicators,
        filters: indicatorFilters,
      } : {
        ...basePayload,
        price_data: {
          open: enhancedWindow!.open,
          high: enhancedWindow!.high,
          low: enhancedWindow!.low,
          close: enhancedWindow!.currentClose,
          volume: enhancedWindow!.volume,
          price_change: enhancedWindow!.priceChange,
        },
      };

      // 根据模式记录不同级别的日志
      if (useTechnicalIndicators) {
        logger.info("monitor_alert_triggering_with_indicators", {
          symbol: symbolValue,
          changePercent: `${(changePercent * 100).toFixed(2)}%`,
          direction,
          rsi: enhancedWindow!.indicators?.rsi,
          bollingerBands: enhancedWindow!.indicators?.bollingerBands,
          volumeChange: enhancedWindow!.indicators?.volumeChange,
          sma: enhancedWindow!.indicators?.sma,
          ema: enhancedWindow!.indicators?.ema,
        });
      } else {
        logger.info("monitor_alert_triggering_simple", {
          symbol: symbolValue,
          changePercent: `${(changePercent * 100).toFixed(2)}%`,
          direction,
        });
      }

      const webhookResult = await sendWebhook(webhookUrl, payload, env.webhookHmacSecret, {
        timeoutMs: env.httpTimeoutMs,
        maxRetries: env.maxRetries,
        backoffBaseMs: env.retryBackoffBaseMs,
      });

      const status: AlertStatus = webhookResult.success ? "SENT" : "FAILED";

      await recordAlert(bindings.DB, {
        symbol: symbolValue,
        changePercent,
        direction,
        windowStart: enhancedWindow.windowStart,
        windowEnd: enhancedWindow.windowEnd,
        idempotencyKey,
        status,
        responseCode: webhookResult.status ?? null,
        responseBody: webhookResult.body ?? webhookResult.error ?? null,
      });

      results.push({
        symbol: symbolValue,
        status,
        triggered: webhookResult.success,
        changePercent,
        windowEnd: enhancedWindow.windowEnd,
        reason: webhookResult.success ? undefined : "webhook_failed",
      });
    } catch (error) {
      logger.error("monitor_symbol_failed", {
        symbol: symbolValue,
        error: `${error}`,
      });
      results.push({
        symbol: symbolValue,
        status: "FAILED",
        triggered: false,
        reason: "enhanced_fetch_error",
      });
    }
  }

  return results;
};
