# erp-execution-service

This service exposes a stable **HTTP** contract (`POST /v1/erp/lifecycle`) for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`. **ERP lifecycle work** is integrated via an **HTTP-only** path to **ERPNext/Frappe** (`HttpProvisioningClient`). The legacy bench/subprocess/filesystem execution model has been removed.

## Migration (bench → HTTP-only)

| Removed | Notes |
|---------|--------|
| Bench CLI, `spawn`, local `bench --version` checks | No subprocess ERP execution. |
| `ERP_BENCH_PATH`, `ERP_BENCH_EXECUTABLE` | No local bench tree. |
| `ERP_DB_ROOT_PASSWORD`, `ERP_ADMIN_PASSWORD`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_READONLY_*`, `ERP_VALIDATE_DB_SCHEMA` | No direct DB coupling for provisioning in this service. |
| `ERP_SKIP_BENCH_RUNTIME_CHECK` | Bench startup checks removed. |
| `site_config.json` filesystem reads | `readSiteDbName` will use HTTP when the adapter is wired. |

## Role

- **Stable API**: allowlisted actions (`createSite`, `readSiteDbName`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`), Bearer auth to **this** service (`ERP_REMOTE_TOKEN`), typed success/error envelopes.
- **Outbound ERP**: `HttpProvisioningClient` calls ERPNext at `ERP_BASE_URL` using Frappe token auth (`ERP_AUTH_TOKEN`). Lifecycle actions still return `503` / `INFRA_UNAVAILABLE` until the adapter delegates to the client in a follow-up step.

## ERPNext provisioning API (upstream)

This service expects **custom whitelisted Frappe methods** to exist on the ERP stack (implemented and deployed separately), for example:

- `POST /api/method/frappe.api.provisioning.create_site`
- `POST /api/method/frappe.api.provisioning.install_erp`
- `POST /api/method/frappe.api.provisioning.enable_scheduler`
- `POST /api/method/frappe.api.provisioning.add_domain`
- `POST /api/method/frappe.api.provisioning.create_api_user`

**Upstream health** defaults to `GET /api/method/frappe.ping` (override with `ERP_HEALTH_PATH`). If your site uses a different probe, set the path accordingly.

Without those methods on ERPNext, provisioning calls will fail with mapped client errors (for example not found or upstream errors).

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

### Outbound HTTP client (ERPNext)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_BASE_URL` | no* | — | Origin of the ERP stack (e.g. `https://erp-internal:8080`). No trailing slash required. |
| `ERP_AUTH_TOKEN` | no* | — | Frappe API credentials as **`api_key:api_secret`** (sent as `Authorization: token <ERP_AUTH_TOKEN>`). Create API Key + API Secret in ERPNext. |
| `ERP_COMMAND_TIMEOUT_MS` | no | `120000` | Per-request timeout for outbound `fetch` to ERPNext |
| `ERP_HEALTH_PATH` | no | `/api/method/frappe.ping` | GET path for `HttpProvisioningClient.ping()` reachability checks |

\*Required together when you use `createHttpProvisioningClient()` / outbound calls: set both `ERP_BASE_URL` and `ERP_AUTH_TOKEN`. The service can start without them until the adapter is wired.

## Deployment

- Deploy **only on private/internal networks**. Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (for example `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.
- Ensure network reachability from this container/process to `ERP_BASE_URL` (DNS, TLS, firewall).

### Docker / Dokploy

- **Compose file path:** set to **`docker-compose.yml`** (repo root). If Dokploy clones into a subfolder, use **`code/docker-compose.yml`** (or whatever prefix matches your checkout).
- Build: `docker build -t erp-execution-service .` from the repo root.
- Secrets: `ERP_REMOTE_TOKEN` (inbound); for outbound ERP, `ERP_BASE_URL` and `ERP_AUTH_TOKEN` when enabling HTTP provisioning.
- Optional: **`docker-compose.dokploy.yml`** — `expose` + external `dokploy-network` (no host `ports:`). Use only if that matches your Dokploy networking; otherwise stay on `docker-compose.yml`.

## Related documentation

- Design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## Rollout notes (provisioning-agent)

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- Until the lifecycle adapter calls `HttpProvisioningClient`, expect `503` / `INFRA_UNAVAILABLE` for lifecycle actions from this service.
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after the adapter is validated end-to-end.
