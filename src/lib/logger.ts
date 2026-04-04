import { pino } from "pino";
import type { Logger } from "pino";
import type { Env } from "../config/env.js";

export function createLogger(env: Env): Logger {
  return pino({
    level: env.NODE_ENV === "production" ? "info" : "debug",
    base: { service: "erp-execution-service" },
  });
}
