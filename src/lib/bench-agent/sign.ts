import { createHash, createHmac } from "node:crypto";

/**
 * HMAC-SHA256 request signing for axis-bench-agent.
 *
 * Mirrors `axis_bench_agent.auth.compute_signature` (Python). The two sides
 * MUST agree exactly on the string-to-sign layout — any whitespace drift will
 * produce signature mismatches that look like auth failures.
 *
 *     string_to_sign = "{timestamp}\n{METHOD}\n{path}\n{sha256_hex(body)}"
 *     signature      = HMAC-SHA256(secret, string_to_sign) as hex (lowercase)
 *
 * `body` is the raw bytes actually sent on the wire — for JSON requests that
 * means the JSON string, not the object. Empty bodies (GET) hash the empty
 * byte string, matching the Python side.
 */

export const TIMESTAMP_HEADER = "X-Axis-Timestamp";
export const SIGNATURE_HEADER = "X-Axis-Signature";

export function buildStringToSign(
  timestamp: string,
  method: string,
  path: string,
  body: string
): string {
  const bodyHash = createHash("sha256").update(body, "utf8").digest("hex");
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

export function computeSignature(
  secret: string,
  timestamp: string,
  method: string,
  path: string,
  body: string
): string {
  const stringToSign = buildStringToSign(timestamp, method, path, body);
  return createHmac("sha256", secret).update(stringToSign, "utf8").digest("hex");
}

/**
 * Build the two HMAC headers for a given request. Caller is responsible for
 * sending `body` on the wire verbatim — any post-sign mutation breaks the
 * signature.
 */
export function buildAuthHeaders(
  secret: string,
  method: string,
  path: string,
  body: string,
  now: () => number = Date.now
): { [TIMESTAMP_HEADER]: string; [SIGNATURE_HEADER]: string } {
  const timestamp = Math.floor(now() / 1000).toString();
  const signature = computeSignature(secret, timestamp, method, path, body);
  return {
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: signature,
  };
}
