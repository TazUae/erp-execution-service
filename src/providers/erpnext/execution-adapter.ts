import { ZodError } from "zod";
import type { Env } from "../../config/env.js";
import type { RemoteExecuteRequest } from "../../contracts/lifecycle.js";
import type { RemoteExecutionFailure } from "../../contracts/lifecycle.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import { NotImplementedError } from "../../lib/not-implemented-error.js";
import type { Logger } from "pino";

export type LifecycleActionOutcome =
  | { ok: true; durationMs: number; metadata?: Record<string, string | number | boolean> }
  | { ok: false; failure: RemoteExecutionFailure };

export type LifecycleAdapter = {
  run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome>;
};

function httpAdapterNotReadyFailure(): RemoteExecutionFailure {
  const err = new NotImplementedError();
  return {
    code: "INFRA_UNAVAILABLE",
    message: "ERP HTTP provisioning is not wired yet",
    retryable: true,
    details: `${err.name}: ${err.message} (FrappeClient; ERP_BASE_URL)`,
  };
}

/**
 * Lifecycle adapter: will delegate to FrappeClient against ERP_BASE_URL.
 * Bench, subprocess, and filesystem-based ERP access have been removed.
 */
export class ErpExecutionAdapter implements LifecycleAdapter {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger
  ) {}

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

    const durationMs = Date.now() - started;
    log.debug(
      { action: request.action, durationMs, erpBaseUrlConfigured: Boolean(this.env.ERP_BASE_URL) },
      "lifecycle action deferred to HTTP adapter (not implemented)"
    );
    return { ok: false, failure: httpAdapterNotReadyFailure() };
  }

  private childLog(requestId?: string): Logger {
    return requestId ? this.logger.child({ requestId }) : this.logger;
  }
}
