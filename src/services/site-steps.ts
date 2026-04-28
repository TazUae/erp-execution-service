import { ZodError } from "zod";
import type { Env } from "../config/env.js";
import type {
  Phase2Error,
  Phase2ErrorCode,
  SiteOperationData,
} from "../contracts/envelope.js";
import { BenchAgentClient, BenchAgentError } from "../lib/bench-agent/client.js";
import { validateDomain, validateUsername } from "../providers/erpnext/validation.js";

/**
 * Phase 2 service layer: one function per bench step.
 *
 * Each function:
 *   1. Validates its inputs (throws nothing — returns `{ok:false, error}`).
 *   2. Calls the bench-agent client.
 *   3. Maps the bench-agent response or error to the Phase 2 envelope
 *      `data`/`error` shape consumed by control-plane.
 *
 * These functions do NOT construct the Phase 2 HTTP envelope itself —
 * routes wrap them with `phase2Success`/`phase2Failure` at the edge so the
 * service layer stays independent of Fastify and HTTP.
 *
 * Idempotency is pushed down to bench-agent:
 *   - `new-site` → checks `sites/{name}/site_config.json` before running
 *   - `install-app` → checks `bench list-apps` before running
 * When the agent reports a no-op, we emit `outcome: "already_done"`.
 */

export type StepResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; error: Phase2Error };

/**
 * Minimal bench-agent surface used by the service layer. Declared structurally
 * so tests can inject fakes without constructing a real `BenchAgentClient`.
 */
export type SetupFiscalYearParams = {
  companyName: string;
  fiscalYearStartMonth?: number;
  companyAbbr?: string;
};

export type SetupGlobalDefaultsParams = {
  companyName: string;
  defaultCurrency: string;
  fiscalYearName: string;
  country: string;
};

export type SetupCompleteParams = {
  companyName: string;
};

export type SetupRegionalParams = {
  country: string;
  companyName: string;
  companyAbbr?: string;
};

export type SetupDomainsParams = {
  companyName: string;
};

export type SetupRolesParams = {
  username: string;
};

export type SetupFitdeskParams = {
  companyName: string;
  companyAbbr: string;
  controlPlaneWebhookUrl?: string;
  controlPlaneWebhookSecret?: string;
};

export type SmokeTestParams = {
  companyName: string;
  apiKey: string;
  apiSecret: string;
};

export type SetupCompanyParams = {
  companyName: string;
  companyAbbr: string;
  country: string;
  defaultCurrency: string;
  companyType?: string;
  domain?: string;
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

export type BenchAgentLike = {
  newSite(siteName: string, adminPassword: string): Promise<{ status: "created" | "exists"; site: string; skipped?: boolean; db_name?: string }>;
  installApp(
    site: string,
    app: string
  ): Promise<{ status: "installed" | "already_installed"; site: string; app: string; skipped?: boolean }>;
  setConfig(site: string, key: string, value: string): Promise<{ status: "ok"; site: string; key: string }>;
  enableScheduler(site: string): Promise<{ status: "ok"; site: string }>;
  setupLocale(site: string, params: SetupLocaleParams): Promise<{ site: string; currency: string; timezone: string; duration_ms: number }>;
  setupCompany(site: string, params: SetupCompanyParams): Promise<{ site: string; company: string; account_count: number; skipped: boolean; duration_ms: number }>;
  setupFiscalYear(site: string, params: SetupFiscalYearParams): Promise<{ site: string; fiscal_year: string; start: string; end: string; duration_ms: number }>;
  setupGlobalDefaults(site: string, params: SetupGlobalDefaultsParams): Promise<{ site: string; duration_ms: number }>;
  setupComplete(site: string, params: SetupCompleteParams): Promise<{ site: string; setup_complete: boolean; duration_ms: number }>;
  setupDomains(site: string, params: SetupDomainsParams): Promise<{ site: string; modules_unblocked: number; duration_ms: number }>;
  setupRegional(site: string, params: SetupRegionalParams): Promise<{ site: string; regional: boolean; reason?: string; duration_ms: number }>;
  createApiUser(
    site: string,
    username: string
  ): Promise<{ site: string; user: string; api_key: string; api_secret: string }>;
  setupRoles(site: string, params: SetupRolesParams): Promise<{ site: string; roles_assigned: number; duration_ms: number }>;
  setupFitdesk(site: string, params: SetupFitdeskParams): Promise<{ site: string; custom_fields: number; duration_ms: number }>;
  smokeTest(site: string, params: SmokeTestParams): Promise<{ site: string; smoke_test: string; tests_run: string[]; duration_ms: number }>;
  siteStatus(site: string): Promise<{ site: string; exists: boolean; apps: string[] }>;
};

// ---------------------------------------------------------------------------
// Single-bench constraint and multi-bench design note.
//
// BENCH_AGENT_URL is intentionally a single env var pointing to one bench-agent.
// This erp-execution-service instance is a 1:1 sidecar to one bench stack.
// Concurrency within the bench is 1 (enforced by the BullMQ worker —
// see control-plane/scripts/worker.ts).
//
// When a second bench is needed:
//   - Deploy a SECOND erp-execution-service instance with its own BENCH_AGENT_URL
//     pointing at the second bench-agent.
//   - Deploy a SECOND provisioning-agent routed to that execution-service.
//   - The control-plane adapter factory (src/lib/provisioning/index.ts) selects
//     the correct provisioning-agent based on Tenant.benchShard.
//   - No changes are needed in this file. BENCH_AGENT_URL remains a single
//     env var; each erp-execution-service deployment is shard-scoped at deploy time.
// ---------------------------------------------------------------------------
export function benchAgentFromEnv(env: Env): BenchAgentLike {
  return new BenchAgentClient({
    baseUrl: env.BENCH_AGENT_URL,
    hmacSecret: env.BENCH_AGENT_HMAC_SECRET,
    timeoutMs: env.BENCH_AGENT_TIMEOUT_MS,
  });
}

/**
 * Lowercase slug: only `[a-z0-9]`, single dashes between segments, no
 * leading/trailing dash. Matches Frappe's on-disk site directory rules.
 */
export function sanitizeSiteName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-");
  return dashed.replace(/^-|-$/g, "");
}

// --- createSite ----------------------------------------------------------

export type CreateSiteParams = {
  siteName: string;
  domain: string;
  apiUsername: string;
  adminPassword: string;
};

/**
 * POST /sites/create → bench new-site.
 *
 * Phase 2 contract note: `createSite` only runs `bench new-site`. App installs,
 * scheduler, domain, and API user are their own steps in the control-plane
 * machine. `domain` and `apiUsername` are validated here (cheap — keeps bad
 * input out of later steps) but not *applied* by this call.
 */
export async function createSite(
  bench: BenchAgentLike,
  params: CreateSiteParams
): Promise<StepResult<SiteOperationData>> {
  try {
    validateDomain(params.domain);
    validateUsername(params.apiUsername);
  } catch (error) {
    return validationFailure(error, "createSite");
  }

  const site = sanitizeSiteName(params.siteName);
  if (site.length < 3 || site.length > 253) {
    return {
      ok: false,
      error: {
        code: "ERP_VALIDATION_FAILED",
        message:
          "Invalid site name: must be 3–253 characters after sanitization (lowercase letters, numbers, dashes)",
        retryable: false,
        details: `sanitized=${site}`,
      },
    };
  }

  try {
    const result = await bench.newSite(site, params.adminPassword);
    const alreadyExists = result.status === "exists";
    return {
      ok: true,
      data: {
        action: "createSite",
        site,
        outcome: alreadyExists ? "already_done" : "applied",
        ...(alreadyExists ? { alreadyExists: true } : {}),
        ...(result.db_name ? { dbName: result.db_name } : {}),
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "createSite");
  }
}

// --- installErp ----------------------------------------------------------

export type SiteOnlyParams = { site: string };

/**
 * POST /sites/install-erp → bench install-app erpnext + install-app provisioning_api.
 *
 * We install BOTH apps under this single step because (a) the control-plane's
 * `erp_installed` state semantically means "the site is ready to receive API
 * users", which requires `provisioning_api` for `create_api_user`, and (b)
 * both installs are idempotent at the bench-agent level.
 */
export async function installErp(
  bench: BenchAgentLike,
  params: SiteOnlyParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const erpnext = await bench.installApp(site, "erpnext");
    const provisioning = await bench.installApp(site, "provisioning_api");
    const bothAlreadyDone =
      erpnext.status === "already_installed" && provisioning.status === "already_installed";
    return {
      ok: true,
      data: {
        action: "installErp",
        site,
        outcome: bothAlreadyDone ? "already_done" : "applied",
        ...(bothAlreadyDone ? { alreadyInstalled: true } : {}),
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "installErp");
  }
}

// --- enableScheduler -----------------------------------------------------

/**
 * POST /sites/enable-scheduler → bench --site enable-scheduler.
 * Naturally idempotent at the bench level.
 */
export async function enableScheduler(
  bench: BenchAgentLike,
  params: SiteOnlyParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    await bench.enableScheduler(site);
    return {
      ok: true,
      data: { action: "enableScheduler", site, outcome: "applied" },
    };
  } catch (error) {
    return benchAgentFailure(error, "enableScheduler");
  }
}

// --- setupLocale ---------------------------------------------------------

/**
 * POST /sites/setup-locale → provisioning_api.api.bootstrap.setup_locale.
 *
 * Enables the tenant's ISO 4217 currency in tabCurrency and writes
 * language / time_zone / date_format / currency_precision / country onto
 * System Settings.  Idempotent: safe to retry.
 */
export async function setupLocale(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupLocaleParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupLocale(site, {
      companyName: params.companyName,
      country: params.country,
      defaultCurrency: params.defaultCurrency,
      timezone: params.timezone,
      language: params.language,
      dateFormat: params.dateFormat,
      currencyPrecision: params.currencyPrecision,
    });
    return {
      ok: true,
      data: {
        action: "setupLocale",
        site,
        outcome: "applied",
        stdout: `currency=${result.currency} timezone=${result.timezone}`,
        durationMs: result.duration_ms,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupLocale");
  }
}

// --- setupCompany --------------------------------------------------------

/**
 * POST /sites/setup-company → provisioning_api.api.bootstrap.setup_company.
 *
 * Creates the Frappe Company document via doc.insert() so that after_insert
 * hooks fire and build the Chart of Accounts, default warehouses, and cost
 * centers.  Idempotent: if the company already exists, returns already_done.
 */
export async function setupCompany(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupCompanyParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupCompany(site, {
      companyName: params.companyName,
      companyAbbr: params.companyAbbr,
      country: params.country,
      defaultCurrency: params.defaultCurrency,
      companyType: params.companyType,
      domain: params.domain,
    });
    return {
      ok: true,
      data: {
        action: "setupCompany",
        site,
        outcome: result.skipped ? "already_done" : "applied",
        ...(result.skipped ? { alreadyExists: true } : {}),
        stdout: `company=${result.company} account_count=${result.account_count}`,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupCompany");
  }
}

// --- setupFiscalYear -----------------------------------------------------

/**
 * POST /sites/setup-fiscal-year → provisioning_api.api.bootstrap.setup_fiscal_year.
 *
 * Creates the Fiscal Year document covering today and links it to the company.
 * Idempotent: if the FY already exists, adds the company if absent.
 */
export async function setupFiscalYear(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupFiscalYearParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupFiscalYear(site, {
      companyName: params.companyName,
      fiscalYearStartMonth: params.fiscalYearStartMonth,
      companyAbbr: params.companyAbbr,
    });
    return {
      ok: true,
      data: {
        action: "setupFiscalYear",
        site,
        outcome: "applied",
        stdout: `fiscal_year=${result.fiscal_year} start=${result.start} end=${result.end}`,
        durationMs: result.duration_ms,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupFiscalYear");
  }
}

// --- setupGlobalDefaults -------------------------------------------------

/**
 * POST /sites/setup-global-defaults → provisioning_api.api.bootstrap.setup_global_defaults.
 *
 * Sets default_company, default_currency, country, current_fiscal_year on
 * the Global Defaults singleton.  Idempotent: overwrites with same values.
 */
export async function setupGlobalDefaults(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupGlobalDefaultsParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    await bench.setupGlobalDefaults(site, {
      companyName: params.companyName,
      defaultCurrency: params.defaultCurrency,
      fiscalYearName: params.fiscalYearName,
      country: params.country,
    });
    return {
      ok: true,
      data: {
        action: "setupGlobalDefaults",
        site,
        outcome: "applied",
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupGlobalDefaults");
  }
}

// --- setupComplete -------------------------------------------------------

/**
 * POST /sites/setup-complete → provisioning_api.api.bootstrap.setup_complete.
 *
 * Sets System Settings.setup_complete = 1 (setup wizard bypass gate).
 * Verifies preconditions inside Frappe before setting the flag — refuses to
 * proceed if locale, company, fiscal year, or global defaults are missing.
 * Idempotent: safe to retry.
 */
export async function setupComplete(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupCompleteParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    await bench.setupComplete(site, { companyName: params.companyName });
    return {
      ok: true,
      data: {
        action: "setupComplete",
        site,
        outcome: "applied",
        stdout: "setup_complete=true",
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupComplete");
  }
}

// --- setupDomains --------------------------------------------------------

/**
 * POST /sites/setup-domains → provisioning_api.api.domain_setup.activate_all_domains.
 *
 * Activates all 8 standard ERPNext business domains in Domain Settings,
 * loads per-domain fixtures, and unblocks any blocked Module Def records.
 * Idempotent: safe to retry.
 */
export async function setupDomains(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupDomainsParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupDomains(site, {
      companyName: params.companyName,
    });
    return {
      ok: true,
      data: {
        action: "setupDomains",
        site,
        outcome: "applied",
        stdout: `modules_unblocked=${result.modules_unblocked}`,
        durationMs: result.duration_ms,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupDomains");
  }
}

// --- setupRegional -------------------------------------------------------

/**
 * POST /sites/setup-regional → provisioning_api.api.regional.setup_regional.
 *
 * Runs ERPNext's country-specific localization module (VAT templates, etc.).
 * Non-fatal: if the module is absent or fails, a placeholder 0% tax template
 * is created instead. This step is ALWAYS marked Completed regardless of
 * whether the regional module ran.
 */
export async function setupRegional(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupRegionalParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupRegional(site, {
      country: params.country,
      companyName: params.companyName,
      companyAbbr: params.companyAbbr,
    });
    return {
      ok: true,
      data: {
        action: "setupRegional",
        site,
        outcome: "applied",
        stdout: `regional=${result.regional}${result.reason ? ` reason=${result.reason}` : ""}`,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupRegional");
  }
}

// --- addDomain -----------------------------------------------------------

/**
 * POST /sites/add-domain → bench --site set-config host_name <value>.
 *
 * The control-plane's `SiteOperationRequestSchema` carries only `{site}`, so
 * we treat the `site` string as the FQDN the site should answer to. This
 * matches Frappe's multi-site model where the site directory name == the
 * HTTP Host the site matches.
 */
export async function addDomain(
  bench: BenchAgentLike,
  params: SiteOnlyParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    await bench.setConfig(site, "host_name", site);
    return {
      ok: true,
      data: { action: "addDomain", site, outcome: "applied" },
    };
  } catch (error) {
    return benchAgentFailure(error, "addDomain");
  }
}

// --- createApiUser -------------------------------------------------------

/**
 * POST /sites/create-api-user → provisioning_api.api.user.create_api_user.
 *
 * Derives a deterministic username from the first label of the site so repeated
 * calls for the same site produce the same User record. The bench-agent's
 * create-api-user route parses `api_key=...`/`api_secret=...` from stdout and
 * returns them as structured fields — we forward them in `data`.
 *
 * `api_key`/`api_secret` are the real secrets. We pass them through the
 * Phase 2 envelope unmodified; the control-plane is the intended consumer and
 * stores them encrypted at rest.
 */
export async function createApiUser(
  bench: BenchAgentLike,
  params: SiteOnlyParams
): Promise<StepResult<SiteOperationData & { apiKey?: string; apiSecret?: string; user?: string }>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  const username = deriveApiUsername(site);
  try {
    const result = await bench.createApiUser(site, username);
    return {
      ok: true,
      data: {
        action: "createApiUser",
        site,
        outcome: "applied",
        user: result.user,
        apiKey: result.api_key,
        apiSecret: result.api_secret,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "createApiUser");
  }
}

// --- setupRoles ----------------------------------------------------------

/**
 * POST /sites/setup-roles → provisioning_api.api.user.setup_roles.
 *
 * Syncs the full PROVISIONING_ROLES set onto the API user and the
 * Administrator user. Idempotent. Username is derived the same way as
 * createApiUser (cp_<first-label>).
 */
export async function setupRoles(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupRolesParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupRoles(site, { username: params.username });
    return {
      ok: true,
      data: {
        action: "setupRoles",
        site,
        outcome: "applied",
        stdout: `roles_assigned=${result.roles_assigned}`,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupRoles");
  }
}

// --- setupFitdesk --------------------------------------------------------

/**
 * POST /sites/setup-fitdesk → provisioning_api.api.fitdesk_setup.setup_fitdesk_schema.
 *
 * Creates 7 custom fields (Customer + Sales Invoice), the TRAINING-SESSION
 * item, the Individual Customer Group, All Territories, and the FitDesk
 * Invoice print format.  Each sub-step is idempotent.
 */
export async function setupFitdesk(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SetupFitdeskParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.setupFitdesk(site, {
      companyName: params.companyName,
      companyAbbr: params.companyAbbr,
      ...(params.controlPlaneWebhookUrl ? { controlPlaneWebhookUrl: params.controlPlaneWebhookUrl } : {}),
      ...(params.controlPlaneWebhookSecret ? { controlPlaneWebhookSecret: params.controlPlaneWebhookSecret } : {}),
    });
    return {
      ok: true,
      data: {
        action: "setupFitdesk",
        site,
        outcome: "applied",
        stdout: `custom_fields=${result.custom_fields}`,
        durationMs: result.duration_ms,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "setupFitdesk");
  }
}

// --- smokeTest -----------------------------------------------------------

/**
 * POST /sites/smoke-test → provisioning_api.api.smoke_test.run_smoke_test.
 *
 * Runs a real transaction sequence against the provisioned site using the
 * API user's credentials to verify the full ERP stack is functional.
 * Creates and cleans up a test Customer (and optionally a draft Sales Invoice).
 * Non-fatal from the caller's perspective: the control-plane step swallows
 * errors so provisioning completes regardless.
 */
export async function smokeTest(
  bench: BenchAgentLike,
  params: SiteOnlyParams & SmokeTestParams
): Promise<StepResult<SiteOperationData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.smokeTest(site, {
      companyName: params.companyName,
      apiKey: params.apiKey,
      apiSecret: params.apiSecret,
    });
    return {
      ok: true,
      data: {
        action: "smokeTest",
        site,
        outcome: "applied",
        stdout: `smoke_test=${result.smoke_test} tests_run=${result.tests_run.join(",")}`,
        durationMs: result.duration_ms,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "smokeTest");
  }
}

// --- siteStatus ----------------------------------------------------------

export type SiteStatusData = SiteOperationData & {
  exists: boolean;
  apps: string[];
};

/**
 * GET /sites/{site}/status → bench --site list-apps (+ site_config.json check).
 *
 * Used by control-plane for the `warmup_completed` step — a positive status
 * means the site is routable, has the expected apps, and is ready to serve.
 */
export async function siteStatus(
  bench: BenchAgentLike,
  params: SiteOnlyParams
): Promise<StepResult<SiteStatusData>> {
  const siteResult = validateSiteParam(params.site);
  if (!siteResult.ok) return siteResult;
  const site = siteResult.value;

  try {
    const result = await bench.siteStatus(site);
    return {
      ok: true,
      data: {
        action: "siteStatus",
        site,
        outcome: "applied",
        exists: result.exists,
        apps: result.apps,
      },
    };
  } catch (error) {
    return benchAgentFailure(error, "siteStatus");
  }
}

// --- helpers -------------------------------------------------------------

function validateSiteParam(
  raw: unknown
): { ok: true; value: string } | { ok: false; error: Phase2Error } {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return {
      ok: false,
      error: {
        code: "ERP_VALIDATION_FAILED",
        message: "site is required",
        retryable: false,
      },
    };
  }
  const trimmed = raw.trim();
  if (trimmed.length < 3 || trimmed.length > 253) {
    return {
      ok: false,
      error: {
        code: "ERP_VALIDATION_FAILED",
        message: "site must be 3–253 characters",
        retryable: false,
      },
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Derive a Frappe User for API access from the site identifier. First label
 * of the hostname, prefixed `cp_` so the user is obviously system-managed.
 */
export function deriveApiUsername(site: string): string {
  const firstLabel = site.split(".")[0] ?? site;
  const slug = firstLabel.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `cp_${slug || "site"}`;
}

function validationFailure(error: unknown, action: string): StepResult<never> {
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: {
        code: "ERP_VALIDATION_FAILED",
        message: error.issues.map((i) => i.message).join("; ") || "validation failed",
        retryable: false,
        details: `action=${action}`,
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: "ERP_VALIDATION_FAILED",
      message,
      retryable: false,
      details: `action=${action}`,
    },
  };
}

/**
 * Map a thrown bench-agent error (or unexpected crash) into the Phase 2
 * `Phase2Error` shape. Classification priority:
 *   1. stderr substrings that unambiguously identify known failure modes
 *      (e.g. `already exists` → SITE_ALREADY_EXISTS)
 *   2. bench-agent's own error code (BENCH_TIMEOUT, NETWORK_ERROR, ...)
 *   3. fallback: ERP_COMMAND_FAILED, not retryable
 */
function benchAgentFailure(error: unknown, action: string): StepResult<never> {
  if (error instanceof BenchAgentError) {
    const stderr = asString(error.details.stderr);
    const stdout = asString(error.details.stdout);
    const exitCode =
      typeof error.details.exit_code === "number" ? error.details.exit_code : undefined;

    const code = mapBenchErrorToPhase2(error, stderr);
    return {
      ok: false,
      error: {
        code,
        message: error.message || "bench-agent request failed",
        retryable: isRetryable(code),
        details: `action=${action}; benchCode=${error.code}${
          asString(error.details.command) ? `; command=${asString(error.details.command)}` : ""
        }`,
        ...(stdout ? { stdout } : {}),
        ...(stderr ? { stderr } : {}),
        ...(exitCode !== undefined ? { exitCode } : {}),
      },
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    error: {
      code: "ERP_COMMAND_FAILED",
      message: message || "ERP command failed",
      retryable: false,
      details: `action=${action}`,
    },
  };
}

function mapBenchErrorToPhase2(err: BenchAgentError, stderr: string): Phase2ErrorCode {
  if (stderr.includes("already exists")) return "SITE_ALREADY_EXISTS";

  switch (err.code) {
    case "BENCH_TIMEOUT":
    case "TIMEOUT":
      return "ERP_TIMEOUT";
    case "NETWORK_ERROR":
    case "UPSTREAM_HTTP_ERROR":
      return "INFRA_UNAVAILABLE";
    case "VALIDATION_ERROR":
      return "ERP_VALIDATION_FAILED";
    case "INVALID_RESPONSE":
      return "ERP_PARTIAL_SUCCESS";
    default:
      return "ERP_COMMAND_FAILED";
  }
}

function isRetryable(code: Phase2ErrorCode): boolean {
  return code === "INFRA_UNAVAILABLE" || code === "ERP_TIMEOUT";
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
