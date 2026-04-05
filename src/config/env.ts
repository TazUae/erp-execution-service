import { z } from "zod";

/** HTTP-only ERP integration: inbound Bearer auth, outbound Bearer to Frappe provisioning API (see `lib/frappe-client/client.ts`). */
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
  ERP_BASE_URL: z.string().url().optional(),
  /**
   * Shared secret for outbound calls to the ERP `provisioning_api` app.
   * Sent as `Authorization: Bearer <ERP_PROVISIONING_TOKEN>` and must match
   * `provisioning_api_token` in the ERP `sites/common_site_config.json`.
   */
  ERP_PROVISIONING_TOKEN: z.string().trim().min(16).optional(),
  /** Dotted Frappe method for each lifecycle action (`POST /api/method/{path}`). */
  ERP_METHOD_CREATE_SITE: z.string().trim().min(1).default("provisioning_api.api.provisioning.create_site"),
  ERP_METHOD_READ_SITE_DB_NAME: z
    .string()
    .trim()
    .min(1)
    .default("provisioning_api.api.provisioning.read_site_db_name"),
  ERP_METHOD_INSTALL_ERP: z.string().trim().min(1).default("provisioning_api.api.provisioning.install_erp"),
  ERP_METHOD_ENABLE_SCHEDULER: z
    .string()
    .trim()
    .min(1)
    .default("provisioning_api.api.provisioning.enable_scheduler"),
  ERP_METHOD_ADD_DOMAIN: z.string().trim().min(1).default("provisioning_api.api.provisioning.add_domain"),
  ERP_METHOD_CREATE_API_USER: z
    .string()
    .trim()
    .min(1)
    .default("provisioning_api.api.provisioning.create_api_user"),
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
