import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isAuthorized } from "../lib/auth.js";
import type { Env } from "../config/env.js";
import type { CreateSiteParams, CreateSiteResult } from "../services/create-site.js";
import { createSite } from "../services/create-site.js";
import { mapFailureCodeToHttpStatus } from "../providers/erpnext/result-mapper.js";

const CreateSiteBodySchema = z.object({
  siteName: z.string().trim().min(1),
  domain: z.string().trim().min(1),
  apiUsername: z.string().trim().min(1),
});

export type SitesRouteOpts = {
  env: Env;
  createSiteFn?: (params: CreateSiteParams) => Promise<CreateSiteResult>;
};

export const sitesRoutes: FastifyPluginAsync<SitesRouteOpts> = async (fastify, opts) => {
  const runCreateSite = opts.createSiteFn ?? ((p: CreateSiteParams) => createSite(opts.env, p));

  fastify.post("/sites/create", async (request, reply) => {
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

    const parsed = CreateSiteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        ok: false,
        error: {
          code: "ERP_VALIDATION_FAILED",
          message: "Invalid request body",
          retryable: false,
          details: parsed.error.message,
        },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await runCreateSite(parsed.data);
    if (result.ok) {
      return reply.status(200).send(result);
    }

    const statusCode = mapFailureCodeToHttpStatus(result.failure.code);
    return reply.status(statusCode).send({
      ok: false,
      error: result.failure,
      timestamp: new Date().toISOString(),
    });
  });
};
