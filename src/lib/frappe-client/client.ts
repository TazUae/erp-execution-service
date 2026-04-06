import type { Env } from "../../config/env.js";
import { errResult, safeExcMessage, truncateSafeSnippet } from "./errors.js";
import type { FrappeRawJson, FrappeResponse, ReadSiteDbNameResult } from "./types.js";
import { buildFrappeMethodUrl, joinFrappeBaseUrl } from "./url.js";

/** Outbound provisioning auth header — not `Authorization: Bearer`, which Frappe handles as OAuth before app code runs. */
export const FRAPPE_PROVISIONING_TOKEN_HEADER = "X-Provisioning-Token";

export type FrappeClientOptions = {
  baseUrl: string;
  /** Same value as ERP `common_site_config.json` `provisioning_api_token`. */
  provisioningToken: string;
  timeoutMs: number;
};

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function parseJsonBody(bodyText: string): { parsed: FrappeRawJson | undefined; parseFailed: boolean } {
  const trimmed = bodyText.trim();
  if (trimmed === "") {
    return { parsed: undefined, parseFailed: false };
  }
  try {
    return { parsed: JSON.parse(bodyText) as FrappeRawJson, parseFailed: false };
  } catch {
    return { parsed: undefined, parseFailed: true };
  }
}

/**
 * Parses successful ``read_site_db_name`` payloads from Frappe's ``message`` (or ``data``) field.
 * Supports the provisioning_api envelope ``{ ok: true, data: { db_name } }`` and a flat ``{ db_name }`` return.
 */
function extractDbNameFromReadSiteRpcMessage(msg: unknown): string | null {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return null;
  }
  const o = msg as Record<string, unknown>;
  if (o.ok === true) {
    const data = o.data;
    if (typeof data === "object" && data !== null && !Array.isArray(data)) {
      const db = (data as { db_name?: unknown }).db_name;
      if (typeof db === "string" && db.trim().length > 0) {
        return db.trim();
      }
    }
    return null;
  }
  if (o.ok === false) {
    return null;
  }
  const db = o.db_name;
  if (typeof db === "string" && db.trim().length > 0) {
    return db.trim();
  }
  return null;
}

function provisioningSiteNotFoundFrom404(parsed: FrappeRawJson | undefined): { message: string } | null {
  const msg = parsed?.message;
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    return null;
  }
  const err = (msg as { error?: { code?: unknown; message?: unknown } }).error;
  if (!err || err.code !== "SITE_NOT_FOUND") {
    return null;
  }
  if (typeof err.message !== "string" || !err.message.trim()) {
    return { message: "SITE_NOT_FOUND" };
  }
  return { message: truncateSafeSnippet(err.message) };
}

export class FrappeClient {
  constructor(private readonly options: FrappeClientOptions) {}

  /**
   * POST JSON to `/api/method/{method}`.
   * @param method Dotted Frappe method path, e.g. `provisioning_api.api.provisioning.create_site`
   */
  async callMethod(method: string, payload?: unknown): Promise<FrappeResponse> {
    const url = buildFrappeMethodUrl(this.options.baseUrl, method);
    const body = payload === undefined ? {} : payload;
    return this.request("POST", url, body);
  }

  /**
   * POST ``read_site_db_name`` and parse the live Frappe envelope:
   * ``{ message: { ok: true, data: { db_name } } }`` on success,
   * ``{ message: { ok: false, error: { code: \"SITE_NOT_FOUND\", ... } } }`` on HTTP 404.
   */
  async callReadSiteDbName(method: string, payload: { site_name: string }): Promise<ReadSiteDbNameResult> {
    const url = buildFrappeMethodUrl(this.options.baseUrl, method);
    try {
      const { status, bodyText } = await this.rawHttp("POST", url, payload);
      const { parsed, parseFailed } = parseJsonBody(bodyText);
      return this.normalizeReadSiteDbNameResponse(status, parsed, bodyText, parseFailed);
    } catch (error) {
      return this.mapReadSiteDbNameFetchFailure(error, this.options.timeoutMs);
    }
  }

  /**
   * GET `/api/method/frappe.ping` — lightweight upstream reachability check.
   */
  async ping(): Promise<FrappeResponse> {
    const url = joinFrappeBaseUrl(this.options.baseUrl, "/api/method/frappe.ping");
    return this.request("GET", url, undefined);
  }

  private async request(method: "GET" | "POST", url: string, jsonBody: unknown | undefined): Promise<FrappeResponse> {
    try {
      const { status, bodyText } = await this.rawHttp(method, url, jsonBody);
      const { parsed, parseFailed } = parseJsonBody(bodyText);
      return this.normalizeResponse(status, parsed, bodyText, parseFailed);
    } catch (error) {
      return this.mapFetchFailure(error, this.options.timeoutMs);
    }
  }

  private async rawHttp(
    method: "GET" | "POST",
    url: string,
    jsonBody: unknown | undefined
  ): Promise<{ status: number; bodyText: string }> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      [FRAPPE_PROVISIONING_TOKEN_HEADER]: this.options.provisioningToken,
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    try {
      const res = await fetch(url, {
        method,
        headers,
        body: method === "POST" ? JSON.stringify(jsonBody ?? {}) : undefined,
        signal: controller.signal,
      });

      const bodyText = await res.text();
      return { status: res.status, bodyText };
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeReadSiteDbNameResponse(
    status: number,
    parsed: FrappeRawJson | undefined,
    bodyText: string,
    parseFailed: boolean
  ): ReadSiteDbNameResult {
    if (status >= 200 && status < 300 && parseFailed) {
      return { ok: false, error: { code: "INVALID_RESPONSE", message: "Upstream returned non-JSON body" } };
    }

    if (status === 401 || status === 403) {
      return {
        ok: false,
        error: {
          code: "AUTH_ERROR",
          message: this.httpErrorMessage(parsed, bodyText, "Upstream rejected credentials"),
        },
      };
    }

    if (status === 404) {
      const snf = provisioningSiteNotFoundFrom404(parsed);
      if (snf) {
        return { ok: false, error: { code: "SITE_NOT_FOUND", message: snf.message } };
      }
      return {
        ok: false,
        error: {
          code: "METHOD_NOT_FOUND",
          message: this.httpErrorMessage(parsed, bodyText, "Frappe method or route not found"),
        },
      };
    }

    if (status === 408) {
      return { ok: false, error: { code: "TIMEOUT", message: "Request timed out (HTTP 408)" } };
    }

    if (status >= 200 && status < 300) {
      if (parsed && this.hasExc(parsed)) {
        return { ok: false, error: { code: "ERP_APPLICATION_ERROR", message: safeExcMessage(parsed.exc) } };
      }
      const msg = parsed?.message ?? parsed?.data;
      const dbName = extractDbNameFromReadSiteRpcMessage(msg);
      if (dbName !== null) {
        return { ok: true, dbName };
      }
      return {
        ok: false,
        error: {
          code: "INVALID_RESPONSE",
          message:
            "read_site_db_name: expected message (or data) with ok/data.db_name or db_name (string) on HTTP 200",
        },
      };
    }

    if (parsed && this.hasExc(parsed)) {
      return { ok: false, error: { code: "ERP_APPLICATION_ERROR", message: safeExcMessage(parsed.exc) } };
    }

    if (status >= 500) {
      return {
        ok: false,
        error: {
          code: "UPSTREAM_HTTP_ERROR",
          message: this.httpErrorMessage(parsed, bodyText, `Upstream server error (HTTP ${status})`),
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "UPSTREAM_HTTP_ERROR",
        message: this.httpErrorMessage(parsed, bodyText, `Unexpected upstream response (HTTP ${status})`),
      },
    };
  }

  private normalizeResponse(
    status: number,
    parsed: FrappeRawJson | undefined,
    bodyText: string,
    parseFailed: boolean
  ): FrappeResponse {
    if (status >= 200 && status < 300 && parseFailed) {
      return errResult("INVALID_RESPONSE", "Upstream returned non-JSON body");
    }

    if (status === 401 || status === 403) {
      return errResult("AUTH_ERROR", this.httpErrorMessage(parsed, bodyText, "Upstream rejected credentials"));
    }
    if (status === 404) {
      return errResult("METHOD_NOT_FOUND", this.httpErrorMessage(parsed, bodyText, "Frappe method or route not found"));
    }
    if (status === 408) {
      return errResult("TIMEOUT", "Request timed out (HTTP 408)");
    }

    if (status >= 200 && status < 300) {
      if (parsed && this.hasExc(parsed)) {
        return errResult("ERP_APPLICATION_ERROR", safeExcMessage(parsed.exc));
      }
      return { ok: true, data: parsed?.message };
    }

    if (parsed && this.hasExc(parsed)) {
      return errResult("ERP_APPLICATION_ERROR", safeExcMessage(parsed.exc));
    }

    if (status >= 500) {
      return errResult(
        "UPSTREAM_HTTP_ERROR",
        this.httpErrorMessage(parsed, bodyText, `Upstream server error (HTTP ${status})`)
      );
    }

    return errResult(
      "UPSTREAM_HTTP_ERROR",
      this.httpErrorMessage(parsed, bodyText, `Unexpected upstream response (HTTP ${status})`)
    );
  }

  private hasExc(p: FrappeRawJson): boolean {
    return typeof p.exc === "string" && p.exc.trim().length > 0;
  }

  private httpErrorMessage(parsed: FrappeRawJson | undefined, raw: string, fallback: string): string {
    if (parsed?.message !== undefined && typeof parsed.message === "string" && parsed.message.trim()) {
      return truncateSafeSnippet(parsed.message);
    }
    const snippet = truncateSafeSnippet(raw);
    return snippet || fallback;
  }

  private mapFetchFailure(error: unknown, timeoutMs: number): FrappeResponse {
    if (error instanceof Error && error.name === "AbortError") {
      return errResult("TIMEOUT", `Request exceeded timeout (${timeoutMs}ms)`);
    }

    const err = error as NodeJS.ErrnoException & { cause?: { code?: string } };
    const code = err.code ?? err.cause?.code;
    if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code)) {
      return errResult("NETWORK_ERROR", `Could not reach ERP upstream (${code})`);
    }

    if (error instanceof TypeError) {
      return errResult("NETWORK_ERROR", "Network error calling ERP upstream");
    }

    const msg = error instanceof Error ? error.message : String(error);
    return errResult("NETWORK_ERROR", truncateSafeSnippet(msg) || "Unexpected network error");
  }

  private mapReadSiteDbNameFetchFailure(error: unknown, timeoutMs: number): ReadSiteDbNameResult {
    const r = this.mapFetchFailure(error, timeoutMs);
    if (!r.ok) {
      return { ok: false, error: r.error };
    }
    return { ok: false, error: { code: "INVALID_RESPONSE", message: "Unexpected success after fetch failure" } };
  }
}

export function createFrappeClientFromEnv(
  env: Pick<Env, "ERP_BASE_URL" | "ERP_PROVISIONING_TOKEN" | "ERP_COMMAND_TIMEOUT_MS">
): FrappeClient {
  if (!env.ERP_BASE_URL) {
    throw new Error("ERP_BASE_URL is not set");
  }
  const token = env.ERP_PROVISIONING_TOKEN?.trim();
  if (!token) {
    throw new Error("ERP_PROVISIONING_TOKEN is not set");
  }
  return new FrappeClient({
    baseUrl: env.ERP_BASE_URL,
    provisioningToken: token,
    timeoutMs: env.ERP_COMMAND_TIMEOUT_MS,
  });
}
