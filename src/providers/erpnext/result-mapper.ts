import type { RemoteExecutionFailure, RemoteExecutionFailureCode } from "../../contracts/lifecycle.js";
import { ErpCallError } from "../../lib/call-erp.js";

const ALREADY_EXISTS_PATTERNS = [
  "already exists",
  "domain already exists",
  "duplicate entry",
];

function combinedLower(message: string, details?: string): string {
  return `${message}\n${details ?? ""}`.toLowerCase();
}

export function mapErpCallErrorToFailure(error: ErpCallError): RemoteExecutionFailure {
  const msg = error.message;
  const details = error.options.responseText;
  const combined = combinedLower(msg, details);

  if (error.kind === "timeout") {
    return {
      code: "ERP_TIMEOUT",
      message: "ERP lifecycle action timed out",
      retryable: true,
    };
  }

  if (error.kind === "network") {
    return {
      code: "INFRA_UNAVAILABLE",
      message: "ERP execution infrastructure unavailable",
      retryable: true,
      details: msg,
    };
  }

  if (error.kind === "parse") {
    return {
      code: "INFRA_UNAVAILABLE",
      message: "ERP execution infrastructure unavailable",
      retryable: true,
      details: msg,
    };
  }

  if (ALREADY_EXISTS_PATTERNS.some((p) => combined.includes(p))) {
    return {
      code: "SITE_ALREADY_EXISTS",
      message: "Site or domain already exists",
      retryable: false,
    };
  }

  if (error.kind === "http") {
    const status = error.options.status;
    if (status === 503 || status === 502 || status === 404) {
      return {
        code: "INFRA_UNAVAILABLE",
        message: "ERP execution infrastructure unavailable",
        retryable: true,
        details: msg,
      };
    }
    if (status === 504 || status === 408) {
      return {
        code: "ERP_TIMEOUT",
        message: "ERP lifecycle action timed out",
        retryable: true,
      };
    }
    if (status === 409) {
      return {
        code: "SITE_ALREADY_EXISTS",
        message: "Site or domain already exists",
        retryable: false,
      };
    }
    return {
      code: "ERP_COMMAND_FAILED",
      message: "ERP lifecycle command failed",
      retryable: false,
      details: msg,
    };
  }

  if (error.kind === "logical") {
    return {
      code: "ERP_COMMAND_FAILED",
      message: msg || "ERP lifecycle command failed",
      retryable: false,
      details,
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
