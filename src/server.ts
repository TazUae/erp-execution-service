import { loadEnv } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { buildApp } from "./app.js";

async function main() {
  const env = loadEnv();
  const logger = createLogger(env);
  const app = await buildApp({ env, logger });

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    logger.info({ port: env.PORT }, "erp-execution-service listening");
  } catch (error) {
    logger.error({ err: error }, "failed to start server");
    process.exit(1);
  }
}

main();
