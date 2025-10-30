import type { AlertDirection } from "../lib/compute";

export type SymbolRecord = {
  id: number;
  symbol: string;
  enabled: number;
  threshold_percent: number | null;
  cooldown_minutes: number | null;
  webhook_url: string | null;
  created_at: string;
  updated_at: string;
};

export type SettingsRecord = {
  id: number;
  default_threshold_percent: number;
  window_minutes: number;
  default_cooldown_minutes: number;
  binance_base_url: string;
};

export type AlertStatus = "SENT" | "SKIPPED" | "FAILED";

export type AlertRecord = {
  id: number;
  symbol: string;
  change_percent: number;
  direction: AlertDirection;
  window_start: number;
  window_end: number;
  idempotency_key: string;
  status: AlertStatus;
  response_code: number | null;
  response_body: string | null;
  created_at: string;
};

export type SymbolInput = {
  symbol: string;
  enabled?: boolean;
  thresholdPercent?: number | null;
  cooldownMinutes?: number | null;
  webhookUrl?: string | null;
};

export type SymbolUpdateInput = Omit<SymbolInput, "symbol">;

const toFlag = (value?: boolean): number | undefined =>
  typeof value === "boolean" ? (value ? 1 : 0) : undefined;

const now = () => new Date().toISOString();

export const getSettings = async (db: D1Database): Promise<SettingsRecord | null> => {
  const record = await db.prepare("SELECT * FROM settings WHERE id = 1").first<SettingsRecord>();
  return record ?? null;
};

export const updateSettings = async (
  db: D1Database,
  update: Partial<{
    default_threshold_percent: number;
    window_minutes: number;
    default_cooldown_minutes: number;
    binance_base_url: string;
  }>,
): Promise<SettingsRecord | null> => {
  const fields: string[] = [];
  const values: unknown[] = [];
  Object.entries(update).forEach(([key, value]) => {
    if (typeof value !== "undefined" && value !== null) {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  });

  if (fields.length === 0) {
    return getSettings(db);
  }

  await db
    .prepare(`UPDATE settings SET ${fields.join(", ")}, updated_at = ? WHERE id = 1`)
    .bind(...values, now())
    .run();

  return getSettings(db);
};

export const listSymbols = async (
  db: D1Database,
  options: {
    page: number;
    pageSize: number;
    enabled?: boolean;
  },
): Promise<{ items: SymbolRecord[]; total: number }> => {
  const page = Math.max(1, options.page);
  const pageSize = Math.min(Math.max(1, options.pageSize), 100);
  const offset = (page - 1) * pageSize;

  const where: string[] = [];
  const params: unknown[] = [];

  if (typeof options.enabled === "boolean") {
    where.push("enabled = ?");
    params.push(options.enabled ? 1 : 0);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const query = `SELECT * FROM symbols ${whereClause} ORDER BY symbol ASC LIMIT ? OFFSET ?`;

  const symbols = await db
    .prepare(query)
    .bind(...params, pageSize, offset)
    .all<SymbolRecord>();

  const count = await db
    .prepare(`SELECT COUNT(*) as count FROM symbols ${whereClause}`)
    .bind(...params)
    .first<{ count: number }>();

  return {
    items: symbols.results ?? [],
    total: count?.count ?? 0,
  };
};

export const getSymbol = async (db: D1Database, symbol: string): Promise<SymbolRecord | null> =>
  db.prepare("SELECT * FROM symbols WHERE symbol = ?").bind(symbol.toUpperCase()).first<SymbolRecord>();

export const getEnabledSymbols = async (db: D1Database): Promise<SymbolRecord[]> => {
  const { results } = await db
    .prepare("SELECT * FROM symbols WHERE enabled = 1 ORDER BY symbol ASC")
    .all<SymbolRecord>();
  return results ?? [];
};

export const createSymbol = async (db: D1Database, input: SymbolInput): Promise<SymbolRecord> => {
  const enabled = toFlag(input.enabled ?? true) ?? 1;
  await db
    .prepare(
      `INSERT INTO symbols (symbol, enabled, threshold_percent, cooldown_minutes, webhook_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.symbol.toUpperCase(),
      enabled,
      input.thresholdPercent ?? null,
      input.cooldownMinutes ?? null,
      input.webhookUrl ?? null,
      now(),
      now(),
    )
    .run();

  const record = await getSymbol(db, input.symbol);
  if (!record) {
    throw new Error("Failed to create symbol");
  }
  return record;
};

export const updateSymbol = async (
  db: D1Database,
  symbol: string,
  input: SymbolUpdateInput,
): Promise<SymbolRecord | null> => {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (typeof input.enabled === "boolean") {
    fields.push("enabled = ?");
    values.push(toFlag(input.enabled));
  }
  if (typeof input.thresholdPercent !== "undefined") {
    fields.push("threshold_percent = ?");
    values.push(input.thresholdPercent);
  }
  if (typeof input.cooldownMinutes !== "undefined") {
    fields.push("cooldown_minutes = ?");
    values.push(input.cooldownMinutes);
  }
  if (typeof input.webhookUrl !== "undefined") {
    fields.push("webhook_url = ?");
    values.push(input.webhookUrl);
  }

  if (fields.length === 0) {
    return getSymbol(db, symbol);
  }

  await db
    .prepare(`UPDATE symbols SET ${fields.join(", ")}, updated_at = ? WHERE symbol = ?`)
    .bind(...values, now(), symbol.toUpperCase())
    .run();

  return getSymbol(db, symbol);
};

export const disableSymbol = async (db: D1Database, symbol: string): Promise<SymbolRecord | null> => {
  await db
    .prepare("UPDATE symbols SET enabled = 0, updated_at = ? WHERE symbol = ?")
    .bind(now(), symbol.toUpperCase())
    .run();
  return getSymbol(db, symbol);
};

export const getLatestAlertForSymbol = async (
  db: D1Database,
  symbol: string,
): Promise<AlertRecord | null> =>
  db
    .prepare("SELECT * FROM alerts WHERE symbol = ? ORDER BY window_end DESC LIMIT 1")
    .bind(symbol.toUpperCase())
    .first<AlertRecord>();

export const findAlertByIdempotency = async (
  db: D1Database,
  key: string,
): Promise<AlertRecord | null> =>
  db.prepare("SELECT * FROM alerts WHERE idempotency_key = ?").bind(key).first<AlertRecord>();

export const recordAlert = async (
  db: D1Database,
  data: {
    symbol: string;
    changePercent: number;
    direction: AlertDirection;
    windowStart: number;
    windowEnd: number;
    idempotencyKey: string;
    status: AlertStatus;
    responseCode: number | null;
    responseBody: string | null;
  },
): Promise<AlertRecord> => {
  await db
    .prepare(
      `INSERT OR REPLACE INTO alerts
      (symbol, change_percent, direction, window_start, window_end, idempotency_key, status, response_code, response_body, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(
        (SELECT created_at FROM alerts WHERE idempotency_key = ?),
        ?
      ))`,
    )
    .bind(
      data.symbol.toUpperCase(),
      data.changePercent,
      data.direction,
      data.windowStart,
      data.windowEnd,
      data.idempotencyKey,
      data.status,
      data.responseCode,
      data.responseBody,
      data.idempotencyKey,
      now(),
    )
    .run();

  const record = await findAlertByIdempotency(db, data.idempotencyKey);
  if (!record) {
    throw new Error("Failed to record alert");
  }
  return record;
};

export const listAlerts = async (
  db: D1Database,
  filters: {
    symbol?: string;
    since?: number;
    status?: AlertStatus;
    limit?: number;
  },
): Promise<AlertRecord[]> => {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.symbol) {
    where.push("symbol = ?");
    params.push(filters.symbol.toUpperCase());
  }

  if (typeof filters.since === "number") {
    where.push("window_end >= ?");
    params.push(filters.since);
  }

  if (filters.status) {
    where.push("status = ?");
    params.push(filters.status);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  const { results } = await db
    .prepare(
      `SELECT * FROM alerts ${whereClause} ORDER BY window_end DESC LIMIT ?`,
    )
    .bind(...params, limit)
    .all<AlertRecord>();

  return results ?? [];
};
