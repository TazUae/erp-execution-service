# provisioning_api (Frappe app)

Custom **Frappe / ERPNext** app that exposes a **contract-only** provisioning HTTP API for **`erp-execution-service`**.

**Status:** scaffold — methods validate input, log, and return an explicit **`NOT_IMPLEMENTED`** outcome. There is **no** bench usage, **no** shell, **no** filesystem-based site provisioning, and **no** pretending that operations succeed.

## Purpose

- Provide stable, whitelisted Python entrypoints under a single module: `provisioning_api.api.provisioning`.
- Align with the Node service’s default env pattern of dotted paths (see **Dotted method paths** below).
- Allow the next implementation step to replace stubs with real, safe behavior behind the same HTTP contract.

## Install (Frappe bench)

From your bench directory (example):

```bash
# Copy or clone this app into bench/apps/provisioning_api
bench get-app /path/to/provisioning_api   # or symlink / git submodule
bench --site <site-name> install-app provisioning_api
bench restart
```

Use your organization’s standard process for custom apps; this repo only ships the app source.

## Dotted method paths

Frappe exposes methods at:

`POST /api/method/<dotted.path.to.function>`

| Python function | HTTP path |
|-----------------|-----------|
| `create_site` | `/api/method/provisioning_api.api.provisioning.create_site` |
| `read_site_db_name` | `/api/method/provisioning_api.api.provisioning.read_site_db_name` |
| `install_erp` | `/api/method/provisioning_api.api.provisioning.install_erp` |
| `enable_scheduler` | `/api/method/provisioning_api.api.provisioning.enable_scheduler` |
| `add_domain` | `/api/method/provisioning_api.api.provisioning.add_domain` |
| `create_api_user` | `/api/method/provisioning_api.api.provisioning.create_api_user` |

**Note:** `erp-execution-service` defaults in env may still point at placeholder names such as `frappe.api.provisioning.*`. After installing this app, set `ERP_METHOD_*` to the **`provisioning_api.api.provisioning.*`** paths above (or your fork’s module path).

## Expected caller

- **`erp-execution-service`** (Bearer to the execution service, token auth from the service to Frappe: `Authorization: token <API_KEY>:<API_SECRET>`).
- Optional correlation header: `X-Request-Id` (logged when present; never logs secrets).

## Authentication

1. **Standard Frappe API authentication** — e.g. `Authorization: token <api_key>:<api_secret>`. Unauthenticated **Guest** requests are rejected by `require_provisioning_access()` (via `frappe.session.user == "Guest"` → `AuthenticationError`).
2. **Optional shared secret** — if `provisioning_api_internal_secret` is set in **site config**, requests must also send header `X-Provisioning-Internal-Secret` with the same value. If unset, this check is skipped so token-only flows keep working.

## Response format

Success (future real implementations):

```json
{ "ok": true, "data": { } }
```

Validation error (HTTP 400):

```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR", "message": "..." } }
```

Stub / not implemented (HTTP 501):

```json
{
  "ok": false,
  "error": {
    "code": "NOT_IMPLEMENTED",
    "message": "<operation> is not implemented yet; provisioning_api is contract scaffold only."
  }
}
```

Auth failures use Frappe’s normal exception handling for `AuthenticationError` (not the custom envelope above).

## Manual checks (curl)

Replace `BASE`, `KEY`, `SECRET`, and `SITE` with your values.

```bash
export BASE=http://127.0.0.1:8000
export AUTH="Authorization: token ${KEY}:${SECRET}"

curl -sS -X POST "$BASE/api/method/provisioning_api.api.provisioning.create_site" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"site_name":"valid-site"}'

curl -sS -X POST "$BASE/api/method/provisioning_api.api.provisioning.read_site_db_name" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"site_name":"valid-site"}'

curl -sS -X POST "$BASE/api/method/provisioning_api.api.provisioning.install_erp" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"site_name":"valid-site"}'

curl -sS -X POST "$BASE/api/method/provisioning_api.api.provisioning.enable_scheduler" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"site_name":"valid-site"}'

curl -sS -X POST "$BASE/api/method/provisioning_api.api.provisioning.add_domain" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"site_name":"valid-site","domain":"app.example.com"}'

curl -sS -X POST "$BASE/api/method/provisioning_api.api.provisioning.create_api_user" \
  -H "Content-Type: application/json" \
  -H "$AUTH" \
  -d '{"site_name":"valid-site","api_username":"api_user"}'
```

## Tests (pure Python)

From `provisioning_api/`:

```bash
python -m pip install -e ".[dev]"
python -m pytest
```

## What remains (next implementation step)

- Replace stub handlers with real provisioning logic **without** bench subprocesses unless your security model explicitly allows it.
- Map Frappe/ERPNext-supported operations to these contracts.
- Keep response and error envelopes stable for `erp-execution-service`.
