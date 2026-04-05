import type { FastifyPluginAsync } from "fastify";
import type { Env } from "../config/env.js";
import { createFrappeClientFromEnv } from "../lib/frappe-client/client.js";

export type HealthRoutesOpts = { env: Env };

/**
 * Liveness: always `200` when the process is up. When outbound ERP env is set, includes a
 * best-effort `frappe.ping` reachability hint (failure here does not mean the process is unhealthy).
 */
export const healthRoutes: FastifyPluginAsync<HealthRoutesOpts> = async (fastify, opts) => {
  fastify.get("/internal/health", async () => {
    const data: {
      status: string;
      service: string;
      upstream?: { erpReachable: boolean; error?: string; reason?: string };
    } = {
      status: "ok",
      service: "erp-execution-service",
    };

    try {
      const client = createFrappeClientFromEnv(opts.env);
      const ping = await client.ping();
      data.upstream = ping.ok
        ? { erpReachable: true }
        : { erpReachable: false, error: ping.error.code };
    } catch {
      data.upstream = { erpReachable: false, reason: "not_configured" };
    }

    return {
      ok: true,
      data,
    };
  });
};
