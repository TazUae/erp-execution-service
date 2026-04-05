import type { InternalExecError } from "../../lib/exec.js";
import type { RemoteExecutionFailure, RemoteExecutionFailureCode } from "../../contracts/lifecycle.js";

const ALREADY_EXISTS_PATTERNS = [
  "already exists",
  "domain already exists",
  "duplicate entry",
];

function combinedLower(error: InternalExecError): string {
  return `${error.stdout}\n${error.stderr}\n${error.message}`.toLowerCase();
}

export function mapExecErrorToFailure(error: InternalExecError): RemoteExecutionFailure {
  const combined = combinedLower(error);

  if (error.kind === "timeout") {
    return {
      code: "ERP_TIMEOUT",
      message: "ERP lifecycle action timed out",
      retryable: true,
    };
  }

  if (error.kind === "spawn_failed" && error.spawnErrno === "ENOENT") {
    return {
      code: "INFRA_UNAVAILABLE",
      message: "ERP execution infrastructure unavailable",
      retryable: true,
      details:
        "bench executable not found (check ERP_BENCH_EXECUTABLE and PATH; this service requires a bench-side runtime)",
    };
  }

  if (error.kind === "spawn_failed") {
    return {
      code: "INFRA_UNAVAILABLE",
      message: "ERP execution infrastructure unavailable",
      retryable: true,
      details: error.message,
    };
  }

  if (ALREADY_EXISTS_PATTERNS.some((p) => combined.includes(p))) {
    return {
      code: "SITE_ALREADY_EXISTS",
      message: "Site or domain already exists",
      retryable: false,
    };
  }

  if (error.kind === "nonzero_exit") {
    return {
      code: "ERP_COMMAND_FAILED",
      message: "ERP lifecycle command failed",
      retryable: false,
    };
  }

  return {
    code: "ERP_COMMAND_FAILED",
    message: "ERP lifecycle command failed",
    retryable: false,
  };
}

export function mapFailureCodeToHttpStatus(code: RemoteExecutionFailureCode): number {
  const map: Record<RemoteExecutionFailureCode, number> = {
    INFRA_UNAVAILABLE: 503,
    ERP_COMMAND_FAILED: 400,
    ERP_TIMEOUT: 504,
    ERP_VALIDATION_FAILED: 422,
    ERP_PARTIAL_SUCCESS: 500,
    SITE_ALREADY_EXISTS: 409,
  };
  return map[code];
}
