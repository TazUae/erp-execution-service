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
  return token === expectedToken;
}
