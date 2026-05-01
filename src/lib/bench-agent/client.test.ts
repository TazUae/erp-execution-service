import test from "node:test";
import assert from "node:assert/strict";
import { Agent } from "undici";
import { BenchAgentClient, BenchAgentError } from "./client.js";

function createClient(overrides?: Partial<ConstructorParameters<typeof BenchAgentClient>[0]>) {
  return new BenchAgentClient({
    baseUrl: "http://bench-agent:8797",
    hmacSecret: "0123456789abcdef0123456789abcdef",
    timeoutMs: 123_456,
    ...overrides,
  });
}

test("rawHttp passes undici dispatcher to fetch", async () => {
  const calls: Array<{ url: string; init: RequestInit & { dispatcher?: unknown } }> = [];
  const client = createClient({
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        init: (init ?? {}) as RequestInit & { dispatcher?: unknown },
      });
      return new Response(JSON.stringify({ ok: true, data: { status: "ok" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  });

  const result = await client.enableScheduler("acme");
  assert.equal(result.status, "ok");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://bench-agent:8797/v1/sites/acme/enable-scheduler");
  assert.ok(calls[0]!.init.dispatcher instanceof Agent);
});

test("dispatcher timeout configuration is aligned to timeoutMs", () => {
  const timeoutMs = 654_321;
  const client = createClient({ timeoutMs });
  assert.equal((client as any).dispatcherTimeoutMs, timeoutMs);
});

test("AbortError still maps to TIMEOUT", async () => {
  const timeoutMs = 42;
  const client = createClient({
    timeoutMs,
    fetchImpl: (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as typeof fetch,
  });

  await assert.rejects(
    client.enableScheduler("acme"),
    (err: unknown) => {
      assert.ok(err instanceof BenchAgentError);
      assert.equal(err.code, "TIMEOUT");
      assert.match(err.message, /timed out after 42ms/);
      return true;
    }
  );
});
