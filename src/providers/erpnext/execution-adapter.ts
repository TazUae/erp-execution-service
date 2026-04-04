import { ZodError } from "zod";
import { isUnexpectedDbNameFormat } from "erp-utils";
import type { Env } from "../../config/env.js";
import { callErp, ErpCallError } from "../../lib/call-erp.js";
import type { RemoteExecuteRequest } from "../../contracts/lifecycle.js";
import type { RemoteExecutionFailure } from "../../contracts/lifecycle.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import { mapErpCallErrorToFailure } from "./result-mapper.js";
import type { Logger } from "pino";

export type CreateSiteResult = {
  success: true;
  site: string;
  dbName: string;
};

export type LifecycleActionOutcome =
  | { ok: true; durationMs: number; metadata?: Record<string, string | number | boolean> }
  | { ok: false; failure: RemoteExecutionFailure };

export type LifecycleAdapter = {
  run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome>;
};

const SITE_CONFIG_POLL_MAX_ATTEMPTS = 5;
const SITE_CONFIG_POLL_INTERVAL_MS = 1000;

const ERP_METHOD = {
  createSite: "/api/method/frappe.api.provisioning.create_site",
  readSiteDbName: "/api/method/frappe.api.provisioning.read_site_db_name",
  installErp: "/api/method/frappe.api.provisioning.install_erp",
  enableScheduler: "/api/method/frappe.api.provisioning.enable_scheduler",
  addDomain: "/api/method/frappe.api.provisioning.add_domain",
  createApiUser: "/api/method/frappe.api.provisioning.create_api_user",
  healthPing: "/api/method/frappe.ping",
} as const;

function parseDbNameFromErpPayload(data: Record<string, unknown>): string | null {
  const raw = data.db_name ?? data.dbName;
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return null;
}

/**
 * Polls ERP until `read_site_db_name` returns a `db_name` (HTTP only; no filesystem).
 */
async function pollReadSiteDbName(
  env: Env,
  log: Logger,
  site: string
): Promise<{ dbName: string; attempts: number; waitMs: number }> {
  const started = Date.now();
  let lastError: ErpCallError | undefined;

  for (let i = 0; i < SITE_CONFIG_POLL_MAX_ATTEMPTS; i++) {
    try {
      const data = await callErp(env, log, ERP_METHOD.readSiteDbName, { site_name: site });
      const dbName = parseDbNameFromErpPayload(data);
      if (dbName) {
        const waitMs = Date.now() - started;
        if (i > 0) {
          log.info(
            {
              metric: "site_config_retry_count",
              value: i + 1,
              site,
              attempts: i + 1,
            },
            "read_site_db_name became ready after retries"
          );
        }
        return { dbName, attempts: i + 1, waitMs };
      }
    } catch (e) {
      if (e instanceof ErpCallError) {
        lastError = e;
      } else {
        throw e;
      }
    }

    log.debug(
      {
        metric: "site_config_retry_count",
        attempt: i + 1,
        site,
      },
      "read_site_db_name not ready yet"
    );

    if (i < SITE_CONFIG_POLL_MAX_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, SITE_CONFIG_POLL_INTERVAL_MS));
    }
  }

  if (lastError) {
    throw lastError;
  }
  throw new Error("SITE_DB_NAME_NOT_READY");
}

/**
 * HTTP-only ERP lifecycle: allowlisted POSTs to Frappe methods; no bench or subprocesses.
 */
export class ErpExecutionAdapter implements LifecycleAdapter {
  constructor(
    private readonly env: Env,
    private readonly logger: Logger
  ) {}

  async run(request: RemoteExecuteRequest): Promise<LifecycleActionOutcome> {
    const log = this.childLog(request.requestId);
    try {
      switch (request.action) {
        case "createSite":
          return await this.runCreateSite(validateSite(request.payload.site), log);
        case "readSiteDbName":
          return await this.runReadSiteDbName(validateSite(request.payload.site), log);
        case "installErp":
          return await this.runSimpleErpCall(
            "installErp",
            ERP_METHOD.installErp,
            { site_name: validateSite(request.payload.site) },
            log
          );
        case "enableScheduler":
          return await this.runSimpleErpCall(
            "enableScheduler",
            ERP_METHOD.enableScheduler,
            { site_name: validateSite(request.payload.site) },
            log
          );
        case "addDomain":
          return await this.runSimpleErpCall(
            "addDomain",
            ERP_METHOD.addDomain,
            {
              site_name: validateSite(request.payload.site),
              domain: validateDomain(request.payload.domain),
            },
            log
          );
        case "createApiUser":
          return await this.runSimpleErpCall(
            "createApiUser",
            ERP_METHOD.createApiUser,
            {
              site_name: validateSite(request.payload.site),
              api_username: validateUsername(request.payload.apiUsername),
            },
            log
          );
        case "healthCheck":
          return await this.runHealthCheck(request.payload.deep === true, log);
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
  }

  private childLog(requestId?: string): Logger {
    return requestId ? this.logger.child({ requestId }) : this.logger;
  }

  private async runReadSiteDbName(site: string, log: Logger): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    const extracted = await this.resolveDbNameFromErp(site, started, log);
    if (!extracted.ok) {
      return { ok: false, failure: extracted.failure };
    }
    const durationMs = Date.now() - started;
    log.info({ site, dbName: extracted.dbName, durationMs, metric: "dbName_extracted" }, "dbName extracted (readSiteDbName)");
    return {
      ok: true,
      durationMs,
      metadata: {
        site,
        dbName: extracted.dbName,
      },
    };
  }

  /**
   * Resolves Frappe `db_name` via ERP HTTP API only.
   */
  private async resolveDbNameFromErp(
    site: string,
    startedAt: number,
    log: Logger
  ): Promise<{ ok: true; dbName: string } | { ok: false; failure: RemoteExecutionFailure }> {
    let dbName: string;
    let siteConfigWaitMs = 0;

    try {
      const polled = await pollReadSiteDbName(this.env, log, site);
      dbName = polled.dbName;
      siteConfigWaitMs = polled.waitMs;
      if (polled.attempts > 1) {
        log.info(
          { site, metric: "site_config_retry_count", value: polled.attempts },
          "read_site_db_name polling completed"
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message === "SITE_DB_NAME_NOT_READY") {
        log.error(
          { site, metric: "provisioning_dbname_missing", value: 1 },
          "db_name not available from ERP after retries"
        );
        return {
          ok: false,
          failure: {
            code: "ERP_PARTIAL_SUCCESS",
            message: "db_name not available from ERP after site operation",
            retryable: true,
            details: "SITE_DB_NAME_NOT_READY",
          },
        };
      }
      if (e instanceof ErpCallError) {
        log.error(
          { site, metric: "provisioning_dbname_missing", value: 1, kind: e.kind },
          "read_site_db_name failed"
        );
        return { ok: false, failure: mapErpCallErrorToFailure(e) };
      }
      throw e;
    }

    const durationMs = Date.now() - startedAt;

    if (isUnexpectedDbNameFormat(dbName)) {
      log.warn(
        { site, dbName, durationMs },
        "db_name has unexpected shape (accepted; verify Frappe version compatibility)"
      );
    }

    log.info(
      { site, dbName, durationMs, siteConfigWaitMs, metric: "dbName_extracted" },
      "dbName resolved from ERP"
    );
    return { ok: true, dbName };
  }

  private async runSimpleErpCall(
    action: string,
    endpoint: string,
    payload: Record<string, string>,
    log: Logger
  ): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    try {
      await callErp(this.env, log, endpoint, payload);
      const durationMs = Date.now() - started;
      log.debug({ action, durationMs }, "ERP lifecycle action completed");
      return { ok: true, durationMs };
    } catch (e) {
      if (!(e instanceof ErpCallError)) {
        throw e;
      }
      log.warn(
        {
          action,
          kind: e.kind,
          status: e.options.status,
          message: e.message,
        },
        "ERP HTTP action failed"
      );
      return { ok: false, failure: mapErpCallErrorToFailure(e) };
    }
  }

  private async runCreateSite(site: string, log: Logger): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    try {
      const data = await callErp(this.env, log, ERP_METHOD.createSite, {
        site_name: site,
        admin_password: this.env.ERP_ADMIN_PASSWORD,
      });

      const ok = data.ok === true || data.ok === undefined;
      const siteOut = typeof data.site === "string" ? data.site : site;
      if (!ok) {
        return {
          ok: false,
          failure: {
            code: "ERP_COMMAND_FAILED",
            message: String(data.error ?? "ERP create_site failed"),
            retryable: false,
          },
        };
      }

      log.debug({ action: "createSite", site: siteOut }, "create_site ERP payload accepted");

      const extractStarted = Date.now();
      const extracted = await this.resolveDbNameFromErp(siteOut, extractStarted, log);
      if (!extracted.ok) {
        return { ok: false, failure: extracted.failure };
      }

      const durationMs = Date.now() - started;
      const createSiteResult: CreateSiteResult = { success: true, site: siteOut, dbName: extracted.dbName };

      log.info(
        {
          site: createSiteResult.site,
          dbName: createSiteResult.dbName,
          metric: "dbName_persisted",
          durationMs,
        },
        "createSite succeeded with db_name validation"
      );

      return {
        ok: true,
        durationMs,
        metadata: {
          site: createSiteResult.site,
          dbName: createSiteResult.dbName,
        },
      };
    } catch (e) {
      if (!(e instanceof ErpCallError)) {
        throw e;
      }
      log.warn(
        {
          action: "createSite",
          kind: e.kind,
          status: e.options.status,
          message: e.message,
        },
        "ERP HTTP action failed"
      );

      const failure = mapErpCallErrorToFailure(e);
      if (failure.code === "SITE_ALREADY_EXISTS") {
        const extractStarted = Date.now();
        const extracted = await this.resolveDbNameFromErp(site, extractStarted, log);
        if (extracted.ok === true) {
          const durationMs = Date.now() - started;
          log.info(
            {
              site,
              dbName: extracted.dbName,
              idempotentCreateSite: true,
              durationMs,
              metric: "dbName_persisted",
            },
            "createSite idempotent: dbName from existing site"
          );
          return {
            ok: true,
            durationMs,
            metadata: {
              site,
              dbName: extracted.dbName,
              idempotentCreateSite: true,
            },
          };
        }
      }

      return { ok: false, failure };
    }
  }

  private async runHealthCheck(deep: boolean, log: Logger): Promise<LifecycleActionOutcome> {
    const startedAt = Date.now();
    try {
      await callErp(this.env, log, ERP_METHOD.healthPing, {});
      const durationMs = Date.now() - startedAt;
      const metadata: Record<string, string | number | boolean> = { status: "ok" };
      if (deep) {
        metadata.deep = true;
      }
      return { ok: true, durationMs, metadata };
    } catch (e) {
      if (!(e instanceof ErpCallError)) {
        throw e;
      }
      log.warn({ kind: e.kind, message: e.message }, "health check failed");
      return { ok: false, failure: mapErpCallErrorToFailure(e) };
    }
  }
}
