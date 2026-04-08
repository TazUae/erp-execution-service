import { z } from "zod";

/**
 * HTTP-only ERP integration: inbound Bearer auth; outbound `X-Provisioning-Token` to Frappe provisioning API (see `lib/frappe-client/client.ts`).
 *
 * Keys here must stay in sync with `.env.example`: NODE_ENV, PORT, ERP_REMOTE_TOKEN,
 * ERP_COMMAND_TIMEOUT_MS, ERP_BASE_URL, ERP_SITE_HOST, ERP_PROVISIONING_TOKEN, ERP_METHOD_CREATE_SITE.
 */
/** Compose may substitute unset `${VAR}` as an empty string; treat that as unset for optional keys. */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  /** Shared secret with provisioning-agent RemoteErpBackend (Bearer). */
  ERP_REMOTE_TOKEN: z.string().trim().min(16),
  ERP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(30_000),
  /**
   * Base URL for the ERP HTTP API (e.g. `http://axis-erp-backend:8000`).
   * Used by `FrappeClient` when calling Frappe/ERPNext.
   */
  ERP_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  /**
   * HTTP `Host` header for outbound Frappe requests when the RPC payload has no site (e.g. `frappe.ping`).
   * When a method body includes `site_name` or `site`, that value is used as `Host` instead.
   * Required whenever `ERP_BASE_URL` is set (multi-site Frappe resolves the site from `Host`).
   */
  ERP_SITE_HOST: z.preprocess(emptyToUndefined, z.string().trim().min(1).optional()),
  /**
   * Shared secret for outbound calls to the ERP `provisioning_api` app.
   * Sent as `X-Provisioning-Token: <ERP_PROVISIONING_TOKEN>` and must match
   * `provisioning_api_token` in the ERP `sites/common_site_config.json`.
   */
  ERP_PROVISIONING_TOKEN: z.preprocess(emptyToUndefined, z.string().trim().min(16).optional()),
  /** Dotted Frappe method for `create_site` (`POST /api/method/{path}`). */
  ERP_METHOD_CREATE_SITE: z.string().trim().min(1).default("provisioning_api.api.provisioning.create_site"),
})
  .superRefine((data, ctx) => {
    if (data.ERP_BASE_URL && !data.ERP_SITE_HOST) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ERP_SITE_HOST is required when ERP_BASE_URL is set (Frappe multi-site Host header)",
        path: ["ERP_SITE_HOST"],
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  readonly zodIssues: z.ZodIssue[];

  constructor(zodIssues: z.ZodIssue[]) {
    const summary = zodIssues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    super(`Invalid environment: ${summary}`);
    this.name = "EnvValidationError";
    this.zodIssues = zodIssues;
  }
}

let cached: Env | null = null;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  if (cached && !overrides) {
    return cached;
  }
  const merged = { ...process.env, ...overrides };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    throw new EnvValidationError(parsed.error.issues);
  }
  if (!overrides) {
    cached = parsed.data;
  }
  return parsed.data;
}

export function resetEnvCacheForTests(): void {
  cached = null;
}
