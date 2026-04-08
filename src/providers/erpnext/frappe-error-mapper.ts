import type { FrappeErrorCode } from "../../lib/frappe-client/types.js";
import type { RemoteExecutionFailure } from "../../contracts/errors.js";

/**
 * Maps normalized {@link FrappeErrorCode} values from `FrappeClient` to HTTP-facing
 * failure codes. Keeps a single place for outbound ERP error semantics.
 */
export function mapFrappeErrorToRemoteFailure(frappeCode: FrappeErrorCode, message: string): RemoteExecutionFailure {
  switch (frappeCode) {
    case "AUTH_ERROR":
      return {
        code: "ERP_COMMAND_FAILED",
        message: "Upstream rejected API credentials",
        retryable: false,
        details: message,
      };
    case "METHOD_NOT_FOUND":
      return {
        code: "NOT_IMPLEMENTED",
        message: "Frappe method is not available on upstream (not deployed or not whitelisted)",
        retryable: true,
        details: message,
      };
    case "SITE_NOT_FOUND":
      return {
        code: "SITE_NOT_FOUND",
        message: "Site not found on ERP bench",
        retryable: false,
        details: message,
      };
    case "TIMEOUT":
      return {
        code: "ERP_TIMEOUT",
        message: "Upstream ERP request timed out",
        retryable: true,
        details: message,
      };
    case "NETWORK_ERROR":
      return {
        code: "INFRA_UNAVAILABLE",
        message: "Could not reach ERP upstream",
        retryable: true,
        details: message,
      };
    case "ERP_APPLICATION_ERROR":
      return {
        code: "ERP_COMMAND_FAILED",
        message: "Upstream ERP reported an application error",
        retryable: false,
        details: message,
      };
    case "INVALID_RESPONSE":
      return {
        code: "INFRA_UNAVAILABLE",
        message: "Invalid or non-JSON response from ERP upstream",
        retryable: true,
        details: message,
      };
    case "UPSTREAM_HTTP_ERROR":
      return {
        code: "INFRA_UNAVAILABLE",
        message: "Unexpected HTTP response from ERP upstream",
        retryable: true,
        details: message,
      };
    default: {
      const _exhaustive: never = frappeCode;
      return _exhaustive;
    }
  }
}
