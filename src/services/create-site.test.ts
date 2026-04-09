import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { classifyError, createSite, sanitizeSiteName } from "./create-site.js";
import { loadEnv, resetEnvCacheForTests } from "../config/env.js";

function baseEnv(overrides?: Record<string, string | undefined>) {
  return loadEnv({
    NODE_ENV: "test",
    PORT: "8791",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_COMMAND_TIMEOUT_MS: "5000",
    ERP_DOCKER_BACKEND_CONTAINER: "test-backend",
    ERP_NEW_SITE_ADMIN_PASSWORD: "test-admin-pass",
    ...overrides,
  });
}

afterEach(() => {
  resetEnvCacheForTests();
});

test("sanitizeSiteName lowercases and uses dashes only", () => {
  assert.equal(sanitizeSiteName("My_Site.Name"), "my-site-name");
  assert.equal(sanitizeSiteName("  hello world  "), "hello-world");
});

test("classifyError maps stderr substrings to codes", () => {
  assert.equal(classifyError("Access denied for user"), "ERP_DB_AUTH_FAILED");
  assert.equal(classifyError("Site already exists"), "SITE_ALREADY_EXISTS");
  assert.equal(classifyError("invalid site"), "INVALID_SITE_NAME");
  assert.equal(classifyError("Connection refused"), "DB_CONNECTION_FAILED");
  assert.equal(classifyError("something else"), "ERP_COMMAND_FAILED");
});

test("createSite runs docker exec new-site then set-config with expected argv", async () => {
  const env = baseEnv();
  const calls: string[][] = [];
  const r = await createSite(
    env,
    { siteName: "valid-site.example.com", domain: "app.example.com", apiUsername: "api_user" },
    {
      execDocker: async (argv, _timeoutMs) => {
        calls.push(argv);
      },
    }
  );
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.site, "valid-site-example-com");
  }
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], [
    "docker",
    "exec",
    "test-backend",
    "bench",
    "new-site",
    "valid-site-example-com",
    "--admin-password",
    "test-admin-pass",
    "--db-type",
    "mariadb",
    "--install-app",
    "erpnext",
  ]);
  assert.deepEqual(calls[1], [
    "docker",
    "exec",
    "test-backend",
    "bench",
    "--site",
    "valid-site-example-com",
    "set-config",
    "host_name",
    "app.example.com",
  ]);
});

test("createSite returns validation error when site too short after sanitization", async () => {
  const env = baseEnv();
  const r = await createSite(env, {
    siteName: "ab",
    domain: "app.example.com",
    apiUsername: "api_user",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.validation, true);
  }
});

test("createSite returns error when docker exec fails", async () => {
  const env = baseEnv();
  const r = await createSite(
    env,
    { siteName: "good-site.example.com", domain: "app.example.com", apiUsername: "api_user" },
    {
      execDocker: async () => {
        throw new Error("bench failed");
      },
    }
  );
  assert.equal(r.ok, false);
  if (!r.ok && !("validation" in r && r.validation)) {
    assert.equal(r.error.code, "ERP_COMMAND_FAILED");
    assert.equal(r.error.message, "ERP command failed");
    assert.equal(r.error.details.stderr, "bench failed");
    assert.match(r.error.details.command, /bench new-site/);
  }
});
