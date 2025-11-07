import { logger } from './logger';
import type { VolumeAnalysis, MarketAnalysis } from '../types';

/**
 * 计算交易量变化百分比
 */
export const calculateVolumeChangePercent = (currentVolume: number, previousVolume: number): number => {
  if (previousVolume === 0) return 0;
  return ((currentVolume - previousVolume) / previousVolume) * 100;
};

/**
 * 计算交易量比率 (当前交易量 / 平均交易量)
 */
export const calculateVolumeRatio = (currentVolume: number, averageVolume: number): number => {
  if (averageVolume === 0) return 0;
  return currentVolume / averageVolume;
};

/**
 * 计算Z分数 (用于异常检测)
 * Z = (当前值 - 平均值) / 标准差
 */
export const calculateZScore = (currentVolume: number, meanVolume: number, stdDevVolume: number): number => {
  if (stdDevVolume === 0) return 0;
  return (currentVolume - meanVolume) / stdDevVolume;
};

/**
 * 计算标准差
 */
export const calculateStandardDeviation = (volumes: number[]): number => {
  if (volumes.length === 0) return 0;

  const mean = volumes.reduce((sum, vol) => sum + vol, 0) / volumes.length;
  const squaredDifferences = volumes.map(vol => Math.pow(vol - mean, 2));
  const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / volumes.length;

  return Math.sqrt(variance);
};

/**
 * 分析交易量数据
 */
export const analyzeVolume = (
  currentVolume: number,
  historicalVolumes: number[],
  windowMinutes: number = 5
): VolumeAnalysis => {
  const previousVolume = historicalVolumes[historicalVolumes.length - 1] || 0;
  const averageVolume = historicalVolumes.reduce((sum, vol) => sum + vol, 0) / Math.max(historicalVolumes.length, 1);

  const changePercent = calculateVolumeChangePercent(currentVolume, previousVolume);
  const volumeRatio = calculateVolumeRatio(currentVolume, averageVolume);

  // 计算标准差和Z分数
  const stdDevVolume = calculateStandardDeviation(historicalVolumes);
  const zScore = calculateZScore(currentVolume, averageVolume, stdDevVolume);

  // 定义阈值
  const SURGE_THRESHOLD = 2.0; // 交易量激增阈值 (2倍于平均值)
  const SPIKE_THRESHOLD = 3.0; // 交易量突增阈值 (3倍于平均值)
  const ABNORMAL_Z_THRESHOLD = 2.0; // 异常Z分数阈值

  const surge = volumeRatio >= SURGE_THRESHOLD;
  const spike = volumeRatio >= SPIKE_THRESHOLD;
  const isAbnormal = Math.abs(zScore) >= ABNORMAL_Z_THRESHOLD;

  const analysis: VolumeAnalysis = {
    currentVolume,
    previousVolume,
    changePercent,
    averageVolume,
    volumeRatio,
    isAbnormal,
    zScore,
    surge,
    spike,
  };

  logger.info('volume_analysis_completed', {
    symbol: 'N/A',
    currentVolume,
    changePercent: changePercent.toFixed(2),
    volumeRatio: volumeRatio.toFixed(2),
    zScore: zScore.toFixed(2),
    surge,
    spike,
    isAbnormal,
  });

  return analysis;
};

/**
 * 从K线数据计算交易量分析
 */
export const analyzeVolumeFromKlines = (
  klines: Array<{ timestamp: number; volume: number }>,
  currentWindowMinutes: number = 5,
  historicalWindowMinutes: number = 60
): VolumeAnalysis => {
  if (klines.length === 0) {
    throw new Error('No kline data available for volume analysis');
  }

  // 分离当前窗口和历史数据
  const currentKlines = klines.slice(-Math.ceil(currentWindowMinutes / 5)); // 假设5分钟K线
  const historicalKlines = klines.slice(0, -Math.ceil(currentWindowMinutes / 5));

  if (currentKlines.length === 0) {
    throw new Error('Insufficient data for current window');
  }

  // 计算当前窗口的总交易量
  const currentVolume = currentKlines.reduce((sum, kline) => sum + kline.volume, 0);

  // 获取上一个周期的交易量
  const previousVolume = historicalKlines.length > 0
    ? historicalKlines[historicalKlines.length - 1].volume
    : 0;

  // 获取历史交易量数据用于计算平均值和标准差
  const historicalVolumes = historicalKlines.map(k => k.volume).slice(-Math.ceil(historicalWindowMinutes / 5));

  return analyzeVolume(currentVolume, historicalVolumes, currentWindowMinutes);
};

/**
 * 检测交易量预警触发条件
 */
export const checkVolumeAlertTriggers = (analysis: VolumeAnalysis): Array<{
  type: string;
  triggered: boolean;
  value: number;
  threshold: number;
  description: string;
}> => {
  const triggers = [];

  // 交易量变化百分比预警 (默认阈值: 50%)
  const VOLUME_CHANGE_THRESHOLD = 50.0;
  triggers.push({
    type: 'volume_change_percent',
    triggered: Math.abs(analysis.changePercent) >= VOLUME_CHANGE_THRESHOLD,
    value: analysis.changePercent,
    threshold: VOLUME_CHANGE_THRESHOLD,
    description: `交易量变化${analysis.changePercent >= 0 ? '增加' : '减少'} ${Math.abs(analysis.changePercent).toFixed(2)}%`,
  });

  // 交易量激增预警
  triggers.push({
    type: 'volume_surge',
    triggered: analysis.surge,
    value: analysis.volumeRatio,
    threshold: 2.0,
    description: `交易量激增 ${analysis.volumeRatio.toFixed(2)} 倍`,
  });

  // 交易量突增预警
  triggers.push({
    type: 'volume_spike',
    triggered: analysis.spike,
    value: analysis.volumeRatio,
    threshold: 3.0,
    description: `交易量突增 ${analysis.volumeRatio.toFixed(2)} 倍`,
  });

  // 异常交易量预警
  triggers.push({
    type: 'abnormal_volume',
    triggered: analysis.isAbnormal,
    value: analysis.zScore,
    threshold: 2.0,
    description: `异常交易量 (Z分数: ${analysis.zScore.toFixed(2)})`,
  });

  return triggers.filter(trigger => trigger.triggered);
};

/**
 * 生成交易量相关的幂等键
 */
export const generateVolumeIdempotencyKey = (
  symbol: string,
  indicatorType: string,
  windowEnd: number,
  thresholdValue: number,
  operator: string
): string => {
  return `${symbol}-${indicatorType}-${windowEnd}-${thresholdValue}-${operator}`;
};