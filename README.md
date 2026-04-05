# erp-execution-service

This service exposes a stable **HTTP** contract (`POST /v1/erp/lifecycle`) for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`. **ERP lifecycle work is being moved** from bench/subprocess/filesystem coupling to an **HTTP-only** integration with the ERP stack. The current release removes the legacy execution paths; **`HttpProvisioningClient` is not implemented yet** — lifecycle actions return `503` with `INFRA_UNAVAILABLE` until the next step lands.

## Migration (bench → HTTP-only)

| Removed | Notes |
|---------|--------|
| Bench CLI, `spawn`, local `bench --version` checks | No subprocess ERP execution. |
| `ERP_BENCH_PATH`, `ERP_BENCH_EXECUTABLE` | No local bench tree. |
| `ERP_DB_ROOT_PASSWORD`, `ERP_ADMIN_PASSWORD`, `ERP_DB_HOST`, `ERP_DB_PORT`, `ERP_DB_READONLY_*`, `ERP_VALIDATE_DB_SCHEMA` | No direct DB coupling for provisioning in this service. |
| `ERP_SKIP_BENCH_RUNTIME_CHECK` | Bench startup checks removed. |
| `site_config.json` filesystem reads | `readSiteDbName` will use HTTP when implemented. |

**Upcoming:** `ERP_BASE_URL` — base URL for the ERP HTTP provisioning API consumed by `HttpProvisioningClient` (see `src/lib/http-adapter-placeholder.ts`).

## Role

- **Stable API**: allowlisted actions (`createSite`, `readSiteDbName`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`), Bearer auth (`ERP_REMOTE_TOKEN`), typed success/error envelopes.
- **Execution**: deferred to `HttpProvisioningClient` + `ERP_BASE_URL` (placeholder until implemented).

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

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_REMOTE_TOKEN` | yes | — | Bearer token (min 16 chars), same as provisioning-agent |
| `ERP_COMMAND_TIMEOUT_MS` | no | `120000` | Reserved for future HTTP client timeouts |
| `ERP_BASE_URL` | no | — | Base URL for ERP HTTP provisioning API (used when `HttpProvisioningClient` is implemented) |
| `PORT` | no | `8790` | Listen port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |

## Deployment

- Deploy **only on private/internal networks**. Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (for example `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.

### Docker / Dokploy

- **Compose file path:** set to **`docker-compose.yml`** (repo root). If Dokploy clones into a subfolder, use **`code/docker-compose.yml`** (or whatever prefix matches your checkout).
- Build: `docker build -t erp-execution-service .` from the repo root.
- Secrets / env: at minimum `ERP_REMOTE_TOKEN`; optional `ERP_BASE_URL` when the HTTP adapter is ready.
- Optional: **`docker-compose.dokploy.yml`** — `expose` + external `dokploy-network` (no host `ports:`). Use only if that matches your Dokploy networking; otherwise stay on `docker-compose.yml`.

## Related documentation

- Design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## Rollout notes (provisioning-agent)

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- Until `HttpProvisioningClient` is implemented, expect `503` / `INFRA_UNAVAILABLE` for lifecycle actions; keep previous backends if you still need provisioning.
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after the HTTP adapter is validated.
