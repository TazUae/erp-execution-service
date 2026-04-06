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
        ERP_BASE_URL: "http://erp.example:8000",
      }),
    /ERP_SITE_HOST/
  );
});

test("default ERP_METHOD_* values use provisioning_api.api.provisioning.*", () => {
  const env = loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
  });
  assert.equal(env.ERP_METHOD_CREATE_SITE, "provisioning_api.api.provisioning.create_site");
  assert.equal(env.ERP_METHOD_READ_SITE_DB_NAME, "provisioning_api.api.provisioning.read_site_db_name");
  assert.equal(env.ERP_METHOD_INSTALL_ERP, "provisioning_api.api.provisioning.install_erp");
  assert.equal(env.ERP_METHOD_ENABLE_SCHEDULER, "provisioning_api.api.provisioning.enable_scheduler");
  assert.equal(env.ERP_METHOD_ADD_DOMAIN, "provisioning_api.api.provisioning.add_domain");
  assert.equal(env.ERP_METHOD_CREATE_API_USER, "provisioning_api.api.provisioning.create_api_user");
});
