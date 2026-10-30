# Project status

**State:** profile management, proxies, backups, profile fingerprints, and cookie import/export are implemented. Automated checks pass; manual UI acceptance and the full user scenario are not yet complete.

- Branch: `master`; after handoff, the visibility of the “New fingerprint” button was fixed and an Electron regression test was added.
- A private GitHub repository, `thejohnd0e/exodus-browser`, was prepared for the initial upload; the chosen name is Exodus Browser. At that checkpoint, UI renaming and duplicate-heading removal had not yet been implemented. `.gitignore` excludes local settings, secrets, browser data, and artifacts; source, tests, and project documentation remain in Git.
- English publication update (2026-10-31): source, UI copy, errors, tests, current/historical documentation, and GitHub description are English. Display branding is Exodus Browser; `app.setName('Exodus Browser')` is paired with an explicit legacy `%APPDATA%\Local Profiles` userData path, so no data migration occurs. New profiles default to `en-US`; existing languages and arbitrary Unicode user data remain supported. Previous history is preserved locally under `refs/archive/pre-english-2026-10-31` and in a verified standalone bundle outside the repository; publication replaces remote `master` with an English root snapshot using an exact-hash force-with-lease. Never publish the archive or mirror-push this repository.
- English publication checks (2026-10-31): `npm run verify` PASS (146/146 unit across 25 files, typecheck, build); `npm run test:integration` PASS (37/37). The first integration run had a cleanup-only Windows `EBUSY` in the WebRTC test; a targeted rerun and a full rerun passed without code changes. Fresh-context review found no Critical/Important issues and verified a fresh-appData startup on Electron 45.1.0 without touching real user data. Minor documentation/test-description follow-ups remain in `TODO.md`.
- Supplied artwork integration (2026-10-31, local changes): the native window and document favicon use `ico/exodus-icon.png`; the sidebar uses `ico/exodus-wordmark.png` instead of the letter badge/text. esbuild emits the native icon under `dist/assets`; Vite bundles local renderer assets. `npm run verify` PASS (147/147 unit, typecheck, build); `npm run test:integration` PASS (38/38). Original artwork is unchanged; installer/executable-resource branding is not implemented. GitHub recreation and publication of these local icon changes are postponed until separately requested.
- Stack: Electron 45, TypeScript, React 19, SQLite (`better-sqlite3`), Vitest, Playwright.
- Latest checks after cookie implementation (2026-10-31): `npm run verify` — 141/141 unit, typecheck, and production build PASS; `npm run test:integration` — 36/36 across 9 files PASS, including cookies on real Chromium. The implementation was reviewed; subsequent fixes are covered by tests.
- After the button fix (2026-10-31): `npm run verify` — PASS (141/141 unit, typecheck, build); `npm run test:integration` — PASS (37/37). The transparent-background rule is restricted to the editor close button; the Electron test checks the opaque background and text contrast of “New fingerprint” without hover (excluding disabled-opacity), as well as the close button's existing transparent background. Before the fix, the test failed on the transparent background. Manual acceptance remains open.
- Verification environment: Windows x64, Node.js 22.23.4, npm 10.9.9. `@playwright/test` 1.64.1 expects Chromium revision 1248; this machine has 1228, so the isolation test uses it from `%LOCALAPPDATA%\ms-playwright`.

## Completed

- Profiles: create, edit, search, launch, stop, delete; metadata survives restart.
- Isolation: each profile has a separate Chromium directory and process; cookies, localStorage, and IndexedDB remain separate and persist after restart (verified on real Chromium).
- Per-profile proxies: authenticated HTTP/HTTPS, unauthenticated SOCKS5, loopback bridge, no DIRECT fallback, upstream reachability check, external IP check on request.
- IP check without modal confirmation: warning next to the button, success in the profile card, separate errors. The result is temporary and cleared on repeat checking/editing. The new UX is covered by UI and Electron tests; manual assessment of the new build is still pending.
- Secrets: proxy passwords are DPAPI-encrypted through `safeStorage`, never appear as plaintext in SQLite, argv, DTOs, or logs; verified by a real Electron test with restart.
- Engine: explicit attachment of an installed `chrome.exe` with SHA-256 pinning and prelaunch verification; Chrome for Testing download from pinned release 156.0.8078.80 was verified through the UI on 2026-10-30 — the engine is installed in the application directory and in use.
- Backups: ZIP only for stopped profiles, restore into a new UUID, protection against unsafe paths, links, duplicates, and exceeded limits; manifest v3 carries the fingerprint, v1/v2 load with defaults.
- Shared proxy directory: multiple profiles can reference a saved connection; secrets are encrypted, deletion of assigned entries is prohibited, edits apply on the next launch.
- Profile language: a single searchable selection field; older profiles and v2 backups with multiple languages use the first. Accept-Language Reduction remains enabled.
- Fingerprint: OS/UA, WebRTC, Canvas, WebGL and WebGL Info, WebGPU, ClientRects, Audio, timezone, geolocation, CPU/memory, and screen. Editor with an engine-version-aware “New fingerprint” button, card summary, warning for WebRTC Off. Native parameters are applied through CDP before the first navigation; script-based parameters use an injected script with deterministic noise seeded by `sha256(profileId)`. Verified by unit/UI tests and real Chromium; manual testing on CfT 156 remains pending.
- Cookies: JSON (Dolphin) and Netscape import/export from a stopped-profile card. The temporary headless browser has no network access (dead loopback proxy, DNS blocked, no navigation), so import does not depend on the proxy; httpOnly and session cookies persist; limits are 5 MiB and 20,000 entries; partitioned cookies are unsupported.
- The main screen no longer repeats local-storage slogans; statistics show only total and running profile counts.
- Lifecycle: double launch prevented, exclusive lock for copying/editing, `blocked` when a browser remains, no automatic killing of unrelated processes.
- IPC and window: `contextIsolation`, `sandbox`, `nodeIntegration: false`, CSP, preload method allowlist, main-frame and document-URL checks, navigation/new-window prohibition.
- Documentation: `README.md`, `docs/architecture.md`, `DECISIONS.md`, `docs/development.md`, `docs/verification.md`, specification and plan under `docs/superpowers/`.

## Currently working

- Profile management is entirely local and offline.
- Launching isolated Chromium with a manually attached engine — supported by code and unit tests; the end-to-end manual UI scenario has not yet been performed (see below).
- Proxies and backups — verified by integration tests against local servers; archive versions 1/2 are covered.
- The application builds and opens; an Electron test verifies profile creation and absence of external window requests.

## In progress / not manually verified

1. **End-to-end profile launch through the UI with an attached Chromium.** Automated tests check the adapter on real Chromium and engine attachment separately, but not the “button → attach → launch → isolation → stop” chain in the built Electron application.
2. **Real external authenticated proxy:** not yet verified. The user performed a real IP check through an unauthenticated HTTP proxy (screenshot); the result matched independent curl output. This does not cover password handling or failure without DIRECT.
3. **Application exit dialogs** (Cancel / Stop and exit) and **manager crash** with real Chromium: logic is unit-tested, but the manual scenario has not been performed.
4. **HTTPS upstream:** a successful connection is not covered by an automated test (requires a trusted test CA); certificate verification is not disabled.
5. **CfT 156 in the language test:** Playwright Chromium 149 is verified. Launching a page on installed CfT 156 from the agent environment previously returned no report; this is a verification limitation in the agent environment, not a confirmed browser defect.
6. **Fingerprint on CfT 156:** all fingerprint and geolocation integration checks run on local Playwright Chromium 149. Manual testing on pinned CfT 156 (UA, Client Hints, timezone, screen, CPU/memory, Canvas/WebGL, WebRTC, Manual geolocation) has not been performed; fingerprint acceptance cannot be closed without it.
7. **Cookies through the UI:** automated tests check the session, formats, network isolation, and card, but the manual scenario with actual Electron open/save dialogs has not been performed. This is the recommended next step.

## Known issues and limitations

- **Language limitation:** one BCP47 code is selected per profile. Chromium retains Accept-Language reduction for privacy; exposing multiple languages to sites is deliberately unsupported. Older records and v2 backups with multiple locales use the first language; empty/invalid data is rejected. SQLite remains schema v2.

- IP checking uses HTTP (`api.ipify.org`); an on-path attacker can alter the response. Disclosed in the UI and README.
- After `STOP_TIMEOUT`, the browser is not forcibly terminated; the profile remains `blocked` until manually closed.
- Backups include Chromium cache and can be large; no progress is shown.
- No installer, digital signature, or auto-update.
- No PAC, proxy chains, or authenticated SOCKS5. Fingerprint spoofing is limited to implemented fields; no network/TLS camouflage is claimed.
- Cookies: CHIPS/partitioned and `storeId` are not implemented; no “replace all” mode. The export menu does not yet close on Escape/outside click; a previous result message may remain after a failed operation. Values over 4096 bytes may pass our schema but be rejected by Chromium.
- Complete protection against DNS/WebRTC/UDP leaks is not guaranteed.
- Integration tests depend on locally installed Playwright Chromium; without it, the isolation test reports `BLOCKED`, not PASS.

## Exact next step

First manually accept cookie import/export in Electron using actual dialogs and separate temporary storage. Check JSON and Netscape in both directions, dialog cancellation, operation results, rejection for running profiles, and absence of cookie values in the UI. Safe launch example:

```powershell
$env:LOCAL_PROFILES_DATA = Join-Path $env:TEMP ('local-profiles-handoff-' + [guid]::NewGuid())
npm run dev
```

Do not run the new build against the real `%APPDATA%\Local Profiles` without separate agreement on migration and a backup. Record results in `docs/verification.md`.

After manual acceptance, record the date, versions, and outcome in `docs/verification.md`, then mark the corresponding item in `TODO.md`. Next continue the remaining P0 manual end-to-end acceptance in `TODO.md` (two profiles, launch/stop, proxy, and application exit). Do not use the real database without separate approval and a backup.

## What the next agent should inspect

- `AGENTS.md` — shared agent instructions: read before working.
- `src/renderer/App.tsx` and `src/renderer/styles.css` — main window, local copy, and statistics.
- `src/renderer/LanguagePicker.tsx`, `src/shared/validation.ts` — single-language selection and compatibility.
- `src/main/profiles/{repository,service}.ts` and `src/main/backups/service.ts` — schema v2, normalization of older languages/fingerprints, v1/v2/v3 archives.
- `src/main/runtime/supervisor.ts` — lifecycle, locks, launch journal, exit handling.
- `src/main/engines/installation.ts` and `src/main/engines/chromium.ts` — engine attachment/download, hash pinning, launch.
- `src/main/index.ts` — service assembly, IPC handlers, dialogs, application exit.
- `src/main/cookies/{service,session,operations,parse,netscape,normalize,serialize}.ts` — import/export, isolated CDP session, and cookie formats.
- `src/shared/cookies.ts`, `src/shared/contracts.ts`, `src/main/ipc.ts`, `src/preload/index.ts` — cookie schema, secure IPC contract, and errors.
- `src/renderer/ProfileList.tsx`, `src/renderer/App.tsx` — cookie actions in the profile card; `tests/integration/cookies.test.ts` — real Chromium checks.
- `src/main/ipc.ts` and `src/main/trust.ts` — IPC contract and trusted-frame validation.
- `src/main/backups/{archive,service}.ts` — safe extraction and profile publication.
- `src/main/proxy/{bridge,check}.ts` — bridge, timeouts, IP check.
- `tests/integration/` — real scenarios; `tests/unit/` — contracts and states. In particular: `languages.test.ts`, `backups.test.ts`, `app-smoke.test.ts`.
- `DECISIONS.md` — rationale and deferred improvements.
