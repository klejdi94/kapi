# kapi

A Postman-style API client that runs as a native desktop app. Nothing is stored on a server —
workspaces, collections, environments and history all live on your machine (`localStorage` inside the
app's webview). Requests go out through the OS's own networking stack (via Tauri's HTTP plugin), not a
browser, so there's no CORS to work around and no proxy involved at all.

<p>
  <a href="https://github.com/klejdi94/kapi/releases/latest/download/kapi_0.1.0_aarch64.dmg">
    <img alt="Download for macOS" src="https://img.shields.io/badge/Download-macOS%20(Apple%20Silicon)-8b7cff?style=for-the-badge&logo=apple&logoColor=white">
  </a>
</p>

Requires macOS on Apple Silicon (arm64). See [Releases](https://github.com/klejdi94/kapi/releases) for
every build.

## Develop

```
npm install
npm run desktop:dev
```

This opens the app in a native window backed by the Vite dev server, with hot reload.

`npm run dev` (plain Vite, in a browser tab) also works for fast UI iteration, but sending requests to
other origins will hit normal browser CORS restrictions there — only the desktop shell bypasses it.

## Build a local macOS app

```
npm run desktop:build
```

Produces `src-tauri/target/release/bundle/macos/kapi.app`. Building the `.dmg` installer requires
`hdiutil` to be able to mount a disk image, which some sandboxed/CI shells block — if that step fails,
the `.app` itself is still valid and can be zipped and distributed directly, or built via the GitHub
Actions release workflow below.

## Release builds (GitHub Actions)

Pushing a tag like `v0.1.0` triggers `.github/workflows/release.yml`, which builds on a real macOS
runner and attaches the `.dmg` to a draft GitHub Release:

```
git tag v0.1.0
git push origin v0.1.0
```
