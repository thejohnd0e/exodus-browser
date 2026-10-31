# Development and operation

A practical guide to building, running, testing, and maintaining Exodus Browser. Architecture: `docs/architecture.md`; decisions: `DECISIONS.md`.

## Requirements

The current branch uses SQLite v2 (shared proxy directory) and singleton `languages:string[]`. Do not run a new build against real data before an agreed migration/directory backup. Tests use separate databases; language privacy and acceptance status are described in STATUS.md. To test with another trusted Chromium, set `LOCAL_PROFILES_TEST_CHROMIUM` to its exe path: the browser launches only with a temporary user-data-dir.

- Windows 10/11 x64.
- Node.js 22+ and npm 10+.
- Git (for history; the application works without it).
- Internet access is needed only for `npm ci`, engine download (when a release is pinned), and the websites themselves.

## Installation

```powershell
npm ci
npm run build
npm start
```

`npm ci` installs Electron and native dependencies; `better-sqlite3` uses a prebuilt binary. If Electron fails to download (corporate proxy, timeouts), retry installation or set a working `HTTPS_PROXY`; do not disable TLS verification.

## Scripts

| Command | Action |
|---|---|
| `npm run dev` | build + launch Electron |
| `npm run build` | esbuild for main/preload + Vite for UI into `dist/` |
| `npm start` | launch the built application |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (Vitest) |
| `npm run test:integration` | build first, then integration tests |
| `npm run verify` | typecheck + unit + production build |

Every invocation of `scripts/build.mjs` (including `dev`, `verify`, and integration tests) consumes the next `0.1.N` build number; failed attempts may leave gaps. The counter is local in `.local/build-version.json` and is not reset by deleting `dist/`. If the counter is missing/corrupt, builds fail closed. For a crashed build, first verify no build is running and remove the stale `.local/build.lock`; then run `node scripts/recover-build-version.mjs <last-used-number>` and type `YES` at the prompt. Choose a number no lower than the committed `build-version-floor.json`; recovery never guesses or lowers a valid counter. Do not run concurrent builds in one checkout.

## Engine preparation

The UI can download the already pinned CfT 156.0.8078.80 using “Download Chromium”. See `docs/verification.md` for pin provenance and verification results. Alternative attachment and preparation of a new release are described below.

### Option A: attach an installed Chromium

1. Obtain a trusted Chromium/Chrome for Testing build and extract it.
2. In the application, click “Attach Chromium…” and select `chrome.exe`.
3. The application writes its path and SHA-256 to `%APPDATA%\Local Profiles\engine\external.json`.
4. The hash is checked before every launch; a replaced file blocks launch and must be attached again.

Playwright-installed Chromium (`%LOCALAPPDATA%\ms-playwright\chromium-*\chrome-win64\chrome.exe`) also works if you trust that build.

### Option B: pin a Chrome for Testing release

1. Download `chrome-win64.zip` for the required version from the official Chrome for Testing directory.
2. Independently establish the file's provenance (official domain, TLS, comparison with a known copy if needed).
3. Calculate the hash: `Get-FileHash .\chrome-win64.zip -Algorithm SHA256`.
4. Update `src/main/engines/releases.json`:
   ```json
   { "release": { "version": "156.0.8078.80", "url": "https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/win64/chrome-win64.zip", "sha256": "<sha256>" } }
   ```
5. Rebuild the application: `npm run build`.

The installer checks HTTPS, exact URL/version agreement, SHA-256, absence of unsafe paths and links in the archive, presence of `chrome.exe`, and the 500 MB limit, and only then atomically activates the engine. There is no auto-update.

## Data locations

`%APPDATA%\Local Profiles`:

- `profiles.sqlite` — profiles and encrypted secrets;
- `settings.json` — validated application settings, including explicit EN/RU interface language;
- `profiles/<uuid>/` — Chromium data;
- `engine/` — attached or downloaded engine;
- `runtime-<uuid>.json` — launch journal (its presence at startup means `blocked`).

The legacy directory name remains a compatibility requirement despite the Exodus Browser display branding. Do not change the corresponding Electron `app.setName` compatibility behavior or move existing data without a separately approved migration.

Development reset: close the application and delete the `Local Profiles` directory (or use a separate directory through `LOCAL_PROFILES_DATA` in development mode). This permanently deletes profiles and cookies.

## Test strategy

- **Unit** (`tests/unit`): validation, storage and secrets, engine adapter and installation, supervisor, IPC dispatcher, trusted-frame predicate, UI on jsdom.
- **Integration** (`tests/integration`):
  - `isolation.test.ts` — real Chromium: cookies/localStorage/IndexedDB are isolated and survive restart; uses a locally installed Playwright build, otherwise the test fails with `BLOCKED`;
  - `languages.test.ts` — real Chromium: checks the single selected language through `navigator.language`, `navigator.languages[0]`, HTTP Accept-Language, and Preferences with normal Accept-Language Reduction;
  - `app-smoke.test.ts` — Electron: offline profile creation, restricted preload, no Node in renderer, no external window requests, DPAPI roundtrip, and no plaintext password;
  - `sessions.test.ts` — real Chromium: ordered URL snapshots, opt-in restoration and start-page fallback, graceful and unexpected exit;
  - `cookies.test.ts` — real Chromium: isolated import/export and cookie clearing (including CHIPS), network isolation, and preservation of localStorage/IndexedDB;
  - `proxy.test.ts` — HTTP/CONNECT, authentication, percent signs in passwords, SOCKS5, no fallback, separate ports, unavailable upstream, IP checking;
  - `backups.test.ts` — roundtrip, rejection of unsafe paths/links/duplicates/size, no partial profile on failure;
  - `recovery.test.ts` — blocking when a process remains/inventory is unavailable;
  - `engine-installation.test.ts` — corrupted/interrupted downloads do not become ready.

Principles: a test must first fail for the expected reason; mock only slow/external boundaries; use real mechanisms rather than stubs for secrets and isolation.

## Adding an IPC operation

1. Add a method to `ProfileApi` (`src/shared/contracts.ts`).
2. Add a tuple schema to `schemas` (`src/main/ipc.ts`) and a safe error code/message mapping in `src/shared/i18n/messages.ts` if the operation can return a domain error.
3. Implement a handler in `src/main/index.ts` (main only; never expose paths/secrets).
4. Add a preload call (allowlist).
5. Update the UI and tests: dispatcher (invalid arguments), preload surface in the smoke test.

## Adding a profile field

1. `ProfileInput`/`Profile` in `contracts.ts`.
2. Schema in `validation.ts` (strict).
3. Migration in `repository.ts` (increment `user_version`).
4. `prepare`/`getLaunchInput` in `service.ts`.
5. Form, list, and tests.

## Troubleshooting

| Symptom | Cause and action |
|---|---|
| “Browser is not installed” | No engine: attach `chrome.exe` or pin a CfT release |
| Profile is `Blocked` | Chromium with this `user-data-dir` or a launch journal remains: close the browser window manually and restart the manager |
| “Proxy is unreachable” | No TCP access to host:port; check address, port, and firewall |
| “Proxy check failed” | 407/incorrect password/invalid service response; the password can be saved again |
| “Windows encryption is unavailable” | DPAPI unavailable; password not saved, profile works without it |
| “Engine checksum mismatch” | Downloaded archive corrupted or tampered with: remove `engine/.stage-*` and retry |
| “The attached Chromium file has changed” | Chromium updated itself: attach `chrome.exe` again |
| Application will not close | A browser has not exited: close its window manually and try exiting again |

Application logs deliberately exclude secrets and profile paths. For debugging, use `npm run dev` and renderer DevTools (F12 is unavailable in production builds under the window policy).

## Security when making changes

- Do not add `nodeIntegration`, disable `contextIsolation`/`sandbox`, or expand CSP unnecessarily.
- Do not accept paths, URLs, or arbitrary commands from renderer: file dialogs run in main.
- Do not log `ProfileInput`, proxy headers, or archive contents.
- Do not add automatic process termination based on PID.
- Do not substitute fake checksums or disable TLS verification.
- Do not use Dolphin binaries or branding. Reuse of its code and ideas is permitted by the user's 2026-10-30 decision, without branding or third-party binaries; this supersedes the earlier blanket prohibition on code reuse.
- Keep all tracked material, UI copy, comments, test names/fixtures, documentation, commit messages, and GitHub metadata in English. Chat may remain in Russian, but never publish Russian. Arbitrary user input and valid BCP47 locale data (including `ru-RU`) remain supported.
