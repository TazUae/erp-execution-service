import { z } from "zod";

export const RemoteErpActionSchema = z.enum([
  "createSite",
  "readSiteDbName",
  "installErp",
  "enableScheduler",
  "addDomain",
  "createApiUser",
  "healthCheck",
]);

export type RemoteErpAction = z.infer<typeof RemoteErpActionSchema>;

export const CreateSiteRequestSchema = z.object({
  site: z.string().trim().min(1),
});
export type CreateSiteRequest = z.infer<typeof CreateSiteRequestSchema>;

export const ReadSiteDbNameRequestSchema = z.object({
  site: z.string().trim().min(1),
});
export type ReadSiteDbNameRequest = z.infer<typeof ReadSiteDbNameRequestSchema>;

export const InstallErpRequestSchema = z.object({
  site: z.string().trim().min(1),
});
export type InstallErpRequest = z.infer<typeof InstallErpRequestSchema>;

export const EnableSchedulerRequestSchema = z.object({
  site: z.string().trim().min(1),
});
export type EnableSchedulerRequest = z.infer<typeof EnableSchedulerRequestSchema>;

export const AddDomainRequestSchema = z.object({
  site: z.string().trim().min(1),
  domain: z.string().trim().min(1),
});
export type AddDomainRequest = z.infer<typeof AddDomainRequestSchema>;

export const CreateApiUserRequestSchema = z.object({
  site: z.string().trim().min(1),
  apiUsername: z.string().trim().min(1),
});
export type CreateApiUserRequest = z.infer<typeof CreateApiUserRequestSchema>;

export const HealthCheckRequestSchema = z.object({
  deep: z.boolean().optional(),
});
export type HealthCheckRequest = z.infer<typeof HealthCheckRequestSchema>;

export type RemoteRequestByAction = {
  createSite: CreateSiteRequest;
  readSiteDbName: ReadSiteDbNameRequest;
  installErp: InstallErpRequest;
  enableScheduler: EnableSchedulerRequest;
  addDomain: AddDomainRequest;
  createApiUser: CreateApiUserRequest;
  healthCheck: HealthCheckRequest;
};

const RemoteExecuteDiscriminatedSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createSite"), payload: CreateSiteRequestSchema }),
  z.object({ action: z.literal("readSiteDbName"), payload: ReadSiteDbNameRequestSchema }),
  z.object({ action: z.literal("installErp"), payload: InstallErpRequestSchema }),
  z.object({ action: z.literal("enableScheduler"), payload: EnableSchedulerRequestSchema }),
  z.object({ action: z.literal("addDomain"), payload: AddDomainRequestSchema }),
  z.object({ action: z.literal("createApiUser"), payload: CreateApiUserRequestSchema }),
  z.object({ action: z.literal("healthCheck"), payload: HealthCheckRequestSchema }),
]);

/**
 * Maps provisioning-agent / control-plane request shapes to the internal contract:
 * `input` + camelCase fields → `payload` + `site` / `apiUsername` / etc.
 * When `payload` is already present, the body is left unchanged.
 */
export function normalizeLifecycleRequestBody(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return raw;
  }
  const o = raw as Record<string, unknown>;
  if (o.payload !== undefined) {
    return raw;
  }
  if (typeof o.input !== "object" || o.input === null || Array.isArray(o.input)) {
    return raw;
  }
  const input = o.input as Record<string, unknown>;
  const { input: _drop, ...rest } = o;

  switch (o.action) {
    case "readSiteDbName":
    case "createSite":
    case "installErp":
    case "enableScheduler": {
      const site = input.siteName ?? input.site;
      if (typeof site === "string") {
        return { ...rest, payload: { site } };
      }
      break;
    }
    case "addDomain": {
      const site = input.siteName ?? input.site;
      const domain = input.domain;
      if (typeof site === "string" && typeof domain === "string") {
        return { ...rest, payload: { site, domain } };
      }
      break;
    }
    case "createApiUser": {
      const site = input.siteName ?? input.site;
      const apiUsername = input.apiUsername ?? input.api_username;
      if (typeof site === "string" && typeof apiUsername === "string") {
        return { ...rest, payload: { site, apiUsername } };
      }
      break;
    }
    case "healthCheck": {
      if (typeof input.deep === "boolean") {
        return { ...rest, payload: { deep: input.deep } };
      }
      return { ...rest, payload: {} };
    }
    default:
      break;
  }
  return raw;
}

export const RemoteExecuteRequestSchema = z.preprocess(
  normalizeLifecycleRequestBody,
  z.intersection(
    RemoteExecuteDiscriminatedSchema,
    z.object({
      /** Correlation id from control plane / provisioning-agent (propagated in logs). */
      requestId: z.string().trim().min(1).max(128).optional(),
    })
  )
);
export type RemoteExecuteRequest = z.infer<typeof RemoteExecuteRequestSchema>;

export const RemoteExecutionSuccessDataSchema = z.object({
  durationMs: z.number().nonnegative(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type RemoteExecutionSuccessData = z.infer<typeof RemoteExecutionSuccessDataSchema>;

export const RemoteExecutionFailureCodeSchema = z.enum([
  "INFRA_UNAVAILABLE",
  "ERP_COMMAND_FAILED",
  "ERP_TIMEOUT",
  "ERP_VALIDATION_FAILED",
  "ERP_PARTIAL_SUCCESS",
  "SITE_ALREADY_EXISTS",
  /** Site folder / config not present on upstream bench (provisioning ``read_site_db_name``). */
  "SITE_NOT_FOUND",
  /** Upstream Frappe method missing or not whitelisted (HTTP 404 / METHOD_NOT_FOUND). */
  "NOT_IMPLEMENTED",
]);
export type RemoteExecutionFailureCode = z.infer<typeof RemoteExecutionFailureCodeSchema>;

export const RemoteExecutionFailureSchema = z.object({
  code: RemoteExecutionFailureCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.string().optional(),
});
export type RemoteExecutionFailure = z.infer<typeof RemoteExecutionFailureSchema>;

export const RemoteExecutionSuccessEnvelopeSchema = z.object({
  ok: z.literal(true),
  data: RemoteExecutionSuccessDataSchema,
  timestamp: z.string().min(1).optional(),
});
export type RemoteExecutionSuccessEnvelope = z.infer<typeof RemoteExecutionSuccessEnvelopeSchema>;

export const RemoteExecutionFailureEnvelopeSchema = z.object({
  ok: z.literal(false),
  error: RemoteExecutionFailureSchema,
  timestamp: z.string().min(1).optional(),
});
export type RemoteExecutionFailureEnvelope = z.infer<typeof RemoteExecutionFailureEnvelopeSchema>;

export const RemoteExecutionEnvelopeSchema = z.union([
  RemoteExecutionSuccessEnvelopeSchema,
  RemoteExecutionFailureEnvelopeSchema,
]);
export type RemoteExecutionEnvelope = z.infer<typeof RemoteExecutionEnvelopeSchema>;
