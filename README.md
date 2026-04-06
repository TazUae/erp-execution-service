# erp-execution-service

This service exposes a stable **HTTP** contract (`POST /v1/erp/lifecycle`) for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`. **ERP lifecycle work** is integrated via an **HTTP-only** path to **ERPNext/Frappe** using the **`FrappeClient`** (`src/lib/frappe-client/`). The legacy bench/subprocess/filesystem execution model has been removed.

## Frappe / ERPNext HTTP API

Frappe exposes callable Python methods over HTTP:

- **Pattern:** `POST /api/method/{dotted.path}`
- **Example:** `POST /api/method/provisioning_api.api.provisioning.create_site`
- **Body:** JSON
- **Auth (provisioning_api app):** `X-Provisioning-Token: <ERP_PROVISIONING_TOKEN>` — the same secret as `provisioning_api_token` in the ERP **`sites/common_site_config.json`**. Do **not** send this secret as `Authorization: Bearer …`; Frappe interprets `Bearer` as OAuth and can return **401** before **`provisioning_api`** runs.

Health checks often use **`GET /api/method/frappe.ping`**, which returns JSON with a `message` field (for example `"pong"`). That ping uses the same **`X-Provisioning-Token`** header as other outbound calls.

This repository ships a **generic** `FrappeClient` and an **`ErpExecutionAdapter`** that maps each lifecycle action to a configurable dotted method (`POST /api/method/{dotted.path}`). **Upstream Python methods must be whitelisted in Frappe**; until they exist on your ERP deployment, calls may return **404** / **`METHOD_NOT_FOUND`**, which this service maps to **`NOT_IMPLEMENTED`** (HTTP **501**) in the lifecycle envelope.

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
| **Provisioning token header** | `ERP_PROVISIONING_TOKEN` must match **`provisioning_api_token`** in ERP **`sites/common_site_config.json`** (sent as **`X-Provisioning-Token`**) |

The tracked **`docker-compose.yml`** and **`docker-compose.dokploy.yml`** attach **`erp-execution-service`** to that external network **in addition to** this project’s default network (and, for Dokploy, `dokploy-network`). After deploy, **redeploy** the service, **verify** the container is on `axiserp-erpnext-pnzjyk_axis-erp-internal`, then run your **live connectivity checks** (e.g. outbound ping / lifecycle against ERP). Smoke-test automation is out of scope for this repo step.

## Role

- **Stable API**: allowlisted actions (`createSite`, `readSiteDbName`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`), Bearer auth to **this** service (`ERP_REMOTE_TOKEN`), typed success/error envelopes.
- **Outbound ERP**: `ErpExecutionAdapter` uses `FrappeClient` against `ERP_BASE_URL` with **`X-Provisioning-Token: <ERP_PROVISIONING_TOKEN>`**. If `ERP_BASE_URL` or `ERP_PROVISIONING_TOKEN` is unset, provisioning actions return **`503` / `INFRA_UNAVAILABLE`**. When set, the adapter issues real RPCs; **upstream provisioning logic may still be pending** on the ERP side.

## ERP-side Frappe app (scaffold)

The directory [`provisioning_api/`](provisioning_api/README.md) is a **Frappe custom app** that defines the whitelisted provisioning RPCs (`provisioning_api.api.provisioning.*`). Install it on your ERP stack; defaults in this service already point at those dotted paths.

## ERPNext provisioning API (upstream)

Custom **whitelisted** Frappe methods are expected to exist on the ERP stack when provisioning is enabled, for example:

- `provisioning_api.api.provisioning.create_site`
- `provisioning_api.api.provisioning.read_site_db_name`
- `provisioning_api.api.provisioning.install_erp`
- `provisioning_api.api.provisioning.enable_scheduler`
- `provisioning_api.api.provisioning.add_domain`
- `provisioning_api.api.provisioning.create_api_user`

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
| `ERP_PROVISIONING_TOKEN` | no* | — | Secret for `provisioning_api` methods, sent as HTTP header **`X-Provisioning-Token`** (not `Authorization: Bearer`); must match **`provisioning_api_token`** in ERP **`sites/common_site_config.json`**. |
| `ERP_COMMAND_TIMEOUT_MS` | no | `30000` | Per-request timeout for outbound `fetch` to Frappe |
| `ERP_METHOD_CREATE_SITE` | no | `provisioning_api.api.provisioning.create_site` | Dotted path for `createSite` |
| `ERP_METHOD_READ_SITE_DB_NAME` | no | `provisioning_api.api.provisioning.read_site_db_name` | Dotted path for `readSiteDbName` |
| `ERP_METHOD_INSTALL_ERP` | no | `provisioning_api.api.provisioning.install_erp` | Dotted path for `installErp` |
| `ERP_METHOD_ENABLE_SCHEDULER` | no | `provisioning_api.api.provisioning.enable_scheduler` | Dotted path for `enableScheduler` |
| `ERP_METHOD_ADD_DOMAIN` | no | `provisioning_api.api.provisioning.add_domain` | Dotted path for `addDomain` |
| `ERP_METHOD_CREATE_API_USER` | no | `provisioning_api.api.provisioning.create_api_user` | Dotted path for `createApiUser` |

\*Required together for outbound ERP calls: set **`ERP_BASE_URL`** and **`ERP_PROVISIONING_TOKEN`**. The process can start without them; lifecycle actions that need ERP then return **`INFRA_UNAVAILABLE`** until configured.

**Payload mapping (this service → Frappe JSON body):** the stable API uses camelCase fields (`site`, `apiUsername`, …). The adapter sends snake_case keys expected by typical Frappe handlers: `site` → `site_name`, `apiUsername` → `api_username`, plus `domain` where applicable.

## Deployment

- Deploy **only on private/internal networks**. Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (for example `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.
- Ensure network reachability from this container/process to `ERP_BASE_URL` (DNS, TLS, firewall).
- Configure **`ERP_PROVISIONING_TOKEN`** to the same value as **`provisioning_api_token`** on the ERP bench (`sites/common_site_config.json`).

### Environment and configuration

- **Tracked templates:** **`.env.example`** documents every variable validated in **`src/config/env.ts`**. The committed **`.env`** file lists the same keys with **non-production placeholder values** so `git pull` always restores a complete variable list; adjust values per environment on the server or in CI.
- **Docker Compose:** both **`docker-compose.yml`** and **`docker-compose.dokploy.yml`** use **`env_file: [.env]`** and do **not** embed an `environment:` block. Dokploy (or your host) can still override values by merging or replacing `.env` after checkout, or by exporting variables before `docker compose` (Compose interpolates `${PORT}` etc. from the project `.env`).
- **Overrides:** use **`.env.local`**, **`.env.production`**, or **`.env.secrets`** for machine-specific or secret values (these filenames are **gitignored**). Never commit real production secrets into **`.env`**.

### Docker / Dokploy

- **Compose file path:** set to **`docker-compose.yml`** (repo root). If Dokploy clones into a subfolder, use **`code/docker-compose.yml`** (or whatever prefix matches your checkout).
- Build: `docker build -t erp-execution-service .` from the repo root.
- **Variables:** inbound **`ERP_REMOTE_TOKEN`**; for outbound ERP, **`ERP_BASE_URL`**, **`ERP_PROVISIONING_TOKEN`**, and optional **`ERP_METHOD_*`** overrides — see **`.env.example`** and the table above.
- **Networks:** compose files declare external network **`axiserp-erpnext-pnzjyk_axis-erp-internal`** so the service can reach **`axis-erp-backend:8000`**. Ensure that network exists (created by the ERPNext stack) before starting this service.
- Optional: **`docker-compose.dokploy.yml`** — `expose` + **`dokploy-network`** + the same ERP internal network. Use when that matches your Dokploy networking; otherwise stay on `docker-compose.yml`.

## Related documentation

- Design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## Rollout notes (provisioning-agent)

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- If outbound ERP env is unset, expect `503` / `INFRA_UNAVAILABLE` for provisioning actions. **`GET /internal/health`** still returns **`200`** and includes an **`upstream`** hint: when ERP is configured it uses **`GET /api/method/frappe.ping`** for reachability (missing methods do not affect liveness).
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after the adapter is validated end-to-end.
