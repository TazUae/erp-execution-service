import { loadEnv, EnvValidationError } from "./config/env.js";
import { createLogger } from "./lib/logger.js";
import { buildApp } from "./app.js";

function logStartupFailure(payload: Record<string, unknown>): void {
  console.error(JSON.stringify(payload));
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      logStartupFailure({
        code: "ENV_INVALID",
        issues: error.zodIssues.map((i) => ({
          path: i.path.map(String),
          message: i.message,
          code: i.code,
        })),
      });
    } else {
      console.error(error);
    }
    process.exit(1);
  }

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
