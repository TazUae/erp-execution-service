import http from "node:http";
import https from "node:https";
import { buildAuthHeaders, SIGNATURE_HEADER, TIMESTAMP_HEADER } from "./sign.js";

/**
 * HTTP client for axis-bench-agent. Replaces the previous `docker exec`
 * path in erp-execution-service. All `/v1/*` calls are HMAC-signed; the
 * agent enforces a ±300s clock skew window so system time matters.
 *
 * Error mapping: the agent returns `{ ok: false, error: { code, message,
 * details } }` envelopes with `details.step/exit_code/stdout/stderr/command`
 * on bench failures. We surface those as `BenchAgentError` so the
 * execution-service can translate into its existing `CreateSiteExecutionError`
 * shape without losing bench-level detail.
 */

export type BenchAgentClientOptions = {
  baseUrl: string;
  hmacSecret: string;
  timeoutMs: number;
};

export type BenchAgentErrorDetails = {
  step?: string;
  exit_code?: number | null;
  stdout?: string;
  stderr?: string;
  command?: string;
  [k: string]: unknown;
};

/**
 * Structured error raised whenever the agent returns a non-2xx envelope OR
 * the transport itself fails. `code` is the agent's error code on envelope
 * failures, or a transport code (`NETWORK_ERROR` / `TIMEOUT` / ...) otherwise.
 */
export class BenchAgentError extends Error {
  override readonly name = "BenchAgentError";
  constructor(
    readonly code: string,
    message: string,
    readonly httpStatus: number | null,
    readonly details: BenchAgentErrorDetails
  ) {
    super(message);
  }
}

export type NewSiteResult = {
  status: "created" | "exists";
  site: string;
  skipped?: boolean;
  /** MariaDB schema name read from site_config.json after bench new-site. */
  db_name?: string;
};

export type InstallAppResult = {
  status: "installed" | "already_installed";
  site: string;
  app: string;
  skipped?: boolean;
};

export type SetConfigResult = {
  status: "ok";
  site: string;
  key: string;
};

export type CreateApiUserResult = {
  site: string;
  user: string;
  api_key: string;
  api_secret: string;
};

export type SiteStatusResult = {
  site: string;
  exists: boolean;
  apps: string[];
};

export type SetupCompanyParams = {
  companyName: string;
  companyAbbr: string;
  country: string;
  defaultCurrency: string;
  companyType?: string;
  domain?: string;
};

export type SetupCompanyResult = {
  site: string;
  company: string;
  account_count: number;
  skipped: boolean;
  duration_ms: number;
};

export type SetupLocaleParams = {
  companyName: string;
  country: string;
  defaultCurrency: string;
  timezone: string;
  language: string;
  dateFormat: string;
  currencyPrecision: number;
};

export type SetupLocaleResult = {
  site: string;
  currency: string;
  timezone: string;
  duration_ms: number;
};

export type SetupFiscalYearParams = {
  companyName: string;
  fiscalYearStartMonth?: number;
  companyAbbr?: string;
};

export type SetupFiscalYearResult = {
  site: string;
  fiscal_year: string;
  start: string;
  end: string;
  duration_ms: number;
};

export type SetupGlobalDefaultsParams = {
  companyName: string;
  defaultCurrency: string;
  fiscalYearName: string;
  country: string;
};

export type SetupGlobalDefaultsResult = {
  site: string;
  duration_ms: number;
};

export type SetupCompleteParams = {
  companyName: string;
};

export type SetupCompleteResult = {
  site: string;
  setup_complete: boolean;
  duration_ms: number;
};

export type SetupRegionalParams = {
  country: string;
  companyName: string;
  companyAbbr?: string;
};

export type SetupDomainsParams = {
  companyName: string;
};

export type SetupDomainsResult = {
  site: string;
  modules_unblocked: number;
  duration_ms: number;
};

export type SetupRolesParams = {
  username: string;
};

export type SetupRolesResult = {
  site: string;
  roles_assigned: number;
  duration_ms: number;
};

export type SetupRegionalResult = {
  site: string;
  regional: boolean;
  reason?: string;
  duration_ms: number;
};

export type SetupFitdeskParams = {
  companyName: string;
  companyAbbr: string;
  controlPlaneWebhookUrl?: string;
  controlPlaneWebhookSecret?: string;
};

export type SetupFitdeskResult = {
  site: string;
  custom_fields: number;
  duration_ms: number;
};

export type SmokeTestParams = {
  companyName: string;
  apiKey: string;
  apiSecret: string;
};

export type SmokeTestResult = {
  site: string;
  smoke_test: string;
  tests_run: string[];
  duration_ms: number;
};

type EnvelopeSuccess<T> = { ok: true; data: T };
type EnvelopeFailure = {
  ok: false;
  error: { code: string; message: string; details?: BenchAgentErrorDetails };
};
type Envelope<T> = EnvelopeSuccess<T> | EnvelopeFailure;

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export class BenchAgentClient {
  constructor(private readonly options: BenchAgentClientOptions) {}

  /** POST /v1/sites — idempotent, agent checks site_config.json first. */
  async newSite(siteName: string, adminPassword: string): Promise<NewSiteResult> {
    return this.post<NewSiteResult>("/v1/sites", { site_name: siteName, admin_password: adminPassword });
  }

  /** POST /v1/sites/{site}/install-app — idempotent via bench list-apps. */
  async installApp(site: string, app: string): Promise<InstallAppResult> {
    return this.post<InstallAppResult>(
      `/v1/sites/${encodeURIComponent(site)}/install-app`,
      { app }
    );
  }

  /** POST /v1/sites/{site}/set-config — naturally idempotent on bench. */
  async setConfig(site: string, key: string, value: string): Promise<SetConfigResult> {
    return this.post<SetConfigResult>(
      `/v1/sites/${encodeURIComponent(site)}/set-config`,
      { key, value }
    );
  }

  /** POST /v1/sites/{site}/enable-scheduler. */
  async enableScheduler(site: string): Promise<{ status: "ok"; site: string }> {
    return this.post(`/v1/sites/${encodeURIComponent(site)}/enable-scheduler`, {});
  }

  /** POST /v1/sites/{site}/create-api-user. */
  async createApiUser(site: string, username: string): Promise<CreateApiUserResult> {
    return this.post<CreateApiUserResult>(
      `/v1/sites/${encodeURIComponent(site)}/create-api-user`,
      { username }
    );
  }

  /** POST /v1/setup/company — create Company doc and trigger CoA hooks. */
  async setupCompany(site: string, params: SetupCompanyParams): Promise<SetupCompanyResult> {
    return this.post<SetupCompanyResult>("/v1/setup/company", {
      site_name: site,
      company_name: params.companyName,
      company_abbr: params.companyAbbr,
      country: params.country,
      default_currency: params.defaultCurrency,
      company_type: params.companyType ?? "Company",
      domain: params.domain ?? "Services",
    });
  }

  /** POST /v1/setup/locale — enable currency and configure System Settings. */
  async setupLocale(site: string, params: SetupLocaleParams): Promise<SetupLocaleResult> {
    return this.post<SetupLocaleResult>("/v1/setup/locale", {
      site_name: site,
      company_name: params.companyName,
      country: params.country,
      default_currency: params.defaultCurrency,
      timezone: params.timezone,
      language: params.language,
      date_format: params.dateFormat,
      currency_precision: params.currencyPrecision,
    });
  }

  /** POST /v1/setup/fiscal-year — create Fiscal Year and link to company. */
  async setupFiscalYear(site: string, params: SetupFiscalYearParams): Promise<SetupFiscalYearResult> {
    return this.post<SetupFiscalYearResult>("/v1/setup/fiscal-year", {
      site_name: site,
      company_name: params.companyName,
      fiscal_year_start_month: params.fiscalYearStartMonth ?? 1,
      company_abbr: params.companyAbbr ?? "",
    });
  }

  /** POST /v1/setup/global-defaults — configure Global Defaults singleton. */
  async setupGlobalDefaults(site: string, params: SetupGlobalDefaultsParams): Promise<SetupGlobalDefaultsResult> {
    return this.post<SetupGlobalDefaultsResult>("/v1/setup/global-defaults", {
      site_name: site,
      company_name: params.companyName,
      default_currency: params.defaultCurrency,
      fiscal_year_name: params.fiscalYearName,
      country: params.country,
    });
  }

  /** POST /v1/setup/complete — set setup_complete = 1 (wizard bypass gate). */
  async setupComplete(site: string, params: SetupCompleteParams): Promise<SetupCompleteResult> {
    return this.post<SetupCompleteResult>("/v1/setup/complete", {
      site_name: site,
      company_name: params.companyName,
    });
  }

  /** POST /v1/setup/domains — activate all ERPNext business domains and unblock modules. */
  async setupDomains(site: string, params: SetupDomainsParams): Promise<SetupDomainsResult> {
    return this.post<SetupDomainsResult>("/v1/setup/domains", {
      site_name: site,
      company_name: params.companyName,
    });
  }

  /** POST /v1/setup/roles — sync full PROVISIONING_ROLES onto the API user and Administrator. */
  async setupRoles(site: string, params: SetupRolesParams): Promise<SetupRolesResult> {
    return this.post<SetupRolesResult>("/v1/setup/roles", {
      site_name: site,
      username: params.username,
    });
  }

  /** POST /v1/setup/smoke-test — run post-provisioning smoke test with provisioned credentials. */
  async smokeTest(site: string, params: SmokeTestParams): Promise<SmokeTestResult> {
    return this.post<SmokeTestResult>("/v1/setup/smoke-test", {
      site_name: site,
      company_name: params.companyName,
      api_key: params.apiKey,
      api_secret: params.apiSecret,
    });
  }

  /** POST /v1/setup/fitdesk — create FitDesk custom fields, item, customer group, print format, MoP, and Server Script. */
  async setupFitdesk(site: string, params: SetupFitdeskParams): Promise<SetupFitdeskResult> {
    return this.post<SetupFitdeskResult>("/v1/setup/fitdesk", {
      site_name: site,
      company_name: params.companyName,
      company_abbr: params.companyAbbr,
      ...(params.controlPlaneWebhookUrl ? { control_plane_webhook_url: params.controlPlaneWebhookUrl } : {}),
      ...(params.controlPlaneWebhookSecret ? { control_plane_webhook_secret: params.controlPlaneWebhookSecret } : {}),
    });
  }

  /** POST /v1/setup/regional — run ERPNext country localization module (non-fatal). */
  async setupRegional(site: string, params: SetupRegionalParams): Promise<SetupRegionalResult> {
    return this.post<SetupRegionalResult>("/v1/setup/regional", {
      site_name: site,
      country: params.country,
      company_name: params.companyName,
      company_abbr: params.companyAbbr ?? "",
    });
  }

  /** GET /v1/sites/{site}/status. */
  async siteStatus(site: string): Promise<SiteStatusResult> {
    return this.get<SiteStatusResult>(`/v1/sites/${encodeURIComponent(site)}/status`);
  }

  /** GET /health — unauthenticated liveness probe. */
  async health(): Promise<{ ok: true }> {
    const { status, bodyText } = await this.rawHttp("GET", "/health", undefined);
    if (status !== 200) {
      throw new BenchAgentError(
        "UPSTREAM_HTTP_ERROR",
        `bench-agent /health returned HTTP ${status}`,
        status,
        { stderr: truncate(bodyText) }
      );
    }
    return { ok: true };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path, undefined);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown | undefined
  ): Promise<T> {
    let status: number;
    let bodyText: string;
    try {
      const res = await this.rawHttp(method, path, body);
      status = res.status;
      bodyText = res.bodyText;
    } catch (error) {
      throw this.mapTransportFailure(error, method, path);
    }

    let parsed: Envelope<T> | undefined;
    try {
      parsed = bodyText ? (JSON.parse(bodyText) as Envelope<T>) : undefined;
    } catch {
      throw new BenchAgentError(
        "INVALID_RESPONSE",
        `bench-agent returned non-JSON body (HTTP ${status})`,
        status,
        { stderr: truncate(bodyText) }
      );
    }

    if (status >= 200 && status < 300 && parsed && parsed.ok === true) {
      return parsed.data;
    }

    if (parsed && parsed.ok === false) {
      throw new BenchAgentError(
        parsed.error.code || "BENCH_AGENT_ERROR",
        parsed.error.message || `bench-agent error (HTTP ${status})`,
        status,
        parsed.error.details ?? {}
      );
    }

    throw new BenchAgentError(
      "UPSTREAM_HTTP_ERROR",
      `bench-agent returned HTTP ${status}`,
      status,
      { stderr: truncate(bodyText) }
    );
  }

  /** Raw HTTP with HMAC signing. Does not JSON-parse or interpret status. */
  private async rawHttp(
    method: "GET" | "POST",
    path: string,
    jsonBody: unknown | undefined
  ): Promise<{ status: number; bodyText: string }> {
    const bodyStr = method === "POST" ? JSON.stringify(jsonBody ?? {}) : "";
    const url = joinUrl(this.options.baseUrl, path);
    const parsed = new URL(url);
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;

    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (method === "POST") {
      headers["Content-Type"] = "application/json";
    }

    // /health is the only unauthenticated route; everything else MUST sign.
    if (!path.startsWith("/health")) {
      const authHeaders = buildAuthHeaders(
        this.options.hmacSecret,
        method,
        parsed.pathname,
        bodyStr
      );
      headers[TIMESTAMP_HEADER] = authHeaders[TIMESTAMP_HEADER];
      headers[SIGNATURE_HEADER] = authHeaders[SIGNATURE_HEADER];
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    const port = parsed.port ? Number(parsed.port) : isHttps ? 443 : 80;

    try {
      return await new Promise<{ status: number; bodyText: string }>((resolve, reject) => {
        const opts: http.RequestOptions = {
          hostname: parsed.hostname,
          port,
          path: `${parsed.pathname}${parsed.search}`,
          method,
          headers,
          signal: controller.signal,
        };
        const req = lib.request(opts, (res) => {
          let buf = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => {
            buf += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode ?? 0, bodyText: buf });
          });
        });
        req.on("error", reject);
        if (method === "POST") {
          req.write(bodyStr);
        }
        req.end();
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private mapTransportFailure(
    error: unknown,
    method: string,
    path: string
  ): BenchAgentError {
    if (error instanceof Error && error.name === "AbortError") {
      return new BenchAgentError(
        "TIMEOUT",
        `bench-agent request timed out after ${this.options.timeoutMs}ms`,
        null,
        { command: `${method} ${path}`, stderr: `timeout after ${this.options.timeoutMs}ms` }
      );
    }
    const err = error as NodeJS.ErrnoException & { cause?: { code?: string } };
    const code = err.code ?? err.cause?.code;
    if (typeof code === "string" && RETRYABLE_NETWORK_CODES.has(code)) {
      return new BenchAgentError(
        "NETWORK_ERROR",
        `Could not reach bench-agent (${code})`,
        null,
        { command: `${method} ${path}`, stderr: code }
      );
    }
    const msg = error instanceof Error ? error.message : String(error);
    return new BenchAgentError(
      "NETWORK_ERROR",
      truncate(msg) || "Unexpected network error calling bench-agent",
      null,
      { command: `${method} ${path}`, stderr: truncate(msg) }
    );
  }
}

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

function truncate(s: string, max = 2000): string {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
