import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import type { BenchAgentLike } from "./services/site-steps.js";
import { BenchAgentError } from "./lib/bench-agent/client.js";

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
    BENCH_AGENT_URL: "http://axis-bench-agent:8797",
    BENCH_AGENT_HMAC_SECRET: "a".repeat(32),
    BENCH_AGENT_TIMEOUT_MS: "60000",
  });
}

const AUTH_HEADER = "Bearer test-token-16chars-min";

function stubBench(overrides: Partial<BenchAgentLike> = {}): BenchAgentLike {
  return {
    newSite:
      overrides.newSite ??
      (async (siteName) => ({ status: "created", site: siteName })),
    installApp:
      overrides.installApp ??
      (async (site, app) => ({ status: "installed", site, app })),
    setConfig:
      overrides.setConfig ??
      (async (site, key) => ({ status: "ok", site, key })),
    enableScheduler:
      overrides.enableScheduler ??
      (async (site) => ({ status: "ok", site })),
    createApiUser:
      overrides.createApiUser ??
      (async (site, username) => ({
        site,
        user: `${username}@axis.local`,
        api_key: "key-xyz",
        api_secret: "secret-xyz",
      })),
    siteStatus:
      overrides.siteStatus ??
      (async (site) => ({ site, exists: true, apps: ["frappe", "erpnext", "provisioning_api"] })),
  };
}

type SuccessBody<T> = { ok: true; data: T; timestamp: string };
type FailureBody = {
  ok: false;
  error: { code: string; message: string; retryable: boolean; details?: string; stderr?: string };
  timestamp: string;
};

// --- health --------------------------------------------------------------

test("GET /internal/health returns ok", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const app = await buildApp({ env, logger, benchAgent: stubBench() });
  try {
    const res = await app.inject({ method: "GET", url: "/internal/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      data: { service: string; upstream?: { erpReachable: boolean; reason?: string } };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.service, "erp-execution-service");
    assert.deepEqual(body.data.upstream, { erpReachable: false, reason: "not_configured" });
  } finally {
    await app.close();
  }
});

// --- auth ----------------------------------------------------------------

test("POST /sites/create rejects missing bearer token", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json" },
      payload: { siteName: "valid-site", domain: "app.example.com", apiUsername: "api_user" },
    });
    assert.equal(res.statusCode, 401);
    const body = res.json() as FailureBody;
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "ERP_COMMAND_FAILED");
    assert.equal(body.error.message, "Unauthorized");
    assert.equal(body.error.retryable, false);
    assert.ok(typeof body.timestamp === "string" && body.timestamp.length > 0);
  } finally {
    await app.close();
  }
});

test("POST /sites/create rejects wrong bearer token", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token-not-valid",
      },
      payload: { siteName: "valid-site", domain: "app.example.com", apiUsername: "api_user" },
    });
    assert.equal(res.statusCode, 401);
    const body = res.json() as FailureBody;
    assert.equal(body.error.code, "ERP_COMMAND_FAILED");
  } finally {
    await app.close();
  }
});

// --- POST /sites/create --------------------------------------------------

test("POST /sites/create returns 422 when sanitized site name is too short", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { siteName: "ab", domain: "app.example.com", apiUsername: "api_user", adminPassword: "test-admin-pw" },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as FailureBody;
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
    assert.equal(body.error.retryable, false);
    assert.match(body.error.message, /Invalid site name/);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 422 for empty siteName", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { siteName: "", domain: "app.example.com", apiUsername: "api_user", adminPassword: "test-admin-pw" },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as FailureBody;
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
    assert.ok(body.error.message.length > 0);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 200 with Phase 2 envelope on success", async () => {
  const env = testEnv();
  let seen: string | undefined;
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      newSite: async (siteName) => {
        seen = siteName;
        return { status: "created", site: siteName };
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: {
        siteName: "Site.Example.com",
        domain: "app.example.com",
        apiUsername: "api_user",
        adminPassword: "test-admin-pw",
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{
      action: string;
      site: string;
      outcome: string;
    }>;
    assert.equal(body.ok, true);
    assert.equal(body.data.action, "createSite");
    assert.equal(body.data.site, "site-example-com");
    assert.equal(body.data.outcome, "applied");
    assert.ok(typeof body.timestamp === "string" && body.timestamp.length > 0);
    assert.equal(seen, "site-example-com");
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 409 when bench reports 'already exists'", async () => {
  const env = testEnv();
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      newSite: async () => {
        throw new BenchAgentError("BENCH_COMMAND_FAILED", "bench new-site failed", 500, {
          step: "new_site",
          exit_code: 1,
          stdout: "",
          stderr: "Site valid-site already exists in apps/",
          command: "bench new-site valid-site",
        });
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: {
        siteName: "valid-site",
        domain: "app.example.com",
        apiUsername: "api_user",
        adminPassword: "test-admin-pw",
      },
    });
    assert.equal(res.statusCode, 409);
    const body = res.json() as FailureBody;
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "SITE_ALREADY_EXISTS");
    assert.equal(body.error.retryable, false);
    assert.match(body.error.stderr ?? "", /already exists/);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 503 when bench-agent is unreachable", async () => {
  const env = testEnv();
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      newSite: async () => {
        throw new BenchAgentError("NETWORK_ERROR", "Could not reach bench-agent", null, {
          command: "POST /v1/sites",
          stderr: "ECONNREFUSED",
        });
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: {
        siteName: "valid-site",
        domain: "app.example.com",
        apiUsername: "api_user",
        adminPassword: "test-admin-pw",
      },
    });
    assert.equal(res.statusCode, 503);
    const body = res.json() as FailureBody;
    assert.equal(body.error.code, "INFRA_UNAVAILABLE");
    assert.equal(body.error.retryable, true);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 504 on bench timeout", async () => {
  const env = testEnv();
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      newSite: async () => {
        throw new BenchAgentError("BENCH_TIMEOUT", "bench timed out", 500, {
          step: "new_site",
          exit_code: null,
          stdout: "",
          stderr: "timeout",
          command: "bench new-site valid-site",
        });
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: {
        siteName: "valid-site",
        domain: "app.example.com",
        apiUsername: "api_user",
        adminPassword: "test-admin-pw",
      },
    });
    assert.equal(res.statusCode, 504);
    const body = res.json() as FailureBody;
    assert.equal(body.error.code, "ERP_TIMEOUT");
    assert.equal(body.error.retryable, true);
  } finally {
    await app.close();
  }
});

// --- POST /sites/install-erp ---------------------------------------------

test("POST /sites/install-erp installs both apps and returns applied", async () => {
  const env = testEnv();
  const installs: Array<{ site: string; app: string }> = [];
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      installApp: async (site, appName) => {
        installs.push({ site, app: appName });
        return { status: "installed", site, app: appName };
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/install-erp",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { site: "acme.example" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{ action: string; outcome: string }>;
    assert.equal(body.data.action, "installErp");
    assert.equal(body.data.outcome, "applied");
    assert.deepEqual(installs, [
      { site: "acme.example", app: "erpnext" },
      { site: "acme.example", app: "provisioning_api" },
    ]);
  } finally {
    await app.close();
  }
});

test("POST /sites/install-erp returns 422 on missing site", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/install-erp",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: {},
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as FailureBody;
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
  } finally {
    await app.close();
  }
});

test("POST /sites/install-fitdesk installs fitdesk and returns applied", async () => {
  const env = testEnv();
  const installs: Array<{ site: string; app: string }> = [];
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      installApp: async (site, appName) => {
        installs.push({ site, app: appName });
        return { status: "installed", site, app: appName };
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/install-fitdesk",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { site: "acme.example" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{ action: string; outcome: string }>;
    assert.equal(body.data.action, "installFitdesk");
    assert.equal(body.data.outcome, "applied");
    assert.deepEqual(installs, [{ site: "acme.example", app: "fitdesk" }]);
  } finally {
    await app.close();
  }
});

test("POST /sites/install-fitdesk returns 422 on missing site", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/install-fitdesk",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: {},
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as FailureBody;
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
  } finally {
    await app.close();
  }
});

// --- POST /sites/enable-scheduler ----------------------------------------

test("POST /sites/enable-scheduler succeeds", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/enable-scheduler",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { site: "acme.example" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{ action: string }>;
    assert.equal(body.data.action, "enableScheduler");
  } finally {
    await app.close();
  }
});

// --- POST /sites/add-domain ----------------------------------------------

test("POST /sites/add-domain sets host_name via bench setConfig", async () => {
  const env = testEnv();
  const setConfigCalls: Array<{ site: string; key: string; value: string }> = [];
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      setConfig: async (site, key, value) => {
        setConfigCalls.push({ site, key, value });
        return { status: "ok", site, key };
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/add-domain",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { site: "acme.erp.example.com" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{ action: string; site: string }>;
    assert.equal(body.data.action, "addDomain");
    assert.deepEqual(setConfigCalls, [
      { site: "acme.erp.example.com", key: "host_name", value: "acme.erp.example.com" },
    ]);
  } finally {
    await app.close();
  }
});

// --- POST /sites/create-api-user -----------------------------------------

test("POST /sites/create-api-user returns api_key/api_secret in data", async () => {
  const env = testEnv();
  const calls: Array<{ site: string; username: string }> = [];
  const app = await buildApp({
    env,
    logger: createLogger(env),
    benchAgent: stubBench({
      createApiUser: async (site, username) => {
        calls.push({ site, username });
        return { site, user: `${username}@axis.local`, api_key: "KEY", api_secret: "SECRET" };
      },
    }),
  });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create-api-user",
      headers: { "content-type": "application/json", authorization: AUTH_HEADER },
      payload: { site: "acme.erp.example.com" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{
      action: string;
      apiKey: string;
      apiSecret: string;
      user: string;
    }>;
    assert.equal(body.data.action, "createApiUser");
    assert.equal(body.data.apiKey, "KEY");
    assert.equal(body.data.apiSecret, "SECRET");
    assert.equal(body.data.user, "cp_acme@axis.local");
    assert.deepEqual(calls, [{ site: "acme.erp.example.com", username: "cp_acme" }]);
  } finally {
    await app.close();
  }
});

// --- GET /sites/:site/status ---------------------------------------------

test("GET /sites/:site/status returns exists + apps", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/sites/acme.example/status",
      headers: { authorization: AUTH_HEADER },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as SuccessBody<{
      action: string;
      exists: boolean;
      apps: string[];
    }>;
    assert.equal(body.data.action, "siteStatus");
    assert.equal(body.data.exists, true);
    assert.deepEqual(body.data.apps, ["frappe", "erpnext", "provisioning_api"]);
  } finally {
    await app.close();
  }
});

test("GET /sites/:site/status rejects missing auth", async () => {
  const env = testEnv();
  const app = await buildApp({ env, logger: createLogger(env), benchAgent: stubBench() });
  try {
    const res = await app.inject({
      method: "GET",
      url: "/sites/acme.example/status",
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});
