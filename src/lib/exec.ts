import { spawn } from "node:child_process";

export type InternalExecResult = {
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type InternalExecError = {
  kind: "timeout" | "spawn_failed" | "nonzero_exit";
  message: string;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode?: number;
  spawnErrno?: string;
};

type ExecOptions = {
  timeoutMs: number;
  cwd: string;
};

/**
 * argv-only execution (no shell). Stdout/stderr captured for internal logging only.
 */
export async function execArgv(
  command: string,
  args: string[],
  options: ExecOptions
): Promise<InternalExecResult> {
  const startedAt = Date.now();
  const { timeoutMs, cwd } = options;

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      const errno = (error as NodeJS.ErrnoException).code;
      const durationMs = Date.now() - startedAt;
      const err: InternalExecError = {
        kind: "spawn_failed",
        message: error.message,
        durationMs,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        spawnErrno: errno,
      };
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const trimmedStdout = stdout.trim();
      const trimmedStderr = stderr.trim();
      const durationMs = Date.now() - startedAt;

      if (timedOut) {
        const err: InternalExecError = {
          kind: "timeout",
          message: `Command exceeded ${timeoutMs}ms`,
          durationMs,
          stdout: trimmedStdout,
          stderr: trimmedStderr,
        };
        reject(err);
        return;
      }

      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        const err: InternalExecError = {
          kind: "nonzero_exit",
          message: `Command exited with code ${exitCode}`,
          durationMs,
          stdout: trimmedStdout,
          stderr: trimmedStderr,
          exitCode,
        };
        reject(err);
        return;
      }

      resolve({
        durationMs,
        stdout: trimmedStdout,
        stderr: trimmedStderr,
        exitCode,
      });
    });
  });
}
