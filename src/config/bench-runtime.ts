import { stat } from "node:fs/promises";
import path from "node:path";
import type { Env } from "./env.js";
import { execArgv } from "../lib/exec.js";
import type { InternalExecError } from "../lib/exec.js";

export type BenchRuntimeCheckIssue = {
  code: string;
  message: string;
};

/**
 * Thrown when startup checks for bench-side execution (directory, `sites`, `bench --version`) fail.
 */
export class BenchRuntimeValidationError extends Error {
  readonly issues: BenchRuntimeCheckIssue[];

  constructor(issues: BenchRuntimeCheckIssue[]) {
    super(
      `Bench runtime validation failed: ${issues.map((i) => `[${i.code}] ${i.message}`).join("; ")}`
    );
    this.name = "BenchRuntimeValidationError";
    this.issues = issues;
  }
}

/**
 * Validates that this process can run as a bench-side executor: bench directory, `sites/`, and
 * `ERP_BENCH_EXECUTABLE --version` from `ERP_BENCH_PATH`.
 */
export async function validateBenchRuntime(env: Env): Promise<void> {
  const issues: BenchRuntimeCheckIssue[] = [];

  try {
    const s = await stat(env.ERP_BENCH_PATH);
    if (!s.isDirectory()) {
      issues.push({
        code: "BENCH_PATH_NOT_DIRECTORY",
        message: `ERP_BENCH_PATH must be a directory: ${env.ERP_BENCH_PATH}`,
      });
    }
  } catch {
    issues.push({
      code: "BENCH_PATH_INACCESSIBLE",
      message: `ERP_BENCH_PATH is missing or not readable: ${env.ERP_BENCH_PATH}`,
    });
  }

  if (issues.length > 0) {
    throw new BenchRuntimeValidationError(issues);
  }

  const sitesPath = path.join(env.ERP_BENCH_PATH, "sites");
  try {
    const s = await stat(sitesPath);
    if (!s.isDirectory()) {
      issues.push({
        code: "BENCH_SITES_INVALID",
        message: `Expected a directory at ${sitesPath}`,
      });
    }
  } catch {
    issues.push({
      code: "BENCH_SITES_MISSING",
      message: `Bench "sites" directory is missing or inaccessible: ${sitesPath}`,
    });
  }

  if (issues.length > 0) {
    throw new BenchRuntimeValidationError(issues);
  }

  try {
    await execArgv(env.ERP_BENCH_EXECUTABLE, ["--version"], {
      cwd: env.ERP_BENCH_PATH,
      timeoutMs: Math.min(30_000, env.ERP_COMMAND_TIMEOUT_MS),
    });
  } catch (error) {
    const execError = error as InternalExecError;
    throw new BenchRuntimeValidationError([
      {
        code: "BENCH_EXECUTABLE_FAILED",
        message: `Cannot run "${env.ERP_BENCH_EXECUTABLE} --version" with cwd=${env.ERP_BENCH_PATH} (${execError.kind}: ${execError.message})`,
      },
    ]);
  }
}
