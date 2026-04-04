import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  isUnexpectedDbNameFormat,
  parseSiteConfig as parseSiteConfigShared,
} from "erp-utils";

export type ReadSiteDbNameFailureCode = "ENOENT" | "INVALID_JSON" | "MISSING_DB_NAME" | "INVALID_DB_NAME";

export type ReadSiteDbNameResult =
  | { ok: true; dbName: string; unexpectedDbNameFormat?: boolean }
  | { ok: false; code: ReadSiteDbNameFailureCode; details?: string };

/**
 * Parses `site_config.json` content using shared `erp-utils` rules, with optional
 * warning-only path when `db_name` shape is unexpected (Frappe version drift).
 */
export function parseSiteConfigDbNameJson(raw: string): ReadSiteDbNameResult {
  try {
    const { dbName } = parseSiteConfigShared(raw);
    if (isUnexpectedDbNameFormat(dbName)) {
      return { ok: true, dbName, unexpectedDbNameFormat: true };
    }
    return { ok: true, dbName };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "INVALID_SITE_CONFIG_JSON") {
      return {
        ok: false,
        code: "INVALID_JSON",
        details: "site_config.json is not valid JSON",
      };
    }
    if (msg === "INVALID_SITE_CONFIG") {
      return { ok: false, code: "MISSING_DB_NAME" };
    }
    return {
      ok: false,
      code: "INVALID_JSON",
      details: msg,
    };
  }
}

/** @deprecated Prefer `parseSiteConfig` from `erp-utils` for strict parse; kept for call sites. */
export function parseSiteConfig(content: string): { dbName: string } {
  return parseSiteConfigShared(content);
}

export function siteConfigPath(benchPath: string, site: string): string {
  return path.join(benchPath, "sites", site, "site_config.json");
}

export async function readSiteConfigDbName(benchPath: string, site: string): Promise<ReadSiteDbNameResult> {
  const filePath = siteConfigPath(benchPath, site);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return { ok: false, code: "ENOENT", details: filePath };
    }
    return {
      ok: false,
      code: "ENOENT",
      details: err.message ?? String(e),
    };
  }

  return parseSiteConfigDbNameJson(raw);
}
