type LogLevel = "debug" | "info" | "warn" | "error";

type LogMetadata = Record<string, unknown>;

const log = (level: LogLevel, message: string, metadata?: LogMetadata) => {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...(metadata ?? {}),
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
};

export const logger = {
  debug: (message: string, metadata?: LogMetadata) => log("debug", message, metadata),
  info: (message: string, metadata?: LogMetadata) => log("info", message, metadata),
  warn: (message: string, metadata?: LogMetadata) => log("warn", message, metadata),
  error: (message: string, metadata?: LogMetadata) => log("error", message, metadata),
};

export type Logger = typeof logger;
