import { z } from "zod";

export const RemoteExecutionFailureCodeSchema = z.enum([
  "INFRA_UNAVAILABLE",
  "ERP_COMMAND_FAILED",
  "ERP_TIMEOUT",
  "ERP_VALIDATION_FAILED",
  "ERP_PARTIAL_SUCCESS",
  "SITE_ALREADY_EXISTS",
  "SITE_NOT_FOUND",
  "NOT_IMPLEMENTED",
]);
export type RemoteExecutionFailureCode = z.infer<typeof RemoteExecutionFailureCodeSchema>;

export const RemoteExecutionFailureSchema = z.object({
  code: RemoteExecutionFailureCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  details: z.string().optional(),
});
export type RemoteExecutionFailure = z.infer<typeof RemoteExecutionFailureSchema>;
