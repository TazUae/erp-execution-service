import { ZodError } from "zod";
import type { Env } from "../../config/env.js";
import type { RemoteExecuteRequest } from "../../contracts/lifecycle.js";
import type { RemoteExecutionFailure } from "../../contracts/lifecycle.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import type { Logger } from "pino";
import { createFrappeClientFromEnv, type FrappeClient } from "../../lib/frappe-client/client.js";
import { mapFrappeErrorToRemoteFailure } from "./frappe-error-mapper.js";

export type LifecycleActionOutcome =
  | { ok: true; durationMs: number; metadata?: Record<string, string | number | boolean> }
  | { ok: false; failure: RemoteExecutionFailure };

export type LifecycleAdapter = {
  run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome>;
};

export type ErpExecutionAdapterDeps = {
  /** Injected for tests; when omitted, a client is created from `env` when ERP settings are present. */
  frappeClient?: FrappeClient;
};

/**
 * Contract field `site` is sent to Frappe as `site_name` (snake_case JSON), matching typical Frappe conventions.
 */
function infraNotConfiguredFailure(): RemoteExecutionFailure {
  return {
    code: "INFRA_UNAVAILABLE",
    message: "Outbound ERP is not configured (set ERP_BASE_URL, ERP_API_KEY, and ERP_API_SECRET)",
    retryable: true,
    details: "createFrappeClientFromEnv requires all three variables",
  };
}

function metadataFromUpstreamMessage(data: unknown): Record<string, string | number | boolean> | undefined {
  if (data === undefined || data === null) {
    return undefined;
  }
  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return { message: data };
  }
  if (typeof data === "object" && !Array.isArray(data)) {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      }
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  }
  return { upstream: JSON.stringify(data).slice(0, 500) };
}

/**
 * Lifecycle adapter: delegates to `FrappeClient` against `ERP_BASE_URL`.
 * Bench, subprocess, and filesystem-based ERP access have been removed.
 */
export class ErpExecutionAdapter implements LifecycleAdapter {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
    private readonly deps: ErpExecutionAdapterDeps = {}
  ) {}

  private resolveClient(): FrappeClient | null {
    if (this.deps.frappeClient) {
      return this.deps.frappeClient;
    }
    try {
      return createFrappeClientFromEnv(this.env);
    } catch {
      return null;
    }
  }

  async run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome> {
    const log = this.childLog(request.requestId);
    const started = Date.now();
    try {
      switch (request.action) {
        case "createSite":
          validateSite(request.payload.site);
          break;
        case "readSiteDbName":
          validateSite(request.payload.site);
          break;
        case "installErp":
          validateSite(request.payload.site);
          break;
        case "enableScheduler":
          validateSite(request.payload.site);
          break;
        case "addDomain":
          validateSite(request.payload.site);
          validateDomain(request.payload.domain);
          break;
        case "createApiUser":
          validateSite(request.payload.site);
          validateUsername(request.payload.apiUsername);
          break;
        case "healthCheck":
          break;
        default: {
          const _never: never = request;
          return _never;
        }
      }
    } catch (error) {
      if (error instanceof ZodError) {
        return {
          ok: false,
          failure: {
            code: "ERP_VALIDATION_FAILED",
            message: "Invalid input for lifecycle action",
            retryable: false,
            details: error.message,
          },
        };
      }
      throw error;
    }

    const client = this.resolveClient();
    if (!client) {
      if (request.action === "healthCheck") {
        const durationMs = Date.now() - started;
        log.debug({ durationMs }, "healthCheck: ERP not configured; skipping upstream ping");
        return {
          ok: true,
          durationMs,
          metadata: { erp_upstream: "not_configured" },
        };
      }
      return { ok: false, failure: infraNotConfiguredFailure() };
    }

    if (request.action === "healthCheck") {
      const pingResult = await client.ping();
      const durationMs = Date.now() - started;
      if (!pingResult.ok) {
        return {
          ok: false,
          failure: mapFrappeErrorToRemoteFailure(pingResult.error.code, pingResult.error.message),
        };
      }
      const meta = metadataFromUpstreamMessage(pingResult.data);
      return {
        ok: true,
        durationMs,
        metadata: { erp_upstream: "reachable", ...meta },
      };
    }

    const method = this.methodForAction(request.action);
    const payload = this.payloadForAction(request);
    log.debug({ action: request.action, method }, "calling Frappe method");

    const result = await client.callMethod(method, payload);
    const durationMs = Date.now() - started;

    if (!result.ok) {
      return {
        ok: false,
        failure: mapFrappeErrorToRemoteFailure(result.error.code, result.error.message),
      };
    }

    return {
      ok: true,
      durationMs,
      metadata: metadataFromUpstreamMessage(result.data),
    };
  }

  private methodForAction(
    action: Exclude<RemoteExecuteRequest["action"], "healthCheck">
  ): string {
    switch (action) {
      case "createSite":
        return this.env.ERP_METHOD_CREATE_SITE;
      case "readSiteDbName":
        return this.env.ERP_METHOD_READ_SITE_DB_NAME;
      case "installErp":
        return this.env.ERP_METHOD_INSTALL_ERP;
      case "enableScheduler":
        return this.env.ERP_METHOD_ENABLE_SCHEDULER;
      case "addDomain":
        return this.env.ERP_METHOD_ADD_DOMAIN;
      case "createApiUser":
        return this.env.ERP_METHOD_CREATE_API_USER;
      default: {
        const _never: never = action;
        return _never;
      }
    }
  }

  private payloadForAction(request: RemoteExecuteRequest): Record<string, string> {
    switch (request.action) {
      case "createSite":
        return { site_name: validateSite(request.payload.site) };
      case "readSiteDbName":
        return { site_name: validateSite(request.payload.site) };
      case "installErp":
        return { site_name: validateSite(request.payload.site) };
      case "enableScheduler":
        return { site_name: validateSite(request.payload.site) };
      case "addDomain":
        return {
          site_name: validateSite(request.payload.site),
          domain: validateDomain(request.payload.domain),
        };
      case "createApiUser":
        return {
          site_name: validateSite(request.payload.site),
          api_username: validateUsername(request.payload.apiUsername),
        };
      case "healthCheck":
        throw new Error("unreachable: healthCheck does not send a Frappe method payload");
      default: {
        const _never: never = request;
        return _never;
      }
    }
  }

  private childLog(requestId?: string): Logger {
    return requestId ? this.logger.child({ requestId }) : this.logger;
  }
}
