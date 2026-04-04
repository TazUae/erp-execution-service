import type { FastifyPluginAsync } from "fastify";
import { isAuthorized } from "../lib/auth.js";
import type { LifecycleService } from "../services/lifecycle-service.js";
import type { Env } from "../config/env.js";

export type LifecycleRouteOpts = {
  env: Env;
  lifecycleService: LifecycleService;
};

export const lifecycleRoutes: FastifyPluginAsync<LifecycleRouteOpts> = async (fastify, opts) => {
  fastify.post("/v1/erp/lifecycle", async (request, reply) => {
    if (!isAuthorized(request, opts.env.ERP_REMOTE_TOKEN)) {
      return reply.status(401).send({
        ok: false,
        error: {
          code: "ERP_VALIDATION_FAILED",
          message: "Unauthorized",
          retryable: false,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await opts.lifecycleService.handleLifecycleRequest(request.body);
    return reply.status(result.statusCode).send(result.envelope);
  });
};
