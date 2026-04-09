import test from "node:test";
import assert from "node:assert/strict";
import { loadEnv, resetEnvCacheForTests } from "./env.js";

test.afterEach(() => {
  resetEnvCacheForTests();
});

test("ERP_BASE_URL without ERP_SITE_HOST fails validation", () => {
  assert.throws(
    () =>
      loadEnv({
        NODE_ENV: "test",
        PORT: "8791",
        ERP_REMOTE_TOKEN: "test-token-16chars-min",
        ERP_COMMAND_TIMEOUT_MS: "5000",
        DB_ROOT_PASSWORD: "test-db-root",
        ERP_BASE_URL: "http://erp.example:8000",
      }),
    /ERP_SITE_HOST/
  );
});

test("default ERP_METHOD_CREATE_SITE uses provisioning_api.api.provisioning.create_site", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
    DB_ROOT_PASSWORD: "test-db-root",
  });
  assert.equal(env.ERP_METHOD_CREATE_SITE, "provisioning_api.api.provisioning.create_site");
});
