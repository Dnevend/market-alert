PRAGMA foreign_keys = ON;

CREATE TABLE symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1,
  threshold_percent REAL,
  cooldown_minutes INTEGER,
  webhook_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  default_threshold_percent REAL NOT NULL DEFAULT 0.02,
  window_minutes INTEGER NOT NULL DEFAULT 5,
  default_cooldown_minutes INTEGER NOT NULL DEFAULT 10,
  binance_base_url TEXT NOT NULL DEFAULT 'https://api.binance.com',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO settings (id)
SELECT 1
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE id = 1);

CREATE TABLE alerts (
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

CREATE INDEX idx_alerts_symbol_window ON alerts(symbol, window_end);

INSERT INTO symbols (symbol, enabled)
SELECT 'BTCUSDT', 1
WHERE NOT EXISTS (SELECT 1 FROM symbols WHERE symbol = 'BTCUSDT');

INSERT INTO symbols (symbol, enabled)
SELECT 'ETHUSDT', 1
WHERE NOT EXISTS (SELECT 1 FROM symbols WHERE symbol = 'ETHUSDT');
