import test from "node:test";
import assert from "node:assert/strict";
import { RemoteExecuteRequestSchema, normalizeLifecycleRequestBody } from "./lifecycle.js";

test("normalizeLifecycleRequestBody maps input.siteName to payload.site for readSiteDbName", () => {
  const raw = {
    action: "readSiteDbName",
    input: { siteName: "erp.zaidan-group.com" },
  };
  const normalized = normalizeLifecycleRequestBody(raw) as Record<string, unknown>;
  assert.deepEqual(normalized, {
    action: "readSiteDbName",
    payload: { site: "erp.zaidan-group.com" },
  });
});

test("RemoteExecuteRequestSchema accepts input.siteName alias", () => {
  const parsed = RemoteExecuteRequestSchema.safeParse({
    action: "readSiteDbName",
    input: { siteName: "erp.zaidan-group.com" },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.action, "readSiteDbName");
    assert.equal(parsed.data.payload.site, "erp.zaidan-group.com");
  }
});

test("RemoteExecuteRequestSchema still accepts payload.site", () => {
  const parsed = RemoteExecuteRequestSchema.safeParse({
    action: "readSiteDbName",
    payload: { site: "erp.zaidan-group.com" },
  });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.payload.site, "erp.zaidan-group.com");
  }
});
