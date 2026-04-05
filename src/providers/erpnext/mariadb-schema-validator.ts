import mysql from "mysql2/promise";
import type { Logger } from "pino";

export type MariaDbValidatorConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
};

/**
 * Confirms the MariaDB/MySQL schema named `dbName` exists (Frappe `db_name`).
 * Uses `information_schema.SCHEMATA`.
 */
export async function verifyMariaDbSchemaExists(
  cfg: MariaDbValidatorConfig,
  dbName: string,
  logger: Logger
): Promise<boolean> {
  const started = Date.now();
  let conn: mysql.Connection | undefined;
  try {
    conn = await mysql.createConnection({
      host: cfg.host,
      port: cfg.port,
      user: cfg.user,
      password: cfg.password,
      connectTimeout: 10_000,
    });
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT SCHEMA_NAME AS schema_name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ? LIMIT 1",
      [dbName]
    );
    const found = Array.isArray(rows) && rows.length > 0;
    logger.info(
      { dbName, found, durationMs: Date.now() - started },
      "MariaDB schema validation query completed"
    );
    return found;
  } catch (e) {
    logger.warn(
      { dbName, err: e instanceof Error ? e.message : String(e), durationMs: Date.now() - started },
      "MariaDB schema validation failed"
    );
    return false;
  } finally {
    if (conn) {
      await conn.end().catch(() => undefined);
    }
  }
}
