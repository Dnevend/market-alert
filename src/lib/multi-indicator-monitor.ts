import { logger } from './logger';
import {
  analyzeVolumeFromKlines,
  checkVolumeAlertTriggers,
  generateVolumeIdempotencyKey
} from './volume-analysis';
import type {
  MarketAnalysis,
  AlertTrigger,
  AlertPayload,
  IndicatorType,
  SymbolIndicatorRecord,
  AlertRecordNew,
  VolumeAnalysis,
  PriceAnalysis
} from '../types';

/**
 * 多指标监控器核心类
 */
export class MultiIndicatorMonitor {
  constructor(
    private db: D1Database,
    private env: any
  ) {}

  /**
   * 执行多指标分析
   */
  async analyzeMarket(
    symbol: string,
    klines: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
    windowMinutes: number = 5
  ): Promise<MarketAnalysis> {
    if (klines.length < 2) {
      throw new Error('Insufficient data for market analysis');
    }

    // 分析价格数据
    const priceAnalysis = this.analyzePrice(klines, windowMinutes);

    // 分析交易量数据
    const volumeAnalysis = await this.analyzeVolume(klines, windowMinutes);

    const windowStart = klines[0].timestamp;
    const windowEnd = klines[klines.length - 1].timestamp;

    const analysis: MarketAnalysis = {
      symbol,
      price: priceAnalysis,
      volume: volumeAnalysis,
      windowStart,
      windowEnd,
      windowMinutes,
    };

    logger.info('multi_indicator_analysis_completed', {
      symbol,
      priceChange: priceAnalysis.changePercent.toFixed(2),
      volumeChange: volumeAnalysis.changePercent.toFixed(2),
      volumeRatio: volumeAnalysis.volumeRatio.toFixed(2),
      windowMinutes,
    });

    return analysis;
  }

  /**
   * 分析价格数据
   */
  private analyzePrice(
    klines: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
    windowMinutes: number
  ): PriceAnalysis {
    const currentKline = klines[klines.length - 1];
    const previousKline = klines[0];

    const open = previousKline.open;
    const close = currentKline.close;
    const change = close - open;
    const changePercent = (change / open) * 100;

    const high = Math.max(...klines.map(k => k.high));
    const low = Math.min(...klines.map(k => k.low));
    const volume = klines.reduce((sum, k) => sum + k.volume, 0);

    return {
      open,
      high,
      low,
      close,
      change,
      changePercent,
      volume,
      direction: change >= 0 ? 'UP' : 'DOWN',
    };
  }

  /**
   * 分析交易量数据
   */
  private async analyzeVolume(
    klines: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
    windowMinutes: number
  ): Promise<VolumeAnalysis> {
    // 获取历史交易量数据用于计算统计值
    const historicalWindowMinutes = 60; // 1小时历史数据
    const historicalKlinesNeeded = Math.ceil(historicalWindowMinutes / 5); // 假设5分钟K线

    // 如果当前数据不足，使用已有数据
    const availableHistoricalKlines = klines.slice(0, -Math.ceil(windowMinutes / 5));
    const historicalVolumes = availableHistoricalKlines.map(k => k.volume);

    const currentKlines = klines.slice(-Math.ceil(windowMinutes / 5));
    const currentVolume = currentKlines.reduce((sum, k) => sum + k.volume, 0);

    return analyzeVolumeFromKlines(
      klines.map(k => ({ timestamp: k.timestamp, volume: k.volume })),
      windowMinutes,
      historicalWindowMinutes
    );
  }

  /**
   * 检查所有配置的指标预警
   */
  async checkAlertTriggers(
    symbol: string,
    analysis: MarketAnalysis
  ): Promise<AlertTrigger[]> {
    // 获取该符号的所有启用指标配置
    const { getSymbolIndicators } = await import('../db/repo');
    const symbolIndicators = await getSymbolIndicators(this.db, symbol);

    const triggers: AlertTrigger[] = [];

    for (const indicator of symbolIndicators) {
      const trigger = await this.checkIndicatorTrigger(indicator, analysis);
      if (trigger.triggered) {
        triggers.push(trigger);
      }
    }

    logger.info('indicator_triggers_checked', {
      symbol,
      totalIndicators: symbolIndicators.length,
      triggeredTriggers: triggers.length,
      triggeredTypes: triggers.map(t => t.indicatorType.name),
    });

    return triggers;
  }

  /**
   * 检查单个指标触发条件
   */
  private async checkIndicatorTrigger(
    indicator: SymbolIndicatorRecord,
    analysis: MarketAnalysis
  ): Promise<AlertTrigger> {
    const { indicatorType } = indicator;
    let indicatorValue = 0;
    let triggered = false;
    let metadata: Record<string, any> = {};

    switch (indicatorType.name) {
      case 'price_change_percent':
        indicatorValue = Math.abs(analysis.price.changePercent);
        triggered = this.evaluateCondition(
          indicatorValue,
          indicator.threshold_value,
          indicator.threshold_operator
        );
        metadata = {
          price: analysis.price.close,
          change: analysis.price.change,
          direction: analysis.price.direction,
        };
        break;

      case 'volume_change_percent':
        indicatorValue = Math.abs(analysis.volume.changePercent);
        triggered = this.evaluateCondition(
          indicatorValue,
          indicator.threshold_value,
          indicator.threshold_operator
        );
        metadata = {
          currentVolume: analysis.volume.currentVolume,
          previousVolume: analysis.volume.previousVolume,
          averageVolume: analysis.volume.averageVolume,
        };
        break;

      case 'volume_surge':
        indicatorValue = analysis.volume.volumeRatio;
        triggered = this.evaluateCondition(
          indicatorValue,
          indicator.threshold_value,
          indicator.threshold_operator
        );
        metadata = {
          currentVolume: analysis.volume.currentVolume,
          averageVolume: analysis.volume.averageVolume,
          surge: analysis.volume.surge,
        };
        break;

      case 'volume_spike':
        indicatorValue = analysis.volume.volumeRatio;
        triggered = this.evaluateCondition(
          indicatorValue,
          indicator.threshold_value,
          indicator.threshold_operator
        );
        metadata = {
          currentVolume: analysis.volume.currentVolume,
          averageVolume: analysis.volume.averageVolume,
          spike: analysis.volume.spike,
        };
        break;

      case 'abnormal_volume':
        indicatorValue = Math.abs(analysis.volume.zScore);
        triggered = this.evaluateCondition(
          indicatorValue,
          indicator.threshold_value,
          indicator.threshold_operator
        );
        metadata = {
          currentVolume: analysis.volume.currentVolume,
          zScore: analysis.volume.zScore,
          isAbnormal: analysis.volume.isAbnormal,
        };
        break;

      case 'price_volume_divergence':
        // 价量背离检测：价格上涨但交易量下降，或价格下跌但交易量上升
        const priceUp = analysis.price.direction === 'UP';
        const volumeDown = analysis.volume.changePercent < 0;
        const priceDown = analysis.price.direction === 'DOWN';
        const volumeUp = analysis.volume.changePercent > 0;

        const divergence = (priceUp && volumeDown) || (priceDown && volumeUp);
        indicatorValue = divergence ? 1 : 0;
        triggered = this.evaluateCondition(
          indicatorValue,
          indicator.threshold_value,
          indicator.threshold_operator
        );
        metadata = {
          priceDirection: analysis.price.direction,
          volumeChangePercent: analysis.volume.changePercent,
          divergence,
        };
        break;

      default:
        logger.warn('unknown_indicator_type', { indicatorType: indicatorType.name });
        indicatorValue = 0;
        triggered = false;
    }

    return {
      symbol: analysis.symbol,
      indicatorType: indicatorType,
      indicatorValue,
      thresholdValue: indicator.threshold_value,
      operator: indicator.threshold_operator,
      triggered,
      metadata,
    };
  }

  /**
   * 评估条件是否满足
   */
  private evaluateCondition(
    actualValue: number,
    thresholdValue: number,
    operator: string
  ): boolean {
    switch (operator) {
      case '>':
        return actualValue > thresholdValue;
      case '>=':
        return actualValue >= thresholdValue;
      case '<':
        return actualValue < thresholdValue;
      case '<=':
        return actualValue <= thresholdValue;
      case '=':
        return Math.abs(actualValue - thresholdValue) < 0.0001; // 浮点数比较
      case '!=':
        return Math.abs(actualValue - thresholdValue) >= 0.0001;
      default:
        logger.warn('unknown_operator', { operator });
        return false;
    }
  }

  /**
   * 生成告警负载
   */
  generateAlertPayload(
    trigger: AlertTrigger,
    analysis: MarketAnalysis,
    windowMinutes: number
  ): AlertPayload {
    const direction = this.getAlertDirection(trigger, analysis);

    return {
      symbol: trigger.symbol,
      indicator_type: trigger.indicatorType.name,
      indicator_display_name: trigger.indicatorType.display_name,
      indicator_value: trigger.indicatorValue,
      threshold_value: trigger.thresholdValue,
      threshold_operator: trigger.operator,
      direction,
      change_percent: analysis.price.changePercent,
      window_minutes: windowMinutes,
      window_start: analysis.windowStart,
      window_end: analysis.windowEnd,
      observed_at: Date.now(),
      source: 'kraken',
      metadata: {
        ...trigger.metadata,
        priceData: {
          open: analysis.price.open,
          high: analysis.price.high,
          low: analysis.price.low,
          close: analysis.price.close,
          volume: analysis.price.volume,
        },
        volumeData: analysis.volume,
      },
      links: {
        kraken: `https://www.kraken.com/prices/${trigger.symbol.toLowerCase()}`,
        tradingview: `https://www.tradingview.com/chart/?symbol=KRAKEN:${trigger.symbol}`,
      },
    };
  }

  /**
   * 确定告警方向
   */
  private getAlertDirection(trigger: AlertTrigger, analysis: MarketAnalysis): string {
    // 根据指标类型和数值确定方向
    switch (trigger.indicatorType.name) {
      case 'price_change_percent':
        return analysis.price.direction === 'UP' ? 'UP' : 'DOWN';
      case 'volume_change_percent':
        return analysis.volume.changePercent >= 0 ? 'ABOVE' : 'BELOW';
      case 'volume_surge':
      case 'volume_spike':
      case 'abnormal_volume':
        return 'ABOVE';
      case 'price_volume_divergence':
        return trigger.metadata.divergence ? 'CROSS_UP' : 'CROSS_DOWN';
      default:
        return 'ABOVE';
    }
  }

  /**
   * 生成幂等键
   */
  generateIdempotencyKey(
    symbol: string,
    indicatorType: string,
    windowEnd: number,
    thresholdValue: number,
    operator: string
  ): string {
    return `${symbol}-${indicatorType}-${windowEnd}-${thresholdValue}-${operator}`;
  }

  /**
   * 检查冷却期
   */
  async checkCooldown(
    symbol: string,
    indicatorType: string,
    windowEnd: number,
    cooldownMinutes?: number
  ): Promise<boolean> {
    if (!cooldownMinutes) return false;

    const { getLatestAlertNewForSymbol } = await import('../db/repo');
    const latestAlert = await getLatestAlertNewForSymbol(symbol, indicatorType);

    if (!latestAlert) return false;

    const cooldownMs = cooldownMinutes * 60 * 1000;
    const timeSinceLastAlert = windowEnd - latestAlert.window_end;

    return timeSinceLastAlert < cooldownMs;
  }

  /**
   * 创建告警记录
   */
  async createAlertRecord(
    trigger: AlertTrigger,
    analysis: MarketAnalysis,
    windowMinutes: number,
    status: 'SENT' | 'SKIPPED' | 'FAILED',
    responseCode?: number | null,
    responseBody?: string | null
  ): Promise<AlertRecordNew> {
    const { createAlertNew } = await import('../db/repo');

    const idempotencyKey = this.generateIdempotencyKey(
      trigger.symbol,
      trigger.indicatorType.name,
      analysis.windowEnd,
      trigger.thresholdValue,
      trigger.operator
    );

    const direction = this.getAlertDirection(trigger, analysis);

    return createAlertNew(this.db, {
      symbol: trigger.symbol,
      indicatorTypeId: trigger.indicatorType.id,
      indicatorValue: trigger.indicatorValue,
      thresholdValue: trigger.thresholdValue,
      changePercent: analysis.price.changePercent,
      direction,
      windowStart: analysis.windowStart,
      windowEnd: analysis.windowEnd,
      windowMinutes,
      idempotencyKey,
      status,
      responseCode,
      responseBody,
      metadata: JSON.stringify(trigger.metadata),
    });
  }
}