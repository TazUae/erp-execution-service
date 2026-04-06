import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {
  FrappeClient,
  FRAPPE_PROVISIONING_TOKEN_HEADER,
  createFrappeClientFromEnv,
} from "./client.js";
import { buildFrappeMethodUrl, joinFrappeBaseUrl } from "./url.js";

const TEST_TOKEN = "test-provisioning-token-16chars";

function createClient(overrides?: Partial<ConstructorParameters<typeof FrappeClient>[0]>) {
  return new FrappeClient({
    baseUrl: "http://127.0.0.1:9",
    provisioningToken: TEST_TOKEN,
    timeoutMs: 5_000,
    ...overrides,
  });
}

test("joinFrappeBaseUrl normalizes base and path", () => {
  assert.equal(joinFrappeBaseUrl("https://erp.example.com", "/api/method/foo"), "https://erp.example.com/api/method/foo");
  assert.equal(joinFrappeBaseUrl("https://erp.example.com/", "/api/method/foo"), "https://erp.example.com/api/method/foo");
  assert.equal(joinFrappeBaseUrl("https://erp.example.com/prefix", "/api/method/foo"), "https://erp.example.com/api/method/foo");
});

test("buildFrappeMethodUrl encodes method segment and joins base", () => {
  assert.equal(
    buildFrappeMethodUrl("http://axis-erp-backend:8000", "provisioning_api.api.provisioning.create_site"),
    "http://axis-erp-backend:8000/api/method/provisioning_api.api.provisioning.create_site"
  );
});

test("provisioning header name is X-Provisioning-Token (not Authorization Bearer or legacy token key:secret)", () => {
  assert.equal(FRAPPE_PROVISIONING_TOKEN_HEADER, "X-Provisioning-Token");
});

test("createFrappeClientFromEnv throws when ERP_BASE_URL missing", () => {
  assert.throws(
    () =>
      createFrappeClientFromEnv({
        ERP_BASE_URL: undefined,
        ERP_PROVISIONING_TOKEN: "a".repeat(16),
        ERP_COMMAND_TIMEOUT_MS: 5000,
      }),
    /ERP_BASE_URL is not set/
  );
});

test("createFrappeClientFromEnv throws when ERP_PROVISIONING_TOKEN missing", () => {
  assert.throws(
    () =>
      createFrappeClientFromEnv({
        ERP_BASE_URL: "https://erp.example.com",
        ERP_PROVISIONING_TOKEN: undefined,
        ERP_COMMAND_TIMEOUT_MS: 5000,
      }),
    /ERP_PROVISIONING_TOKEN is not set/
  );
});

test("callMethod POST sends JSON, correct path, and X-Provisioning-Token (no Authorization Bearer)", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.match(req.url ?? "", /^\/api\/method\/provisioning_api\.api\.provisioning\.create_site$/);
    assert.equal(req.headers["x-provisioning-token"], TEST_TOKEN);
    assert.equal(req.headers.authorization, undefined);
    let buf = "";
    req.on("data", (c) => {
      buf += c;
    });
    req.on("end", () => {
      assert.deepEqual(JSON.parse(buf), { site: "s1" });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "created" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("provisioning_api.api.provisioning.create_site", { site: "s1" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.data, "created");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("success response normalizes message to data", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: { nested: true } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("some.method", {});
    assert.equal(r.ok, true);
    if (r.ok) assert.deepEqual(r.data, { nested: true });
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("401 maps to AUTH_ERROR", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ exc: "Auth failed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("provisioning_api.api.provisioning.install_erp", {});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "AUTH_ERROR");
    }
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("408 maps to TIMEOUT", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(408, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "timeout" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("any.method", {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "TIMEOUT");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("404 maps to METHOD_NOT_FOUND", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Not found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("missing.method", {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "METHOD_NOT_FOUND");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("callReadSiteDbName: HTTP 200 + flat message with db_name succeeds", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: { db_name: "_fe883896178c6f75" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callReadSiteDbName("provisioning_api.api.provisioning.read_site_db_name", {
      site_name: "erp.example.com",
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.dbName, "_fe883896178c6f75");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("callReadSiteDbName: HTTP 200 + top-level data field with envelope succeeds", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: { ok: true, data: { db_name: "_fe883896178c6f75" } },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callReadSiteDbName("provisioning_api.api.provisioning.read_site_db_name", {
      site_name: "erp.example.com",
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.dbName, "_fe883896178c6f75");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("callReadSiteDbName: HTTP 200 + message envelope with db_name succeeds", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        message: { ok: true, data: { db_name: "_fe883896178c6f75" } },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callReadSiteDbName("provisioning_api.api.provisioning.read_site_db_name", {
      site_name: "erp.example.com",
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.dbName, "_fe883896178c6f75");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("callReadSiteDbName: HTTP 404 + SITE_NOT_FOUND in message envelope", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        message: {
          ok: false,
          error: { code: "SITE_NOT_FOUND", message: "site directory does not exist" },
        },
      })
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callReadSiteDbName("provisioning_api.api.provisioning.read_site_db_name", {
      site_name: "missing.example.com",
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "SITE_NOT_FOUND");
      assert.match(r.error.message, /site directory does not exist/);
    }
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("callReadSiteDbName: HTTP 401 maps to AUTH_ERROR", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ exc: "Auth failed" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callReadSiteDbName("provisioning_api.api.provisioning.read_site_db_name", {
      site_name: "erp.example.com",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "AUTH_ERROR");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("callReadSiteDbName: HTTP 200 with malformed message envelope maps to INVALID_RESPONSE", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: { ok: true, success: true } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callReadSiteDbName("provisioning_api.api.provisioning.read_site_db_name", {
      site_name: "erp.example.com",
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "INVALID_RESPONSE");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("200 with exc maps to ERP_APPLICATION_ERROR", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ exc: "ValidationError: bad" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("x.y.z", {});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "ERP_APPLICATION_ERROR");
      assert.match(r.error.message, /ValidationError/);
    }
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("malformed JSON on 200 maps to INVALID_RESPONSE", async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("not-json{{{");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.callMethod("x.y.z", {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "INVALID_RESPONSE");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("request times out when server is slow", async () => {
  const server = http.createServer((_req, _res) => {
    /* Intentionally no response — client aborts after timeout. */
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 80 });
    const r = await client.ping();
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "TIMEOUT");
  } finally {
    server.closeAllConnections?.();
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("ping uses GET /api/method/frappe.ping with X-Provisioning-Token (no Authorization Bearer)", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.match(req.url ?? "", /^\/api\/method\/frappe\.ping$/);
    assert.equal(req.headers["x-provisioning-token"], TEST_TOKEN);
    assert.equal(req.headers.authorization, undefined);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "pong" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}` });
    const r = await client.ping();
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.data, "pong");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("unreachable port yields NETWORK_ERROR", async () => {
  const client = createClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
  const r = await client.ping();
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "NETWORK_ERROR");
});
