# erp-execution-service

Internal-only Node.js service that exposes a **narrow, typed** HTTP API for approved ERP lifecycle actions. It is the intended target for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`.

## Purpose

- **Allowlisted actions only** (`createSite`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`).
- **Bearer authentication** using `ERP_REMOTE_TOKEN` (same secret configured on the provisioning-agent caller).
- **Structured responses** aligned with `provisioning-agent` `remote-contract.ts` (`ok` / `data` or `ok` / `error`).
- **No** arbitrary shell, generic command runner, unrestricted bench passthrough, Docker control, or host control APIs.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/internal/health` | None (internal probes) |
| `POST` | `/v1/erp/lifecycle` | `Authorization: Bearer <ERP_REMOTE_TOKEN>` |

## Stack

- Node.js, TypeScript, Fastify, Zod, Pino

## Scripts

```bash
npm install
npm run dev      # tsx src/server.ts
npm run build    # tsc -> dist/
npm start        # node dist/server.js
npm test
```

## Required environment variables

| Variable | Description |
|----------|-------------|
| `ERP_REMOTE_TOKEN` | Bearer token (min 16 chars) shared with provisioning-agent |
| `ERP_ADMIN_PASSWORD` | Admin password for `bench new-site --admin-password` (same as ERP stack) |
| `ERP_DB_ROOT_PASSWORD` | MariaDB/MySQL root password for `bench new-site --db-root-password` (non-interactive) |
| `ERP_BENCH_PATH` | Bench directory (default `/home/frappe/frappe-bench`) |
| `ERP_BENCH_EXECUTABLE` | Bench binary name (default `bench`) |
| `ERP_COMMAND_TIMEOUT_MS` | Per-action timeout (default `120000`) |
| `PORT` | Listen port (default `8790`) |
| `NODE_ENV` | `development` \| `test` \| `production` |

## Deployment

- Deploy **only on private/internal networks** next to the ERP bench host (or on the same host).
- Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (e.g. `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.

## Documentation

- Repository root: [`docs/erp-side-execution-service.md`](../docs/erp-side-execution-service.md)

## TODOs before switching production from Docker to remote

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- Load-test timeouts and tune `ERP_COMMAND_TIMEOUT_MS` vs `ERP_REMOTE_TIMEOUT_MS` (caller should be ≥ server-side execution budget).
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after validation; keep `docker` as rollback until stable.
