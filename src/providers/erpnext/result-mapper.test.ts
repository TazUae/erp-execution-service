import test from "node:test";
import assert from "node:assert/strict";
import { mapFailureCodeToHttpStatus } from "./result-mapper.js";

test("mapFailureCodeToHttpStatus returns expected codes", () => {
  assert.equal(mapFailureCodeToHttpStatus("INFRA_UNAVAILABLE"), 503);
  assert.equal(mapFailureCodeToHttpStatus("ERP_TIMEOUT"), 504);
  assert.equal(mapFailureCodeToHttpStatus("SITE_ALREADY_EXISTS"), 409);
});
