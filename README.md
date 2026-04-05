# erp-execution-service

**Bench-side executor:** this service exposes a stable **HTTP** contract (`/v1/erp/lifecycle`) for `provisioning-agent` when `ERP_EXECUTION_BACKEND=remote`. **Work is performed locally** via the Frappe **bench** CLI, filesystem access under the bench directory (for example `sites/<site>/site_config.json`), and subprocesses. It is **not** a self-contained “Node + HTTP only” stack: the **Docker image does not include bench, Python, or MariaDB**—those must exist wherever the process runs.

## Role

- **Stable API**: allowlisted actions (`createSite`, `readSiteDbName`, `installErp`, `enableScheduler`, `addDomain`, `createApiUser`, `healthCheck`), Bearer auth (`ERP_REMOTE_TOKEN`), typed success/error envelopes.
- **Local execution**: each request runs **bench** on the same machine (or VM) as the tree at `ERP_BENCH_PATH`, with `cwd` set to that path.

## Runtime assumptions (required)

| Requirement | Purpose |
|-------------|---------|
| **Bench directory** | `ERP_BENCH_PATH` must exist, be readable, and contain a `sites/` directory. |
| **Bench executable** | `ERP_BENCH_EXECUTABLE` (default `bench`) must be on `PATH`; startup runs `bench --version` with `cwd=ERP_BENCH_PATH`. |
| **Secrets / DB** | `ERP_DB_ROOT_PASSWORD` and `ERP_ADMIN_PASSWORD` for `bench new-site`. `ERP_DB_HOST` is passed to `--db-host` (default `db`). Optional `ERP_VALIDATE_DB_SCHEMA` + read-only DB credentials validate `db_name` in MariaDB. |

Unless `ERP_SKIP_BENCH_RUNTIME_CHECK=true`, startup **fails fast** with JSON on stderr if the bench layout or `bench --version` fails. Do not skip checks in production without a deliberate reason.

## Endpoints

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/internal/health` | None (internal probes) |
| `POST` | `/v1/erp/lifecycle` | `Authorization: Bearer <ERP_REMOTE_TOKEN>` |

## Stack

- Node.js, TypeScript, Fastify, Zod, Pino; local package `erp-utils` (`file:./packages/erp-utils`).

## Scripts

```bash
npm install
npm run dev      # tsx src/server.ts
npm run build    # build erp-utils + tsc -> dist/
npm start        # node dist/server.js
npm test
```

## Environment variables

Values match `src/config/env.ts`.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ERP_REMOTE_TOKEN` | yes | — | Bearer token (min 16 chars), same as provisioning-agent |
| `ERP_ADMIN_PASSWORD` | yes | — | Admin password for `bench new-site --admin-password` |
| `ERP_DB_ROOT_PASSWORD` | yes | — | MariaDB root password for `bench new-site --db-root-password` |
| `ERP_BENCH_PATH` | no | `/home/frappe/frappe-bench` | Absolute path to the bench directory |
| `ERP_BENCH_EXECUTABLE` | no | `bench` | Bench binary name (must be on `PATH`) |
| `ERP_COMMAND_TIMEOUT_MS` | no | `120000` | Per-action subprocess timeout |
| `ERP_DB_HOST` | no | `db` | MariaDB host for `bench new-site --db-host` and optional schema validation |
| `ERP_DB_PORT` | no | `3306` | MariaDB port for optional `information_schema` validation |
| `ERP_DB_READONLY_USER` | if `ERP_VALIDATE_DB_SCHEMA=true` | — | Read-only DB user |
| `ERP_DB_READONLY_PASSWORD` | if `ERP_VALIDATE_DB_SCHEMA=true` | — | Password for read-only user |
| `ERP_VALIDATE_DB_SCHEMA` | no | `false` | Set `true` to verify `db_name` exists in `information_schema.SCHEMATA` |
| `ERP_SKIP_BENCH_RUNTIME_CHECK` | no | unset | Set `true` only to skip startup bench checks (not for production) |
| `PORT` | no | `8790` | Listen port |
| `NODE_ENV` | no | `development` | `development` \| `test` \| `production` |

## Deployment

- Run **on the bench host** or mount the bench tree into the container at `ERP_BENCH_PATH` and ensure **bench** and dependencies are available (the stock image is Node-only; extend it or run on the host).
- Deploy **only on private/internal networks**. Do not expose this service on the public internet without additional controls.
- Point `provisioning-agent` at `ERP_REMOTE_BASE_URL` (for example `http://erp-execution-service:8790`) and set `ERP_REMOTE_TOKEN` to the **same value** on both sides.

### Docker / Dokploy

- This repo is **standalone**: `Dockerfile` and **`docker-compose.yml`** at repo root (for Dokploy compose deployments).
- Build: `docker build -t erp-execution-service .` from the repo root.
- Compose: set `ERP_REMOTE_TOKEN`, `ERP_ADMIN_PASSWORD`, `ERP_DB_ROOT_PASSWORD`, and mount or align `ERP_BENCH_PATH` with a real bench tree.
- **If Dokploy reports “Compose file not found”:** set **Compose file path** to `docker-compose.yml`. If your Dokploy version clones into a subfolder, try `code/docker-compose.yml`. Ensure the **branch** is `main` and redeploy after pushing.
- Identical stacks may also exist as `compose.yml`, `compose.yaml`, or `docker-compose.yaml` for tooling that prefers those names.

## Related documentation

- Design notes (when this package lives inside the control-plane monorepo): [`docs/erp-side-execution-service.md`](https://github.com/TazUae/control-plane/blob/main/docs/erp-side-execution-service.md)

## Rollout notes (provisioning-agent)

- Confirm network path from `provisioning-agent` to this service (DNS, TLS if required).
- Set `ERP_REMOTE_BASE_URL`, `ERP_REMOTE_TOKEN`, and `ERP_REMOTE_TIMEOUT_MS` on provisioning-agent.
- Load-test timeouts and tune `ERP_COMMAND_TIMEOUT_MS` vs `ERP_REMOTE_TIMEOUT_MS` (caller should be ≥ server-side execution budget).
- Flip `ERP_EXECUTION_BACKEND=remote` per environment after validation; keep `docker` as rollback until stable.
