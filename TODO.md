# TODO

Priorities: P0 — blocks a reliable handoff, P1 — important quality/security, P2 — improvements, P3 — outside the first version. Mark items complete only after verification; record manual scenario results in `docs/verification.md`.

## P0 — manual end-to-end verification

- [ ] **Manual end-to-end acceptance of the build with isolated storage.**
  The shared proxy directory and single selectable language are implemented and pass automated tests. Remaining UI scenarios cover two profiles, start/stop, IP checking, and application exit. Use `LOCAL_PROFILES_DATA` from `STATUS.md`; do not touch the real database without approval.

- [ ] **Manual acceptance of cookie import/export in Electron.**
  Recommended next step: open the build with a separate `LOCAL_PROFILES_DATA`, check real open/save dialogs, JSON/Netscape import and export in both directions, dialog cancellation, result messages, and rejection for running profiles. Ensure the UI does not show cookie values; record results in `docs/verification.md`.
  Files: `src/main/cookies/operations.ts`, `src/main/index.ts`, `src/renderer/ProfileList.tsx`, `src/renderer/App.tsx`, `tests/integration/cookies.test.ts`.

- [ ] **Extend migration/restore failure injection.**
  Non-blocking review finding: the current migration rollback test fails during prevalidation, and the restore test fails before directory publication. Add failures after the migration SQL write and after the restore rename but before commit.

- [ ] **Launch a profile through the UI with an attached Chromium.**
  Steps: `npm run build`, `npm start`, “Attach Chromium…”, select a trusted `chrome.exe`, create and launch a profile.
  Done when: the browser opens with a separate `--user-data-dir`, the profile shows `Running`, and “Stop” correctly closes the window and changes the state to `Stopped`.
  Files: `src/main/index.ts`, `src/main/engines/*`, `src/main/runtime/supervisor.ts`.

- [ ] **Manually check two simultaneous profiles and isolation.**
  Done when: A and B run in parallel, cookies/login in A are not visible in B, A retains data after restart, and a second launch of A is rejected.
  Record the result in `docs/verification.md`.

- [ ] **Check exit dialogs and crash handling.**
  Scenarios: closing with an active browser → “Cancel” leaves everything running; confirmation stops the browsers; killing the manager leaves the profile `Blocked` until Chromium is closed manually.
  Files: `src/main/index.ts`, `src/main/runtime/*`.

- [ ] **Check a real authenticated proxy and “Check IP”.**
  Done when: the profile connects through the proxy, an incorrect password produces a clear error without a direct connection, and the IP check shows the proxy address.
  Files: `src/main/proxy/*`.

## P1 — engine and proxies

- [x] **Pin a verified Chrome for Testing release.**
  Completed 2026-10-30: pinned 156.0.8078.80 (official URL, SHA-256 `16edb57d…0f`, initial trust relies on TLS to the official bucket, size checked against Content-Length); UI installation verified — see `docs/verification.md`. The version and win64 URL matched the Stable channel in the official `last-known-good-versions-with-downloads.json`; the previous 404 was caused by an incorrect endpoint.

- [ ] **Add a successful HTTPS-upstream test.**
  Requires a local proxy with a certificate from a test CA and explicit trust in that CA during the test; separately check rejection of a self-signed certificate.
  Files: `tests/integration/proxy.test.ts`, `src/main/proxy/bridge.ts`.

- [ ] **IP checking over HTTPS.**
  Implement CONNECT through the bridge and TLS to the checking service, or document the final decision not to use HTTPS. Do not disable certificate verification.
  Files: `src/main/proxy/check.ts`.

## P2 — operational quality

- [ ] **English-publication review follow-ups (nonblocking).**
  Clarify display-name versus explicit legacy userData wording in README, DECISIONS, and architecture; align documented “Attach Chromium…” labels with the UI's “Link Chromium…”; rename the validation test description that still mentions Russian-name coverage despite its English fixture. Unicode coverage is retained by separate tests. Add a permanent isolated fresh-appData startup regression: independent review already verified the pinned Electron runtime successfully, but existing smoke uses a pre-created override directory.

- [x] **Remove IP-check confirmation and move success into the profile card.**
  2026-10-30: service/HTTP warning next to the button, IP without a URL or global banner; repeat checks and edits clear the result. UI and Electron regressions pass; manual assessment of the new appearance is pending.

- [x] **Extend UI regression coverage to proxy-password-only changes.**
  The new shared-directory test changes only the proxy password/version, retains the other profile fields, and checks that the IP is cleared. Included in the current passing `npm run verify`.

- [ ] **Forced termination policy after `STOP_TIMEOUT`.**
  Allow kill only for a verified profile process tree (PID + executable + user-data-dir + creation time), with a test rejecting an unrelated process.
  Files: `src/main/engines/chromium.ts`, `src/main/runtime/supervisor.ts`.

- [ ] **Backup progress and cache exclusion.**
  Decide whether Chromium cache belongs in a “full copy”; document it if excluded. Add a progress indicator and cancellation.
  Files: `src/main/backups/service.ts`, `src/renderer/App.tsx`.

- [ ] **Clear archive cleanup errors.**
  Do not mask the original extraction error with an `EBUSY` error when removing staging; use a separate code for busy files.
  Files: `src/main/backups/archive.ts`, `src/main/backups/service.ts`.

- [ ] **IPC test from a nested/third-party frame.**
  The trusted-frame predicate is currently covered by a unit-test matrix; add an Electron test with an iframe/navigation.
  Files: `tests/integration/app-smoke.test.ts`, `src/main/trust.ts`.

- [ ] **Update IP-check tests after any service/scheme change**, if one occurs.

## P3 — outside the first version

- [ ] Installer, digital signature, application auto-update.
- [x] **Basic fingerprint:** OS/UA, WebRTC, Canvas/WebGL/WebGL Info/WebGPU/ClientRects/Audio, timezone, Manual geolocation, CPU/memory/screen; editor with “New fingerprint”, card summary, backup v3. Covered by unit/UI tests and real Chromium; manual testing on CfT 156 has not yet been performed.
- [x] **Cookies:** JSON (Dolphin) and Netscape import/export from stopped-profile cards; temporary network-isolated headless session, httpOnly/session, limits, and errors. Covered by unit/UI tests and real Chromium.
- [ ] **Fingerprint: next phase:** Android/iOS, MAC and device name, WebGPU Manual Info, fonts, TLS/JA3, IP-based geolocation, full Dolphin profile import.
- [ ] **Cookies: next phase:** partitioned (CHIPS) cookies and `storeId`, per-site cookie management, “replace all” mode — deliberately not implemented.
- [ ] Cloud synchronization, teamwork, public API.
- [ ] PAC, proxy chains, authenticated SOCKS5.
- [ ] Embedded tabs instead of separate browser windows.

## Maintenance rules

- Use TDD for new functionality: first a test that fails for the expected reason, then the minimal implementation.
- Do not log secrets, proxy headers, or profile contents.
- Do not kill processes based on PID alone or disable TLS verification.
- After changes, run `npm run verify` and `npm run test:integration`.
- Record manual verification results in `docs/verification.md` with dates and versions.
