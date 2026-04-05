import type { Env } from "../../config/env.js";
import { HttpProvisioningError, truncateSafeSnippet } from "./errors.js";
import { joinFrappeBaseUrl } from "./frappe-url.js";
import type { FrappeMethodJson, PingResult } from "./types.js";

export type HttpProvisioningClientOptions = {
  baseUrl: string;
  /** Frappe token auth value: `api_key:api_secret` (sent as `Authorization: token …`). */
  authToken: string;
  timeoutMs: number;
  /** GET path for upstream health (default `/api/method/frappe.ping`). */
  healthPath: string;
};

/**
 * HTTP client for ERPNext/Frappe `/api/method/...` provisioning endpoints.
 * Requires custom whitelisted methods on the ERP side (see README).
 */
export class HttpProvisioningClient {
  constructor(private readonly options: HttpProvisioningClientOptions) {}

  /**
   * Builds the Frappe `Authorization` header. The raw token is never logged by this class.
   */
  static buildAuthorizationHeader(authToken: string): string {
    return `token ${authToken}`;
  }

  /**
   * POST JSON to `/api/method/<dotted.method>`.
   * @param methodPath Dotted Frappe method, e.g. `frappe.api.provisioning.create_site`
   */
  async postMethod(methodPath: string, body?: Record<string, unknown>): Promise<FrappeMethodJson> {
    const path = `/api/method/${methodPath}`;
    const url = joinFrappeBaseUrl(this.options.baseUrl, path);
    return this.requestJson("POST", url, body ?? {});
  }

  /**
   * Lightweight upstream reachability check (default `frappe.ping`).
   */
  async ping(): Promise<PingResult> {
    const url = joinFrappeBaseUrl(this.options.baseUrl, this.options.healthPath);
    const json = await this.requestJson("GET", url, undefined);
    return { ok: true, message: json.message };
  }

  private async requestJson(
    method: "GET" | "POST",
    url: string,
    jsonBody: Record<string, unknown> | undefined
  ): Promise<FrappeMethodJson> {
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: HttpProvisioningClient.buildAuthorizationHeader(this.options.authToken),
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
      if (!res.ok) {
        throw this.mapNonOkResponse(res.status, text);
      }

      if (!text || text.trim() === "") {
        return {};
      }

      try {
        return JSON.parse(text) as FrappeMethodJson;
      } catch (cause) {
        throw new HttpProvisioningError(
          "parse",
          "Upstream returned non-JSON body",
          {
            safeDetails: truncateSafeSnippet(text),
            cause,
          }
        );
      }
    } catch (error) {
      if (error instanceof HttpProvisioningError) {
        throw error;
      }
      throw this.mapFetchError(error, timeoutMs);
    } finally {
      clearTimeout(timer);
    }
  }

  private mapNonOkResponse(status: number, bodyText: string): HttpProvisioningError {
    const snippet = truncateSafeSnippet(bodyText);
    if (status === 401 || status === 403) {
      return new HttpProvisioningError("unauthorized", "Upstream rejected credentials", {
        upstreamStatus: status,
        safeDetails: snippet || `HTTP ${status}`,
      });
    }
    if (status === 404) {
      return new HttpProvisioningError("not_found", "Upstream path not found", {
        upstreamStatus: status,
        safeDetails: snippet || `HTTP ${status}`,
      });
    }
    if (status === 400 || status === 422) {
      return new HttpProvisioningError("bad_request", "Upstream rejected the request", {
        upstreamStatus: status,
        safeDetails: snippet || `HTTP ${status}`,
      });
    }
    if (status >= 500) {
      return new HttpProvisioningError("upstream", "Upstream server error", {
        upstreamStatus: status,
        safeDetails: snippet || `HTTP ${status}`,
      });
    }
    return new HttpProvisioningError("upstream", "Unexpected upstream response", {
      upstreamStatus: status,
      safeDetails: snippet || `HTTP ${status}`,
    });
  }

  private mapFetchError(error: unknown, timeoutMs: number): HttpProvisioningError {
    if (error instanceof Error && error.name === "AbortError") {
      return new HttpProvisioningError(
        "timeout",
        `Request exceeded timeout (${timeoutMs}ms)`,
        { cause: error }
      );
    }

    const err = error as NodeJS.ErrnoException & { cause?: { code?: string } };
    const code = err.code ?? err.cause?.code;
    const retryableCodes = new Set([
      "ECONNREFUSED",
      "ECONNRESET",
      "EPIPE",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ETIMEDOUT",
      "UND_ERR_CONNECT_TIMEOUT",
    ]);
    if (typeof code === "string" && retryableCodes.has(code)) {
      return new HttpProvisioningError("network", "Could not reach ERP upstream", {
        safeDetails: code,
        cause: error,
      });
    }

    if (error instanceof TypeError) {
      return new HttpProvisioningError("network", "Network error calling ERP upstream", {
        safeDetails: error.message,
        cause: error,
      });
    }

    return new HttpProvisioningError("upstream", "Unexpected error during ERP request", {
      safeDetails: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}

/**
 * Builds a client from validated env. Requires `ERP_BASE_URL` and `ERP_AUTH_TOKEN`.
 */
export function createHttpProvisioningClient(env: Pick<Env, "ERP_BASE_URL" | "ERP_AUTH_TOKEN" | "ERP_COMMAND_TIMEOUT_MS" | "ERP_HEALTH_PATH">): HttpProvisioningClient {
  if (!env.ERP_BASE_URL) {
    throw new HttpProvisioningError("configuration", "ERP_BASE_URL is not set");
  }
  if (!env.ERP_AUTH_TOKEN) {
    throw new HttpProvisioningError("configuration", "ERP_AUTH_TOKEN is not set");
  }
  return new HttpProvisioningClient({
    baseUrl: env.ERP_BASE_URL,
    authToken: env.ERP_AUTH_TOKEN,
    timeoutMs: env.ERP_COMMAND_TIMEOUT_MS,
    healthPath: env.ERP_HEALTH_PATH,
  });
}
