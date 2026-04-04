import { readFile } from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { isUnexpectedDbNameFormat, parseSiteConfig } from "erp-utils";
import type { Env } from "../../config/env.js";
import { execArgv, type InternalExecError } from "../../lib/exec.js";
import type { RemoteExecuteRequest } from "../../contracts/lifecycle.js";
import type { RemoteExecutionFailure } from "../../contracts/lifecycle.js";
import { validateDomain, validateSite, validateUsername } from "./validation.js";
import { mapExecErrorToFailure } from "./result-mapper.js";
import type { Logger } from "pino";
import type { ReadSiteDbNameResult } from "./site-config.js";
import { verifyMariaDbSchemaExists } from "./mariadb-schema-validator.js";

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

type AllowedProvisioningAction =
  | "createSite"
  | "installErp"
  | "enableScheduler"
  | "addDomain"
  | "createApiUser";

const SITE_CONFIG_POLL_MAX_ATTEMPTS = 5;
const SITE_CONFIG_POLL_INTERVAL_MS = 1000;

/**
 * Polls until `site_config.json` exists and contains `db_name` (no fixed delay).
 * Raw paths only; no shell.
 */
async function waitForSiteConfig(
  benchPath: string,
  site: string,
  log: Logger
): Promise<{ dbName: string; attempts: number; waitMs: number }> {
  const filePath = path.join(benchPath, "sites", site, "site_config.json");
  const started = Date.now();
  for (let i = 0; i < SITE_CONFIG_POLL_MAX_ATTEMPTS; i++) {
    try {
      const data = await readFile(filePath, "utf-8");
      const { dbName } = parseSiteConfig(data);
      const waitMs = Date.now() - started;
      if (i > 0) {
        log.info(
          {
            metric: "site_config_retry_count",
            value: i + 1,
            site,
            attempts: i + 1,
          },
          "site_config became ready after retries"
        );
      }
      return { dbName, attempts: i + 1, waitMs };
    } catch {
      // retry
    }
    log.debug(
      {
        metric: "site_config_retry_count",
        attempt: i + 1,
        site,
      },
      "site_config not ready yet"
    );
    await new Promise((r) => setTimeout(r, SITE_CONFIG_POLL_INTERVAL_MS));
  }
  throw new Error("SITE_CONFIG_NOT_READY");
}

/**
 * Narrow bench execution: only allowlisted argv sequences; no shell, no passthrough.
 * Raw stdout/stderr are never returned to callers — use logger for diagnostics.
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
          return await this.runBenchAction("createSite", { site: validateSite(request.payload.site) }, log);
        case "readSiteDbName":
          return await this.runReadSiteDbName(validateSite(request.payload.site), log);
        case "installErp":
          return await this.runBenchAction("installErp", { site: validateSite(request.payload.site) }, log);
        case "enableScheduler":
          return await this.runBenchAction("enableScheduler", { site: validateSite(request.payload.site) }, log);
        case "addDomain":
          return await this.runBenchAction("addDomain", {
            site: validateSite(request.payload.site),
            domain: validateDomain(request.payload.domain),
          }, log);
        case "createApiUser":
          return await this.runBenchAction("createApiUser", {
            site: validateSite(request.payload.site),
            apiUsername: validateUsername(request.payload.apiUsername),
          }, log);
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

  private buildBenchArgs(
    action: AllowedProvisioningAction,
    input: { site: string; domain?: string; apiUsername?: string }
  ): string[] {
    const site = input.site;

    switch (action) {
      case "createSite":
        return [
          "new-site",
          site,
          "--db-root-password",
          this.env.ERP_DB_ROOT_PASSWORD,
          "--admin-password",
          this.env.ERP_ADMIN_PASSWORD,
          "--db-host",
          "db",
          "--db-type",
          "mariadb",
          "--no-mariadb-socket",
        ];
      case "installErp":
        return ["--site", site, "install-app", "erpnext"];
      case "enableScheduler":
        return ["--site", site, "enable-scheduler"];
      case "addDomain": {
        const domain = input.domain;
        if (!domain) {
          throw new Error("domain is required for addDomain");
        }
        return [
          "--site",
          site,
          "execute",
          "frappe.api.provisioning.add_domain",
          "--args",
          `["${site}","${domain}"]`,
        ];
      }
      case "createApiUser": {
        const apiUsername = input.apiUsername;
        if (!apiUsername) {
          throw new Error("apiUsername is required for createApiUser");
        }
        return [
          "--site",
          site,
          "execute",
          "frappe.api.provisioning.create_api_user",
          "--args",
          `["${site}","${apiUsername}"]`,
        ];
      }
      default: {
        const _never: never = action;
        return _never;
      }
    }
  }

  private async runReadSiteDbName(site: string, log: Logger): Promise<LifecycleActionOutcome> {
    const started = Date.now();
    const extracted = await this.extractDbNameFromSiteConfig(site, started, log);
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
   * Reads `sites/<slug>/site_config.json` and returns `db_name` (filesystem + JSON parse only; no shell).
   */
  private async extractDbNameFromSiteConfig(
    site: string,
    startedAt: number,
    log: Logger
  ): Promise<{ ok: true; dbName: string } | { ok: false; failure: RemoteExecutionFailure }> {
    let read: ReadSiteDbNameResult;
    let siteConfigWaitMs = 0;

    try {
      const polled = await waitForSiteConfig(this.env.ERP_BENCH_PATH, site, log);
      const unexpectedDbNameFormat = isUnexpectedDbNameFormat(polled.dbName);
      read = { ok: true, dbName: polled.dbName, unexpectedDbNameFormat };
      siteConfigWaitMs = polled.waitMs;
      if (polled.attempts > 1) {
        log.info(
          { site, metric: "site_config_retry_count", value: polled.attempts },
          "site_config polling completed"
        );
      }
    } catch (e) {
      if (e instanceof Error && e.message === "SITE_CONFIG_NOT_READY") {
        log.error(
          { site, metric: "provisioning_dbname_missing", value: 1 },
          "site_config.json not ready after retries"
        );
        return {
          ok: false,
          failure: {
            code: "ERP_PARTIAL_SUCCESS",
            message: "site_config.json not ready after site operation",
            retryable: true,
            details: "SITE_CONFIG_NOT_READY",
          },
        };
      }
      throw e;
    }

    const durationMs = Date.now() - startedAt;

    if (read.unexpectedDbNameFormat) {
      log.warn(
        { site, dbName: read.dbName, durationMs },
        "db_name has unexpected shape (accepted; verify Frappe version compatibility)"
      );
    }

    if (this.env.ERP_VALIDATE_DB_SCHEMA) {
      const exists = await verifyMariaDbSchemaExists(
        {
          host: this.env.ERP_DB_HOST,
          port: this.env.ERP_DB_PORT,
          user: this.env.ERP_DB_READONLY_USER!,
          password: this.env.ERP_DB_READONLY_PASSWORD!,
        },
        read.dbName,
        log
      );
      if (!exists) {
        log.error(
          { site, dbName: read.dbName, durationMs, metric: "provisioning_dbname_missing", value: 1 },
          "MariaDB schema missing for db_name"
        );
        return {
          ok: false,
          failure: {
            code: "ERP_PARTIAL_SUCCESS",
            message: "ERP database schema not found for site_config db_name",
            retryable: true,
            details: `information_schema.SCHEMATA has no SCHEMA_NAME=${read.dbName}`,
          },
        };
      }
    }

    log.info(
      { site, dbName: read.dbName, durationMs, siteConfigWaitMs, metric: "dbName_extracted" },
      "dbName extracted and validated"
    );
    return { ok: true, dbName: read.dbName };
  }

  private async runBenchAction(
    action: AllowedProvisioningAction,
    input: { site: string; domain?: string; apiUsername?: string },
    log: Logger
  ): Promise<LifecycleActionOutcome> {
    const site = input.site;

    if (action === "createSite") {
      const dbRootPassword = this.env.ERP_DB_ROOT_PASSWORD;
      if (!dbRootPassword || dbRootPassword.trim() === "") {
        throw new Error("ERP_DB_ROOT_PASSWORD is required for ERP site provisioning");
      }
      log.debug(
        { erpDbRootPasswordPresent: true },
        "erp createSite: ERP_DB_ROOT_PASSWORD is set (value not logged)"
      );
    }

    const args = this.buildBenchArgs(action, input);

    if (action !== "createSite") {
      try {
        const result = await execArgv(this.env.ERP_BENCH_EXECUTABLE, args, {
          cwd: this.env.ERP_BENCH_PATH,
          timeoutMs: this.env.ERP_COMMAND_TIMEOUT_MS,
        });
        log.debug({ action, durationMs: result.durationMs }, "bench action completed");
        return { ok: true, durationMs: result.durationMs };
      } catch (error) {
        const execError = error as InternalExecError;
        log.warn(
          {
            action,
            kind: execError.kind,
            durationMs: execError.durationMs,
            stderr: execError.stderr,
          },
          "bench action failed"
        );
        return { ok: false, failure: mapExecErrorToFailure(execError) };
      }
    }

    return await this.runCreateSiteWithDbNameCapture(site, args, log);
  }

  private async runCreateSiteWithDbNameCapture(site: string, args: string[], log: Logger): Promise<LifecycleActionOutcome> {
    try {
      const result = await execArgv(this.env.ERP_BENCH_EXECUTABLE, args, {
        cwd: this.env.ERP_BENCH_PATH,
        timeoutMs: this.env.ERP_COMMAND_TIMEOUT_MS,
      });
      log.debug({ action: "createSite", durationMs: result.durationMs }, "bench new-site completed");

      const extractStarted = Date.now();
      const extracted = await this.extractDbNameFromSiteConfig(site, extractStarted, log);
      if (!extracted.ok) {
        return { ok: false, failure: extracted.failure };
      }

      const durationMs = result.durationMs + (Date.now() - extractStarted);
      const createSiteResult: CreateSiteResult = { success: true, site, dbName: extracted.dbName };

      log.info(
        {
          site,
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
    } catch (error) {
      const execError = error as InternalExecError;
      log.warn(
        {
          action: "createSite",
          kind: execError.kind,
          durationMs: execError.durationMs,
          stderr: execError.stderr,
        },
        "bench action failed"
      );

      const failure = mapExecErrorToFailure(execError);
      if (failure.code === "SITE_ALREADY_EXISTS") {
        const extractStarted = Date.now();
        const extracted = await this.extractDbNameFromSiteConfig(site, extractStarted, log);
        if (extracted.ok === true) {
          const durationMs = execError.durationMs + (Date.now() - extractStarted);
          log.info(
            {
              site,
              dbName: extracted.dbName,
              idempotentCreateSite: true,
              durationMs,
              metric: "dbName_persisted",
            },
            "createSite idempotent: dbName extracted from existing site"
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
      await execArgv(this.env.ERP_BENCH_EXECUTABLE, ["--version"], {
        cwd: this.env.ERP_BENCH_PATH,
        timeoutMs: this.env.ERP_COMMAND_TIMEOUT_MS,
      });
      const durationMs = Date.now() - startedAt;
      const metadata: Record<string, string | number | boolean> = { status: "ok" };
      if (deep) {
        metadata.deep = true;
      }
      return { ok: true, durationMs, metadata };
    } catch (error) {
      const execError = error as InternalExecError;
      log.warn(
        { kind: execError.kind, stderr: execError.stderr },
        "health check failed"
      );
      return { ok: false, failure: mapExecErrorToFailure(execError) };
    }
  }
}
