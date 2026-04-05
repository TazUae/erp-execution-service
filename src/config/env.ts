import { z } from "zod";

/** HTTP-only ERP integration: inbound Bearer auth, outbound ERPNext token auth and timeouts (see `lib/http/client.ts`). */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  /** Shared secret with provisioning-agent RemoteErpBackend (Bearer). */
  ERP_REMOTE_TOKEN: z.string().trim().min(16),
  ERP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(120_000),
  /**
   * Base URL for the ERP HTTP provisioning API (e.g. `https://erp-internal:8080`).
   * Used by `HttpProvisioningClient` when calling ERPNext.
   */
  ERP_BASE_URL: z.string().url().optional(),
  /**
   * Frappe token credentials as `api_key:api_secret` (Authorization: `token …`).
   * Generate API Key / Secret in ERPNext; required for outbound provisioning calls when `ERP_BASE_URL` is set.
   */
  ERP_AUTH_TOKEN: z.string().trim().min(1).optional(),
  /**
   * GET path for upstream health (`ping`). Defaults to Frappe’s `frappe.ping` method.
   */
  ERP_HEALTH_PATH: z.preprocess((v) => {
    if (v === undefined || v === null || v === "") return "/api/method/frappe.ping";
    const s = String(v).trim();
    return s.length > 0 ? s : "/api/method/frappe.ping";
  }, z.string().refine((s) => s.startsWith("/"), "must start with /")),
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
