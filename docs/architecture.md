# Exodus Browser architecture

This document describes the first version's components, data flows, contracts, and security boundaries. Requirements specification: `docs/superpowers/specs/2026-10-30-local-profile-manager-design.md`; implementation plan: `docs/superpowers/plans/2026-10-30-local-profile-manager.md`; actual verification results: `docs/verification.md`.

## 1. Purpose and scope

**Implementation checkpoint (2026-10-30):** SQLite schema v2 adds separate proxies with an encrypted secret and a profiles.proxy_id foreign key; a profile contains singleton `languages` for one selected site language. The shared entry is resolved into a snapshot before launch, and the active run holds the public proxy version. At this checkpoint, archives were written as v2 and read as v1/v2; older multi-value lists normalize to the first language without a SQLite migration. Chromium Accept-Language Reduction is not disabled. See STATUS.md for detailed acceptance status. Later fingerprint work adds archive v3, described below.

Exodus Browser is a local browser profile manager for Windows. Each profile is a separate ordinary Chromium process with a persistent data directory, keeping cookies, localStorage, IndexedDB, cache, and settings separate between profiles. Each profile has its own proxy configuration.

Original first-version boundaries (later fingerprint additions are described in section 3.9):

- no accounts, cloud, synchronization, or Dolphin API;
- no anti-detection or fingerprint spoofing (Canvas/WebGL/Audio, etc.) in the original scope;
- no guarantees against DNS/WebRTC/UDP leaks; a browser proxy is not a system VPN;
- no Dolphin profile import, installer, digital signature, or auto-update;
- no PAC, proxy chains, or authenticated SOCKS5.

## 2. Technology stack

| Layer | Technology |
|---|---|
| Shell | Electron 45 |
| Language | TypeScript, strict |
| Interface | React 19, custom CSS |
| Build | Vite 6 (renderer), esbuild (main/preload) |
| Metadata | SQLite through `better-sqlite3` |
| Validation | Zod |
| Proxies | `proxy-chain` |
| Archives | `yauzl` / `yazl` (streaming) |
| Tests | Vitest, Testing Library, jsdom, Playwright (`_electron`, Chromium) |

## 3. Components

```
┌──────────────────────── renderer (sandbox) ──────────────────────────┐
│ React UI: App, ProfileList, ProfileEditor, EngineSettings             │
│ window.profileApi (allowlisted methods only)                         │
└─────────────────────────────┬───────────────────────────────────────┘
                              │ IPC invoke (validation + trusted frame)
┌─────────────────────────────▼───────────────────────────────────────┐
│ main process                                                        │
│  ipc.ts / trust.ts  — operation dispatcher and sender validation     │
│  profiles/*         — SQLite, CRUD, safe paths                       │
│  security/secrets   — safeStorage (DPAPI)                            │
│  engines/*          — Chromium adapter, engine installation/attach   │
│  runtime/*          — Supervisor, launch journal, recovery           │
│  proxy/*            — loopback bridge, IP check                      │
│  backups/*          — ZIP backups, safe extraction                   │
└───────────────┬───────────────────────────┬─────────────────────────┘
                │ spawn (argv, no shell)   │ TCP 127.0.0.1 (bridge)
        ┌───────▼──────────┐       ┌───────▼──────────┐
        │ Profile Chromium │       │ Upstream proxy   │
        │ user-data-dir    │       └──────────────────┘
        └──────────────────┘
```

### 3.1 Renderer

- `src/renderer/App.tsx` — application state: list, statuses (polled once per second), search, editor, messages.
- `ProfileList.tsx` — cards, statuses, and actions; running/blocked profiles cannot be edited, copied, or deleted.
- `ProfileEditor.tsx` — profile form; username and password are not sent for SOCKS5.
- `EngineSettings.tsx` — engine status, “Attach Chromium…” and “Download Chromium”.
- `window.profileApi` — the only system channel; no direct access to Node.js, disk, or processes.

### 3.2 IPC

`src/main/ipc.ts`:

- fixed operation list and Zod argument tuple schemas;
- unknown operations, extra arguments, invalid UUIDs, or fields are rejected before service invocation;
- returns `Result<T> = {ok:true,value} | {ok:false,error:{code,message}}`;
- error text comes from a code allowlist; arbitrary exception messages, paths, and secrets are not returned.

`src/main/trust.ts` accepts a request only if:

1. `event.sender` is our window's `webContents`;
2. `senderFrame` is exactly `mainFrame` (not a nested or third-party frame);
3. the frame URL matches the built `dist/ui/index.html` URL.

### 3.3 Profile storage

`src/main/profiles/service.ts`:

- SQLite file `profiles.sqlite` in the application user-data directory; the original implementation used `user_version = 1` (the shared proxy directory checkpoint above upgrades it to v2);
- a profile is stored as JSON in a row; originally, the proxy secret used a separate encrypted column;
- outward-facing `Profile` contains no password, only `hasPassword`;
- profile directory is `<root>/profiles/<uuid>`; the user-provided name is not used in paths;
- optional session snapshots live at `<root>/sessions/<uuid>.json`; profile JSON stores `restoreLastSession` and a persistent uint32 fingerprint seed without a SQLite schema bump;
- `profilePath` rejects UUID substitution, symlinks, and escape from storage;
- original inline-proxy update behavior: `password: undefined` preserves the previous secret only when `kind/host/port/username` are unchanged; `password: ""` clears it;
- deletion: first check “profile stopped”, rename the directory to `trash-<uuid>`, delete the row, then remove the directory asynchronously.

### 3.4 Secrets

`src/main/security/secrets.ts` is a thin wrapper around `safeStorage`:

- `seal`/`open` throw `OS_ENCRYPTION_UNAVAILABLE` if OS encryption is unavailable;
- passwords are never written to SQLite as plaintext, passed in argv, or logged;
- passwords are excluded from backups.

### 3.5 Chromium engine

`src/main/engines/`:

- `types.ts` — `BrowserEngineAdapter`, `EngineLaunch`, `EngineProcess`, `ProxyLease`;
- `chromium.ts` — launch through `spawn` with an argument array (`shell: false`), persistent `--user-data-dir`, `--lang`, startup URLs, `--no-first-run`, `--no-default-browser-check`; for proxies, `--proxy-server` and `--proxy-bypass-list=<-loopback>`; only public fingerprint flags `--user-agent`, `--window-size`, and `--force-webrtc-ip-handling-policy` are added;
- `installation.ts` — two engine sources:
  - **attach installed engine**: the user selects `chrome.exe`; the application pins SHA-256 and checks the file on every launch; replacing the file blocks launch;
  - **CfT download**: explicit command only, official URL only, mandatory pinned SHA-256 from `releases.json`, 500 MB limit, safe extraction, atomic activation;
  - `releases.json` pins CfT 156.0.8078.80 for win64; without a pinned release, downloads are prohibited. Stable verification as of 2026-10-30: `docs/verification.md`.

### 3.6 Lifecycle

`src/main/runtime/supervisor.ts`:

- states: `stopped`, `starting`, `running`, `stopping`, `error`, `blocked`;
- per-profile mutex: concurrent `start(A)` calls produce exactly one launch;
- process inventory is checked before launch: a live Chromium with this `user-data-dir` blocks the profile;
- `runtime-<uuid>.json` is written after the observer is installed; its presence at the next startup puts the profile into `blocked`;
- browser exit closes the proxy bridge and removes the journal; late completion of an old run cannot displace a new one (run identity comparison);
- `withStopped` provides an exclusive lock for copying and editing;
- `stop` confirms process ownership (PID + executable + `user-data-dir`) before closing the window; unrelated processes are not terminated;
- `shutdown` stops all running profiles; the application does not silently exit on error.

`src/main/runtime/recovery.ts` takes a `chrome.exe` snapshot through `Get-CimInstance` (PID, path, creation time, command line). Unavailable inventory means `blocked`, not “everything is free”.

### 3.7 Proxies

- `proxy/bridge.ts` — separate loopback bridge per profile; upstream TCP reachability is checked before creation with a 10 s timeout; the bridge adds upstream authentication, the origin receives no `Proxy-Authorization`; library errors are not logged;
- `proxy/check.ts` — explicit external IP check through the same bridge; fixed service address, response limited to 64 KiB and validated as an IP; the service currently uses HTTP, disclosed next to the button and in documentation. There is no additional dialog. App stores success by UUID and `updatedAt` only in memory; ProfileList shows it in the matching card; a repeat check clears the previous result, and profile editing invalidates it. Errors use a separate message.

### 3.8 Backups

- creation only for a stopped profile under an exclusive lock;
- streaming ZIP: `manifest.json` (version 4) + `data/…`; the manifest carries the fingerprint, session preference, seed, and optional URL snapshot; proxy passwords are excluded; v1–v3 remain readable with safe defaults;
- restoration uses temporary `.restore-<uuid>`, validating the manifest, layout, version, duplicates, links, special files, device names, and limits (100,000 entries, 20 GiB based on bytes actually written);
- publication occurs only after successful extraction, with a new UUID; no visible profile appears on failure.

### 3.9 Fingerprint, geolocation, and CDP

`src/shared/fingerprint.ts` — model and strict Zod schema; `fingerprint-presets.ts` — “New fingerprint” from a local catalog for the engine version; `shared/user-agent.ts` — UA, Client Hints, and GPU/screen presets.

- `main/cdp/client.ts` — minimal DevTools protocol client: connects to `127.0.0.1` using a URL from stderr, 15 s to open WebSocket, 5 s per command, one session per profile. Waits up to 10 s for the devtools-URL line.
- `main/cdp/fingerprint.ts` — after connecting and before the first navigation, applies `Emulation.setTimezoneOverride`, `Emulation.setGeolocationOverride` (Manual only), and `Network.setUserAgentOverride` with `userAgentMetadata`, then `Page.addScriptToEvaluateOnNewDocument` with the bundled script (`Page.enable` is required before adding the script). If the browser has not created its initial page, launch waits up to 5 s rather than failing immediately. New targets (popups, `window.open`) receive the same settings; a target arriving with navigation already underway is reloaded once. Workers, devtools, and `chrome://` are excluded. An application failure closes the page and ends launch with `FINGERPRINT_UNAVAILABLE`.
- `main/sessions/*` tracks only eligible ordered tab URLs for normal managed launches; snapshots are bounded, atomic local files, debounced, and flushed before intentional or unexpected browser exit. Restore is profile-specific and opt-in; form state/history are not captured. Cookie-maintenance sessions do not use the tracker.
- `main/engines/spoof-script.ts` — injected script (string template with JSON configuration): deterministic Canvas/WebGL/ClientRects/Audio noise using a positional hash from `sha256(profileId)`, configured vendor/renderer, disabling `navigator.gpu`, overriding `hardwareConcurrency`, `deviceMemory`, `screen.*`, and `outer*`, removing `RTCPeerConnection` for WebRTC Off; Canvas/WebGL Off disable their respective APIs. The script is idempotent (`window.__LP_FP__`).
- Geolocation: Manual grants session permission and coordinates; Auto overrides nothing and retains the normal permission prompt.

### 3.10 Cookies: import and export

- `shared/cookies.ts` — `CookieInput` model, limits (5 MiB, 20,000 entries, field lengths), and strict Zod schema with `SameSite=None`, `__Secure-`, and `__Host-` requirements.
- `main/cookies/parse.ts`, `netscape.ts`, `normalize.ts` — file reading (strict UTF-8, BOM, size limit), format detection, normalization of Dolphin JSON (expiry scale, booleans, special names, `facebook.com`) and Netscape (include-subdomains field, `#HttpOnly_`); any invalid entry rejects the entire file.
- `main/cookies/serialize.ts` — JSON and Netscape export.
- `main/cookies/session.ts` — temporary headless Chromium using the same `user-data-dir`: dead loopback proxy, DNS blocked, background traffic disabled, no navigation; `Network.setCookies` in the `about:blank` session, `Storage.getCookies` on the browser connection, closure through `Browser.close` while awaiting process exit.
- `main/cookies/service.ts` — import/export under `withStopped`, orphan-browser check, readback by `domain+path+name`, atomic file writing, closing all sessions during application exit.
- Cookie clearing uses a separate confirmation and Chromium `Storage.clearCookies`, verifies a raw zero-cookie count including partitioned entries, and requires clean maintenance-session closure; other site storage is not cleared.
- `main/cookies/operations.ts` and `index.ts` — open/save dialogs in main; renderer receives only `{count, fileName}`.
- Profile cards provide “Import cookies…” and “Export cookies…” (JSON or Netscape), only for stopped profiles; the result shows a count and filename.

## 4. Data on disk

`%APPDATA%\Local Profiles`:

| Path | Contents |
|---|---|
| `profiles.sqlite` | profiles, public settings, encrypted secrets |
| `profiles/<uuid>/` | profile Chromium data |
| `engine/current/` | downloaded engine (if pinned) |
| `engine/external.json` | attached `chrome.exe` path and SHA-256 |
| `runtime-<uuid>.json` | active-run journal |

The legacy data path and compatibility-related Electron `app.setName` behavior must remain unchanged by display-only renaming to Exodus Browser; any data migration requires separate approval.

The Dolphin directory (`C:\Program Files\Dolphin Anty`, its profiles and settings) is neither read nor modified.

## 5. Profile launch flow

1. UI calls `start(id)`.
2. The dispatcher checks the trusted frame and UUID.
3. Supervisor acquires the mutex and checks that the profile is not running and no unrelated process uses its directory.
4. The proxy password is decrypted; if a proxy is configured, a loopback bridge is created.
5. The adapter checks the engine and launches Chromium.
6. Before the first navigation, CDP connects and applies the fingerprint, timezone, and (for Manual) geolocation; failure closes the browser and sets state to `error`.
7. The journal is written; state becomes `running`.
8. On browser exit: the bridge closes, the journal is removed, and state becomes `stopped` or `error`; failed stopping results in `blocked`.

## 6. Threat model and protections

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP without `unsafe-eval`, navigation/new-window/webview/permission prohibition.
- IPC: tuple validation, sender and main-frame checks, error-message allowlist.
- Files: UUID directories, symlink checks, restore staging, no escaping storage.
- Processes: no-shell launch, ownership check before closure, no automatic killing by PID.
- Secrets: DPAPI, fail-closed when encryption is unavailable, no secrets in DTOs, argv, or logs.
- Network: loopback-only bridge, no DIRECT fallback, upstream certificate verification.

## 7. Limitations and known gaps

- Successful HTTPS upstream is not covered by an automated test (requires a trusted test CA); the code does not disable certificate verification.
- IP checking uses an HTTP service; an on-path attacker can alter the response, which is disclosed to the user.
- After `STOP_TIMEOUT`, the browser is not forcibly terminated; the profile remains `blocked`.
- Backups include Chromium cache and can be large; no progress is shown.
- Backups may contain cookies Chromium binds to a Windows account; transfer to another user is not guaranteed.
- Installer, signing, and auto-update are outside the first version. Fingerprint spoofing is limited to implemented fields; script-based overrides are distinguishable from a real browser, and the CDP debugging port is accessible to local processes while the profile runs.
