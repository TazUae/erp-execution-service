import test from "node:test";
import assert from "node:assert/strict";
import { validateSite } from "./validation.js";

test("validateSite accepts FQDN erp.zaidan-group.com", () => {
  assert.equal(validateSite("erp.zaidan-group.com"), "erp.zaidan-group.com");
});

test("validateSite accepts single-label tenant1", () => {
  assert.equal(validateSite("tenant1"), "tenant1");
});

test("validateSite rejects uppercase ERP.zaidan-group.com", () => {
  assert.throws(() => validateSite("ERP.zaidan-group.com"), /invalid site format/);
});

test("validateSite rejects abc_site (underscore)", () => {
  assert.throws(() => validateSite("abc_site"), /invalid site format/);
});

test("validateSite rejects .example.com", () => {
  assert.throws(() => validateSite(".example.com"), /invalid site format/);
});

test("validateSite rejects example..com", () => {
  assert.throws(() => validateSite("example..com"), /invalid site format/);
});

test("validateSite rejects evil;rm-rf", () => {
  assert.throws(() => validateSite("evil;rm-rf"), /invalid site format/);
});

test("validateSite rejects slug too short", () => {
  assert.throws(() => validateSite("ab"), /invalid site format/);
});

test("validateSite rejects spaces", () => {
  assert.throws(() => validateSite("a b"), /invalid site format/);
});

test("validateSite rejects slashes", () => {
  assert.throws(() => validateSite("a/b"), /invalid site format/);
});
