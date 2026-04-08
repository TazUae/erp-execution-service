import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSite } from "./create-site.js";
import { loadEnv, resetEnvCacheForTests } from "../config/env.js";
import type { FrappeClient } from "../lib/frappe-client/client.js";
import type { FrappeResponse } from "../lib/frappe-client/types.js";

function baseEnv(overrides?: Record<string, string | undefined>) {
  return loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
    ERP_BASE_URL: "http://erp.example:8000",
    ERP_SITE_HOST: "erp.fallback.example",
    ERP_PROVISIONING_TOKEN: "test-provisioning-token-16chars",
    ...overrides,
  });
}

afterEach(() => {
  resetEnvCacheForTests();
});

test("createSite sends only site_name to ERP (contract)", async () => {
  const env = baseEnv({ ERP_METHOD_CREATE_SITE: "custom.path.create_site" });
  let seenMethod: string | undefined;
  let seenPayload: unknown;
  const client = {
    async callMethod(method: string, payload?: unknown): Promise<FrappeResponse> {
      seenMethod = method;
      seenPayload = payload;
      return { ok: true, data: {} };
    },
  } as FrappeClient;
  const r = await createSite(
    env,
    { siteName: "valid-site.example.com", domain: "app.example.com", apiUsername: "api_user" },
    { frappeClient: client }
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.siteName, "valid-site.example.com");
  }
  assert.equal(seenMethod, "custom.path.create_site");
  assert.deepEqual(seenPayload, { site_name: "valid-site.example.com" });
});

test("createSite returns INFRA when ERP not configured", async () => {
  const env = baseEnv({ ERP_BASE_URL: "", ERP_SITE_HOST: "", ERP_PROVISIONING_TOKEN: "" });
  const r = await createSite(env, {
    siteName: "valid-site.example.com",
    domain: "app.example.com",
    apiUsername: "api_user",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "INFRA_UNAVAILABLE");
  }
});
