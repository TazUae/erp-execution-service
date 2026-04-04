import { z } from "zod";

/** HTTP-only service: no `ERP_DB_ROOT_PASSWORD`, bench paths, or Docker runtime image env vars. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  /** Shared secret with provisioning-agent RemoteErpBackend (Bearer to this service and to ERPNext). */
  ERP_REMOTE_TOKEN: z.string().trim().min(16),
  /** ERPNext base URL (e.g. http://axis-erp-backend:8000). */
  ERP_BASE_URL: z.string().trim().url(),
  ERP_ADMIN_PASSWORD: z.string().min(8),
  ERP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(120_000),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(overrides?: Record<string, string | undefined>): Env {
  if (cached && !overrides) {
    return cached;
  }
  const merged = { ...process.env, ...overrides };
  const parsed = EnvSchema.safeParse(merged);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment: ${issues.join(", ")}`);
  }
  if (!overrides) {
    cached = parsed.data;
  }
  return parsed.data;
}

export function resetEnvCacheForTests(): void {
  cached = null;
}
