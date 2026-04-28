import test from "node:test";
import assert from "node:assert/strict";
import { loadEnv, resetEnvCacheForTests } from "./env.js";

const BASE_ENV = {
  NODE_ENV: "test",
  PORT: "8791",
  ERP_REMOTE_TOKEN: "test-token-16chars-min",
  ERP_COMMAND_TIMEOUT_MS: "5000",
  BENCH_AGENT_URL: "http://axis-bench-agent:8797",
  BENCH_AGENT_HMAC_SECRET: "a".repeat(32),
};

test.afterEach(() => {
  resetEnvCacheForTests();
});

test("ERP_BASE_URL without ERP_SITE_HOST fails validation", () => {
  assert.throws(
    () =>
      loadEnv({
        ...BASE_ENV,
        ERP_BASE_URL: "http://erp.example:8000",
      }),
    /ERP_SITE_HOST/
  );
});

test("default ERP_METHOD_CREATE_SITE uses provisioning_api.api.provisioning.create_site", () => {
  const env = loadEnv({ ...BASE_ENV });
  assert.equal(env.ERP_METHOD_CREATE_SITE, "provisioning_api.api.provisioning.create_site");
});

test("BENCH_AGENT_URL is required", () => {
  assert.throws(
    () =>
      loadEnv({
        ...BASE_ENV,
        BENCH_AGENT_URL: undefined,
      }),
    /BENCH_AGENT_URL/
  );
});

test("BENCH_AGENT_HMAC_SECRET must be at least 32 chars", () => {
  assert.throws(
    () =>
      loadEnv({
        ...BASE_ENV,
        BENCH_AGENT_HMAC_SECRET: "too-short",
      }),
    /BENCH_AGENT_HMAC_SECRET/
  );
});

test("BENCH_AGENT_TIMEOUT_MS defaults to 1_200_000", () => {
  const env = loadEnv({ ...BASE_ENV });
  assert.equal(env.BENCH_AGENT_TIMEOUT_MS, 1_200_000);
});
