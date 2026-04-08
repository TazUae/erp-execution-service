import type { RemoteExecutionFailureCode } from "../../contracts/errors.js";

export function mapFailureCodeToHttpStatus(code: RemoteExecutionFailureCode): number {
  const map: Record<RemoteExecutionFailureCode, number> = {
    INFRA_UNAVAILABLE: 503,
    ERP_COMMAND_FAILED: 400,
    ERP_TIMEOUT: 504,
    ERP_VALIDATION_FAILED: 422,
    ERP_PARTIAL_SUCCESS: 500,
    SITE_ALREADY_EXISTS: 409,
    SITE_NOT_FOUND: 404,
    NOT_IMPLEMENTED: 501,
  };
  return map[code];
}
