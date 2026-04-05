# erp-execution-service

This service exposes a stable **HTTP** contract (`POST /v1/erp/lifecycle`) for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`. **ERP lifecycle work** is integrated via an **HTTP-only** path to **ERPNext/Frappe** using the **`FrappeClient`** (`src/lib/frappe-client/`). The legacy bench/subprocess/filesystem execution model has been removed.

## Frappe / ERPNext HTTP API

Frappe exposes callable Python methods over HTTP:

- **Pattern:** `POST /api/method/{dotted.path}`
- **Example:** `POST /api/method/frappe.api.provisioning.create_site`
- **Body:** JSON
- **Auth:** `Authorization: token {API_KEY}:{API_SECRET}` (API Key + API Secret from ERPNext)

Health checks often use **`GET /api/method/frappe.ping`**, which returns JSON with a `message` field (for example `"pong"`).

This repository ships a **generic** `FrappeClient` and an **`ErpExecutionAdapter`** that maps each lifecycle action to a configurable dotted method (`POST /api/method/{dotted.path}`). **Upstream Python methods must be whitelisted in Frappe**; until they exist on your ERP deployment, calls may return **404** / **`METHOD_NOT_FOUND`**, which this service maps to **`NOT_IMPLEMENTED`** (HTTP **501**) in the lifecycle envelope.

### Expected upstream behavior

- Successful RPCs return JSON that includes a **`message`** field with the result payload.
- Application-level failures may include an **`exc`** string (trace / error text). The client maps that to a normalized **`ERP_APPLICATION_ERROR`** result (no secrets in logs).
- HTTP **401/403** indicate credential or permission problems relative to the token.
- HTTP **404** usually means the method path is missing or not exposed.

## Migration (bench → HTTP-only)

| Removed | Notes |
|---------|--------|
| Bench CLI, `spawn`, local `bench --version` checks | No subprocess ERP execution. |
| `ERP_BENCH_PATH`, `ERP_BENCH_EXECUTABLE` | No local bench tree. |
| `ERP_DB_ROOT_PASSWORD`, `ERP_ADMIN_PASSWORD`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_READONLY_*`, `ERP_VALIDATE_DB_SCHEMA` | No direct DB coupling for provisioning in this service. |
| `ERP_SKIP_BENCH_RUNTIME_CHECK` | Bench startup checks removed. |
| `site_config.json` filesystem reads | Will use HTTP when the adapter is wired. |

## Role

- **Stable API**: allowlisted actions (`createSite`, `readSiteDbName`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`), Bearer auth to **this** service (`ERP_REMOTE_TOKEN`), typed success/error envelopes.
- **Outbound ERP**: `ErpExecutionAdapter` uses `FrappeClient` against `ERP_BASE_URL` with token auth (`ERP_API_KEY` + `ERP_API_SECRET`). If those variables are unset, provisioning actions return **`503` / `INFRA_UNAVAILABLE`**. When set, the adapter issues real RPCs; **upstream provisioning logic may still be pending** on the ERP side.

## ERP-side Frappe app (scaffold)

The directory [`provisioning_api/`](provisioning_api/README.md) is a **Frappe custom app** that defines the whitelisted provisioning RPCs (`provisioning_api.api.provisioning.*`). It is **contract-only** (stubs return `NOT_IMPLEMENTED`); install it on your ERP stack and point `ERP_METHOD_*` on **erp-execution-service** at those dotted paths when ready.

## ERPNext provisioning API (upstream, future)

Custom **whitelisted** Frappe methods are expected to exist on the ERP stack when provisioning is enabled, for example:

- `frappe.api.provisioning.create_site`
- `frappe.api.provisioning.install_erp`
- `frappe.api.provisioning.enable_scheduler`
- `frappe.api.provisioning.add_domain`
- `frappe.api.provisioning.create_api_user`

Those methods are **not** implemented in this repository; they must exist on the ERP stack as **whitelisted** `@frappe.whitelist()` (or equivalent) Python entry points. The execution service is **transport-wired**; behavior depends on your ERP version and custom app.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/internal/health` | None (internal probes) |
| `POST` | `/v1/erp/lifecycle` | `Authorization: Bearer <ERP_REMOTE_TOKEN>` |

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

Values match `src/config/env.ts`.

### Inbound (this service)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_REMOTE_TOKEN` | yes | — | Bearer token (min 16 chars), same as provisioning-agent |
| `PORT` | no | `8790` | Listen port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |

### Outbound Frappe client (ERPNext)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_BASE_URL` | no* | — | Origin of the ERP stack (e.g. `http://axis-erp-backend:8000`). No trailing slash required. |
| `ERP_API_KEY` | no* | — | Frappe API Key |
| `ERP_API_SECRET` | no* | — | Frappe API Secret (paired with key; sent as `Authorization: token {ERP_API_KEY}:{ERP_API_SECRET}`) |
| `ERP_COMMAND_TIMEOUT_MS` | no | `30000` | Per-request timeout for outbound `fetch` to Frappe |
| `ERP_METHOD_CREATE_SITE` | no | `frappe.api.provisioning.create_site` | Dotted path for `createSite` |
| `ERP_METHOD_READ_SITE_DB_NAME` | no | `frappe.api.provisioning.read_site_db_name` | Dotted path for `readSiteDbName` |
| `ERP_METHOD_INSTALL_ERP` | no | `frappe.api.provisioning.install_erp` | Dotted path for `installErp` |
| `ERP_METHOD_ENABLE_SCHEDULER` | no | `frappe.api.provisioning.enable_scheduler` | Dotted path for `enableScheduler` |
| `ERP_METHOD_ADD_DOMAIN` | no | `frappe.api.provisioning.add_domain` | Dotted path for `addDomain` |
| `ERP_METHOD_CREATE_API_USER` | no | `frappe.api.provisioning.create_api_user` | Dotted path for `createApiUser` |

\*Required together for outbound ERP calls: set `ERP_BASE_URL`, `ERP_API_KEY`, and `ERP_API_SECRET`. The process can start without them; lifecycle actions that need ERP then return **`INFRA_UNAVAILABLE`** until configured.

**Payload mapping (this service → Frappe JSON body):** the stable API uses camelCase fields (`site`, `apiUsername`, …). The adapter sends snake_case keys expected by typical Frappe handlers: `site` → `site_name`, `apiUsername` → `api_username`, plus `domain` where applicable.

## Deployment

- Deploy **only on private/internal networks**. Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (for example `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.
- Ensure network reachability from this container/process to `ERP_BASE_URL` (DNS, TLS, firewall).

### Docker / Dokploy

- **Compose file path:** set to **`docker-compose.yml`** (repo root). If Dokploy clones into a subfolder, use **`code/docker-compose.yml`** (or whatever prefix matches your checkout).
- Build: `docker build -t erp-execution-service .` from the repo root.
- Secrets: `ERP_REMOTE_TOKEN` (inbound); for outbound ERP, `ERP_BASE_URL`, `ERP_API_KEY`, and `ERP_API_SECRET` when enabling HTTP calls.
- Optional: **`docker-compose.dokploy.yml`** — `expose` + external `dokploy-network` (no host `ports:`). Use only if that matches your Dokploy networking; otherwise stay on `docker-compose.yml`.

## Related documentation

- Design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## Rollout notes (provisioning-agent)

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- If outbound ERP env is unset, expect `503` / `INFRA_UNAVAILABLE` for provisioning actions. **`GET /internal/health`** still returns **`200`** and includes an **`upstream`** hint: when ERP is configured it uses **`GET /api/method/frappe.ping`** for reachability (missing methods do not affect liveness).
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after the adapter is validated end-to-end.
