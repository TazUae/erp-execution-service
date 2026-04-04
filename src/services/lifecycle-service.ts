import { RemoteExecuteRequestSchema, type RemoteExecutionEnvelope } from "../contracts/lifecycle.js";
import type { LifecycleAdapter } from "../providers/erpnext/execution-adapter.js";
import { mapFailureCodeToHttpStatus } from "../providers/erpnext/result-mapper.js";

export class LifecycleService {
  constructor(private readonly adapter: LifecycleAdapter) {}

  async handleLifecycleRequest(body: unknown): Promise<{ statusCode: number; envelope: RemoteExecutionEnvelope }> {
    const parsed = RemoteExecuteRequestSchema.safeParse(body);
    if (!parsed.success) {
      return {
        statusCode: 422,
        envelope: {
          ok: false,
          error: {
            code: "ERP_VALIDATION_FAILED",
            message: "Invalid lifecycle request",
            retryable: false,
            details: parsed.error.message,
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const outcome = await this.adapter.run(parsed.data);
    const timestamp = new Date().toISOString();

    if (outcome.ok) {
      return {
        statusCode: 200,
        envelope: {
          ok: true,
          data: {
            durationMs: outcome.durationMs,
            metadata: outcome.metadata,
          },
          timestamp,
        },
      };
    }

    return {
      statusCode: mapFailureCodeToHttpStatus(outcome.failure.code),
      envelope: {
        ok: false,
        error: outcome.failure,
        timestamp,
      },
    };
  }
}
