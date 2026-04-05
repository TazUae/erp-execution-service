import { z } from "zod";

/** Bench-side executor: requires bench path, subprocesses, and optional MariaDB validation. */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  /** Shared secret with provisioning-agent RemoteErpBackend (Bearer). */
  ERP_REMOTE_TOKEN: z.string().trim().min(16),
  ERP_ADMIN_PASSWORD: z.string().min(8),
  /** MariaDB/MySQL root password for `bench new-site --db-root-password` (non-interactive). */
  ERP_DB_ROOT_PASSWORD: z.string().trim().min(1),
  ERP_BENCH_PATH: z.string().min(1).default("/home/frappe/frappe-bench"),
  ERP_BENCH_EXECUTABLE: z.string().min(1).default("bench"),
  ERP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(120_000),
  /** MariaDB host for `bench new-site --db-host` and optional `information_schema` checks. */
  ERP_DB_HOST: z.string().trim().min(1).default("db"),
  ERP_DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  /** Read-only MariaDB user for `information_schema` validation (never use root for this). */
  ERP_DB_READONLY_USER: z.string().trim().min(1).optional(),
  ERP_DB_READONLY_PASSWORD: z.string().optional(),
  /**
   * Set to `"true"` to verify `db_name` exists in MariaDB `information_schema.SCHEMATA` after site_config read.
   */
  ERP_VALIDATE_DB_SCHEMA: z
    .union([z.literal("true"), z.literal("false")])
    .default("false")
    .transform((v) => v === "true"),
}).superRefine((data, ctx) => {
  if (data.ERP_VALIDATE_DB_SCHEMA) {
    if (!data.ERP_DB_READONLY_USER?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ERP_DB_READONLY_USER"],
        message: "ERP_DB_READONLY_USER is required when ERP_VALIDATE_DB_SCHEMA is true",
      });
    }
    if (!data.ERP_DB_READONLY_PASSWORD || data.ERP_DB_READONLY_PASSWORD.trim() === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ERP_DB_READONLY_PASSWORD"],
        message: "ERP_DB_READONLY_PASSWORD is required when ERP_VALIDATE_DB_SCHEMA is true",
      });
    }
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
