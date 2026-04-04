/** Typical Frappe MariaDB database name shape in `site_config.json` (not the site slug). */
export const DB_NAME_EXPECTED_PATTERN = /^_[0-9a-f]{8,32}$/;

/**
 * Parses `site_config.json` body and returns Frappe `db_name`.
 * @throws Error with message INVALID_SITE_CONFIG or INVALID_SITE_CONFIG_JSON
 */
export function parseSiteConfig(content: string): { dbName: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    const err = new Error("INVALID_SITE_CONFIG_JSON");
    err.name = "InvalidSiteConfigError";
    throw err;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("INVALID_SITE_CONFIG");
  }

  const dbName = (parsed as Record<string, unknown>).db_name;
  if (typeof dbName !== "string" || dbName.trim() === "") {
    throw new Error("INVALID_SITE_CONFIG");
  }

  return { dbName: dbName.trim() };
}

export function isUnexpectedDbNameFormat(dbName: string): boolean {
  return !DB_NAME_EXPECTED_PATTERN.test(dbName);
}
