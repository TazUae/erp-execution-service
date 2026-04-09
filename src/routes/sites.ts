import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { isAuthorized } from "../lib/auth.js";
import type { Env } from "../config/env.js";
import type { CreateSiteParams, CreateSiteResult } from "../services/create-site.js";
import { createSite } from "../services/create-site.js";

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
        error: "Unauthorized",
      });
    }

    const parsed = CreateSiteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(422).send({
        ok: false,
        error: parsed.error.message,
      });
    }

    const result = await runCreateSite(parsed.data);
    if (result.ok) {
      return reply.status(200).send(result);
    }

    if (result.validation) {
      return reply.status(422).send({
        ok: false,
        error: result.error,
      });
    }

    return reply.status(500).send({
      ok: false,
      error: result.error,
    });
  });
};
