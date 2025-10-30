export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const unauthorized = (message = "Unauthorized") =>
  new AppError(401, "UNAUTHORIZED", message);

export const notFound = (message = "Not Found") => new AppError(404, "NOT_FOUND", message);

export const badRequest = (message: string, details?: Record<string, unknown>) =>
  new AppError(400, "BAD_REQUEST", message, details);

export const conflict = (message: string) => new AppError(409, "CONFLICT", message);

export const internalError = (message = "Internal Server Error") =>
  new AppError(500, "INTERNAL_ERROR", message);
