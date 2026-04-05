/**
 * Known error codes returned in {@link FrappeErrorResult} (normalized client surface).
 */
export type FrappeErrorCode =
  | "AUTH_ERROR"
  | "METHOD_NOT_FOUND"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "ERP_APPLICATION_ERROR"
  | "INVALID_RESPONSE"
  | "UPSTREAM_HTTP_ERROR";

export type FrappeErrorBody = {
  code: FrappeErrorCode;
  message: string;
};

export type FrappeSuccessResult = {
  ok: true;
  /** Frappe `message` field on success. */
  data: unknown;
};

export type FrappeErrorResult = {
  ok: false;
  error: FrappeErrorBody;
};

export type FrappeResponse = FrappeSuccessResult | FrappeErrorResult;

/**
 * Raw JSON from Frappe `/api/method/...` (shape varies by version and outcome).
 */
export type FrappeRawJson = {
  message?: unknown;
  exc?: string;
  exception?: string;
  exc_type?: string;
  _server_messages?: string;
  [key: string]: unknown;
};
