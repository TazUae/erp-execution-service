import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/internal/health", async () => {
    return {
      ok: true,
      data: {
        status: "ok",
        service: "erp-execution-service",
      },
    };
  });
};
