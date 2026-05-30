import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";

export function extractBearerToken(request: FastifyRequest): string | null {
  const raw = request.headers.authorization;
  if (!raw || typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  const prefix = "Bearer ";
  if (!trimmed.startsWith(prefix)) {
    return null;
  }
  const token = trimmed.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

export function isAuthorized(request: FastifyRequest, expectedToken: string): boolean {
  const token = extractBearerToken(request);
  if (!token) {
    return false;
  }
  // Constant-time comparison: hash both inputs to a fixed-length digest first so
  // `crypto.timingSafeEqual` neither short-circuits (timing oracle on the secret)
  // nor throws/leaks on a length mismatch.
  const tokenHash = crypto.createHash("sha256").update(token, "utf8").digest();
  const expectedHash = crypto.createHash("sha256").update(expectedToken, "utf8").digest();
  return crypto.timingSafeEqual(tokenHash, expectedHash);
}
