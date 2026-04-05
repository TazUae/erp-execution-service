import type { Env } from "../../config/env.js";
import { errResult, safeExcMessage, truncateSafeSnippet } from "./errors.js";
import type { FrappeRawJson, FrappeResponse } from "./types.js";
import { buildFrappeMethodUrl, joinFrappeBaseUrl } from "./url.js";

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

export class FrappeClient {
  constructor(private readonly options: FrappeClientOptions) {}

  /**
   * Provisioning API auth: `Authorization: Bearer <ERP_PROVISIONING_TOKEN>`.
   * Raw values must never be logged.
   */
  static buildAuthorizationHeader(provisioningToken: string): string {
    return `Bearer ${provisioningToken}`;
  }

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
   * GET `/api/method/frappe.ping` — lightweight upstream reachability check.
   */
  async ping(): Promise<FrappeResponse> {
    const url = joinFrappeBaseUrl(this.options.baseUrl, "/api/method/frappe.ping");
    return this.request("GET", url, undefined);
  }

  private async request(
    method: "GET" | "POST",
    url: string,
    jsonBody: unknown | undefined
  ): Promise<FrappeResponse> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: FrappeClient.buildAuthorizationHeader(this.options.provisioningToken),
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

      const text = await res.text();
      return this.normalizeResponse(res.status, text);
    } catch (error) {
      return this.mapFetchFailure(error, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  private normalizeResponse(status: number, bodyText: string): FrappeResponse {
    const trimmed = bodyText.trim();
    let parsed: FrappeRawJson | undefined;
    let parseFailed = false;
    if (trimmed !== "") {
      try {
        parsed = JSON.parse(bodyText) as FrappeRawJson;
      } catch {
        parseFailed = true;
        parsed = undefined;
      }
    }

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
