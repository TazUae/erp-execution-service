import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ErpExecutionAdapter } from "./execution-adapter.js";
import { loadEnv, resetEnvCacheForTests } from "../../config/env.js";
import { createLogger } from "../../lib/logger.js";
import type { FrappeClient } from "../../lib/frappe-client/client.js";
import type { FrappeResponse, ReadSiteDbNameResult } from "../../lib/frappe-client/types.js";

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

function makeMockClient(handlers: {
  callMethod?: (method: string, payload?: unknown) => Promise<FrappeResponse>;
  callReadSiteDbName?: (method: string, payload: { site_name: string }) => Promise<ReadSiteDbNameResult>;
  ping?: () => Promise<FrappeResponse>;
}): FrappeClient {
  const callMethod = handlers.callMethod ?? (async () => ({ ok: true, data: {} }));
  return {
    callMethod,
    callReadSiteDbName:
      handlers.callReadSiteDbName ??
      (async () => ({
        ok: false,
        error: { code: "INVALID_RESPONSE", message: "callReadSiteDbName not stubbed in test mock" },
      })),
    ping: handlers.ping ?? (async () => ({ ok: true, data: "pong" })),
  } as FrappeClient;
}

afterEach(() => {
  resetEnvCacheForTests();
});

test("createSite calls configured method with site_name payload", async () => {
  const env = baseEnv({ ERP_METHOD_CREATE_SITE: "custom.path.create_site" });
  const logger = createLogger(env);
  let seenMethod: string | undefined;
  let seenPayload: unknown;
  const client = makeMockClient({
    async callMethod(method, payload) {
      seenMethod = method;
      seenPayload = payload;
      return { ok: true, data: { done: true } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({
    action: "createSite",
    payload: {
      site: "valid-site",
      domain: "app.example.com",
      apiUsername: "api_user",
    },
  });
  assert.equal(r.ok, true);
  assert.equal(seenMethod, "custom.path.create_site");
  assert.deepEqual(seenPayload, {
    site_name: "valid-site",
    domain: "app.example.com",
    api_username: "api_user",
  });
});

test("installErp maps to ERP_METHOD_INSTALL_ERP", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  let seenMethod: string | undefined;
  const client = makeMockClient({
    async callMethod(method) {
      seenMethod = method;
      return { ok: true, data: null };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  await adapter.run({ action: "installErp", payload: { site: "valid-site" } });
  assert.equal(seenMethod, env.ERP_METHOD_INSTALL_ERP);
  assert.equal(seenMethod, "provisioning_api.api.provisioning.install_erp");
});

test("addDomain sends site_name and domain", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  let seenPayload: unknown;
  const client = makeMockClient({
    async callMethod(_m, payload) {
      seenPayload = payload;
      return { ok: true, data: {} };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  await adapter.run({
    action: "addDomain",
    payload: { site: "valid-site", domain: "app.example.com" },
  });
  assert.deepEqual(seenPayload, { site_name: "valid-site", domain: "app.example.com" });
});

test("createApiUser sends site_name and api_username from apiUsername", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  let seenPayload: unknown;
  const client = makeMockClient({
    async callMethod(_m, payload) {
      seenPayload = payload;
      return { ok: true, data: {} };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  await adapter.run({
    action: "createApiUser",
    payload: { site: "valid-site", apiUsername: "api_user" },
  });
  assert.deepEqual(seenPayload, { site_name: "valid-site", api_username: "api_user" });
});

test("METHOD_NOT_FOUND maps to NOT_IMPLEMENTED", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callMethod() {
      return { ok: false, error: { code: "METHOD_NOT_FOUND", message: "404" } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({
    action: "createSite",
    payload: { site: "valid-site", domain: "app.example.com", apiUsername: "api_user" },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "NOT_IMPLEMENTED");
    assert.equal(r.failure.retryable, true);
  }
});

test("AUTH_ERROR maps to ERP_COMMAND_FAILED", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callMethod() {
      return { ok: false, error: { code: "AUTH_ERROR", message: "nope" } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({ action: "installErp", payload: { site: "valid-site" } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "ERP_COMMAND_FAILED");
    assert.equal(r.failure.retryable, false);
  }
});

test("TIMEOUT maps to ERP_TIMEOUT", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callMethod() {
      return { ok: false, error: { code: "TIMEOUT", message: "slow" } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({ action: "enableScheduler", payload: { site: "valid-site" } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "ERP_TIMEOUT");
  }
});

test("NETWORK_ERROR maps to INFRA_UNAVAILABLE", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callMethod() {
      return { ok: false, error: { code: "NETWORK_ERROR", message: "ECONNREFUSED" } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({ action: "addDomain", payload: { site: "valid-site", domain: "app.example.com" } });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "INFRA_UNAVAILABLE");
  }
});

test("successful Frappe response maps to ok with metadata", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callMethod() {
      return { ok: true, data: { status: "created", count: 1 } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({
    action: "createSite",
    payload: { site: "valid-site", domain: "app.example.com", apiUsername: "api_user" },
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.ok(r.metadata);
    assert.equal(r.metadata?.status, "created");
    assert.equal(r.metadata?.count, 1);
  }
});

test("readSiteDbName uses callReadSiteDbName and returns db_name metadata on success", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  let seenMethod: string | undefined;
  let seenPayload: unknown;
  const client = makeMockClient({
    async callReadSiteDbName(method, payload) {
      seenMethod = method;
      seenPayload = payload;
      return { ok: true, dbName: "_fe883896178c6f75" };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({
    action: "readSiteDbName",
    payload: { site: "valid-site" },
  });
  assert.equal(r.ok, true);
  assert.equal(seenMethod, env.ERP_METHOD_READ_SITE_DB_NAME);
  assert.deepEqual(seenPayload, { site_name: "valid-site" });
  if (r.ok) {
    assert.equal(r.metadata?.db_name, "_fe883896178c6f75");
  }
});

test("readSiteDbName maps SITE_NOT_FOUND from client", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callReadSiteDbName() {
      return { ok: false, error: { code: "SITE_NOT_FOUND", message: "site directory does not exist" } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({
    action: "readSiteDbName",
    payload: { site: "missing-site" },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "SITE_NOT_FOUND");
    assert.equal(r.failure.retryable, false);
    assert.match(r.failure.details ?? "", /site directory does not exist/);
  }
});

test("readSiteDbName maps AUTH_ERROR from client", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  const client = makeMockClient({
    async callReadSiteDbName() {
      return { ok: false, error: { code: "AUTH_ERROR", message: "Invalid or missing provisioning token" } };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({
    action: "readSiteDbName",
    payload: { site: "valid-site" },
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.failure.code, "ERP_COMMAND_FAILED");
    assert.equal(r.failure.retryable, false);
  }
});

test("healthCheck uses ping", async () => {
  const env = baseEnv();
  const logger = createLogger(env);
  let pinged = false;
  const client = makeMockClient({
    async callMethod() {
      throw new Error("should not callMethod");
    },
    async ping() {
      pinged = true;
      return { ok: true, data: "pong" };
    },
  });
  const adapter = new ErpExecutionAdapter(env, logger, { frappeClient: client });
  const r = await adapter.run({ action: "healthCheck", payload: {} });
  assert.equal(pinged, true);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.metadata?.erp_upstream, "reachable");
    assert.equal(r.metadata?.message, "pong");
  }
});
