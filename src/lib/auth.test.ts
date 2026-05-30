import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { isAuthorized, extractBearerToken } from "./auth.js";

// ---------------------------------------------------------------------------
// H2 — Non-constant-time service-auth comparison (timing oracle)
//
// `isAuthorized` (auth.ts:22) compares the inbound bearer token against the
// expected ERP_REMOTE_TOKEN with `token === expectedToken`. String `===`
// short-circuits at the first differing byte, leaking a timing side channel
// that lets an attacker who can measure latency recover the shared secret one
// byte at a time. The fix is to compare with `crypto.timingSafeEqual`
// (constant-time), matching the codebase idiom already used elsewhere.
//
// The reproduction test below FAILS against the current code (because
// `crypto.timingSafeEqual` is never invoked) and will PASS once the fix routes
// the comparison through `crypto.timingSafeEqual`.
// ---------------------------------------------------------------------------

const EXPECTED = "expected-token-16chars-long";

function reqWith(authHeader?: string): FastifyRequest {
  const headers = authHeader === undefined ? {} : { authorization: authHeader };
  return { headers } as unknown as FastifyRequest;
}

// --- behavioral guard rails (pass before AND after the fix) ----------------

test("extractBearerToken: returns null when no header", () => {
  assert.equal(extractBearerToken(reqWith(undefined)), null);
});

test("isAuthorized: rejects request with no Authorization header", () => {
  assert.equal(isAuthorized(reqWith(undefined), EXPECTED), false);
});

test("isAuthorized: rejects a wrong token", () => {
  assert.equal(isAuthorized(reqWith("Bearer wrong-token-not-valid"), EXPECTED), false);
});

test("isAuthorized: accepts the correct token", () => {
  assert.equal(isAuthorized(reqWith(`Bearer ${EXPECTED}`), EXPECTED), true);
});

// --- H2 reproduction: must use constant-time comparison --------------------

test("isAuthorized: compares tokens in constant time via crypto.timingSafeEqual [H2 repro]", () => {
  const original = crypto.timingSafeEqual;
  let timingSafeEqualCalls = 0;
  // Wrap the real implementation so behavior is preserved while we count calls.
  (crypto as unknown as { timingSafeEqual: typeof crypto.timingSafeEqual }).timingSafeEqual = ((
    a: NodeJS.ArrayBufferView,
    b: NodeJS.ArrayBufferView,
  ) => {
    timingSafeEqualCalls += 1;
    return original(a, b);
  }) as typeof crypto.timingSafeEqual;

  try {
    // A present token (correct or not) must be compared in constant time.
    isAuthorized(reqWith(`Bearer ${EXPECTED}`), EXPECTED);
    isAuthorized(reqWith("Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaa"), EXPECTED);
  } finally {
    (crypto as unknown as { timingSafeEqual: typeof crypto.timingSafeEqual }).timingSafeEqual = original;
  }

  assert.ok(
    timingSafeEqualCalls > 0,
    "Expected isAuthorized() to compare the bearer token against the expected secret using " +
      "crypto.timingSafeEqual (constant-time). It currently uses `token === expectedToken` " +
      "(erp-execution-service/src/lib/auth.ts:22), which short-circuits at the first differing " +
      "byte and exposes a timing oracle on ERP_REMOTE_TOKEN.",
  );
});
