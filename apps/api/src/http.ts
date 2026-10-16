import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";

export const errorCodes = {
  400: "BAD_REQUEST",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "VALIDATION_FAILED",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
  503: "SERVICE_UNAVAILABLE",
} as const;
export type ErrorCode =
  | (typeof errorCodes)[keyof typeof errorCodes]
  | "ORIGIN_REJECTED"
  | "CSRF_REJECTED"
  | "INVALID_REFERENCE"
  | "DUPLICATE_RECORD";
const allowedCodes = new Set<string>([
  ...Object.values(errorCodes),
  "ORIGIN_REJECTED",
  "CSRF_REJECTED",
  "INVALID_REFERENCE",
  "DUPLICATE_RECORD",
]);
export class ApiError extends Error {
  readonly code: ErrorCode;
  constructor(
    public readonly status: keyof typeof errorCodes,
    publicMessage: string,
    code?: ErrorCode,
  ) {
    super(publicMessage);
    this.code = code && allowedCodes.has(code) ? code : errorCodes[status];
  }
}
export type FailureEvent = Readonly<{
  event: "http.request.failed";
  requestId: string;
  status: number;
  code: ErrorCode;
  method: string;
}>;
export type FailureLogger = (event: FailureEvent) => void;
const defaultLog: FailureLogger = (event) =>
  console.error(JSON.stringify(event));

export const requestContext: RequestHandler = (_req, res, next) => {
  // Generate our own identity; arbitrary inbound correlation values are untrusted.
  res.locals.requestId = randomUUID();
  res.set("X-Request-ID", res.locals.requestId);
  res.set("Cache-Control", "no-store");
  next();
};
export function classifyError(error: unknown): {
  status: number;
  code: ErrorCode;
  error: string;
} {
  if (error instanceof ZodError)
    return {
      status: 422,
      code: "VALIDATION_FAILED",
      error: "Request validation failed. Check the submitted values.",
    };
  if (error instanceof ApiError && Object.hasOwn(errorCodes, error.status)) {
    if (error.status === 500)
      return {
        status: 500,
        code: "INTERNAL_ERROR",
        error: "Request could not be completed",
      };
    if (error.status === 503)
      return {
        status: 503,
        code: "SERVICE_UNAVAILABLE",
        error:
          "Service temporarily unavailable. Check saved records before retrying.",
      };
    return { status: error.status, code: error.code, error: error.message };
  }
  const detail =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  if (detail.type === "entity.too.large")
    return {
      status: 413,
      code: "PAYLOAD_TOO_LARGE",
      error: "Request too large",
    };
  if (detail.type === "entity.parse.failed")
    return { status: 400, code: "BAD_REQUEST", error: "Invalid JSON" };
  if (detail.code === "23503")
    return {
      status: 422,
      code: "INVALID_REFERENCE",
      error: "Invalid record reference",
    };
  if (detail.code === "23505")
    return {
      status: 409,
      code: "DUPLICATE_RECORD",
      error: "A matching record already exists",
    };
  if (detail.code === "42501")
    return {
      status: 403,
      code: "FORBIDDEN",
      error: "Access to this operation is denied",
    };
  if (detail.code === "40001" || detail.code === "40P01")
    return {
      status: 409,
      code: "CONFLICT",
      error: "Concurrent change detected. Refresh and review before retrying.",
    };
  if (
    ["08003", "08006", "57P01", "ECONNREFUSED", "ETIMEDOUT"].includes(
      String(detail.code),
    )
  )
    return {
      status: 503,
      code: "SERVICE_UNAVAILABLE",
      error:
        "Service temporarily unavailable. Check saved records before retrying.",
    };
  return {
    status: 500,
    code: "INTERNAL_ERROR",
    error: "Request could not be completed",
  };
}
export function safeErrorHandler(
  log: FailureLogger = defaultLog,
): ErrorRequestHandler {
  return (error: unknown, req, res, _next) => {
    const failure = classifyError(error);
    const requestId: string = res.locals.requestId ?? randomUUID();
    const event: FailureEvent = {
      event: "http.request.failed",
      requestId,
      status: failure.status,
      code: failure.code,
      method: [
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
      ].includes(req.method)
        ? req.method
        : "OTHER",
    };
    // Do not forward raw errors to Express's default logger after headers are sent.
    // Logging failure must not replace a safe response with a new exception.
    try {
      log(event);
    } catch {
      /* The response contract remains safe. */
    }
    if (res.headersSent) {
      res.destroy();
      return;
    }
    res.set("X-Request-ID", requestId);
    res.set("Cache-Control", "no-store");
    res
      .status(failure.status)
      .json({ error: failure.error, code: failure.code, requestId });
  };
}
