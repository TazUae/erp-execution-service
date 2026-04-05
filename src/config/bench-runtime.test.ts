import test from "node:test";
import assert from "node:assert/strict";
import { validateBenchRuntime } from "./bench-runtime.js";
import { loadEnv } from "./env.js";

test("validateBenchRuntime fails fast for missing ERP_BENCH_PATH", async () => {
  const env = loadEnv({
    NODE_ENV: "test",
    ERP_REMOTE_TOKEN: "test-token-16chars-min",
    ERP_ADMIN_PASSWORD: "password12",
    ERP_DB_ROOT_PASSWORD: "dbroot-pass",
    ERP_BENCH_PATH: "/nonexistent-erp-exec-bench-path-99999",
  });
  await assert.rejects(
    () => validateBenchRuntime(env),
    (err: unknown) => err instanceof Error && err.name === "BenchRuntimeValidationError"
  );
});
