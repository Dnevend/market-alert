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
  buildKlinesUrl,
  fetchRecentKlines,
  type BinanceClientOptions,
} from "./binance";
import {
  calculatePercentChange,
  generateIdempotencyKey,
  getDirection,
  isWithinCooldown,
  shouldTriggerAlert,
  toPriceWindow,
} from "./compute";
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
  const binanceBaseUrl =
    bindings.BINANCE_BASE_URL ?? settings?.binance_base_url ?? env.binanceBaseUrl;

  const { symbols, skipped } = await resolveSymbols(bindings, options.symbols);

  const clientOptions: BinanceClientOptions = {
    baseUrl: binanceBaseUrl,
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

    const klinesUrl = buildKlinesUrl(clientOptions.baseUrl, symbolValue, interval);

    try {
      const candles = await fetchRecentKlines(symbolValue, interval, clientOptions);
      const window = toPriceWindow(
        candles.map((candle) => ({
          openTime: candle.openTime,
          closeTime: candle.closeTime,
          close: candle.close,
        })),
      );

      if (!window) {
        results.push({
          symbol: symbolValue,
          status: "SKIPPED",
          triggered: false,
          reason: "insufficient_data",
        });
        continue;
      }

      const changePercent = calculatePercentChange(window.previousClose, window.currentClose);
      if (!shouldTriggerAlert(changePercent, thresholdPercent)) {
        results.push({
          symbol: symbolValue,
          status: "SKIPPED",
          triggered: false,
          changePercent,
          windowEnd: window.windowEnd,
          reason: "below_threshold",
        });
        continue;
      }

      const direction = getDirection(changePercent);

      const idempotencyKey = await generateIdempotencyKey(
        symbolValue,
        window.windowEnd,
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
        isWithinCooldown(latestAlert.window_end, window.windowEnd, cooldownMinutes)
      ) {
        await recordAlert(bindings.DB, {
          symbol: symbolValue,
          changePercent,
          direction,
          windowStart: window.windowStart,
          windowEnd: window.windowEnd,
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
          windowEnd: window.windowEnd,
          reason: "cooldown_active",
        });
        continue;
      }

      const payload = {
        symbol: symbolValue,
        change_percent: changePercent,
        direction,
        window_minutes: windowMinutes,
        window_start: window.windowStart,
        window_end: window.windowEnd,
        observed_at: Date.now(),
        source: ALERT_SOURCE,
        links: {
          kline_api: klinesUrl.toString(),
        },
      };

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
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
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
        windowEnd: window.windowEnd,
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
        reason: "binance_error",
      });
    }
  }

  return results;
};
