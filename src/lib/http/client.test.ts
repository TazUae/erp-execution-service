import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { HttpProvisioningClient, createHttpProvisioningClient } from "./client.js";
import { HttpProvisioningError } from "./errors.js";
import { joinFrappeBaseUrl } from "./frappe-url.js";

function createClient(overrides?: Partial<ConstructorParameters<typeof HttpProvisioningClient>[0]>) {
  return new HttpProvisioningClient({
    baseUrl: "http://127.0.0.1:9",
    authToken: "key:secret",
    timeoutMs: 5_000,
    healthPath: "/api/method/frappe.ping",
    ...overrides,
  });
}

test("joinFrappeBaseUrl normalizes base and path", () => {
  assert.equal(joinFrappeBaseUrl("https://erp.example.com", "/api/method/foo"), "https://erp.example.com/api/method/foo");
  assert.equal(joinFrappeBaseUrl("https://erp.example.com/", "/api/method/foo"), "https://erp.example.com/api/method/foo");
  assert.equal(joinFrappeBaseUrl("https://erp.example.com/bench", "/api/method/foo"), "https://erp.example.com/api/method/foo");
});

test("buildAuthorizationHeader uses Frappe token scheme", () => {
  assert.equal(HttpProvisioningClient.buildAuthorizationHeader("k:s"), "token k:s");
});

test("createHttpProvisioningClient throws configuration error when ERP_BASE_URL missing", () => {
  assert.throws(
    () =>
      createHttpProvisioningClient({
        ERP_BASE_URL: undefined,
        ERP_AUTH_TOKEN: "a:b",
        ERP_COMMAND_TIMEOUT_MS: 5000,
        ERP_HEALTH_PATH: "/api/method/frappe.ping",
      }),
    (e: unknown) => e instanceof HttpProvisioningError && (e as HttpProvisioningError).kind === "configuration"
  );
});

test("createHttpProvisioningClient throws configuration error when ERP_AUTH_TOKEN missing", () => {
  assert.throws(
    () =>
      createHttpProvisioningClient({
        ERP_BASE_URL: "https://erp.example.com",
        ERP_AUTH_TOKEN: undefined,
        ERP_COMMAND_TIMEOUT_MS: 5000,
        ERP_HEALTH_PATH: "/api/method/frappe.ping",
      }),
    (e: unknown) => e instanceof HttpProvisioningError && (e as HttpProvisioningError).kind === "configuration"
  );
});

test("POST postMethod parses JSON success body", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "POST");
    assert.match(req.url ?? "", /^\/api\/method\/frappe\.api\.provisioning\.create_site$/);
    assert.equal(req.headers.authorization, "token key:secret");
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
    const client = createClient({ baseUrl: `http://127.0.0.1:${port}`, authToken: "key:secret" });
    const body = await client.postMethod("frappe.api.provisioning.create_site", { site: "s1" });
    assert.deepEqual(body, { message: "created" });
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("non-2xx maps to HttpProvisioningError with kind", async () => {
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
    await assert.rejects(
      () => client.postMethod("frappe.api.provisioning.install_erp", {}),
      (e: unknown) =>
        e instanceof HttpProvisioningError && e.kind === "unauthorized" && e.upstreamStatus === 401
    );
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("malformed JSON on 200 throws parse error", async () => {
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
    await assert.rejects(
      () => client.postMethod("x.y.z", {}),
      (e: unknown) => e instanceof HttpProvisioningError && (e as HttpProvisioningError).kind === "parse"
    );
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
    await assert.rejects(
      () => client.ping(),
      (e: unknown) => e instanceof HttpProvisioningError && (e as HttpProvisioningError).kind === "timeout"
    );
  } finally {
    server.closeAllConnections?.();
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("ping uses ERP_HEALTH_PATH and returns message", async () => {
  const server = http.createServer((req, res) => {
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/custom/health");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "pong" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const port = addr.port;
  try {
    const client = createClient({
      baseUrl: `http://127.0.0.1:${port}`,
      healthPath: "/custom/health",
    });
    const r = await client.ping();
    assert.equal(r.ok, true);
    assert.equal(r.message, "pong");
  } finally {
    server.close();
    await new Promise<void>((r) => server.once("close", r));
  }
});

test("unreachable port yields network error", async () => {
  const client = createClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 2000 });
  await assert.rejects(
    () => client.ping(),
    (e: unknown) => e instanceof HttpProvisioningError && (e as HttpProvisioningError).kind === "network"
  );
});
