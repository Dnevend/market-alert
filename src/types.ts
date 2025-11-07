import type { AppEnv, CloudflareBindings } from "./config/env";

export type AppContext = {
  Bindings: CloudflareBindings;
  Variables: {
    env: AppEnv;
    userAddress?: string;
    userRole?: string;
  };
};

// 指标类型定义
export type IndicatorType = {
  id: number;
  name: string;
  display_name: string;
  description?: string;
  unit?: string;
  is_active: 1 | 0;
  created_at: string;
};

// 符号指标配置
export type SymbolIndicator = {
  id: number;
  symbol: string;
  indicator_type_id: number;
  threshold_value: number;
  threshold_operator: '>' | '<' | '>=' | '<=' | '=' | '!=';
  enabled: 1 | 0;
  cooldown_minutes?: number;
  webhook_url?: string;
  created_at: string;
  updated_at: string;
};

// 扩展的告警记录
export type AlertRecord = {
  id: number;
  symbol: string;
  indicator_type_id: number;
  indicator_value: number;
  threshold_value: number;
  change_percent?: number;
  direction?: 'UP' | 'DOWN' | 'ABOVE' | 'BELOW' | 'CROSS_UP' | 'CROSS_DOWN';
  window_start: number;
  window_end: number;
  window_minutes: number;
  idempotency_key: string;
  status: 'SENT' | 'SKIPPED' | 'FAILED';
  response_code?: number;
  response_body?: string;
  metadata?: string; // JSON string
  created_at: string;
};

// 交易量分析结果
export type VolumeAnalysis = {
  currentVolume: number;
  previousVolume: number;
  changePercent: number;
  averageVolume: number; // 历史平均交易量
  volumeRatio: number; // 当前交易量 / 平均交易量
  isAbnormal: boolean; // 是否异常
  zScore: number; // Z分数，用于异常检测
  surge: boolean; // 是否激增
  spike: boolean; // 是否突增
};

// 价格分析结果
export type PriceAnalysis = {
  open: number;
  high: number;
  low: number;
  close: number;
  change: number;
  changePercent: number;
  volume: number;
  direction: 'UP' | 'DOWN';
};

// 完整的监控分析结果
export type MarketAnalysis = {
  symbol: string;
  price: PriceAnalysis;
  volume: VolumeAnalysis;
  windowStart: number;
  windowEnd: number;
  windowMinutes: number;
  // 未来可扩展: 技术指标等
};

// 预警触发条件
export type AlertTrigger = {
  symbol: string;
  indicatorType: IndicatorType;
  indicatorValue: number;
  thresholdValue: number;
  operator: string;
  triggered: boolean;
  metadata?: Record<string, any>;
};

// Webhook payload (扩展版)
export type AlertPayload = {
  symbol: string;
  indicator_type: string;
  indicator_display_name: string;
  indicator_value: number;
  threshold_value: number;
  threshold_operator: string;
  direction?: string;
  change_percent?: number;
  window_minutes: number;
  window_start: number;
  window_end: number;
  observed_at: number;
  source: string;
  metadata?: Record<string, any>;
  links: {
    kraken: string;
    tradingview: string;
  };
};
