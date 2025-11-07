-- 多指标预警系统迁移
-- 为交易量和其他技术指标提供可扩展的支持

-- 1. 创建预警指标类型表
CREATE TABLE IF NOT EXISTS indicator_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT,
  unit TEXT, -- 单位: % (百分比), volume (交易量), price (价格) 等
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 2. 创建符号指标配置表 (替代原有的单一阈值字段)
CREATE TABLE IF NOT EXISTS symbol_indicators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  indicator_type_id INTEGER NOT NULL,
  threshold_value REAL NOT NULL, -- 阈值
  threshold_operator TEXT NOT NULL CHECK (threshold_operator IN ('>', '<', '>=', '<=', '=', '!=')),
  enabled INTEGER NOT NULL DEFAULT 1,
  cooldown_minutes INTEGER DEFAULT NULL, -- 可为NULL，使用全局默认值
  webhook_url TEXT DEFAULT NULL, -- 可为NULL，使用符号默认webhook
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (indicator_type_id) REFERENCES indicator_types (id),
  UNIQUE(symbol, indicator_type_id)
);

-- 3. 扩展告警表支持多指标
CREATE TABLE IF NOT EXISTS alerts_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  indicator_type_id INTEGER NOT NULL,
  indicator_value REAL NOT NULL, -- 触发时的指标值
  threshold_value REAL NOT NULL, -- 配置的阈值
  change_percent REAL DEFAULT NULL, -- 变化百分比(仅对价格相关指标)
  direction TEXT CHECK (direction IN ('UP', 'DOWN', 'ABOVE', 'BELOW', 'CROSS_UP', 'CROSS_DOWN')),
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  window_minutes INTEGER NOT NULL, -- 监控窗口大小
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'SKIPPED', 'FAILED')),
  response_code INTEGER,
  response_body TEXT,
  metadata TEXT DEFAULT NULL, -- JSON格式存储额外数据(如交易量详情、技术指标等)
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (indicator_type_id) REFERENCES indicator_types (id)
);

-- 4. 创建指标类型
INSERT OR IGNORE INTO indicator_types (name, display_name, description, unit) VALUES
  ('price_change_percent', '价格变化百分比', '价格在指定时间窗口内的变化百分比', '%'),
  ('volume_change_percent', '交易量变化百分比', '交易量在指定时间窗口内的变化百分比', '%'),
  ('volume_surge', '交易量激增', '交易量相对于历史平均值的增长倍数', 'x'),
  ('volume_spike', '交易量突增', '交易量在短时间内急剧增加', 'x'),
  ('abnormal_volume', '异常交易量', '交易量超过统计正常范围', 'σ'),
  ('price_volume_divergence', '价量背离', '价格上涨但交易量下降或相反', 'boolean'),
  ('accumulation_distribution', '累积派发线', '基于成交量的资金流向指标', 'boolean');

-- 5. 更新settings表支持多指标默认配置
ALTER TABLE settings ADD COLUMN default_volume_threshold_percent REAL DEFAULT NULL;
ALTER TABLE settings ADD COLUMN default_volume_surge_threshold REAL DEFAULT 2.0;
ALTER TABLE settings ADD COLUMN enable_volume_alerts INTEGER DEFAULT 1;
ALTER TABLE settings ADD COLUMN enable_abnormal_volume_alerts INTEGER DEFAULT 0;
ALTER TABLE settings ADD COLUMN volume_analysis_window_minutes INTEGER DEFAULT 60; -- 用于计算历史平均交易量的窗口

-- 6. 从原有的symbols表迁移现有配置到新的symbol_indicators表
-- 迁移价格变化百分比指标配置
INSERT OR IGNORE INTO symbol_indicators (symbol, indicator_type_id, threshold_value, threshold_operator, enabled, cooldown_minutes, webhook_url)
SELECT
  s.symbol,
  it.id,
  COALESCE(s.threshold_percent, (SELECT default_threshold_percent FROM settings LIMIT 1)),
  '>=',
  s.enabled,
  s.cooldown_minutes,
  s.webhook_url
FROM symbols s
CROSS JOIN indicator_types it
WHERE it.name = 'price_change_percent' AND s.symbol IN ('BTCUSDT', 'ETHUSDT');

-- 7. 创建索引以优化查询性能
CREATE INDEX IF NOT EXISTS idx_symbol_indicators_symbol_type ON symbol_indicators(symbol, indicator_type_id);
CREATE INDEX IF NOT EXISTS idx_symbol_indicators_enabled ON symbol_indicators(enabled, indicator_type_id);
CREATE INDEX IF NOT EXISTS idx_alerts_new_symbol_indicator ON alerts_new(symbol, indicator_type_id, window_end);
CREATE INDEX IF NOT EXISTS idx_alerts_new_symbol_time ON alerts_new(symbol, created_at);

-- 8. 创建视图以简化查询
CREATE VIEW IF NOT EXISTS v_symbol_alerts AS
SELECT
  s.symbol,
  s.enabled as symbol_enabled,
  si.indicator_type_id,
  it.name as indicator_name,
  it.display_name as indicator_display_name,
  it.unit as indicator_unit,
  si.threshold_value,
  si.threshold_operator,
  si.enabled as indicator_enabled,
  si.cooldown_minutes,
  si.webhook_url,
  s.webhook_url as default_webhook_url,
  si.created_at as indicator_created_at,
  si.updated_at as indicator_updated_at
FROM symbols s
LEFT JOIN symbol_indicators si ON s.symbol = si.symbol
LEFT JOIN indicator_types it ON si.indicator_type_id = it.id
WHERE s.symbol IN (SELECT DISTINCT symbol FROM symbol_indicators WHERE enabled = 1)
   OR s.symbol IN (SELECT DISTINCT symbol FROM symbols WHERE enabled = 1);