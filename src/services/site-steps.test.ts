import test from "node:test";
import assert from "node:assert/strict";
import {
  addDomain,
  createApiUser,
  createSite,
  deriveApiUsername,
  enableScheduler,
  installErp,
  installFitdesk,
  sanitizeSiteName,
  siteStatus,
  type BenchAgentLike,
} from "./site-steps.js";
import { BenchAgentError } from "../lib/bench-agent/client.js";

type Call =
  | { kind: "newSite"; siteName: string; adminPassword: string }
  | { kind: "installApp"; site: string; app: string }
  | { kind: "setConfig"; site: string; key: string; value: string }
  | { kind: "enableScheduler"; site: string }
  | { kind: "createApiUser"; site: string; username: string }
  | { kind: "siteStatus"; site: string };

function fakeBench(
  overrides: Partial<BenchAgentLike> = {}
): { bench: BenchAgentLike; calls: Call[] } {
  const calls: Call[] = [];
  const bench: BenchAgentLike = {
    newSite:
      overrides.newSite ??
      (async (siteName, adminPassword) => {
        calls.push({ kind: "newSite", siteName, adminPassword });
        return { status: "created", site: siteName };
      }),
    installApp:
      overrides.installApp ??
      (async (site, app) => {
        calls.push({ kind: "installApp", site, app });
        return { status: "installed", site, app };
      }),
    setConfig:
      overrides.setConfig ??
      (async (site, key, value) => {
        calls.push({ kind: "setConfig", site, key, value });
        return { status: "ok", site, key };
      }),
    enableScheduler:
      overrides.enableScheduler ??
      (async (site) => {
        calls.push({ kind: "enableScheduler", site });
        return { status: "ok", site };
      }),
    createApiUser:
      overrides.createApiUser ??
      (async (site, username) => {
        calls.push({ kind: "createApiUser", site, username });
        return { site, user: `${username}@axis.local`, api_key: "key-xyz", api_secret: "secret-xyz" };
      }),
    siteStatus:
      overrides.siteStatus ??
      (async (site) => {
        calls.push({ kind: "siteStatus", site });
        return { site, exists: true, apps: ["frappe", "erpnext", "provisioning_api"] };
      }),
  };
  return { bench, calls };
}

// --- sanitizeSiteName / deriveApiUsername --------------------------------

test("sanitizeSiteName lowercases and uses dashes only", () => {
  assert.equal(sanitizeSiteName("My_Site.Name"), "my-site-name");
  assert.equal(sanitizeSiteName("  hello world  "), "hello-world");
});

test("deriveApiUsername takes the first label and prefixes cp_", () => {
  assert.equal(deriveApiUsername("acme.erp.example.com"), "cp_acme");
  assert.equal(deriveApiUsername("standalone"), "cp_standalone");
  assert.equal(deriveApiUsername("with-dash.example.com"), "cp_with_dash");
});

// --- createSite ----------------------------------------------------------

test("createSite runs bench newSite with sanitized name and returns applied outcome", async () => {
  const { bench, calls } = fakeBench();
  const r = await createSite(bench, {
    siteName: "Valid.Site",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "createSite");
    assert.equal(r.data.site, "valid-site");
    assert.equal(r.data.outcome, "applied");
    assert.equal(r.data.alreadyExists, undefined);
  }
  assert.deepEqual(calls, [{ kind: "newSite", siteName: "valid-site", adminPassword: "test-admin-pw" }]);
});

test("createSite returns already_done when bench reports exists", async () => {
  const { bench } = fakeBench({
    newSite: async (siteName) => ({ status: "exists", site: siteName, skipped: true }),
  });
  const r = await createSite(bench, {
    siteName: "existing.example",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.outcome, "already_done");
    assert.equal(r.data.alreadyExists, true);
  }
});

test("createSite returns ERP_VALIDATION_FAILED on bad domain", async () => {
  const { bench } = fakeBench();
  const r = await createSite(bench, {
    siteName: "good-site",
    domain: "notadomain",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "ERP_VALIDATION_FAILED");
    assert.equal(r.error.retryable, false);
  }
});

test("createSite returns ERP_VALIDATION_FAILED on bad username", async () => {
  const { bench } = fakeBench();
  const r = await createSite(bench, {
    siteName: "good-site",
    domain: "app.example.com",
    apiUsername: "BadUser!",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_VALIDATION_FAILED");
});

test("createSite returns ERP_VALIDATION_FAILED when sanitized name too short", async () => {
  const { bench } = fakeBench();
  const r = await createSite(bench, {
    siteName: "ab",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_VALIDATION_FAILED");
});

test("createSite maps 'already exists' stderr to SITE_ALREADY_EXISTS", async () => {
  const { bench } = fakeBench({
    newSite: async () => {
      throw new BenchAgentError("BENCH_COMMAND_FAILED", "bench new-site failed", 500, {
        step: "new_site",
        exit_code: 1,
        stdout: "",
        stderr: "Site valid-site already exists in apps/",
        command: "bench new-site valid-site",
      });
    },
  });
  const r = await createSite(bench, {
    siteName: "valid-site",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "SITE_ALREADY_EXISTS");
    assert.equal(r.error.retryable, false);
    assert.equal(r.error.exitCode, 1);
    assert.match(r.error.stderr ?? "", /already exists/);
  }
});

test("createSite maps BENCH_TIMEOUT to ERP_TIMEOUT (retryable)", async () => {
  const { bench } = fakeBench({
    newSite: async () => {
      throw new BenchAgentError("BENCH_TIMEOUT", "bench timed out after 1200s", 500, {
        step: "new_site",
        exit_code: null,
        stdout: "",
        stderr: "timeout after 1200s",
        command: "bench new-site valid-site",
      });
    },
  });
  const r = await createSite(bench, {
    siteName: "valid-site",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "ERP_TIMEOUT");
    assert.equal(r.error.retryable, true);
  }
});

test("createSite maps NETWORK_ERROR to INFRA_UNAVAILABLE (retryable)", async () => {
  const { bench } = fakeBench({
    newSite: async () => {
      throw new BenchAgentError("NETWORK_ERROR", "Could not reach bench-agent (ECONNREFUSED)", null, {
        command: "POST /v1/sites",
        stderr: "ECONNREFUSED",
      });
    },
  });
  const r = await createSite(bench, {
    siteName: "valid-site",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "INFRA_UNAVAILABLE");
    assert.equal(r.error.retryable, true);
  }
});

test("createSite wraps non-BenchAgentError as ERP_COMMAND_FAILED", async () => {
  const { bench } = fakeBench({
    newSite: async () => {
      throw new Error("unexpected crash");
    },
  });
  const r = await createSite(bench, {
    siteName: "valid-site",
    domain: "app.example.com",
    apiUsername: "api_user",
    adminPassword: "test-admin-pw",
  });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.error.code, "ERP_COMMAND_FAILED");
    assert.equal(r.error.retryable, false);
    assert.equal(r.error.message, "unexpected crash");
  }
});

// --- installErp ----------------------------------------------------------

test("installErp installs erpnext then provisioning_api", async () => {
  const { bench, calls } = fakeBench();
  const r = await installErp(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "installErp");
    assert.equal(r.data.outcome, "applied");
  }
  assert.deepEqual(calls, [
    { kind: "installApp", site: "acme.example", app: "erpnext" },
    { kind: "installApp", site: "acme.example", app: "provisioning_api" },
  ]);
});

test("installErp returns already_done when both apps already installed", async () => {
  const { bench } = fakeBench({
    installApp: async (site, app) => ({ status: "already_installed", site, app, skipped: true }),
  });
  const r = await installErp(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.outcome, "already_done");
    assert.equal(r.data.alreadyInstalled, true);
  }
});

test("installErp reports applied when only one app was already installed", async () => {
  // Simulate a retried flow: erpnext done, provisioning_api freshly installed.
  let count = 0;
  const { bench } = fakeBench({
    installApp: async (site, app) => {
      count++;
      return count === 1
        ? { status: "already_installed" as const, site, app, skipped: true }
        : { status: "installed" as const, site, app };
    },
  });
  const r = await installErp(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.outcome, "applied");
    assert.equal(r.data.alreadyInstalled, undefined);
  }
});

test("installErp rejects empty site", async () => {
  const { bench } = fakeBench();
  const r = await installErp(bench, { site: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_VALIDATION_FAILED");
});

test("installErp propagates bench failure mid-install as ERP_COMMAND_FAILED", async () => {
  let count = 0;
  const { bench } = fakeBench({
    installApp: async (site, app) => {
      count++;
      if (count === 2) {
        throw new BenchAgentError("BENCH_COMMAND_FAILED", "provisioning_api install failed", 500, {
          step: "install_app",
          exit_code: 1,
          stdout: "",
          stderr: "ImportError",
          command: "bench --site acme install-app provisioning_api",
        });
      }
      return { status: "installed", site, app };
    },
  });
  const r = await installErp(bench, { site: "acme.example" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_COMMAND_FAILED");
});

// --- installFitdesk ------------------------------------------------------

test("installFitdesk installs fitdesk and returns applied", async () => {
  const { bench, calls } = fakeBench();
  const r = await installFitdesk(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "installFitdesk");
    assert.equal(r.data.outcome, "applied");
  }
  assert.deepEqual(calls, [{ kind: "installApp", site: "acme.example", app: "fitdesk" }]);
});

test("installFitdesk returns already_done when fitdesk is already installed", async () => {
  const { bench } = fakeBench({
    installApp: async (site, app) => ({ status: "already_installed", site, app, skipped: true }),
  });
  const r = await installFitdesk(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "installFitdesk");
    assert.equal(r.data.outcome, "already_done");
    assert.equal(r.data.alreadyInstalled, true);
  }
});

test("installFitdesk rejects empty site", async () => {
  const { bench } = fakeBench();
  const r = await installFitdesk(bench, { site: "" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_VALIDATION_FAILED");
});

test("installFitdesk maps bench install failure through existing failure path", async () => {
  const { bench } = fakeBench({
    installApp: async () => {
      throw new BenchAgentError("BENCH_COMMAND_FAILED", "fitdesk install failed", 500, {
        step: "install_app",
        exit_code: 1,
        stdout: "",
        stderr: "ModuleNotFoundError: fitdesk",
        command: "bench --site acme install-app fitdesk",
      });
    },
  });
  const r = await installFitdesk(bench, { site: "acme.example" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_COMMAND_FAILED");
});

// --- enableScheduler -----------------------------------------------------

test("enableScheduler calls bench and returns applied outcome", async () => {
  const { bench, calls } = fakeBench();
  const r = await enableScheduler(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.data.action, "enableScheduler");
  assert.deepEqual(calls, [{ kind: "enableScheduler", site: "acme.example" }]);
});

// --- addDomain -----------------------------------------------------------

test("addDomain sets host_name to the site string", async () => {
  const { bench, calls } = fakeBench();
  const r = await addDomain(bench, { site: "acme.erp.example.com" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "addDomain");
    assert.equal(r.data.site, "acme.erp.example.com");
  }
  assert.deepEqual(calls, [
    { kind: "setConfig", site: "acme.erp.example.com", key: "host_name", value: "acme.erp.example.com" },
  ]);
});

// --- createApiUser -------------------------------------------------------

test("createApiUser derives username and returns api_key/api_secret in data", async () => {
  const { bench, calls } = fakeBench();
  const r = await createApiUser(bench, { site: "acme.erp.example.com" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "createApiUser");
    assert.equal(r.data.apiKey, "key-xyz");
    assert.equal(r.data.apiSecret, "secret-xyz");
    assert.equal(r.data.user, "cp_acme@axis.local");
  }
  assert.deepEqual(calls, [{ kind: "createApiUser", site: "acme.erp.example.com", username: "cp_acme" }]);
});

test("createApiUser propagates bench failure as ERP_COMMAND_FAILED", async () => {
  const { bench } = fakeBench({
    createApiUser: async () => {
      throw new BenchAgentError("BENCH_COMMAND_FAILED", "create_api_user failed", 500, {
        step: "create_api_user",
        exit_code: 1,
        stdout: "",
        stderr: "DoesNotExistError: provisioning_api",
        command: "bench --site acme execute ...",
      });
    },
  });
  const r = await createApiUser(bench, { site: "acme.example" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.error.code, "ERP_COMMAND_FAILED");
});

// --- siteStatus ----------------------------------------------------------

test("siteStatus returns exists + apps from bench-agent", async () => {
  const { bench, calls } = fakeBench();
  const r = await siteStatus(bench, { site: "acme.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.action, "siteStatus");
    assert.equal(r.data.exists, true);
    assert.deepEqual(r.data.apps, ["frappe", "erpnext", "provisioning_api"]);
  }
  assert.deepEqual(calls, [{ kind: "siteStatus", site: "acme.example" }]);
});

test("siteStatus returns exists=false for unknown site", async () => {
  const { bench } = fakeBench({
    siteStatus: async (site) => ({ site, exists: false, apps: [] }),
  });
  const r = await siteStatus(bench, { site: "nope.example" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.data.exists, false);
    assert.deepEqual(r.data.apps, []);
  }
});
