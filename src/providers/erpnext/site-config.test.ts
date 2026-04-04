import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseSiteConfigDbNameJson, readSiteConfigDbName } from "./site-config.js";

test("parseSiteConfigDbNameJson extracts db_name", () => {
  const r = parseSiteConfigDbNameJson(JSON.stringify({ db_name: "_652d9db35da0a831" }));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.dbName, "_652d9db35da0a831");
});

test("parseSiteConfigDbNameJson rejects missing db_name", () => {
  const r = parseSiteConfigDbNameJson(JSON.stringify({ foo: 1 }));
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "MISSING_DB_NAME");
});

test("parseSiteConfigDbNameJson accepts unexpected db_name shape with flag", () => {
  const r = parseSiteConfigDbNameJson(JSON.stringify({ db_name: "weird_legacy_name" }));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.dbName, "weird_legacy_name");
    assert.equal(r.unexpectedDbNameFormat, true);
  }
});

test("parseSiteConfigDbNameJson rejects invalid JSON", () => {
  const r = parseSiteConfigDbNameJson("{");
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.code, "INVALID_JSON");
});

test("readSiteConfigDbName reads file from bench tree", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "erp-site-"));
  try {
    const site = "acme-corp";
    const siteDir = path.join(dir, "sites", site);
    await mkdir(siteDir, { recursive: true });
    await writeFile(
      path.join(siteDir, "site_config.json"),
      JSON.stringify({ db_name: "_abcdef0123456789" }),
      "utf8"
    );
    const r = await readSiteConfigDbName(dir, site);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.dbName, "_abcdef0123456789");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
