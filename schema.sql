PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  threshold_percent REAL,
  cooldown_minutes INTEGER,
  webhook_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_threshold_percent REAL NOT NULL DEFAULT 0.02,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  default_cooldown_minutes INTEGER NOT NULL DEFAULT 10,
  binance_base_url TEXT NOT NULL DEFAULT 'https://api.binance.com',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT OR IGNORE INTO settings (id) VALUES (1);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  change_percent REAL NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('UP', 'DOWN')),
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (status IN ('SENT', 'SKIPPED', 'FAILED')),
  response_code INTEGER,
  response_body TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_alerts_symbol_window ON alerts(symbol, window_end);

-- 用户表 - 用于存储以太坊钱包用户信息
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  address TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'user', -- 角色: admin, user, guest
  nickname TEXT,
  avatar_url TEXT,
  preferences TEXT, -- JSON格式存储用户偏好设置
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 角色枚举约束
CREATE TABLE IF NOT EXISTS user_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 插入默认角色
INSERT OR IGNORE INTO user_roles (name, description) VALUES
  ('admin', '管理员用户，拥有系统全部权限'),
  ('user', '普通用户，可以访问基础功能'),
  ('guest', '访客用户，仅限公开访问');

CREATE INDEX IF NOT EXISTS idx_users_address ON users(address);

INSERT OR IGNORE INTO symbols (symbol, enabled) VALUES ('BTCUSDT', 1);
INSERT OR IGNORE INTO symbols (symbol, enabled) VALUES ('ETHUSDT', 1);
