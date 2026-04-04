import Fastify from "fastify";
import type { Env } from "./config/env.js";
import type { Logger } from "pino";
import type { FastifyBaseLogger } from "fastify";
import { ErpExecutionAdapter } from "./providers/erpnext/execution-adapter.js";
import { LifecycleService } from "./services/lifecycle-service.js";
import { healthRoutes } from "./routes/health.js";
import { lifecycleRoutes } from "./routes/lifecycle.js";
import type { LifecycleAdapter } from "./providers/erpnext/execution-adapter.js";

export type BuildAppOptions = {
  env: Env;
  logger: Logger;
  adapter?: LifecycleAdapter;
};

export async function buildApp(options: BuildAppOptions) {
  const adapter = options.adapter ?? new ErpExecutionAdapter(options.env, options.logger);
  const lifecycleService = new LifecycleService(adapter);

  const fastify = Fastify({
    logger: options.logger as unknown as FastifyBaseLogger,
    requestIdHeader: "x-request-id",
    disableRequestLogging: false,
  });

  await fastify.register(healthRoutes);
  await fastify.register(lifecycleRoutes, {
    env: options.env,
    lifecycleService,
  });

  return fastify;
}
