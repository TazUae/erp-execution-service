import { spawn } from "node:child_process";
import { ZodError } from "zod";
import type { Env } from "../config/env.js";
import { validateDomain, validateUsername } from "../providers/erpnext/validation.js";

export type CreateSiteParams = {
  siteName: string;
  domain: string;
  apiUsername: string;
};

export type CreateSiteResult =
  | { ok: true; data: { site: string } }
  | { ok: false; error: string; validation?: true };

export type CreateSiteDeps = {
  execDocker?: (argv: string[], timeoutMs: number) => Promise<void>;
};

/**
 * Lowercase slug: only [a-z0-9], single dashes between segments (no leading/trailing dash).
 */
export function sanitizeSiteName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-");
  return dashed.replace(/^-|-$/g, "");
}

function defaultExecDocker(argv: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = argv[0];
    const args = argv.slice(1);
    const child = spawn(bin, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let stdout = "";
    let settled = false;
    child.stdout?.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c: Buffer) => {
      stderr += c.toString();
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new Error(`docker exec timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);
    const finish = (fn: () => void) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        fn();
      }
    };
    child.on("error", (err) => {
      finish(() => reject(err));
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(() => resolve());
        return;
      }
      const msg = (stderr || stdout || "").trim() || `docker exited with code ${code}`;
      finish(() => reject(new Error(msg)));
    });
  });
}

/**
 * Provisions a site via `docker exec` on the host Docker socket (execution service runs docker, not ERP).
 */
export async function createSite(
  env: Env,
  params: CreateSiteParams,
  deps: CreateSiteDeps = {}
): Promise<CreateSiteResult> {
  let domain: string;
  try {
    validateUsername(params.apiUsername);
    domain = validateDomain(params.domain);
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.message, validation: true };
    }
    throw error;
  }

  const site = sanitizeSiteName(params.siteName);
  if (site.length < 3 || site.length > 253) {
    return {
      ok: false,
      error: "Invalid site name: must be 3–253 characters after sanitization (lowercase letters, numbers, dashes)",
      validation: true,
    };
  }

  const execDocker = deps.execDocker ?? defaultExecDocker;
  const timeoutMs = env.ERP_COMMAND_TIMEOUT_MS;
  const container = env.ERP_DOCKER_BACKEND_CONTAINER;
  const adminPassword = env.ERP_NEW_SITE_ADMIN_PASSWORD;
  const dockerBin = env.ERP_DOCKER_BIN;

  const newSiteArgs = [
    dockerBin,
    "exec",
    container,
    "bench",
    "new-site",
    site,
    "--admin-password",
    adminPassword,
    "--db-type",
    "mariadb",
    "--install-app",
    "erpnext",
  ];

  const setHostArgs = [dockerBin, "exec", container, "bench", "--site", site, "set-config", "host_name", domain];

  try {
    await execDocker(newSiteArgs, timeoutMs);
    await execDocker(setHostArgs, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }

  return { ok: true, data: { site } };
}
