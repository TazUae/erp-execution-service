import { spawn } from "node:child_process";
import { ZodError } from "zod";
import type { Env } from "../config/env.js";
import { validateDomain, validateUsername } from "../providers/erpnext/validation.js";

export type CreateSiteParams = {
  siteName: string;
  domain: string;
  apiUsername: string;
};

export type CreateSiteExecutionError = {
  code: string;
  message: string;
  details: {
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
  };
};

export type CreateSiteResult =
  | { ok: true; data: { site: string } }
  | { ok: false; error: string; validation: true }
  | { ok: false; error: CreateSiteExecutionError };

export type CreateSiteDeps = {
  execDocker?: (argv: string[], timeoutMs: number) => Promise<void>;
};

export function classifyError(stderr: string): string {
  if (stderr.includes("Access denied")) return "ERP_DB_AUTH_FAILED";
  if (stderr.includes("already exists")) return "SITE_ALREADY_EXISTS";
  if (stderr.includes("invalid")) return "INVALID_SITE_NAME";
  if (stderr.includes("Connection refused")) return "DB_CONNECTION_FAILED";
  return "ERP_COMMAND_FAILED";
}

export class DockerExecError extends Error {
  override readonly name = "DockerExecError";
  constructor(
    readonly command: string,
    readonly exitCode: number | null,
    readonly stdout: string,
    readonly stderr: string,
  ) {
    super((stderr || stdout || "").trim() || `docker exited with code ${exitCode ?? "null"}`);
  }
}

function executionErrorFromDocker(err: DockerExecError): CreateSiteExecutionError {
  const code = classifyError(err.stderr);
  console.log("EXEC CMD:", err.command);
  console.log("STDERR:", err.stderr);
  return {
    code,
    message: "ERP command failed",
    details: {
      command: err.command,
      exitCode: err.exitCode,
      stdout: err.stdout,
      stderr: err.stderr,
    },
  };
}

/**
 * Lowercase slug: only [a-z0-9], single dashes between segments (no leading/trailing dash).
 */
export function sanitizeSiteName(raw: string): string {
  const lower = raw.trim().toLowerCase();
  const dashed = lower.replace(/[^a-z0-9]+/g, "-").replace(/-+/g, "-");
  return dashed.replace(/^-|-$/g, "");
}

function defaultExecDocker(argv: string[], timeoutMs: number): Promise<void> {
  const command = argv.join(" ");
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
        reject(
          new DockerExecError(
            command,
            null,
            stdout,
            `docker exec timed out after ${timeoutMs}ms`,
          ),
        );
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
      finish(() => reject(new DockerExecError(command, null, stdout, err.message)));
    });
    child.on("close", (code) => {
      if (code === 0) {
        finish(() => resolve());
        return;
      }
      finish(() => reject(new DockerExecError(command, code, stdout, stderr)));
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
      error:
        "Invalid site name: must be 3–253 characters after sanitization (lowercase letters, numbers, dashes)",
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

  let lastCommand = "";
  try {
    lastCommand = newSiteArgs.join(" ");
    await execDocker(newSiteArgs, timeoutMs);
    lastCommand = setHostArgs.join(" ");
    await execDocker(setHostArgs, timeoutMs);
  } catch (error) {
    if (error instanceof DockerExecError) {
      return { ok: false, error: executionErrorFromDocker(error) };
    }
    const message = error instanceof Error ? error.message : String(error);
    console.log("EXEC CMD:", lastCommand);
    console.log("STDERR:", message);
    return {
      ok: false,
      error: {
        code: "ERP_COMMAND_FAILED",
        message: "ERP command failed",
        details: {
          command: lastCommand,
          exitCode: null,
          stdout: "",
          stderr: message,
        },
      },
    };
  }

  return { ok: true, data: { site } };
}
