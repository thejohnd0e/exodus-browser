# Exodus Browser

A local browser profile manager for Windows. Each profile runs in a separate Chromium process with its own persistent data directory: cookies, localStorage, IndexedDB, cache, and settings are not shared between profiles. A proxy is configured separately for each profile.

The application requires no account, subscription, cloud, or Dolphin servers. It does not use Dolphin's engine or branding. Reuse of Dolphin code and ideas is permitted by the user's 2026-10-30 decision, without its branding or third-party binaries.

> **Profile isolation is not anti-detection.** A profile can override selected fingerprint parameters (User-Agent and Client Hints, timezone, Canvas/WebGL/Audio, screen, CPU/memory, WebRTC, Manual geolocation), but script-based overrides are distinguishable from a real browser, TLS/JA3 is not disguised, and sites may still link profiles using other signals. A browser proxy is not a system VPN: elimination of all DNS/WebRTC/UDP leaks is not guaranteed.

## Features

- Create, edit, search, launch, and stop profiles.
- Separate cookies, localStorage, IndexedDB, and cache for each profile.
- Run different profiles in parallel; launching the same profile twice is prohibited.
- HTTP/HTTPS proxies with optional authentication and unauthenticated SOCKS5 (one per profile).
- Explicit external IP check through the selected proxy.
- ZIP backups of stopped profiles and restoration into a new profile.
- Profile fingerprint: OS and User-Agent, WebRTC, Canvas, WebGL and WebGL Info, WebGPU, ClientRects, Audio, timezone, Manual geolocation, CPU/memory, and screen. “New fingerprint” builds a consistent set for the attached engine version; a summary appears in the card.
- Recovery after a manager crash: the profile is blocked until its browser is closed manually. Unrelated processes are not terminated.
- English interface, entirely local metadata storage in SQLite.

## Requirements

- Windows 10/11 x64.
- Node.js 22+ and npm.
- Separate Chromium: download it through the application or attach a trusted build (see below). Your personal Chrome profile is not used.

## Install and run

> **The proxy directory and language selection changes have not yet completed full manual acceptance.** The new build upgrades SQLite to v2; before using existing data, close the manager and browsers and save a complete copy of `%APPDATA%\Local Profiles`. Older builds cannot read v2. Development and testing have not migrated the user's real database.

```powershell
npm ci
npm run build
npm start
```

Development: `npm run dev` (build + launch Electron).

## Application data

Metadata and profile directories are stored in the legacy location `%APPDATA%\Local Profiles`:

- `profiles.sqlite` — profiles, settings, and encrypted proxy passwords;
- `profiles\<uuid>\` — Chromium data for the corresponding profile;
- `engine\` — installed engine;
- `runtime-<uuid>.json` — running browser journal.

The Exodus Browser display name does not imply a data-directory migration. Preserve the compatibility-related Electron `app.setName` behavior and legacy storage location unless a migration is separately approved.

Proxy passwords are encrypted by Windows DPAPI through Electron `safeStorage`; they are not written as plaintext to the database, logs, or command line. If OS encryption is unavailable, the password is not saved.

## Chromium engine and checksum

The application needs a separate Chromium. There are two explicit ways to provide it.

**1. Attach an installed Chromium.** “Attach Chromium…” opens a file picker; select `chrome.exe` from a Chromium build you trust (for example, manually extracted Chrome for Testing). The application stores the path and file SHA-256 and checks before every launch that the file has not changed. If replaced, launch is blocked until it is attached again. The user is responsible for the selected file's provenance; the application neither downloads nor replaces it.

**2. Download Chrome for Testing.** “Download Chromium” downloads official Chrome for Testing from `storage.googleapis.com` **only on explicit request**, and only if `src/main/engines/releases.json` pins a release with SHA-256.

The repository pins Chrome for Testing **156.0.8078.80** for Windows x64; click “Download Chromium” to install it in the application directory. As of 2026-10-30, this version matches the Stable channel in the [official metadata](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json). The application does not automatically select a newer version. To replace the pinned release, the build maintainer must:

1. Download `chrome-win64.zip` for the required version from the official Chrome for Testing directory.
2. Independently establish the file's provenance (official directory, TLS, stable network/known copy).
3. Calculate SHA-256: `Get-FileHash .\chrome-win64.zip -Algorithm SHA256`.
4. Update `src/main/engines/releases.json`:
   ```json
   { "release": { "version": "156.0.8078.80", "url": "https://storage.googleapis.com/chrome-for-testing-public/156.0.8078.80/win64/chrome-win64.zip", "sha256": "<sha256>" } }
   ```
5. Rebuild the application (`npm run build`).

The verified archive SHA-256 and installation results are in [docs/verification.md](docs/verification.md). The hash pins a specific archive but is not independent proof of its provenance: the initial download trusts TLS to Google's official server. Without a pinned release, downloads are prohibited, while profile management continues to work offline.

The “Chrome for Testing is only for automated testing” banner is normal for this build; the application does not suppress it using test flags or by disabling security warnings.

Installation verifies HTTPS and the exact official URL, version format, downloaded archive SHA-256, safe extraction (no `..`, absolute paths, links, or special files), presence of `chrome-win64\chrome.exe`, and an archive size of at most 500 MB. Only then does the directory atomically become the current engine. There is no engine auto-update.

## Proxies

### Connection directory (new implementation)

The “Proxies” section creates named connections with type, address, port, and authentication. A profile selects a saved entry or “No proxy”; a new entry can be added from the form without losing the draft. Multiple profiles can use one proxy. Edits to a shared entry apply at the next launch; an already running browser keeps its previous settings. IP checking checks the current saved entry and does not prove the route of a browser using an older snapshot.

Assigned proxies cannot be deleted: remove profile references first. Unlinking does not delete the entry, nor does deleting a profile. During migration, old embedded connections become separate entries even when addresses match, because passwords may differ.

### Profile languages

The editor offers one site language, searchable by name and BCP47 code; codes outside the built-in catalog are allowed. The language can differ by profile. It is saved in Preferences and passed through `--lang`. Chromium may reduce language preferences for privacy; the application does not disable this protection. The browser UI language depends on the build's resources. There is no IP-based autodetection. Valid locale codes such as `ru-RU` and arbitrary user input remain supported; the repository's English-only publication policy does not restrict such data.

- HTTP and HTTPS: optional username and password.
- SOCKS5: no authentication.
- PAC, proxy chains, and authenticated SOCKS5 are unsupported.
- Each launch creates a local proxy bridge listening only on `127.0.0.1`; Chromium uses it, and the bridge adds upstream authentication. Proxy failure does not result in a direct connection.
- HTTPS upstream certificates are checked against system trust.
- IP checking runs only on button click, without a separate dialog. A warning next to the button states that `http://api.ipify.org?format=json` is used; the HTTP response can be altered, and the service sees the proxy IP. The result appears in the profile card without a URL and is not persisted; it is cleared on repeat checking, profile editing, or manager restart. Errors are displayed separately from the result.
- Chromium receives `--proxy-bypass-list=<-loopback>`. The original documentation stated that production builds did not open a remote debugging port; later fingerprint implementation uses a loopback-only CDP debugging port, as described in the security section below.

## Cookies

- Cookie import/export is available from a stopped-profile card: JSON (Dolphin format) and Netscape `cookies.txt`. Both formats can be read and written.
- Import adds cookies and overwrites matches (`domain + path + name`); there is no “replace all” mode. httpOnly and session cookies persist.
- A temporary headless browser uses the same profile directory but **has no network access**: dead loopback proxy, blocked DNS, and disabled background traffic. Import/export therefore does not depend on the profile proxy; launching the profile itself still fails when the proxy is unavailable.
- Cookie values are not shown in the UI, logs, or messages: only the entry count and filename are visible.
- Partitioned (CHIPS) cookies and `storeId` mode are unsupported; limits are 5 MiB and 20,000 entries per file.

## Backups

- Only a stopped profile can be copied; running or blocked profiles cannot be backed up.
- A backup contains profile data and a settings manifest (version 3, including the fingerprint), but **not** the proxy password — enter it again after restore. Version 1 and 2 archives are readable, with fingerprint defaults supplied.
- Backups contain cookies and other sensitive data: store them securely.
- Restore creates a new profile with a new UUID, validates manifest version, paths, links, duplicates, and limits (100,000 entries, 20 GiB), writes to a temporary directory, and publishes the profile only after successful extraction.
- Chromium-encrypted cookies may be bound to a Windows account; working cookies are not guaranteed to transfer to another computer.

## Limitations and security

- The renderer is isolated: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; only the narrow typed `window.profileApi` API is available.
- All IPC arguments are schema-validated; requests are accepted only from the main frame of the application's own window.
- The window does not open external sites or new windows; navigation and webview are prohibited; CSP has no `unsafe-eval`.
- Chromium launches without a shell, with arguments passed as an array; passwords never enter argv. The profile User-Agent is visible in the process command line so popups receive it before the first navigation.
- While a profile is running, its CDP debugging port is accessible to local processes: it listens only on `127.0.0.1` on an ephemeral port, its URL is not logged, and its session lasts as long as the browser.
- The application's appearance and copy do not use Dolphin branding; installed Dolphin data is neither read nor modified.
- Dolphin profiles are not imported.

## Checks

```powershell
npm run verify          # typecheck + unit + production build
npm run test:integration
```

Isolation integration tests launch real local Chromium: they use an existing Playwright Chromium installation if present; otherwise they report `BLOCKED`. Results on the current machine and uncovered scenarios are listed in [docs/verification.md](docs/verification.md).

## Documentation

- [AGENTS.md](AGENTS.md) — instructions for agents (Codex, Claude Code, OpenCode) and everyone modifying the repository.
- [STATUS.md](STATUS.md) — current state, verified behavior, and next step.
- [TODO.md](TODO.md) — prioritized work list.
- [docs/architecture.md](docs/architecture.md) — components, data flows, IPC, security model.
- [DECISIONS.md](DECISIONS.md) — decisions, trade-offs, and deferred improvements.
- [docs/development.md](docs/development.md) — builds, engine preparation, tests, troubleshooting.
- [docs/verification.md](docs/verification.md) — verified behavior, blockers, and manual scenarios.
- [docs/superpowers/specs/2026-10-30-local-profile-manager-design.md](docs/superpowers/specs/2026-10-30-local-profile-manager-design.md) — specification.
- [docs/superpowers/plans/2026-10-30-local-profile-manager.md](docs/superpowers/plans/2026-10-30-local-profile-manager.md) — implementation plan.

## Structure

- `src/shared` — DTOs and Zod schemas;
- `src/main/profiles` — SQLite, profiles, safe paths;
- `src/main/security` — secret encryption;
- `src/main/engines` — Chromium adapter and engine installation;
- `src/main/runtime` — lifecycle and recovery;
- `src/main/proxy` — bridge and IP checking;
- `src/main/backups` — ZIP backups and safe restoration;
- `src/renderer` — React UI.
