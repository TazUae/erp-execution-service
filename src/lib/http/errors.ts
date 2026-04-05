import type { RemoteExecutionFailureCode } from "../../contracts/lifecycle.js";

export type HttpProvisioningErrorKind =
  | "unauthorized"
  | "bad_request"
  | "not_found"
  | "timeout"
  | "network"
  | "upstream"
  | "parse"
  | "configuration";

/**
 * Structured failure from the ERPNext HTTP client. Safe for logs and API envelopes
 * (no secrets; upstream snippets are truncated).
 */
export class HttpProvisioningError extends Error {
  readonly kind: HttpProvisioningErrorKind;
  readonly upstreamStatus?: number;
  /** Short, non-sensitive detail for operators (no auth material). */
  readonly safeDetails?: string;

  constructor(
    kind: HttpProvisioningErrorKind,
    message: string,
    options?: { upstreamStatus?: number; safeDetails?: string; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HttpProvisioningError";
    this.kind = kind;
    this.upstreamStatus = options?.upstreamStatus;
    this.safeDetails = options?.safeDetails;
  }
}

/** Thrown when lifecycle HTTP paths are not implemented yet (adapter layer). */
export class NotImplementedError extends Error {
  constructor(message = "HTTP adapter not implemented yet") {
    super(message);
    this.name = "NotImplementedError";
  }
}

const UPSTREAM_SNIPPET_MAX = 512;

export function truncateSafeSnippet(text: string, max = UPSTREAM_SNIPPET_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/**
 * Maps client errors to lifecycle failure codes for the adapter layer (no bench-era concepts).
 */
export function mapHttpProvisioningErrorToFailure(
  err: HttpProvisioningError
): { code: RemoteExecutionFailureCode; retryable: boolean } {
  switch (err.kind) {
    case "unauthorized":
      return { code: "ERP_COMMAND_FAILED", retryable: false };
    case "bad_request":
      return { code: "ERP_VALIDATION_FAILED", retryable: false };
    case "not_found":
      return { code: "ERP_COMMAND_FAILED", retryable: false };
    case "timeout":
      return { code: "ERP_TIMEOUT", retryable: true };
    case "network":
      return { code: "INFRA_UNAVAILABLE", retryable: true };
    case "upstream":
      return { code: "INFRA_UNAVAILABLE", retryable: true };
    case "parse":
      return { code: "ERP_COMMAND_FAILED", retryable: false };
    case "configuration":
      return { code: "INFRA_UNAVAILABLE", retryable: false };
  }
}
