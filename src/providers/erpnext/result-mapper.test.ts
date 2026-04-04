import test from "node:test";
import assert from "node:assert/strict";
import { mapErpCallErrorToFailure, mapFailureCodeToHttpStatus } from "./result-mapper.js";
import { ErpCallError } from "../../lib/call-erp.js";

test("mapErpCallErrorToFailure maps timeout to ERP_TIMEOUT", () => {
  const f = mapErpCallErrorToFailure(new ErpCallError("timeout", "ERP HTTP request timed out"));
  assert.equal(f.code, "ERP_TIMEOUT");
  assert.equal(f.retryable, true);
});

test("mapErpCallErrorToFailure maps network to INFRA_UNAVAILABLE", () => {
  const f = mapErpCallErrorToFailure(new ErpCallError("network", "fetch failed"));
  assert.equal(f.code, "INFRA_UNAVAILABLE");
  assert.equal(f.retryable, true);
});

test("mapErpCallErrorToFailure maps already exists message to SITE_ALREADY_EXISTS", () => {
  const f = mapErpCallErrorToFailure(
    new ErpCallError("logical", "Site foo already exists")
  );
  assert.equal(f.code, "SITE_ALREADY_EXISTS");
  assert.equal(f.retryable, false);
});

test("mapErpCallErrorToFailure maps generic logical to ERP_COMMAND_FAILED", () => {
  const f = mapErpCallErrorToFailure(new ErpCallError("logical", "some other ERP error"));
  assert.equal(f.code, "ERP_COMMAND_FAILED");
});

test("mapErpCallErrorToFailure maps HTTP 503 to INFRA_UNAVAILABLE", () => {
  const f = mapErpCallErrorToFailure(
    new ErpCallError("http", "bad gateway", { status: 503 })
  );
  assert.equal(f.code, "INFRA_UNAVAILABLE");
});

test("mapFailureCodeToHttpStatus returns expected codes", () => {
  assert.equal(mapFailureCodeToHttpStatus("INFRA_UNAVAILABLE"), 503);
  assert.equal(mapFailureCodeToHttpStatus("ERP_TIMEOUT"), 504);
  assert.equal(mapFailureCodeToHttpStatus("SITE_ALREADY_EXISTS"), 409);
});
