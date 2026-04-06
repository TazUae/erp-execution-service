/**
 * Known error codes returned in {@link FrappeErrorResult} (normalized client surface).
 */
export type FrappeErrorCode =
  | "AUTH_ERROR"
  | "METHOD_NOT_FOUND"
  | "SITE_NOT_FOUND"
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
 * Typed outcome for ``provisioning_api.api.provisioning.read_site_db_name`` (Frappe wraps the RPC return in ``message``).
 */
export type ReadSiteDbNameResult =
  | { ok: true; dbName: string }
  | { ok: false; error: { code: FrappeErrorCode; message: string } };

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
