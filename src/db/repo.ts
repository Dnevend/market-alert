import type { AlertDirection } from "../lib/compute";
import type { IndicatorType, SymbolIndicator, AlertRecord as NewAlertRecord } from "../types";

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
  default_volume_threshold_percent?: number;
  default_volume_surge_threshold?: number;
  enable_volume_alerts?: number;
  enable_abnormal_volume_alerts?: number;
  volume_analysis_window_minutes?: number;
};

export type AlertStatus = "SENT" | "SKIPPED" | "FAILED";

// 保持向后兼容的旧版AlertRecord
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

// 新版的多指标告警记录
export { NewAlertRecord as AlertRecordNew };

export type IndicatorTypeRecord = IndicatorType & {
  id: number;
  is_active: 1 | 0;
  created_at: string;
};

export type SymbolIndicatorRecord = SymbolIndicator & {
  id: number;
  enabled: 1 | 0;
  created_at: string;
  updated_at: string;
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

// ========== 多指标系统相关函数 ==========

// 指标类型相关操作
export const getIndicatorTypes = async (db: D1Database): Promise<IndicatorTypeRecord[]> => {
  const { results } = await db
    .prepare("SELECT * FROM indicator_types WHERE is_active = 1 ORDER BY id")
    .all<IndicatorTypeRecord>();
  return results ?? [];
};

export const getIndicatorTypeByName = async (db: D1Database, name: string): Promise<IndicatorTypeRecord | null> => {
  return db
    .prepare("SELECT * FROM indicator_types WHERE name = ? AND is_active = 1")
    .bind(name)
    .first<IndicatorTypeRecord>();
};

// 符号指标配置相关操作
export const getSymbolIndicators = async (
  db: D1Database,
  symbol?: string,
  indicatorType?: string
): Promise<SymbolIndicatorRecord[]> => {
  let query = `
    SELECT
      si.*,
      it.name as indicator_name,
      it.display_name,
      it.unit,
      it.id as indicator_type_id,
      it.name as indicator_type_name,
      it.description as indicator_type_description,
      it.is_active as indicator_type_is_active,
      it.created_at as indicator_type_created_at
    FROM symbol_indicators si
    JOIN indicator_types it ON si.indicator_type_id = it.id
    WHERE si.enabled = 1 AND it.is_active = 1
  `;
  const params: unknown[] = [];

  if (symbol) {
    query += " AND si.symbol = ?";
    params.push(symbol.toUpperCase());
  }

  if (indicatorType) {
    query += " AND it.name = ?";
    params.push(indicatorType);
  }

  query += " ORDER BY si.symbol, si.indicator_type_id";

  const { results } = await db.prepare(query).bind(...params).all<any>();

  // Transform the results to include indicatorType object
  return (results ?? []).map(row => ({
    ...row,
    indicatorType: {
      id: row.indicator_type_id,
      name: row.indicator_type_name,
      display_name: row.display_name,
      description: row.indicator_type_description,
      unit: row.unit,
      is_active: row.indicator_type_is_active,
      created_at: row.indicator_type_created_at
    }
  }));
};

export const getSymbolIndicator = async (
  db: D1Database,
  symbol: string,
  indicatorType: string
): Promise<SymbolIndicatorRecord | null> => {
  const query = `
    SELECT si.*, it.name as indicator_name, it.display_name, it.unit
    FROM symbol_indicators si
    JOIN indicator_types it ON si.indicator_type_id = it.id
    WHERE si.symbol = ? AND it.name = ? AND si.enabled = 1 AND it.is_active = 1
  `;
  return db.prepare(query).bind(symbol.toUpperCase(), indicatorType).first<SymbolIndicatorRecord>();
};

export const createSymbolIndicator = async (
  db: D1Database,
  input: {
    symbol: string;
    indicatorTypeId: number;
    thresholdValue: number;
    thresholdOperator: string;
    enabled?: boolean;
    cooldownMinutes?: number;
    webhookUrl?: string;
  }
): Promise<SymbolIndicatorRecord> => {
  const enabled = toFlag(input.enabled ?? 1) ?? 1;
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT OR REPLACE INTO symbol_indicators
       (symbol, indicator_type_id, threshold_value, threshold_operator, enabled, cooldown_minutes, webhook_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.symbol.toUpperCase(),
      input.indicatorTypeId,
      input.thresholdValue,
      input.thresholdOperator,
      enabled,
      input.cooldownMinutes ?? null,
      input.webhookUrl ?? null,
      now,
      now
    )
    .run();

  const record = await getSymbolIndicator(db, input.symbol,
    (await getIndicatorTypes(db)).find(it => it.id === input.indicatorTypeId)?.name || ''
  );

  if (!record) {
    throw new Error("Failed to create symbol indicator");
  }
  return record;
};

export const updateSymbolIndicator = async (
  db: D1Database,
  symbol: string,
  indicatorType: string,
  updates: {
    thresholdValue?: number;
    thresholdOperator?: string;
    enabled?: boolean;
    cooldownMinutes?: number;
    webhookUrl?: string;
  }
): Promise<SymbolIndicatorRecord | null> => {
  const setFields: string[] = [];
  const params: unknown[] = [];

  if (typeof updates.thresholdValue !== 'undefined') {
    setFields.push("threshold_value = ?");
    params.push(updates.thresholdValue);
  }

  if (typeof updates.thresholdOperator !== 'undefined') {
    setFields.push("threshold_operator = ?");
    params.push(updates.thresholdOperator);
  }

  if (typeof updates.enabled !== 'undefined') {
    setFields.push("enabled = ?");
    params.push(toFlag(updates.enabled));
  }

  if (typeof updates.cooldownMinutes !== 'undefined') {
    setFields.push("cooldown_minutes = ?");
    params.push(updates.cooldownMinutes);
  }

  if (typeof updates.webhookUrl !== 'undefined') {
    setFields.push("webhook_url = ?");
    params.push(updates.webhookUrl);
  }

  if (setFields.length === 0) {
    return getSymbolIndicator(db, symbol, indicatorType);
  }

  setFields.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(symbol.toUpperCase());

  const indicatorTypeRecord = await getIndicatorTypeByName(db, indicatorType);
  if (!indicatorTypeRecord) {
    throw new Error("Indicator type not found");
  }

  params.push(indicatorTypeRecord.id);

  await db
    .prepare(`UPDATE symbol_indicators SET ${setFields.join(", ")} WHERE symbol = ? AND indicator_type_id = ?`)
    .bind(...params)
    .run();

  return getSymbolIndicator(db, symbol, indicatorType);
};

// 新版告警记录相关操作
export const createAlertNew = async (
  db: D1Database,
  alert: {
    symbol: string;
    indicatorTypeId: number;
    indicatorValue: number;
    thresholdValue: number;
    changePercent?: number;
    direction?: string;
    windowStart: number;
    windowEnd: number;
    windowMinutes: number;
    idempotencyKey: string;
    status: AlertStatus;
    responseCode?: number | null;
    responseBody?: string | null;
    metadata?: string;
  }
): Promise<AlertRecordNew> => {
  await db
    .prepare(
      `INSERT INTO alerts_new
       (symbol, indicator_type_id, indicator_value, threshold_value, change_percent, direction,
        window_start, window_end, window_minutes, idempotency_key, status, response_code, response_body, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      alert.symbol.toUpperCase(),
      alert.indicatorTypeId,
      alert.indicatorValue,
      alert.thresholdValue,
      alert.changePercent ?? null,
      alert.direction ?? null,
      alert.windowStart,
      alert.windowEnd,
      alert.windowMinutes,
      alert.idempotencyKey,
      alert.status,
      alert.responseCode ?? null,
      alert.responseBody ?? null,
      alert.metadata ?? null,
      new Date().toISOString()
    )
    .run();

  const record = await db
    .prepare("SELECT * FROM alerts_new WHERE idempotency_key = ?")
    .bind(alert.idempotencyKey)
    .first<AlertRecordNew>();

  if (!record) {
    throw new Error("Failed to create alert");
  }
  return record;
};

export const findAlertNewByIdempotency = async (
  db: D1Database,
  key: string
): Promise<AlertRecordNew | null> => {
  return db
    .prepare("SELECT * FROM alerts_new WHERE idempotency_key = ?")
    .bind(key)
    .first<AlertRecordNew>();
};

export const getLatestAlertNewForSymbol = async (
  db: D1Database,
  symbol: string,
  indicatorType?: string
): Promise<AlertRecordNew | null> => {
  let query = `
    SELECT a.*, it.name as indicator_name
    FROM alerts_new a
    JOIN indicator_types it ON a.indicator_type_id = it.id
    WHERE a.symbol = ?
  `;
  const params: unknown[] = [symbol.toUpperCase()];

  if (indicatorType) {
    query += " AND it.name = ?";
    params.push(indicatorType);
  }

  query += " ORDER BY a.window_end DESC LIMIT 1";

  return db.prepare(query).bind(...params).first<AlertRecordNew>();
};

export const listAlertsNew = async (
  db: D1Database,
  filters: {
    symbol?: string;
    indicatorType?: string;
    since?: number;
    status?: AlertStatus;
    limit?: number;
  } = {}
): Promise<AlertRecordNew[]> => {
  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.symbol) {
    where.push("a.symbol = ?");
    params.push(filters.symbol.toUpperCase());
  }

  if (filters.indicatorType) {
    where.push("it.name = ?");
    params.push(filters.indicatorType);
  }

  if (typeof filters.since === "number") {
    where.push("a.window_end >= ?");
    params.push(filters.since);
  }

  if (filters.status) {
    where.push("a.status = ?");
    params.push(filters.status);
  }

  const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);

  const { results } = await db
    .prepare(
      `SELECT a.*, it.name as indicator_name, it.display_name
       FROM alerts_new a
       JOIN indicator_types it ON a.indicator_type_id = it.id
       ${whereClause}
       ORDER BY a.window_end DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all<AlertRecordNew>();

  return results ?? [];
};
