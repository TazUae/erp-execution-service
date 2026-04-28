import Fastify from "fastify";
import type { Env } from "./config/env.js";
import type { Logger } from "pino";
import type { FastifyBaseLogger } from "fastify";
import { healthRoutes } from "./routes/health.js";
import { sitesRoutes } from "./routes/sites.js";
import type { BenchAgentLike } from "./services/site-steps.js";

export type BuildAppOptions = {
  env: Env;
  logger: Logger;
  /** Injected for tests; production constructs a real BenchAgentClient from env. */
  benchAgent?: BenchAgentLike;
};

export async function buildApp(options: BuildAppOptions) {
  const fastify = Fastify({
    logger: options.logger as unknown as FastifyBaseLogger,
    requestIdHeader: "x-request-id",
    disableRequestLogging: false,
  });

  await fastify.register(healthRoutes, { env: options.env });
  await fastify.register(sitesRoutes, {
    env: options.env,
    benchAgent: options.benchAgent,
  });

  return fastify;
}
