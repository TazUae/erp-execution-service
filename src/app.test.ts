import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import type { LifecycleAdapter } from "./providers/erpnext/execution-adapter.js";
import { ErpExecutionAdapter } from "./providers/erpnext/execution-adapter.js";
import type { RemoteExecuteRequest } from "./contracts/lifecycle.js";

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
  });
}

test("GET /internal/health returns ok", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return { ok: true, durationMs: 0 };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({ method: "GET", url: "/internal/health" });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: { service: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.service, "erp-execution-service");
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle rejects missing bearer token", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return { ok: true, durationMs: 0 };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: { "content-type": "application/json" },
      payload: { action: "healthCheck", payload: {} },
    });
    assert.equal(res.statusCode, 401);
    const body = res.json() as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle rejects wrong bearer token", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return { ok: true, durationMs: 0 };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer wrong-token-not-valid",
      },
      payload: { action: "healthCheck", payload: {} },
    });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle returns 422 when semantic site validation fails", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const realAdapter: LifecycleAdapter = new ErpExecutionAdapter(env, logger);
  const app = await buildApp({ env, logger, adapter: realAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { action: "createSite", payload: { site: "ab" } },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle returns 422 for invalid action payload", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return { ok: true, durationMs: 0 };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { action: "createSite", payload: { site: "" } },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as { ok: boolean; error: { code: string } };
    assert.equal(body.error.code, "ERP_VALIDATION_FAILED");
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle handles valid envelope via adapter", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  let seen: RemoteExecuteRequest | undefined;
  const mockAdapter: LifecycleAdapter = {
    async run(request) {
      seen = request;
      return { ok: true, durationMs: 42, metadata: { status: "ok" } };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { action: "healthCheck", payload: {} },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      ok: boolean;
      data: { durationMs: number; metadata?: Record<string, unknown> };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.durationMs, 42);
    assert.ok(seen);
    assert.equal(seen.action, "healthCheck");
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle maps adapter failure with SITE_ALREADY_EXISTS", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return {
        ok: false,
        failure: {
          code: "SITE_ALREADY_EXISTS",
          message: "duplicate",
          retryable: false,
        },
      };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { action: "createSite", payload: { site: "valid-site" } },
    });
    assert.equal(res.statusCode, 409);
    const body = res.json() as { ok: boolean; error: { code: string } };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "SITE_ALREADY_EXISTS");
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle maps adapter failure with ERP_TIMEOUT", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return {
        ok: false,
        failure: {
          code: "ERP_TIMEOUT",
          message: "timed out",
          retryable: true,
        },
      };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { action: "installErp", payload: { site: "valid-site" } },
    });
    assert.equal(res.statusCode, 504);
  } finally {
    await app.close();
  }
});

test("POST /v1/erp/lifecycle maps adapter failure with INFRA_UNAVAILABLE", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockAdapter: LifecycleAdapter = {
    async run() {
      return {
        ok: false,
        failure: {
          code: "INFRA_UNAVAILABLE",
          message: "remote unavailable",
          retryable: true,
        },
      };
    },
  };
  const app = await buildApp({ env, logger, adapter: mockAdapter });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/v1/erp/lifecycle",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { action: "enableScheduler", payload: { site: "valid-site" } },
    });
    assert.equal(res.statusCode, 503);
  } finally {
    await app.close();
  }
});
