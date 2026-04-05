import test from "node:test";
import assert from "node:assert/strict";
import { mapExecErrorToFailure, mapFailureCodeToHttpStatus } from "./result-mapper.js";
import type { InternalExecError } from "../../lib/exec.js";

function makeError(partial: Partial<InternalExecError> & Pick<InternalExecError, "kind">): InternalExecError {
  return {
    message: partial.message ?? "err",
    durationMs: partial.durationMs ?? 1,
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    ...partial,
  };
}

test("mapExecErrorToFailure maps timeout to ERP_TIMEOUT", () => {
  const f = mapExecErrorToFailure(
    makeError({
      kind: "timeout",
      message: "timeout",
    })
  );
  assert.equal(f.code, "ERP_TIMEOUT");
  assert.equal(f.retryable, true);
});

test("mapExecErrorToFailure maps ENOENT spawn to INFRA_UNAVAILABLE", () => {
  const f = mapExecErrorToFailure(
    makeError({
      kind: "spawn_failed",
      message: "spawn bench ENOENT",
      spawnErrno: "ENOENT",
    })
  );
  assert.equal(f.code, "INFRA_UNAVAILABLE");
  assert.equal(f.retryable, true);
});

test("mapExecErrorToFailure maps already exists stderr to SITE_ALREADY_EXISTS", () => {
  const f = mapExecErrorToFailure(
    makeError({
      kind: "nonzero_exit",
      message: "exit 1",
      stderr: "Site foo already exists",
      exitCode: 1,
    })
  );
  assert.equal(f.code, "SITE_ALREADY_EXISTS");
  assert.equal(f.retryable, false);
});

test("mapExecErrorToFailure maps generic nonzero exit to ERP_COMMAND_FAILED", () => {
  const f = mapExecErrorToFailure(
    makeError({
      kind: "nonzero_exit",
      message: "exit 1",
      stderr: "some other bench error",
      exitCode: 1,
    })
  );
  assert.equal(f.code, "ERP_COMMAND_FAILED");
});

test("mapFailureCodeToHttpStatus returns expected codes", () => {
  assert.equal(mapFailureCodeToHttpStatus("INFRA_UNAVAILABLE"), 503);
  assert.equal(mapFailureCodeToHttpStatus("ERP_TIMEOUT"), 504);
  assert.equal(mapFailureCodeToHttpStatus("SITE_ALREADY_EXISTS"), 409);
});
