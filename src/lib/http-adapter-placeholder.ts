/**
 * Placeholder for the upcoming HTTP-only ERP integration.
 * The real implementation will use HttpProvisioningClient against ERP_BASE_URL.
 */

/** Placeholder for the client that will perform lifecycle calls over HTTP to the ERP stack. */
export type HttpProvisioningClient = unknown;

/**
 * Reserved for when code paths must signal that the HTTP adapter is not implemented yet.
 * Lifecycle actions currently return INFRA_UNAVAILABLE instead of throwing.
 */
export class NotImplementedError extends Error {
  constructor(message = "HTTP adapter not implemented yet") {
    super(message);
    this.name = "NotImplementedError";
  }
}
