/**
 * Phase 2 HTTP envelope shared with control-plane.
 *
 * Wire format (see `control-plane/src/lib/provisioning/contract.ts`):
 *
 *   success: { ok: true,  data: { ... },   timestamp: <ISO> }
 *   failure: { ok: false, error: { code, message, retryable, details?, stdout?, stderr?, exitCode? }, timestamp: <ISO> }
 *
 * Every Phase 2 site-step route (`/sites/create`, `/sites/install-erp`, ...)
 * MUST return one of these shapes. The control-plane HTTP adapter Zod-validates
 * both envelopes and treats unknown codes as opaque HTTP errors, so the code
 * enum here must stay in lock-step with the control-plane contract.
 */

export type Phase2ErrorCode =
  | "INFRA_UNAVAILABLE"
  | "ERP_COMMAND_FAILED"
  | "ERP_VALIDATION_FAILED"
  | "ERP_TIMEOUT"
  | "ERP_PARTIAL_SUCCESS"
  | "SITE_ALREADY_EXISTS";

export type Phase2Error = {
  code: Phase2ErrorCode;
  message: string;
  retryable: boolean;
  details?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

export type Phase2Success<TData> = {
  ok: true;
  data: TData;
  timestamp: string;
};

export type Phase2Failure = {
  ok: false;
  error: Phase2Error;
  timestamp: string;
};

export type Phase2Envelope<TData> = Phase2Success<TData> | Phase2Failure;

/** Data payload returned by every `/sites/*` site-operation route. */
export type SiteOperationData = {
  /** Stable action identifier — matches the adapter method name on control-plane. */
  action: string;
  site: string;
  /** `applied` when this call changed state, `already_done` on an idempotent no-op. */
  outcome: "applied" | "already_done";
  /** MariaDB schema name (`db_name` in site_config), not the site slug. */
  dbName?: string;
  message?: string;
  alreadyExists?: boolean;
  alreadyInstalled?: boolean;
  alreadyConfigured?: boolean;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
};

export function phase2Success<TData>(data: TData): Phase2Success<TData> {
  return { ok: true, data, timestamp: new Date().toISOString() };
}

export function phase2Failure(error: Phase2Error): Phase2Failure {
  return { ok: false, error, timestamp: new Date().toISOString() };
}

/**
 * HTTP status for a given Phase 2 error code. Used by routes when translating
 * an internal failure into an HTTP response — the control-plane reads the
 * envelope body regardless of status, but we still want sane status codes for
 * logs/metrics and for any future direct callers.
 */
export function phase2StatusFor(code: Phase2ErrorCode): number {
  switch (code) {
    case "INFRA_UNAVAILABLE":
      return 503;
    case "ERP_TIMEOUT":
      return 504;
    case "ERP_VALIDATION_FAILED":
      return 422;
    case "SITE_ALREADY_EXISTS":
      return 409;
    case "ERP_PARTIAL_SUCCESS":
      return 500;
    case "ERP_COMMAND_FAILED":
    default:
      return 500;
  }
}
