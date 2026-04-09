import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import type { CreateSiteParams, CreateSiteResult } from "./services/create-site.js";

function testEnv() {
  return loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
    DB_ROOT_PASSWORD: "test-db-root",
  });
}

test("GET /internal/health returns ok", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({ ok: true, data: { site: "x" } });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
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

test("POST /sites/create rejects missing bearer token", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({ ok: true, data: { site: "x" } });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: { "content-type": "application/json" },
      payload: { siteName: "valid-site", domain: "app.example.com", apiUsername: "api_user" },
    });
    assert.equal(res.statusCode, 401);
    const body = res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.equal(body.error, "Unauthorized");
  } finally {
    await app.close();
  }
});

test("POST /sites/create rejects wrong bearer token", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({ ok: true, data: { site: "x" } });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
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
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 422 when semantic site validation fails", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const app = await buildApp({ env, logger });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { siteName: "ab", domain: "app.example.com", apiUsername: "api_user" },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as { ok: boolean; error: string };
    assert.match(body.error, /Invalid site name/);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 422 for empty siteName", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({ ok: true, data: { site: "x" } });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: { siteName: "", domain: "app.example.com", apiUsername: "api_user" },
    });
    assert.equal(res.statusCode, 422);
    const body = res.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.ok(body.error.length > 0);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 200 with standardized payload via mock", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  let seen: CreateSiteParams | undefined;
  const mockCreateSite = async (params: CreateSiteParams): Promise<CreateSiteResult> => {
    seen = params;
    return { ok: true, data: { site: params.siteName } };
  };
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: {
        siteName: "site.example.com",
        domain: "app.example.com",
        apiUsername: "api_user",
      },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json() as { ok: boolean; data: { site: string } };
    assert.equal(body.ok, true);
    assert.equal(body.data.site, "site.example.com");
    assert.ok(seen);
    assert.equal(seen.siteName, "site.example.com");
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 500 when provisioning fails", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({
    ok: false,
    error: {
      code: "SITE_ALREADY_EXISTS",
      message: "ERP command failed",
      details: {
        command: "docker exec … bench new-site …",
        exitCode: 1,
        stdout: "",
        stderr: "duplicate",
      },
    },
  });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: {
        siteName: "valid-site.example.com",
        domain: "app.example.com",
        apiUsername: "api_user",
      },
    });
    assert.equal(res.statusCode, 500);
    const body = res.json() as {
      ok: boolean;
      error: { code: string; message: string; details: { stderr: string } };
    };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "SITE_ALREADY_EXISTS");
    assert.equal(body.error.details.stderr, "duplicate");
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 500 for execution errors", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({
    ok: false,
    error: {
      code: "ERP_COMMAND_FAILED",
      message: "ERP command failed",
      details: { command: "", exitCode: null, stdout: "", stderr: "timed out" },
    },
  });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: {
        siteName: "valid-site.example.com",
        domain: "app.example.com",
        apiUsername: "api_user",
      },
    });
    assert.equal(res.statusCode, 500);
  } finally {
    await app.close();
  }
});

test("POST /sites/create returns 500 for infra-style errors", async () => {
  const env = testEnv();
  const logger = createLogger(env);
  const mockCreateSite = async (): Promise<CreateSiteResult> => ({
    ok: false,
    error: {
      code: "ERP_COMMAND_FAILED",
      message: "ERP command failed",
      details: { command: "", exitCode: null, stdout: "", stderr: "remote unavailable" },
    },
  });
  const app = await buildApp({ env, logger, createSiteFn: mockCreateSite });
  try {
    const res = await app.inject({
      method: "POST",
      url: "/sites/create",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-token-16chars-min",
      },
      payload: {
        siteName: "valid-site.example.com",
        domain: "app.example.com",
        apiUsername: "api_user",
      },
    });
    assert.equal(res.statusCode, 500);
  } finally {
    await app.close();
  }
});
