import type { CloudflareBindings } from "../config/env";

export const getDatabase = (bindings: CloudflareBindings): D1Database => bindings.DB;

export const checkDatabase = async (db: D1Database): Promise<boolean> => {
  try {
    const result = await db.prepare("SELECT 1 as ok").first<{ ok: number }>();
    return result?.ok === 1;
  } catch {
    return false;
  }
};
