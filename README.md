# kapi

**A Postman-grade API client that keeps its mouth shut.**

No account. No sync. No telemetry. No server anywhere in the loop. Your workspaces, collections,
environments, secrets and history are files on your own disk — and requests leave through your
operating system's networking stack, not a browser, so there is no CORS to fight and no proxy
sitting between you and the API.

<p>
  <a href="https://github.com/klejdi94/kapi/releases/latest">
    <img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS-8b7cff?style=for-the-badge&logo=apple&logoColor=white">
  </a>
  <a href="https://github.com/klejdi94/kapi/releases/latest">
    <img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows-2f81f7?style=for-the-badge&logo=windows&logoColor=white">
  </a>
</p>

macOS (Apple Silicon and Intel) and Windows x64. Every build lives on the
[Releases](https://github.com/klejdi94/kapi/releases) page.

### Opening an unsigned build

kapi is not signed with a paid Apple Developer certificate, so both systems will
question it on first launch.

**macOS** — open the `.dmg`, drag kapi to Applications, then right-click the app
and choose **Open** (once; double-clicking is refused). If macOS instead claims
the app *"is damaged and can't be opened"*, it is not — that message means the
download carries a quarantine flag. Clear it and open normally:

```
xattr -cr /Applications/kapi.app
```

**Windows** — SmartScreen shows a warning: choose **More info → Run anyway**.

---

## What you get

**Every request you actually send.** All HTTP methods plus custom verbs. Bearer, Basic, API key, JWT
(signed locally), OAuth 2.0 and raw custom auth. JSON, XML, HTML, text, GraphQL, form-data with real
file uploads, urlencoded, and raw binary bodies. WebSocket connections with a live frame log.

**Responses you can actually read.** Pretty-printed and syntax-highlighted, a collapsible JSON tree,
raw bytes, a real preview for HTML, images, audio, video and PDFs, parsed cookies, header tables, and
a timing breakdown. Save any response as a named example and replay it later.

**Organization that scales.** Workspaces → collections → nested folders → requests, with drag-and-drop,
multi-select, pinned favourites and tabs, inherited auth/headers/variables, and `{{variables}}` resolved
across environments, collection scope and globals. Every collection gets its own page — default auth and
headers, variables (with a secret toggle that keeps them out of the AI's context), scripts and generated
docs, all in one place.

**Scripting, the Postman way.** Pre-request and test scripts with a `pm` API you already know — per
request *and* per collection, running in that order. Assertions show up in a Tests panel; `console.log`
and script errors land in the Console.

**An AI that sees what you see.** Claude answers with the request and response you have open already
attached — "why did this fail?", "write a pre-request script for this" — and writes `pm.test(...)`
assertions from a real response. It shells out to your own `claude` CLI — no API key, no extra
subscription, nothing sent to us.

**Run a whole collection.** N iterations, an optional CSV data file, the exact pre-request → send → test
pipeline a manual send uses — so a login request's token really does carry into the ones after it. Live
pass/fail as it runs, results exportable as JSON.

**Discover an API by browsing it.** Point kapi at a site and it opens it in its own window — your real
session, your real cookies — and quietly watches the calls it makes while you click around. Turn what it
finds into a real collection, secrets swapped for `{{variables}}` instead of saved as plaintext. Or skip
the clicking: kapi checks the usual `/openapi.json` / `/swagger.json` paths first.

**Docs that write themselves.** Markdown notes per request, rolled up into one document per collection —
export it as Markdown or OpenAPI 3.0, or hand the whole collection to any tool that reads either.

**A local mock server.** Turn any collection into a running HTTP server on localhost with per-route
status, headers, body and latency, then watch the hits stream into the console.

**Git-backed workspaces.** Point a workspace at a folder and kapi keeps a clean JSON snapshot in it,
with a built-in diff view, commit, push and pull. Review API changes in a pull request like code.
Secrets stay out of the snapshot.

**Import and export everything.** Postman v2.1 collections and environments, OpenAPI 3.x / Swagger 2
(JSON or YAML, auto-organized into folders by tag), HAR, Insomnia, and plain cURL — paste a cURL
command straight into the URL bar and it expands into a full request. Export to Postman, OpenAPI 3.0,
Markdown docs, HAR, or generate ready-to-run code in a dozen languages.

**A console that shows the whole truth.** Every request, response, WebSocket frame, mock hit and
script log, with full headers and bodies.

---

## Develop

```
npm install
npm run desktop:dev
```

Opens the app in a native window backed by the Vite dev server, with hot reload.

`npm run dev` (plain Vite in a browser tab) is fine for fast UI iteration, but requests to other
origins hit normal browser CORS restrictions there — only the desktop shell bypasses them.

## Build locally

```
npm run desktop:build
```

Produces a bundle under `src-tauri/target/release/bundle/`. On macOS, building the `.dmg` needs
`hdiutil` to mount a disk image, which some sandboxed shells block — if that step fails the `.app`
itself is still valid, or you can let CI build it.

## Release builds

Pushing a tag builds macOS (Apple Silicon + Intel) and Windows installers on GitHub's own runners and
attaches them to a draft release:

```
git tag v0.2.1
git push origin v0.2.1
```
