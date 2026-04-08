import { ZodError } from "zod";
import type { Env } from "../config/env.js";
import type { RemoteExecutionFailure } from "../contracts/errors.js";
import { createFrappeClientFromEnv, type FrappeClient } from "../lib/frappe-client/client.js";
import { mapFrappeErrorToRemoteFailure } from "../providers/erpnext/frappe-error-mapper.js";
import { validateDomain, validateSite, validateUsername } from "../providers/erpnext/validation.js";
export type CreateSiteParams = {
  siteName: string;
  domain: string;
  apiUsername: string;
};

export type CreateSiteResult =
  | { ok: true; data: { siteName: string } }
  | { ok: false; failure: RemoteExecutionFailure };

export type CreateSiteDeps = {
  frappeClient?: FrappeClient;
};

function infraNotConfiguredFailure(): RemoteExecutionFailure {
  return {
    code: "INFRA_UNAVAILABLE",
    message: "Outbound ERP is not configured (set ERP_BASE_URL, ERP_PROVISIONING_TOKEN, and ERP_SITE_HOST)",
    retryable: true,
    details:
      "createFrappeClientFromEnv requires ERP_BASE_URL, ERP_PROVISIONING_TOKEN (X-Provisioning-Token to provisioning_api), and ERP_SITE_HOST (Frappe Host header fallback)",
  };
}

/**
 * Calls ERP `provisioning_api.api.provisioning.create_site` with body `{ site_name }` only (ERP contract).
 * `domain` and `apiUsername` are validated locally for consistent input checks; they are not sent until the ERP API accepts them.
 */
export async function createSite(env: Env, params: CreateSiteParams, deps: CreateSiteDeps = {}): Promise<CreateSiteResult> {
  let site: string;
  try {
    site = validateSite(params.siteName);
    validateDomain(params.domain);
    validateUsername(params.apiUsername);
  } catch (error) {
    if (error instanceof ZodError) {
      return {
        ok: false,
        failure: {
          code: "ERP_VALIDATION_FAILED",
          message: "Invalid create site input",
          retryable: false,
          details: error.message,
        },
      };
    }
    throw error;
  }

  const client =
    deps.frappeClient ??
    (() => {
      try {
        return createFrappeClientFromEnv(env);
      } catch {
        return null;
      }
    })();

  if (!client) {
    return { ok: false, failure: infraNotConfiguredFailure() };
  }

  const result = await client.callMethod(env.ERP_METHOD_CREATE_SITE, { site_name: site });
  if (!result.ok) {
    return {
      ok: false,
      failure: mapFrappeErrorToRemoteFailure(result.error.code, result.error.message),
    };
  }

  return { ok: true, data: { siteName: site } };
}
