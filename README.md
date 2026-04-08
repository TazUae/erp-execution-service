# erp-execution-service

This service is a **thin HTTP adapter** to **ERPNext/Frappe** `provisioning_api.api.provisioning.create_site`: **`POST /sites/create`** validates input, forwards **`{ site_name }`** to the ERP RPC with **`X-Provisioning-Token`**, and returns a small JSON envelope. Outbound calls use **`FrappeClient`** (`src/lib/frappe-client/`). The legacy bench/subprocess/filesystem execution model has been removed.

## Frappe / ERPNext HTTP API

Frappe exposes callable Python methods over HTTP:

- **Pattern:** `POST /api/method/{dotted.path}`
- **Example:** `POST /api/method/provisioning_api.api.provisioning.create_site`
- **Body:** JSON
- **Auth (provisioning_api app):** `X-Provisioning-Token: <ERP_PROVISIONING_TOKEN>` — the same secret as `provisioning_api_token` in the ERP **`sites/common_site_config.json`**. Do **not** send this secret as `Authorization: Bearer …`; Frappe interprets `Bearer` as OAuth and can return **401** before **`provisioning_api`** runs.

Health checks often use **`GET /api/method/frappe.ping`**, which returns JSON with a `message` field (for example `"pong"`). That ping uses the same **`X-Provisioning-Token`** header as other outbound calls.

**Multi-site Frappe** resolves the site from the HTTP **`Host`** header. Outbound requests still use **`ERP_BASE_URL`** as the TCP target (for example `http://axis-erp-backend:8000`), but the client sets **`Host`** to the site being operated on (`site_name` / `site` in the JSON body when present, otherwise **`ERP_SITE_HOST`** for ping and other calls without a site).

This repository ships a **generic** `FrappeClient` and a single **`createSite`** path wired to **`ERP_METHOD_CREATE_SITE`** (`POST /api/method/{dotted.path}`). **Upstream Python methods must be whitelisted in Frappe**; until they exist on your ERP deployment, calls may return **404** / **`METHOD_NOT_FOUND`**, which this service maps to **`NOT_IMPLEMENTED`** (HTTP **501**).

### Expected upstream behavior

- Successful RPCs return JSON that includes a **`message`** field with the result payload.
- Application-level failures may include an **`exc`** string (trace / error text). The client maps that to a normalized **ERP_APPLICATION_ERROR** result (no secrets in logs).
- HTTP **401/403** indicate credential or permission problems relative to the provisioning token (`X-Provisioning-Token`).
- HTTP **404** usually means the method path is missing or not exposed.

## Migration (bench → HTTP-only)

| Removed | Notes |
|---------|--------|
| Bench CLI, `spawn`, local `bench --version` checks | No subprocess ERP execution. |
| `ERP_BENCH_PATH`, `ERP_BENCH_EXECUTABLE` | No local bench tree. |
| `ERP_DB_ROOT_PASSWORD`, `ERP_ADMIN_PASSWORD`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_READONLY_*`, `ERP_VALIDATE_DB_SCHEMA` | No direct DB coupling for provisioning in this service. |
| `ERP_SKIP_BENCH_RUNTIME_CHECK` | Bench startup checks removed. |
| `site_config.json` filesystem reads | Will use HTTP when the adapter is wired. |
| `ERP_API_KEY` / `ERP_API_SECRET` + `Authorization: token key:secret` | Replaced by **`ERP_PROVISIONING_TOKEN`** sent as **`X-Provisioning-Token`** (not `Authorization: Bearer`, which Frappe treats as OAuth). |

### Obsolete variables (do not set)

These belonged to the removed bench/DB execution model and **must not** be re-added to deployment or docs:

`ERP_BENCH_PATH`, `ERP_BENCH_EXECUTABLE`, `ERP_ADMIN_PASSWORD`, `ERP_DB_ROOT_PASSWORD`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_SKIP_BENCH_RUNTIME_CHECK`, `ERP_VALIDATE_DB_SCHEMA`.

## Runtime wiring (Docker / ERP)

For outbound calls to ERPNext, this container must share a Docker network with the ERP stack so DNS resolves the backend service:

| Item | Value |
|------|--------|
| **External Docker network (exact name)** | `axiserp-erpnext-pnzjyk_axis-erp-internal` |
| **Intended `ERP_BASE_URL` (env-driven)** | `http://axis-erp-backend:8000` |
| **`ERP_SITE_HOST`** | Public site hostname Frappe expects on **`Host`** when the request has no site in the body (e.g. **`frappe.ping`**); must match a site name your bench knows |
| **Provisioning token header** | `ERP_PROVISIONING_TOKEN` must match **`provisioning_api_token`** in ERP **`sites/common_site_config.json`** (sent as **`X-Provisioning-Token`**) |

The tracked **`docker-compose.yml`** and **`docker-compose.dokploy.yml`** attach **`erp-execution-service`** to that external network **in addition to** this project’s default network (and, for Dokploy, `dokploy-network`). **`docker-compose.dokploy.yml`** sets network alias **`erp-execution-service`** on **`dokploy-network`** so peers (for example **`provisioning-agent`**) can resolve **`http://erp-execution-service:<PORT>`** for **`ERP_REMOTE_BASE_URL`**. After deploy, **redeploy** the service, **verify** the container is on `axiserp-erpnext-pnzjyk_axis-erp-internal`, then run your **live connectivity checks** (e.g. outbound ping / `POST /sites/create` against ERP). Smoke-test automation is out of scope for this repo step.

## Role

- **Stable API**: **`POST /sites/create`** with JSON body `{ siteName, domain, apiUsername }` (camelCase); Bearer auth to **this** service (`ERP_REMOTE_TOKEN`). Success: `{ ok: true, data: { siteName } }`. Errors use `ok: false` and mapped HTTP status codes.
- **Outbound ERP**: `createSite` uses `FrappeClient` against `ERP_BASE_URL` with **`X-Provisioning-Token: <ERP_PROVISIONING_TOKEN>`** and HTTP **`Host`** derived from **`site_name`** in the body (or **`ERP_SITE_HOST`** when needed). If `ERP_BASE_URL`, `ERP_PROVISIONING_TOKEN`, or `ERP_SITE_HOST` is unset, **`503` / `INFRA_UNAVAILABLE`**. **Only `{ site_name }`** is sent to the ERP RPC (ERP contract); `domain` and `apiUsername` are validated locally.

## ERP-side Frappe app (scaffold)

The directory [`provisioning_api/`](provisioning_api/README.md) is a **Frappe custom app** that defines the whitelisted provisioning RPCs (`provisioning_api.api.provisioning.*`). Install it on your ERP stack; defaults in this service already point at those dotted paths.

## ERPNext provisioning API (upstream)

This service calls **`provisioning_api.api.provisioning.create_site`** (configurable via **`ERP_METHOD_CREATE_SITE`**). That method must exist on the ERP stack as a **whitelisted** `@frappe.whitelist()` (or equivalent) Python entry point. Other provisioning RPCs may exist on the ERP side; they are **not** exposed by this service.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/internal/health` | None (internal probes) |
| `POST` | `/sites/create` | `Authorization: Bearer <ERP_REMOTE_TOKEN>` |

## Stack

- Node.js, TypeScript, Fastify, Zod, Pino.

## Scripts

```bash
npm install
npm run dev      # tsx src/server.ts
npm run build    # tsc -> dist/
npm start        # node dist/server.js
npm test
```

## Environment variables

Values match `src/config/env.ts`. See also **`.env.example`**.

### Inbound (this service)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_REMOTE_TOKEN` | yes | — | Bearer token (min 16 chars), same as provisioning-agent |
| `PORT` | no | `8790` | Listen port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |

### Outbound Frappe client (ERPNext)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_BASE_URL` | no* | — | Origin of the ERP stack. **Production/Docker:** `http://axis-erp-backend:8000` (requires network attachment; see **Runtime wiring**). No trailing slash. |
| `ERP_SITE_HOST` | no* | — | Default HTTP **`Host`** for outbound Frappe calls when the JSON body has no `site_name` / `site` (e.g. **`frappe.ping`**). Required whenever **`ERP_BASE_URL`** is set. Per-action calls that include a site use that site as **`Host`** instead. |
| `ERP_PROVISIONING_TOKEN` | no* | — | Secret for `provisioning_api` methods, sent as HTTP header **`X-Provisioning-Token`** (not `Authorization: Bearer`); must match **`provisioning_api_token`** in ERP **`sites/common_site_config.json`**. |
| `ERP_COMMAND_TIMEOUT_MS` | no | `30000` | Per-request timeout for outbound `fetch` to Frappe |
| `ERP_METHOD_CREATE_SITE` | no | `provisioning_api.api.provisioning.create_site` | Dotted path for `create_site` |

\*Required together for outbound ERP calls: set **`ERP_BASE_URL`**, **`ERP_SITE_HOST`**, and **`ERP_PROVISIONING_TOKEN`** (`ERP_SITE_HOST` is required by env validation whenever **`ERP_BASE_URL`** is set). The process can start without outbound ERP vars; **`POST /sites/create`** then returns **`503` / `INFRA_UNAVAILABLE`** until configured.

**Payload mapping (this service → Frappe JSON body):** inbound **`siteName`** → outbound **`site_name`** only (ERP contract for `create_site`).

## Deployment

- Deploy **only on private/internal networks**. Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (for example `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.
- Ensure network reachability from this container/process to `ERP_BASE_URL` (DNS, TLS, firewall).
- Configure **`ERP_PROVISIONING_TOKEN`** to the same value as **`provisioning_api_token`** on the ERP bench (`sites/common_site_config.json`).

### Environment and configuration

- **Production (Dokploy):** runtime configuration is **not** read from a committed `.env` file. Set every variable in the **Dokploy UI** (or the deployment host environment) so it is the **single source of truth** for production. After changing Dokploy env vars, **redeploy** the service so containers pick up new values.
- **Schema / template:** **`.env.example`** lists every variable validated in **`src/config/env.ts`**, with safe placeholder values only. Keep it in sync when adding or renaming env vars.
- **Local development:** copy **`.env.example`** to **`.env`** (gitignored). **`docker-compose.yml`** uses **`env_file: [.env]`** for convenience. Optional overrides: **`.env.local`**, **`.env.production`**, or **`.env.secrets`** (also gitignored).
- **Drift check:** run **`./scripts/check-env-keys.sh`** to compare variable names in `.env` vs `.env.example` (no values are printed).

### Docker / Dokploy

- **Compose file path:** use **`docker-compose.dokploy.yml`** for Dokploy/production (explicit `environment:` mapping with `${VAR}` entries; no `env_file` for runtime secrets). **`.env`** in the repo is **not** used for production.
- If you merge **`docker-compose.yml`** with **`docker-compose.dokploy.yml`**, the Dokploy file uses **`env_file: !reset []`** so the base `env_file: [.env]` is cleared and production still relies on Dokploy-injected variables.
- **Local-only:** `docker-compose.yml` + a copied **`.env`** (not committed). **Production** should use **`docker-compose.dokploy.yml`** with Dokploy env as above.
- Build: `docker build -t erp-execution-service .` from the repo root.
- **Variables:** inbound **`ERP_REMOTE_TOKEN`**; for outbound ERP, **`ERP_BASE_URL`**, **`ERP_SITE_HOST`**, **`ERP_PROVISIONING_TOKEN`**, and optional **`ERP_METHOD_*`** overrides — see **`.env.example`** and the table above.
- **Networks:** compose files declare external network **`axiserp-erpnext-pnzjyk_axis-erp-internal`** so the service can reach **`axis-erp-backend:8000`**. Ensure that network exists (created by the ERPNext stack) before starting this service.
- **`docker-compose.dokploy.yml`** adds **`expose`**, **`dokploy-network`**, and the same ERP internal network. Use it when that matches your Dokploy networking; otherwise stay on `docker-compose.yml` for local-only runs.

## Related documentation

- Design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## Rollout notes (provisioning-agent)

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- If outbound ERP env is unset, expect `503` / `INFRA_UNAVAILABLE` for provisioning actions. **`GET /internal/health`** still returns **`200`** and includes an **`upstream`** hint: when ERP is configured it uses **`GET /api/method/frappe.ping`** for reachability (missing methods do not affect liveness). Set **`ERP_SITE_HOST`** to the site hostname Frappe expects on **`Host`** for that ping (and as the default when a call has no site in the body).
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after the adapter is validated end-to-end.
