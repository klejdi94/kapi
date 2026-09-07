---
name: kapi
description: Use kapi's MCP tools to build and run API test collections, keep them in sync with a backend's OpenAPI/Swagger spec, and manage kapi workspaces/environments. Trigger whenever the user asks to test an API, exercise a backend's endpoints, generate or import an OpenAPI spec into kapi, or otherwise work with a kapi workspace.
---

# kapi

kapi is a local-only API client (a real desktop app, not a service) that stores everything as plain
JSON files on this machine. Its MCP server lets you read and enrich a kapi workspace directly — no
credentials of any kind are involved on kapi's side; you're only ever reading/writing files that
belong to the person running you, on their own machine.

## Always start with `kapi_status`

It tells you whether a workspace already exists and, if not, exactly what to call next
(`kapi_create_workspace`). Never assume a workspace exists — a fresh machine has none. If the kapi
app itself isn't installed, `kapi_status` says so and gives you the GitHub releases URL to mention to
the user — this is informational only, every other tool works whether or not the app is installed.

## Typical flow when asked to test a backend project

1. `kapi_status` — confirm a workspace exists (create one if not).
2. Does the project already have an OpenAPI/Swagger file checked in (`openapi.json`,
   `openapi.yaml`, `swagger.json`, a `docs/` folder, or similar)? If so, use `kapi_import_openapi`
   (first time) or `kapi_sync_openapi` (an existing collection for this backend) with `filePath`.
3. Otherwise, many backend frameworks serve their spec once the app is running (FastAPI/NestJS/
   Spring's springdoc, etc. under `/openapi.json`, `/v3/api-docs`, `/swagger.json`...). If the
   backend is already running (or you can start it, e.g. `npm run dev` / `mvn spring-boot:run` —
   that's your call to make, not kapi's), call `kapi_import_openapi` or `kapi_sync_openapi` with
   `probeOrigin` set to its base URL (e.g. `http://localhost:3000`) and let it try the common paths.
4. If neither exists, build the collection by hand with `kapi_create_request` (and
   `kapi_create_folder` to group related requests) based on what you know about the backend's
   routes.
5. Put anything environment-specific — base URLs, tokens — into `{{variables}}` in the request and
   set their values with `kapi_set_environment_variable`. Mark real credentials `secret: true`.
6. `kapi_run_tests` to actually exercise it. Point `scope` at one folder to run a subset.
7. **Re-run `kapi_sync_openapi` every time you come back to this backend** (after pulling new
   code, after the backend restarts with route changes, etc.) — it merges non-destructively:
   endpoints that still exist keep whatever auth/scripts/examples were set on them, brand-new
   endpoints are added, and endpoints removed from the spec are left alone (never deleted) but
   called out in the response so you can flag them to the user. This is what gives the user a real
   history of how the backend's API surface changed over time, visible in kapi's own UI.

## Rules

- Never put a real secret (an actual API key, password, or token) directly into a request URL,
  header value, or body — always a `{{variable}}`, set via `kapi_set_environment_variable` with
  `secret: true`. This mirrors how kapi's own AI panel keeps secrets out of anything it sends
  anywhere.
- Every mutating tool's response ends with a reminder to bring kapi's window to the foreground if
  it's open, so the change is picked up safely — mention that to the user when it's relevant (they
  might have kapi open right now).
- Prefer `kapi_sync_openapi` over `kapi_import_openapi` once you know a collection for this backend
  already exists (check with `kapi_list_collections` first) — importing again would create a
  duplicate collection instead of updating the existing one.
