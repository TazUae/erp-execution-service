import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { isAuthorized } from "../lib/auth.js";
import type { Env } from "../config/env.js";
import {
  phase2Failure,
  phase2StatusFor,
  phase2Success,
  type Phase2Error,
  type Phase2Envelope,
  type SiteOperationData,
} from "../contracts/envelope.js";
import {
  addDomain,
  benchAgentFromEnv,
  createApiUser,
  deriveApiUsername,
  setupRoles,
  createSite,
  enableScheduler,
  installErp,
  setupComplete,
  setupCompany,
  setupFiscalYear,
  setupGlobalDefaults,
  setupLocale,
  setupDomains,
  setupFitdesk,
  setupRegional,
  smokeTest,
  siteStatus,
  type BenchAgentLike,
  type CreateSiteParams,
  type SetupCompleteParams,
  type SetupCompanyParams,
  type SetupDomainsParams,
  type SetupFitdeskParams,
  type SetupFiscalYearParams,
  type SetupGlobalDefaultsParams,
  type SetupLocaleParams,
  type SetupRegionalParams,
  type SetupRolesParams,
  type SmokeTestParams,
  type SiteOnlyParams,
  type StepResult,
} from "../services/site-steps.js";

/**
 * Phase 2 routes: one endpoint per bench step in the control-plane's
 * provisioning state machine. Every response follows the Phase 2 envelope
 * (`src/contracts/envelope.ts`) ??? success with timestamp, or
 * `{code, message, retryable}` failure ??? so the control-plane HTTP adapter
 * can decode errors uniformly.
 */

const CreateSiteBodySchema = z.object({
  siteName: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  apiUsername: z.string().trim().min(1),
  adminPassword: z.string().min(1),
});

const RequestContextSchema = z
  .object({
    requestId: z.string().min(1).optional(),
    tenantId: z.string().min(1).optional(),
  })
  .optional();

const SiteOperationBodySchema = z.object({
  site: z.string().trim().min(1),
  context: RequestContextSchema,
});

const SetupCompanyBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  companyAbbr: z.string().trim().min(1).max(10),
  country: z.string().trim().min(2).max(2),
  defaultCurrency: z.string().trim().min(3).max(3),
  companyType: z.string().trim().min(1).default("Company"),
  domain: z.string().trim().min(1).default("Services"),
  context: RequestContextSchema,
});

const SetupLocaleBodySchema = z.object({
  site: z.string().trim().min(1),
  country: z.string().trim().min(2).max(2),
  defaultCurrency: z.string().trim().min(3).max(3),
  timezone: z.string().trim().min(1),
  language: z.string().trim().min(1).default("en"),
  dateFormat: z.string().trim().min(1).default("dd-mm-yyyy"),
  currencyPrecision: z.number().int().min(0).max(9).default(2),
  context: RequestContextSchema,
});

const SetupFiscalYearBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  companyAbbr: z.string().trim().default(""),
  context: RequestContextSchema,
});

const SetupCompleteBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  context: RequestContextSchema,
});

const SetupGlobalDefaultsBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  defaultCurrency: z.string().trim().min(3).max(3),
  fiscalYearName: z.string().trim().min(1),
  country: z.string().trim().min(2).max(2),
  context: RequestContextSchema,
});

const SetupDomainsBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  context: RequestContextSchema,
});

const SetupRolesBodySchema = z.object({
  site: z.string().trim().min(1),
  context: RequestContextSchema,
});

const SetupRegionalBodySchema = z.object({
  site: z.string().trim().min(1),
  country: z.string().trim().min(2).max(2),
  companyName: z.string().trim().min(1),
  companyAbbr: z.string().trim().default(""),
  context: RequestContextSchema,
});

const SetupFitdeskBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  companyAbbr: z.string().trim().default(""),
  controlPlaneWebhookUrl: z.string().url().optional(),
  controlPlaneWebhookSecret: z.string().min(1).optional(),
  context: RequestContextSchema,
});

const SmokeTestBodySchema = z.object({
  site: z.string().trim().min(1),
  companyName: z.string().trim().min(1),
  apiKey: z.string().trim().min(1),
  apiSecret: z.string().trim().min(1),
  context: RequestContextSchema,
});

const SiteStatusParamsSchema = z.object({
  site: z.string().trim().min(1),
});

export type SitesRouteOpts = {
  env: Env;
  /** Injected for tests ??? production constructs from env. */
  benchAgent?: BenchAgentLike;
};

export const sitesRoutes: FastifyPluginAsync<SitesRouteOpts> = async (fastify, opts) => {
  const bench = opts.benchAgent ?? benchAgentFromEnv(opts.env);
  const token = opts.env.ERP_REMOTE_TOKEN;

  // ---- POST /sites/create ----------------------------------------------
  fastify.post("/sites/create", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = CreateSiteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendFailure(reply, zodToPhase2(parsed.error));
    }
    const result = await createSite(bench, parsed.data as CreateSiteParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/install-erp -----------------------------------------
  fastify.post("/sites/install-erp", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SiteOperationBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const result = await installErp(bench, { site: parsed.data.site } as SiteOnlyParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/enable-scheduler ------------------------------------
  fastify.post("/sites/enable-scheduler", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SiteOperationBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const result = await enableScheduler(bench, { site: parsed.data.site });
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-company ---------------------------------------
  fastify.post("/sites/setup-company", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupCompanyBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName, companyAbbr, country, defaultCurrency, companyType, domain } = parsed.data;
    const result = await setupCompany(bench, {
      site,
      companyName,
      companyAbbr,
      country,
      defaultCurrency,
      companyType,
      domain,
    } as SiteOnlyParams & SetupCompanyParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-locale ----------------------------------------
  fastify.post("/sites/setup-locale", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupLocaleBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, country, defaultCurrency, timezone, language, dateFormat, currencyPrecision } = parsed.data;
    const result = await setupLocale(bench, {
      site,
      companyName: "",
      country,
      defaultCurrency,
      timezone,
      language,
      dateFormat,
      currencyPrecision,
    } as SiteOnlyParams & SetupLocaleParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-fiscal-year ------------------------------------
  fastify.post("/sites/setup-fiscal-year", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupFiscalYearBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName, fiscalYearStartMonth, companyAbbr } = parsed.data;
    const result = await setupFiscalYear(bench, {
      site,
      companyName,
      fiscalYearStartMonth,
      companyAbbr,
    } as SiteOnlyParams & SetupFiscalYearParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-global-defaults --------------------------------
  fastify.post("/sites/setup-global-defaults", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupGlobalDefaultsBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName, defaultCurrency, fiscalYearName, country } = parsed.data;
    const result = await setupGlobalDefaults(bench, {
      site,
      companyName,
      defaultCurrency,
      fiscalYearName,
      country,
    } as SiteOnlyParams & SetupGlobalDefaultsParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-complete --------------------------------------
  fastify.post("/sites/setup-complete", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupCompleteBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName } = parsed.data;
    const result = await setupComplete(bench, {
      site,
      companyName,
    } as SiteOnlyParams & SetupCompleteParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-domains ---------------------------------------
  fastify.post("/sites/setup-domains", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupDomainsBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName } = parsed.data;
    const result = await setupDomains(bench, {
      site,
      companyName,
    } as SiteOnlyParams & SetupDomainsParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-regional --------------------------------------
  fastify.post("/sites/setup-regional", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupRegionalBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, country, companyName, companyAbbr } = parsed.data;
    const result = await setupRegional(bench, {
      site,
      country,
      companyName,
      companyAbbr,
    } as SiteOnlyParams & SetupRegionalParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-roles -----------------------------------------
  fastify.post("/sites/setup-roles", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupRolesBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site } = parsed.data;
    const username = deriveApiUsername(site);
    const result = await setupRoles(bench, { site, username } as SiteOnlyParams & SetupRolesParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/add-domain ------------------------------------------
  fastify.post("/sites/add-domain", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SiteOperationBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const result = await addDomain(bench, { site: parsed.data.site });
    return sendResult(reply, result);
  });

  // ---- POST /sites/create-api-user -------------------------------------
  fastify.post("/sites/create-api-user", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SiteOperationBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const result = await createApiUser(bench, { site: parsed.data.site });
    return sendResult(reply, result);
  });

  // ---- POST /sites/setup-fitdesk ---------------------------------------
  fastify.post("/sites/setup-fitdesk", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SetupFitdeskBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName, companyAbbr, controlPlaneWebhookUrl, controlPlaneWebhookSecret } = parsed.data;
    const result = await setupFitdesk(bench, {
      site,
      companyName,
      companyAbbr,
      ...(controlPlaneWebhookUrl ? { controlPlaneWebhookUrl } : {}),
      ...(controlPlaneWebhookSecret ? { controlPlaneWebhookSecret } : {}),
    } as SiteOnlyParams & SetupFitdeskParams);
    return sendResult(reply, result);
  });

  // ---- POST /sites/smoke-test ------------------------------------------
  fastify.post("/sites/smoke-test", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SmokeTestBodySchema.safeParse(request.body);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const { site, companyName, apiKey, apiSecret } = parsed.data;
    const result = await smokeTest(bench, {
      site,
      companyName,
      apiKey,
      apiSecret,
    } as SiteOnlyParams & SmokeTestParams);
    return sendResult(reply, result);
  });

  // ---- GET /sites/:site/status -----------------------------------------
  fastify.get<{ Params: { site: string } }>("/sites/:site/status", async (request, reply) => {
    if (!requireAuth(request, reply, token)) return;
    const parsed = SiteStatusParamsSchema.safeParse(request.params);
    if (!parsed.success) return sendFailure(reply, zodToPhase2(parsed.error));
    const result = await siteStatus(bench, { site: parsed.data.site });
    return sendResult(reply, result);
  });
};

// --- helpers ---------------------------------------------------------------

function requireAuth(request: FastifyRequest, reply: FastifyReply, token: string): boolean {
  if (isAuthorized(request, token)) return true;
  reply.status(401).send(
    phase2Failure({
      code: "ERP_COMMAND_FAILED",
      message: "Unauthorized",
      retryable: false,
    })
  );
  return false;
}

function sendResult<TData extends SiteOperationData>(
  reply: FastifyReply,
  result: StepResult<TData>
): FastifyReply {
  if (result.ok) {
    return reply.status(200).send(phase2Success(result.data));
  }
  return sendFailure(reply, result.error);
}

function sendFailure(reply: FastifyReply, error: Phase2Error): FastifyReply {
  return reply.status(phase2StatusFor(error.code)).send(phase2Failure(error));
}

function zodToPhase2(error: z.ZodError): Phase2Error {
  return {
    code: "ERP_VALIDATION_FAILED",
    message: error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "),
    retryable: false,
  };
}

// Re-export so tests can assert envelope shape via public type.
export type { Phase2Envelope };
