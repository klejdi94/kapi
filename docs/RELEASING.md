# Releasing kapi

1. **Bump the version** everywhere it has to agree:
   ```bash
   node scripts/bump-version.mjs 0.4.0
   ```
   Add the release notes to `CHANGELOG.md`, commit, and open a PR. CI has to be green.
2. **Tag the merge commit** on `master`:
   ```bash
   git tag v0.4.0 && git push origin v0.4.0
   ```
   The `release` workflow builds macOS (Apple Silicon + Intel), Windows and Linux installers, signs the
   updater artifacts, and attaches everything to a **draft** GitHub release.
3. **Publish the draft** once you've tried a build. Publishing triggers the `publish-npm` workflow,
   which ships the same version of the CLI + MCP server as `npx kapi`. Installed apps see the update
   from `latest.json` on their next launch.

## Secrets

Everything except the updater key is optional — without a secret, that step is skipped and the build
comes out the way it always has.

| Secret | Used for | Where to get it |
| --- | --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Signing updater artifacts (required — the app only installs updates signed with the matching public key in `tauri.conf.json`) | Already configured |
| `NPM_TOKEN` | `npx kapi` | npmjs.com → Access Tokens → *Automation* (or a granular token with publish rights to `kapi`) |
| `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` | Developer ID signing on macOS, so Gatekeeper stops asking for right-click → Open | Apple Developer Program: export the *Developer ID Application* certificate as `.p12`, base64-encode it; the identity is its full name, e.g. `Developer ID Application: Your Name (TEAMID)` |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | Notarization (removes the "can't be checked for malicious software" dialog) | Your Apple ID, an app-specific password from appleid.apple.com, and your team id |
| `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Authenticode signing on Windows, so SmartScreen warns less (and, with an EV certificate or reputation, not at all) | A code-signing certificate as a base64-encoded `.pfx`. Open-source projects can get one free through [SignPath Foundation](https://signpath.org) |

Once macOS builds are signed with a Developer ID, the keychain will stop asking for permission again
after each update (ad-hoc signatures change every build, which macOS treats as a different app), and
the `xattr -cr` step in the README can go.
