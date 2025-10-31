import { sha256Hex } from "./crypto";
import type { EnhancedKline } from "./ccxt-adapter";

export type AlertDirection = "UP" | "DOWN";

export type PriceWindow = {
  previousClose: number;
  currentClose: number;
  windowStart: number;
  windowEnd: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  priceChange: number;
  priceChangePercent: number;
};

export type TechnicalIndicators = {
  rsi?: number;
  macd?: {
    line: number;
    signal: number;
    histogram: number;
  };
  bollingerBands?: {
    upper: number;
    middle: number;
    lower: number;
  };
  sma?: number[];
  ema?: number[];
  volumeChange?: number;
};

export type EnhancedPriceWindow = PriceWindow & {
  indicators?: TechnicalIndicators;
};

/**
 * 计算百分比变化
 */
export const calculatePercentChange = (previous: number, current: number): number => {
  if (previous === 0) {
    return 0;
  }
  return (current - previous) / previous;
};

/**
 * 获取变化方向
 */
export const getDirection = (changePercent: number): AlertDirection =>
  changePercent >= 0 ? "UP" : "DOWN";

/**
 * 判断是否应该触发警报
 */
export const shouldTriggerAlert = (changePercent: number, thresholdPercent: number): boolean =>
  Math.abs(changePercent) >= Math.abs(thresholdPercent);

/**
 * 检查是否在冷却期内
 */
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

/**
 * 将增强的 K线数据转换为价格窗口
 */
export const enhancedKlinesToPriceWindow = (klines: EnhancedKline[]): PriceWindow | null => {
  if (klines.length < 2) {
    return null;
  }

  const previous = klines[klines.length - 2];
  const current = klines[klines.length - 1];

  const priceChange = current.close - previous.close;
  const priceChangePercent = calculatePercentChange(previous.close, current.close);

  return {
    previousClose: previous.close,
    currentClose: current.close,
    windowStart: current.openTime,
    windowEnd: current.closeTime,
    open: current.open,
    high: current.high,
    low: current.low,
    volume: current.volume,
    priceChange,
    priceChangePercent,
  };
};

/**
 * 计算简单移动平均线 (SMA)
 */
export const calculateSMA = (prices: number[], period: number): number[] => {
  const sma: number[] = [];
  for (let i = period - 1; i < prices.length; i++) {
    const slice = prices.slice(i - period + 1, i + 1);
    const sum = slice.reduce((acc, val) => acc + val, 0);
    sma.push(sum / period);
  }
  return sma;
};

/**
 * 计算指数移动平均线 (EMA)
 */
export const calculateEMA = (prices: number[], period: number): number[] => {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);

  // 第一个 EMA 值使用 SMA
  const firstSMA = prices.slice(0, period).reduce((acc, val) => acc + val, 0) / period;
  ema.push(firstSMA);

  for (let i = period; i < prices.length; i++) {
    const currentEMA = (prices[i] - ema[ema.length - 1]) * multiplier + ema[ema.length - 1];
    ema.push(currentEMA);
  }

  return ema;
};

/**
 * 计算相对强弱指数 (RSI)
 */
export const calculateRSI = (prices: number[], period: number = 14): number => {
  if (prices.length < period + 1) {
    return 50; // 默认中性值
  }

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }

  const avgGain = gains.slice(-period).reduce((acc, val) => acc + val, 0) / period;
  const avgLoss = losses.slice(-period).reduce((acc, val) => acc + val, 0) / period;

  if (avgLoss === 0) {
    return 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  return rsi;
};

/**
 * 计算布林带
 */
export const calculateBollingerBands = (
  prices: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number; middle: number; lower: number } | null => {
  if (prices.length < period) {
    return null;
  }

  const recentPrices = prices.slice(-period);
  const middle = recentPrices.reduce((acc, val) => acc + val, 0) / period;

  // 计算标准差
  const variance = recentPrices.reduce((acc, val) => acc + Math.pow(val - middle, 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);

  return {
    upper: middle + (standardDeviation * stdDev),
    middle,
    lower: middle - (standardDeviation * stdDev),
  };
};

/**
 * 计算技术指标
 */
export const calculateTechnicalIndicators = (klines: EnhancedKline[]): TechnicalIndicators => {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);

  const indicators: TechnicalIndicators = {};

  // RSI
  if (closes.length >= 15) {
    indicators.rsi = calculateRSI(closes);
  }

  // 布林带
  if (closes.length >= 20) {
    const bollingerBands = calculateBollingerBands(closes);
    if (bollingerBands) {
      indicators.bollingerBands = bollingerBands;
    }
  }

  // SMA (5, 10, 20)
  if (closes.length >= 20) {
    indicators.sma = [
      calculateSMA(closes, 5).pop() || 0,
      calculateSMA(closes, 10).pop() || 0,
      calculateSMA(closes, 20).pop() || 0,
    ];
  }

  // EMA (5, 10, 20)
  if (closes.length >= 20) {
    const ema5 = calculateEMA(closes, 5);
    const ema10 = calculateEMA(closes, 10);
    const ema20 = calculateEMA(closes, 20);

    indicators.ema = [
      ema5[ema5.length - 1] || 0,
      ema10[ema10.length - 1] || 0,
      ema20[ema20.length - 1] || 0,
    ];
  }

  // 成交量变化
  if (volumes.length >= 2) {
    const currentVolume = volumes[volumes.length - 1];
    const previousVolume = volumes[volumes.length - 2];
    indicators.volumeChange = calculatePercentChange(previousVolume, currentVolume);
  }

  return indicators;
};

/**
 * 创建增强的价格窗口，包含技术指标
 */
export const createEnhancedPriceWindow = (klines: EnhancedKline[]): EnhancedPriceWindow | null => {
  const priceWindow = enhancedKlinesToPriceWindow(klines);
  if (!priceWindow) {
    return null;
  }

  const indicators = calculateTechnicalIndicators(klines);

  return {
    ...priceWindow,
    indicators,
  };
};

/**
 * 检查是否应该基于技术指标触发警报
 */
export const shouldTriggerAlertWithIndicators = (
  window: EnhancedPriceWindow,
  thresholdPercent: number,
  additionalFilters?: {
    minVolumeChange?: number;
    rsiRange?: [number, number];
    useBollingerBands?: boolean;
  }
): boolean => {
  // 基础价格变化检查
  if (!shouldTriggerAlert(window.priceChangePercent, thresholdPercent)) {
    return false;
  }

  if (!additionalFilters || !window.indicators) {
    return true;
  }

  // 成交量变化过滤
  if (additionalFilters.minVolumeChange && window.indicators.volumeChange !== undefined) {
    if (Math.abs(window.indicators.volumeChange) < additionalFilters.minVolumeChange) {
      return false;
    }
  }

  // RSI 范围过滤
  if (additionalFilters.rsiRange && window.indicators.rsi !== undefined) {
    const [minRSI, maxRSI] = additionalFilters.rsiRange;
    if (window.indicators.rsi < minRSI || window.indicators.rsi > maxRSI) {
      return false;
    }
  }

  // 布林带突破过滤
  if (additionalFilters.useBollingerBands && window.indicators.bollingerBands) {
    const { upper, lower } = window.indicators.bollingerBands;
    const isBreakingUpper = window.currentClose > upper;
    const isBreakingLower = window.currentClose < lower;

    // 只有价格突破布林带时才触发
    if (!isBreakingUpper && !isBreakingLower) {
      return false;
    }
  }

  return true;
};

/**
 * 向后兼容的 toPriceWindow 函数
 */
export const toPriceWindow = (candles: Array<{ openTime: number; closeTime: number; close: number }>): PriceWindow | null => {
  if (candles.length < 2) {
    return null;
  }
  const previous = candles[candles.length - 2];
  const current = candles[candles.length - 1];

  const priceChange = current.close - previous.close;
  const priceChangePercent = calculatePercentChange(previous.close, current.close);

  return {
    previousClose: previous.close,
    currentClose: current.close,
    windowStart: current.openTime,
    windowEnd: current.closeTime,
    open: current.close, // 向后兼容，没有 open 字段
    high: current.close, // 向后兼容，没有 high 字段
    low: current.close,  // 向后兼容，没有 low 字段
    volume: 0,          // 向后兼容，没有 volume 字段
    priceChange,
    priceChangePercent,
  };
};

/**
 * 生成幂等性密钥
 */
export const generateIdempotencyKey = async (
  symbol: string,
  windowEnd: number,
  thresholdPercent: number,
): Promise<string> => sha256Hex(`${symbol}:${windowEnd}:${thresholdPercent}`);