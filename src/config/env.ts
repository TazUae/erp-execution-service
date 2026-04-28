import fs from "node:fs";
import { z } from "zod";

/**
 * erp-execution-service env contract.
 *
 * Inbound: Bearer `ERP_REMOTE_TOKEN` from provisioning-agent.
 * Outbound (primary): HMAC-signed HTTP to bench-agent (see `lib/bench-agent`).
 * Outbound (secondary): `X-Provisioning-Token` to Frappe provisioning_api
 *   HTTP endpoints via `lib/frappe-client` — used for runtime-on-live-site
 *   operations (health checks, read_db_name, etc.), NOT for bench lifecycle.
 *
 * Removed (Phase 1): ERP_DOCKER_BIN, ERP_DOCKER_BACKEND_CONTAINER,
 *   ERP_NEW_SITE_ADMIN_PASSWORD, DB_ROOT_PASSWORD — these moved to
 *   bench-agent, which is the only thing that should hold bench-local secrets
 *   or touch `bench` directly. The execution-service no longer has Docker
 *   socket access and no longer spawns `bench`.
 */
/** Read a Docker Swarm secret file. Returns the trimmed content, or empty string if absent. */
function readDockerSecret(name: string): string {
  try {
    return fs.readFileSync(`/run/secrets/${name}`, "utf8").trim();
  } catch {
    return "";
  }
}

/** Compose may substitute unset `${VAR}` as an empty string; treat that as unset for optional keys. */
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8790),
  /** Shared secret with provisioning-agent RemoteErpBackend (Bearer). */
  ERP_REMOTE_TOKEN: z.string().trim().min(16),
  /** Per-request timeout for outbound Frappe HTTP calls (lib/frappe-client). */
  ERP_COMMAND_TIMEOUT_MS: z.coerce.number().int().min(1).max(300_000).default(30_000),

  // --- bench-agent HTTP client (replaces docker exec path) -----------
  /**
   * Base URL of axis-bench-agent. Reached over the ERPNext stack's internal
   * overlay network, e.g. `http://axis-bench-agent:8797`. Must NOT be a
   * dokploy-network address.
   */
  BENCH_AGENT_URL: z.string().url(),
  /**
   * Pre-shared HMAC-SHA256 secret. Must match `BENCH_AGENT_HMAC_SECRET` set
   * on the bench-agent side. >=32 chars.
   */
  BENCH_AGENT_HMAC_SECRET: z.string().trim().min(32),
  /**
   * Per-request timeout for outbound calls to bench-agent. `bench new-site`
   * with install-app erpnext can take 10+ minutes, so default is generous.
   */
  BENCH_AGENT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(1_200_000),

  /**
   * Base URL for the ERP HTTP API (e.g. `http://axis-erp-backend:8000`).
   * Used by `FrappeClient` for live-site Frappe calls — NOT for bench
   * lifecycle (those go through bench-agent).
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
  // Docker Swarm secret files take precedence over env vars; env vars are the
  // local-dev fallback (secret files don't exist outside Swarm).
  const secretOverrides: Record<string, string> = {};
  const benchAgentToken = readDockerSecret("axis_bench_agent_token");
  if (benchAgentToken) secretOverrides.BENCH_AGENT_HMAC_SECRET = benchAgentToken;

  const merged = { ...process.env, ...secretOverrides, ...overrides };
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
